// resendInvoiceToClient() had the same latent bug fixed in
// resendQuoteToClient() the same session (2026-10-22, see
// tests/tools/resend-quote.test.js): it always called
// sync-invoice-to-portal, which only actually triggers
// send-invoice-notification when the invoice is new to the client's
// portal or the client has no portal presence at all. So resending an
// already-synced invoice to the SAME email -- the ordinary case --
// silently upserted an identical row and emailed nobody, while the UI
// still showed "Invoice #... resent to ...".
//
// This exact failure mode was already found and fixed once, on
// 2026-09-22, for tools/clients.html's separate Portal panel
// (resendPortalInvoice/resendPortalQuote, which call
// send-invoice-notification/send-quote-notification directly -- see
// tests/tools/portal-invoice-quote-resend.test.js for the root-cause
// writeup). This file confirms resendInvoiceToClient() now follows the
// same split: an unchanged email calls send-invoice-notification
// directly (always actually emails, or reports a real opt-out); a
// changed email still goes through sync-invoice-to-portal, since that's
// what actually moves/creates the portal row.
//
// Runs the real resendInvoiceToClient() from tools/invoice-generator.html
// and the real showPromptForm() from tools/tools-dialogs.js in jsdom.
// tests/tools/resend-invoice-other-email.test.js already covers the
// email-change mechanics in detail (confirm copy, mirroring, line items,
// capitalisation); this file focuses on the unchanged-email path this
// fix actually changes, plus confirming the changed-email path still
// goes where it always did.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const PAGE = fs.readFileSync(path.join(TOOLS, 'invoice-generator.html'), 'utf8');
const DIALOGS = fs.readFileSync(path.join(TOOLS, 'tools-dialogs.js'), 'utf8');
const RESEND = PAGE.match(/  async function resendInvoiceToClient\(invoiceId\) \{[\s\S]*?\n  \}\n/)[0];

const INVOICE = { id: 1790448758936, invoiceNumber: 'INV-2026-1051', clientName: 'San Diego building supply',
  clientEmail: 'old@example.com', date: '2026-09-26', total: 212.66, jobRefTitle: 'Parts delivery',
  line_items: [{ desc: 'Parts', amount: 212.66 }] };

function setup({ invoice = INVOICE, confirm = true, resendResult = { ok: true } } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/invoice-generator.html', runScripts: 'outside-only' });
  const w = dom.window;
  const out = { sent: [], mirrored: [], toasts: [], confirms: [], renders: 0 };
  w.localStorage.setItem('th_invoices', JSON.stringify([invoice]));
  w.SUPABASE_URL = 'https://x.supabase.co';
  w.SUPABASE_ANON_KEY = 'anon';
  w.getAuthToken = () => 'tok';
  w.fetch = async (url, init) => {
    out.sent.push({ url, body: JSON.parse(init.body) });
    return { json: async () => resendResult };
  };
  w.mirrorInvoiceToRelational = (e) => out.mirrored.push({ ...e });
  w.renderInvoiceLog = () => { out.renders++; };
  w.eval(DIALOGS);
  w.showToast = (m, o) => out.toasts.push({ m, type: o && o.type });
  w.showConfirm = async (m) => { out.confirms.push(m); return confirm; };
  w.eval(`var INVOICE_STORAGE_KEY = 'th_invoices';
    function loadInvoiceLog() { try { return JSON.parse(localStorage.getItem(INVOICE_STORAGE_KEY) || '[]'); } catch (e) { return []; } }
    function saveInvoiceLog(list) { localStorage.setItem(INVOICE_STORAGE_KEY, JSON.stringify(list)); }
    ` + RESEND + '\nwindow.__r = resendInvoiceToClient;');
  const field = () => w.document.getElementById('customDialogField0');
  const click = (text) => [...w.document.querySelectorAll('#customDialogButtons button')].find((b) => b.textContent === text).click();
  out.resend = async (email, button = 'Send') => {
    const p = w.__r(invoice.id);
    await new Promise((r) => setTimeout(r, 0));
    if (email !== undefined) field().value = email;
    click(button);
    await p;
  };
  const saved = () => JSON.parse(w.localStorage.getItem('th_invoices'))[0];
  return { w, out, field, click, saved };
}

test('an unchanged email now calls send-invoice-notification directly, not sync-invoice-to-portal', async () => {
  const { w, out, field, click, saved } = setup();
  const p = w.__r(INVOICE.id);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(field().value, 'old@example.com');
  click('Send');
  await p;
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/send-invoice-notification');
  assert.equal(out.sent[0].body.client_email, 'old@example.com');
  assert.equal(out.sent[0].body.invoice_number, 'INV-2026-1051');
  assert.equal(out.sent[0].body.total, 212.66);
  assert.equal(out.confirms.length, 0, 'no second question when the email is unchanged');
  assert.equal(out.mirrored.length, 0, 'no re-mirror needed -- nothing on the invoice changed');
  assert.equal(saved().clientEmail, 'old@example.com');
  assert.match(out.toasts[0].m, /resent to old@example\.com/);
});

test('an opted-out client is reported honestly, not as "resent"', async () => {
  const { out } = setup({ resendResult: { ok: true, skipped: 'client opted out of invoice/quote emails' } });
  await out.resend(undefined);
  assert.match(out.toasts[0].m, /turned off invoice\/quote emails/i);
  assert.equal(out.toasts[0].type, 'error');
});

test('a failed notification send is reported, not silently swallowed', async () => {
  const { out } = setup({ resendResult: { ok: false, error: 'Resend API down' } });
  await out.resend(undefined);
  assert.match(out.toasts[0].m, /Resend failed: Resend API down/);
  assert.equal(out.toasts[0].type, 'error');
});

test('a changed email still goes through sync-invoice-to-portal, confirmed, mirrored, and sent there', async () => {
  const { out, saved } = setup();
  await out.resend('  ap@sdbuilding.com ');
  assert.equal(out.confirms.length, 1);
  assert.match(out.confirms[0], /to ap@sdbuilding\.com instead of old@example\.com/);
  assert.equal(saved().clientEmail, 'ap@sdbuilding.com');
  assert.equal(out.mirrored.length, 1);
  assert.equal(out.mirrored[0].clientEmail, 'ap@sdbuilding.com');
  assert.equal(out.renders, 1);
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/sync-invoice-to-portal');
  assert.equal(out.sent[0].body.client_email, 'ap@sdbuilding.com');
  assert.equal(out.sent[0].body.source_invoice_id, INVOICE.id);
  assert.match(out.toasts[0].m, /resent to ap@sdbuilding\.com/);
});

test('changing only the capitalisation is still treated as unchanged and uses send-invoice-notification', async () => {
  const { out } = setup();
  await out.resend('OLD@example.com');
  assert.equal(out.confirms.length, 0);
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/send-invoice-notification');
});
