// Quotes get a real Resend (2026-10-22). Download Estimate PDF's bad-email
// error told Steve to "fix it and use Resend from the Recent Quotes list,"
// but quotes had no resend at all, and logQuote() never even saved
// clientEmail on the entry -- there was nothing to resend with
// (docs/ACTION-ITEMS.md's bug-lane note on this).
//
// resendQuoteToClient() deliberately does NOT just call
// sync-quote-to-portal the way resendInvoiceToClient does, because that
// function only emails the client when the quote is new to the portal or
// the client is brand new -- see tests/tools/portal-invoice-quote-resend.test.js
// for the exact bug that was for the clients.html portal panel (fixed
// 2026-09-22 by calling send-quote-notification directly). This file
// confirms the Invoice Log tab's own quote Resend was built the same
// correct way from the start: an unchanged email calls
// send-quote-notification directly (always actually emails, or reports a
// real opt-out); a changed email still goes through sync-quote-to-portal
// (it has to move/create the portal row).
//
// Runs the real resendQuoteToClient() from tools/invoice-generator.html
// and the real showPromptForm() from tools/tools-dialogs.js in jsdom.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const PAGE = fs.readFileSync(path.join(TOOLS, 'invoice-generator.html'), 'utf8');
const DIALOGS = fs.readFileSync(path.join(TOOLS, 'tools-dialogs.js'), 'utf8');
const RESEND = PAGE.match(/  async function resendQuoteToClient\(quoteId\) \{[\s\S]*?\n  \}\n/)[0];

const QUOTE = { id: 1790448760000, quoteNumber: 'EST-2026-0042', clientName: 'Silver Silo Bakery',
  clientEmail: 'old@example.com', date: '2026-10-20', total: 340.5, jobRefTitle: 'Dryer vent cleaning',
  line_items: [{ desc: 'Labor', amount: 340.5 }] };

function setup({ quote = QUOTE, confirm = true, resendResult = { ok: true } } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/invoice-generator.html', runScripts: 'outside-only' });
  const w = dom.window;
  const out = { sent: [], mirrored: [], toasts: [], confirms: [], renders: 0 };
  w.localStorage.setItem('th_quotes', JSON.stringify([quote]));
  w.SUPABASE_URL = 'https://x.supabase.co';
  w.SUPABASE_ANON_KEY = 'anon';
  w.getAuthToken = () => 'tok';
  w.fetch = async (url, init) => {
    out.sent.push({ url, body: JSON.parse(init.body) });
    return { json: async () => resendResult };
  };
  w.mirrorQuoteToRelational = (e) => out.mirrored.push({ ...e });
  w.renderQuoteLog = () => { out.renders++; };
  w.eval(DIALOGS);
  w.showToast = (m, o) => out.toasts.push({ m, type: o && o.type });
  w.showConfirm = async (m) => { out.confirms.push(m); return confirm; };
  w.eval(`var QUOTE_STORAGE_KEY = 'th_quotes';
    function loadQuoteLog() { try { return JSON.parse(localStorage.getItem(QUOTE_STORAGE_KEY) || '[]'); } catch (e) { return []; } }
    function saveQuoteLog(list) { localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(list)); }
    ` + RESEND + '\nwindow.__r = resendQuoteToClient;');
  const field = () => w.document.getElementById('customDialogField0');
  const click = (text) => [...w.document.querySelectorAll('#customDialogButtons button')].find((b) => b.textContent === text).click();
  out.resend = async (email, button = 'Send') => {
    const p = w.__r(quote.id);
    await new Promise((r) => setTimeout(r, 0));
    if (email !== undefined) field().value = email;
    click(button);
    await p;
  };
  const saved = () => JSON.parse(w.localStorage.getItem('th_quotes'))[0];
  return { w, out, field, click, saved };
}

test('logQuote() saves clientEmail on the entry (previously missing entirely)', () => {
  const logQuoteFn = PAGE.match(/function logQuote\(totals\)[\s\S]*?\n  \}/)[0];
  assert.match(logQuoteFn, /clientEmail: document\.getElementById\('quoteClientEmail'\)\.value\.trim\(\) \|\| null/);
});

test('an unchanged email calls send-quote-notification directly, not sync-quote-to-portal', async () => {
  const { w, out, field, click, saved } = setup();
  const p = w.__r(QUOTE.id);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(field().value, 'old@example.com');
  click('Send');
  await p;
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/send-quote-notification');
  assert.equal(out.sent[0].body.client_email, 'old@example.com');
  assert.equal(out.sent[0].body.quote_number, 'EST-2026-0042');
  assert.equal(out.sent[0].body.total, 340.5);
  assert.equal(out.confirms.length, 0, 'no second question when the email is unchanged');
  assert.equal(out.mirrored.length, 0, 'no re-mirror needed -- nothing on the quote changed');
  assert.equal(saved().clientEmail, 'old@example.com');
  assert.match(out.toasts[0].m, /resent to old@example\.com/);
});

test('an opted-out client is reported honestly, not as "resent"', async () => {
  const { out } = setup({ resendResult: { ok: true, skipped: 'client opted out of invoice/quote emails' } });
  await out.resend(undefined);
  assert.match(out.toasts[0].m, /turned off invoice\/quote emails/i);
  assert.equal(out.toasts[0].type, 'error');
});

test('a changed email is confirmed, saved on the quote, mirrored, and sent via sync-quote-to-portal', async () => {
  const { out, saved } = setup();
  await out.resend('  owner@silversilo.com ');
  assert.equal(out.confirms.length, 1);
  assert.match(out.confirms[0], /to owner@silversilo\.com instead of old@example\.com/);
  assert.equal(saved().clientEmail, 'owner@silversilo.com');
  assert.equal(out.mirrored.length, 1);
  assert.equal(out.mirrored[0].clientEmail, 'owner@silversilo.com');
  assert.equal(out.renders, 1);
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/sync-quote-to-portal');
  assert.equal(out.sent[0].body.client_email, 'owner@silversilo.com');
  assert.equal(out.sent[0].body.source_quote_id, QUOTE.id);
  assert.match(out.toasts[0].m, /resent to owner@silversilo\.com/);
});

test('saying no to the email change sends nothing and changes nothing', async () => {
  const { out, saved } = setup({ confirm: false });
  await out.resend('owner@silversilo.com');
  assert.equal(out.sent.length, 0);
  assert.equal(out.mirrored.length, 0);
  assert.equal(saved().clientEmail, 'old@example.com');
});

test('Cancel sends nothing', async () => {
  const { out, saved } = setup();
  await out.resend('owner@silversilo.com', 'Cancel');
  assert.equal(out.sent.length, 0);
  assert.equal(saved().clientEmail, 'old@example.com');
});

test('a bad email is refused in the dialog until it is fixed', async () => {
  const { w, out, field, click, saved } = setup();
  const p = w.__r(QUOTE.id);
  await new Promise((r) => setTimeout(r, 0));
  field().value = 'not-an-email';
  click('Send');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.document.getElementById('customDialogFieldsError').textContent, 'Enter a valid email address.');
  assert.equal(out.sent.length, 0);
  field().value = 'owner@silversilo.com';
  click('Send');
  await p;
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/sync-quote-to-portal');
  assert.equal(saved().clientEmail, 'owner@silversilo.com');
});

test('changing only the capitalisation is not treated as a different email', async () => {
  const { out } = setup();
  await out.resend('OLD@example.com');
  assert.equal(out.confirms.length, 0);
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/send-quote-notification');
});

test('a quote with no clientEmail yet prompts with an empty field', async () => {
  const noEmailQuote = { ...QUOTE, clientEmail: null };
  const { w, field } = setup({ quote: noEmailQuote });
  w.__r(noEmailQuote.id);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(field().value, '');
});
