// Viewing an invoice from a client (2026-10-03, requested directly: "when i
// click on a client and click on invoice, it just takes me to a page but
// doesnt pull it up"). The client and job pages linked every invoice to the
// Invoices list with only ?search=<client name>, so nothing opened. They now
// pass ?invoice=<id> (or ?quote=<id>), and the Invoices page opens that
// record's sheet, with View invoice first, which opens the PDF archived when
// the invoice was created.
//
// Runs the real openInvoiceActions(), viewInvoicePdf() and
// openRecordFromUrl() from tools/invoice-generator.html in jsdom, and checks
// the real links client-detail.html and job-detail.html build.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const PAGE = fs.readFileSync(path.join(TOOLS, 'invoice-generator.html'), 'utf8');
const grab = (src, re) => { const m = src.match(re); assert.ok(m, 'found ' + re); return m[0]; };
const FNS = grab(PAGE, /  function openInvoiceActions\(id\) \{[\s\S]*?\n  function initInvoiceLogLongPress\(\)/)
  .replace(/\n  function initInvoiceLogLongPress\(\)$/, '\n');

const INV = { id: 1790448758936, invoiceNumber: 'INV-2026-1051', clientName: 'San Diego building supply', clientEmail: 'crisandk05@gmail.com', total: 212.66, jobRefId: '1790445301073' };
const NO_EMAIL = { id: 42, invoiceNumber: 'INV-2026-0042', clientName: 'Walk-in', total: 50 };
const QUOTE = { id: 77, quoteNumber: 'Q-2026-0077', clientName: 'San Diego building supply', total: 300 };

function setup({ url = 'https://example.com/tools/invoice-generator.html', signed = 'https://x.supabase.co/storage/v1/object/sign/invoice-pdfs/invoices/INV-2026-1051.pdf?token=t', popup = true } = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="inv-item" data-invoice-id="1790448758936"></div><div class="inv-item" data-quote-id="77"></div></body>', { url, runScripts: 'outside-only' });
  const w = dom.window;
  const out = { sheets: [], toasts: [], signs: [], opened: [], quoteSheets: [] };
  const fakeTab = { location: { href: '' }, closed: false, close() { this.closed = true; } };
  out.tab = fakeTab;
  w.open = (u, t) => { out.opened.push([u, t]); return popup ? fakeTab : null; };
  w.getSignedStorageUrl = async (bucket, p, exp) => { out.signs.push([bucket, p, exp]); return signed; };
  w.invoicesForDisplay = () => [INV, NO_EMAIL];
  w.loadInvoiceLog = () => [INV, NO_EMAIL];
  w.loadQuoteLog = () => [QUOTE];
  w.invoiceState = () => ({ status: 'unpaid', balance: 212.66 });
  w.invoiceClientHref = () => '/tools/client-detail.html?id=c_1';
  w.money = (n) => '$' + Number(n).toFixed(2);
  w.escapeHtml = (s) => String(s);
  w.showQuickActionSheet = (title, actions) => out.sheets.push({ title, actions });
  w.showToast = (m, o) => out.toasts.push({ m, type: o && o.type });
  w.toggleInvoicePaid = () => {};
  w.resendInvoiceToClient = (id) => { out.resent = id; };
  w.deleteInvoiceLogEntry = () => {};
  w.openQuoteActions = (id) => out.quoteSheets.push(id);
  w.HTMLElement.prototype.scrollIntoView = function () { out.scrolled = this.dataset.invoiceId || this.dataset.quoteId; };
  w.eval(FNS + '\nwindow.__f = { openInvoiceActions, viewInvoicePdf, openRecordFromUrl };');
  return { w, api: w.__f, out };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test('the invoice sheet leads with View invoice, and always offers Resend', () => {
  const { api, out } = setup();
  api.openInvoiceActions(INV.id);
  const labels = Array.from(out.sheets[0].actions, (a) => a.label);
  assert.equal(labels[0], 'View invoice');
  assert.ok(labels.includes('Resend'));
  api.openInvoiceActions(NO_EMAIL.id);
  assert.ok(Array.from(out.sheets[1].actions, (a) => a.label).includes('Send to an email'), 'an invoice with no email on file can still be sent');
});

test('View invoice opens the archived PDF in a tab opened inside the tap', async () => {
  const { api, out } = setup();
  const p = api.viewInvoicePdf(INV.id);
  assert.deepEqual(out.opened, [['', '_blank']], 'the tab opens before any await (popup blockers)');
  await p;
  assert.deepEqual(out.signs, [['invoice-pdfs', 'invoices/INV-2026-1051.pdf', 600]]);
  assert.match(out.tab.location.href, /invoice-pdfs\/invoices\/INV-2026-1051\.pdf\?token=/);
  assert.equal(out.toasts.length, 0);
});

test('with no saved PDF, the blank tab is closed and it says so', async () => {
  const { api, out } = setup({ signed: '' });
  await api.viewInvoicePdf(INV.id);
  assert.equal(out.tab.closed, true);
  assert.match(out.toasts[0].m, /No saved PDF for #INV-2026-1051/);
});

test('with popups blocked, this tab goes to the PDF instead', async () => {
  const { api, out } = setup({ popup: false });
  // jsdom can't navigate; the call must still finish quietly after signing.
  await api.viewInvoicePdf(INV.id);
  assert.equal(out.signs.length, 1);
  assert.equal(out.toasts.length, 0);
  assert.match(FNS, /if \(pdfWindow\) pdfWindow\.location\.href = url;\n    else window\.location\.href = url;/);
});

test('?invoice=<id> opens that invoice, highlights its row, and is removed from the address', async () => {
  const { w, api, out } = setup({ url: 'https://example.com/tools/invoice-generator.html?search=San%20Diego&invoice=1790448758936#recent' });
  api.openRecordFromUrl();
  assert.equal(out.sheets.length, 1);
  assert.match(out.sheets[0].title, /INV-2026-1051/);
  assert.equal(out.sheets[0].actions[0].label, 'View invoice');
  assert.ok(w.document.querySelector('[data-invoice-id="1790448758936"]').classList.contains('is-linked'));
  assert.equal(out.scrolled, '1790448758936');
  assert.equal(w.location.search, '?search=San+Diego');
  assert.equal(w.location.hash, '#recent');
  // Tapping View invoice from that sheet opens the PDF.
  await out.sheets[0].actions[0].onClick();
  await flush();
  assert.match(out.tab.location.href, /INV-2026-1051\.pdf/);
});

test('?quote=<id> opens that quote', () => {
  const { api, out } = setup({ url: 'https://example.com/tools/invoice-generator.html?quote=77#recent' });
  api.openRecordFromUrl();
  assert.deepEqual(out.quoteSheets, [77]);
  assert.equal(out.sheets.length, 0);
});

test('an id not on this device says so instead of doing nothing', () => {
  const { api, out } = setup({ url: 'https://example.com/tools/invoice-generator.html?invoice=999#recent' });
  api.openRecordFromUrl();
  assert.equal(out.sheets.length, 0);
  assert.match(out.toasts[0].m, /Could not find that invoice/);
});

test('no ?invoice or ?quote: nothing opens', () => {
  const { api, out } = setup({ url: 'https://example.com/tools/invoice-generator.html?search=x#recent' });
  api.openRecordFromUrl();
  assert.equal(out.sheets.length + out.quoteSheets.length + out.toasts.length, 0);
});

test('the client and job pages link each invoice and quote by id', () => {
  const client = fs.readFileSync(path.join(TOOLS, 'client-detail.html'), 'utf8');
  const job = fs.readFileSync(path.join(TOOLS, 'job-detail.html'), 'utf8');
  assert.equal((client.match(/&invoice=' \+ encodeURIComponent\(i\.id\)/g) || []).length, 2, 'client timeline + Invoices section');
  assert.equal((client.match(/&quote=' \+ encodeURIComponent\(q\.id\)/g) || []).length, 2, 'client timeline + Quotes section');
  assert.equal((job.match(/&invoice=' \+ encodeURIComponent\(i\.id\)/g) || []).length, 1);
  assert.equal((job.match(/&quote=' \+ encodeURIComponent\(q\.id\)/g) || []).length, 1);
  // The page runs it on load, after the tab from #recent is shown.
  assert.match(PAGE, /applyGenTabFromHash\(\);\n    window\.addEventListener\('hashchange', applyGenTabFromHash\);\n    openRecordFromUrl\(\);/);
});
