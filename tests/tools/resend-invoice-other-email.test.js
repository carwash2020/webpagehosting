// Resend can send an invoice to a different email (2026-10-03, requested
// directly). Resend used to send only to the email on file, behind a yes/no
// confirm. Now the email is a field, filled in with the one on file; a
// changed email is saved on the invoice (log + relational mirror) before
// sync-invoice-to-portal moves the portal row to it.
//
// Runs the real resendInvoiceToClient() from tools/invoice-generator.html
// and the real showPromptForm() from tools/tools-dialogs.js in jsdom.

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
  clientEmail: 'old@example.com', date: '2026-09-26', total: 212.66, line_items: [{ desc: 'Parts', amount: 212.66 }] };

function setup({ invoice = INVOICE, confirm = true } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/invoice-generator.html', runScripts: 'outside-only' });
  const w = dom.window;
  const out = { sent: [], mirrored: [], toasts: [], confirms: [], renders: 0 };
  w.localStorage.setItem('th_invoices', JSON.stringify([invoice]));
  w.SUPABASE_URL = 'https://x.supabase.co';
  w.SUPABASE_ANON_KEY = 'anon';
  w.getAuthToken = () => 'tok';
  w.fetch = async (url, init) => { out.sent.push({ url, body: JSON.parse(init.body) }); return { json: async () => ({ ok: true }) }; };
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
  // Opens the dialog, types an email (or leaves it), presses a button, and waits for the send.
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

test('the email field starts with the email on file, and sending it unchanged works as before', async () => {
  const { w, out, field, click, saved } = setup();
  const p = w.__r(INVOICE.id);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(field().value, 'old@example.com');
  assert.equal(field().type, 'email');
  click('Send');
  await p;
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].url, 'https://x.supabase.co/functions/v1/sync-invoice-to-portal');
  assert.equal(out.sent[0].body.client_email, 'old@example.com');
  assert.equal(out.sent[0].body.total, 212.66);
  assert.deepEqual(out.sent[0].body.line_items, INVOICE.line_items);
  assert.equal(out.confirms.length, 0, 'no second question when the email is unchanged');
  assert.equal(out.mirrored.length, 0);
  assert.equal(saved().clientEmail, 'old@example.com');
  assert.match(out.toasts[0].m, /resent to old@example\.com/);
});

test('a different email is confirmed, saved on the invoice, mirrored, and the invoice is sent there', async () => {
  const { out, saved } = setup();
  await out.resend('  ap@sdbuilding.com ');
  assert.equal(out.confirms.length, 1);
  assert.match(out.confirms[0], /to ap@sdbuilding\.com instead of old@example\.com/);
  assert.equal(saved().clientEmail, 'ap@sdbuilding.com');
  assert.equal(out.mirrored.length, 1);
  assert.equal(out.mirrored[0].clientEmail, 'ap@sdbuilding.com');
  assert.equal(out.renders, 1);
  assert.equal(out.sent[0].body.client_email, 'ap@sdbuilding.com');
  assert.equal(out.sent[0].body.source_invoice_id, INVOICE.id);
  assert.match(out.toasts[0].m, /resent to ap@sdbuilding\.com/);
});

test('saying no to the change sends nothing and changes nothing', async () => {
  const { out, saved } = setup({ confirm: false });
  await out.resend('ap@sdbuilding.com');
  assert.equal(out.sent.length, 0);
  assert.equal(out.mirrored.length, 0);
  assert.equal(saved().clientEmail, 'old@example.com');
});

test('Cancel sends nothing', async () => {
  const { out, saved } = setup();
  await out.resend('ap@sdbuilding.com', 'Cancel');
  assert.equal(out.sent.length, 0);
  assert.equal(saved().clientEmail, 'old@example.com');
});

test('a bad email is refused in the dialog until it is fixed', async () => {
  const { w, out, field, click, saved } = setup();
  const p = w.__r(INVOICE.id);
  await new Promise((r) => setTimeout(r, 0));
  field().value = 'not-an-email';
  click('Send');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.document.getElementById('customDialogFieldsError').textContent, 'Enter a valid email address.');
  assert.equal(out.sent.length, 0);
  field().value = 'ap@sdbuilding.com';
  click('Send');
  await p;
  assert.equal(out.sent[0].body.client_email, 'ap@sdbuilding.com');
  assert.equal(saved().clientEmail, 'ap@sdbuilding.com');
});

test('changing only the capitalisation is not treated as a different email', async () => {
  const { out } = setup();
  await out.resend('OLD@example.com');
  assert.equal(out.confirms.length, 0);
  assert.equal(out.mirrored.length, 0);
});
