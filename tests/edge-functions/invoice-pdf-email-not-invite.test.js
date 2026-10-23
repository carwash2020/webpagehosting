// URGENT bug fix (2026-10-23), same fix as
// tests/edge-functions/quote-pdf-email-not-invite.test.js, applied to
// invoices at the user's explicit follow-up request ("invoices must
// also send the PDF invoice ... not a portal invite link. Apply the
// same fix to the invoice send path").
//
// Root cause: sync-invoice-to-portal-index.ts called send-invite (a
// bare "create your account" email with zero mention of the invoice)
// for a brand-new client's first-ever invoice. Fix: sync-invoice-to-portal
// now always calls send-invoice-notification (never send-invite),
// forwarding an optional pdf_base64/pdf_filename through for Resend to
// attach; the "View and Pay" CTA is only shown when has_portal_account
// is true (a brand-new, never-invited client has no password set, so a
// login link would be a dead end -- they can still pay however Steve
// arranges directly, same as before the portal existed).
//
// Runs the real handlers from both files via a vm sandbox, same harness
// style as tests/edge-functions/quote-pdf-email-not-invite.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

function j(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeJwt(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `h.${payload}.s`;
}
const STAFF_JWT = fakeJwt({ role: 'authenticated', email: 'steve@triplehenterprisesllc.biz', sub: 'u1', aal: 'aal1', session_id: 's1' });

function loadFunction(file, name, state) {
  const raw = fs.readFileSync(repo('edge-functions', file), 'utf8');
  const src = stripTypeScriptTypes(raw);
  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
    RESEND_API_KEY: 're_test',
    LEAD_EMAIL_FROM: 'leads@example.com',
  };
  const context = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch: state.fetchStub, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN,
    encodeURIComponent, decodeURIComponent, TextEncoder,
  });
  vm.runInContext(src, context, { filename: file });
  return async (body, { token = STAFF_JWT } = {}) => {
    const res = await handler(new Request(`https://example.supabase.co/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
}

// ---------- send-invoice-notification ----------

function setupNotify({ resendOk = true } = {}) {
  const resendCalls = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.includes('/rest/v1/account_roles')) return j([{ can_manage_invoices: true }]);
    if (u.includes('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return j(true);
    if (u.includes('/rest/v1/client_notification_preferences')) return j([]);
    if (u === 'https://api.resend.com/emails' && method === 'POST') {
      resendCalls.push(JSON.parse(init.body));
      return resendOk ? j({ id: 'email_test' }) : j({ message: 'boom' }, 500);
    }
    if (u.includes('/rest/v1/rpc/get_auth_user_id_by_email')) return j(null);
    throw new Error(`unexpected fetch in send-invoice-notification: ${method} ${u}`);
  };
  const call = loadFunction('send-invoice-notification-index.ts', 'send-invoice-notification', { fetchStub });
  return { call, resendCalls };
}

test('send-invoice-notification attaches the PDF and says "attached" when pdf_base64 is given', async () => {
  const { call, resendCalls } = setupNotify();
  const res = await call({
    client_email: 'client@example.com', client_name: 'Jane Smith', invoice_number: 'INV-1', total: 250,
    pdf_base64: 'ZmFrZXBkZg==', pdf_filename: 'invoice.pdf', has_portal_account: false,
  });
  assert.equal(res.body.ok, true);
  assert.equal(resendCalls.length, 1);
  assert.deepEqual(resendCalls[0].attachments, [{ filename: 'invoice.pdf', content: 'ZmFrZXBkZg==' }]);
  assert.match(resendCalls[0].subject, /Your invoice from Triple H Enterprises/);
  assert.match(resendCalls[0].html, /Your invoice is attached/);
  assert.match(resendCalls[0].html, /is attached to this email as a PDF/);
  assert.equal(resendCalls[0].bcc, 'steve@triplehenterprisesllc.biz', 'Steve gets a copy of the actual invoice email, BCC on the same send');
});

test('send-invoice-notification without pdf_base64 falls back to the PDF-less "new invoice" copy (the resend path) and does NOT BCC Steve', async () => {
  const { call, resendCalls } = setupNotify();
  await call({ client_email: 'client@example.com', client_name: 'Jane Smith', invoice_number: 'INV-1', total: 250, has_portal_account: true });
  assert.equal(resendCalls[0].attachments, undefined);
  assert.match(resendCalls[0].subject, /New invoice from Triple H Enterprises/);
  assert.match(resendCalls[0].html, /You have a new invoice/);
  assert.equal(resendCalls[0].bcc, undefined, 'no BCC on the PDF-less fallback -- this is not "the invoice emailed to the customer"');
});

test('the "View and Pay" CTA only appears when has_portal_account is true', async () => {
  const { call, resendCalls } = setupNotify();
  await call({ client_email: 'a@example.com', client_name: 'A', invoice_number: 'INV-2', total: 10, pdf_base64: 'eA==', has_portal_account: false });
  assert.doesNotMatch(resendCalls[0].html, /portal\/dashboard\.html/, 'no portal link for a client with no account to log into');

  await call({ client_email: 'b@example.com', client_name: 'B', invoice_number: 'INV-3', total: 10, pdf_base64: 'eA==', has_portal_account: true });
  assert.match(resendCalls[1].html, /portal\/dashboard\.html/);
});

test('a failed Resend send is still reported as a real failure, not silently ok', async () => {
  const { call } = setupNotify({ resendOk: false });
  const res = await call({ client_email: 'a@example.com', client_name: 'A', invoice_number: 'INV-4', total: 10, pdf_base64: 'eA==' });
  assert.equal(res.body.ok, false);
});

// ---------- sync-invoice-to-portal ----------

function setupSync({ existingClient = false, existingInvoice = false } = {}) {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.includes('/rest/v1/account_roles')) return j([{ can_manage_invoices: true }]);
    if (u.includes('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return j(true);
    if (u.includes('/rest/v1/client_portal_invoices?client_email=')) return j(existingClient ? [{ id: 1 }] : []);
    if (u.includes('/rest/v1/client_portal_invoices?source_invoice_id=')) return j(existingInvoice ? [{ id: 1 }] : []);
    if (u.includes('/rest/v1/client_portal_invoices?on_conflict=')) return j([{ id: 1 }]);
    if (u.endsWith('/functions/v1/send-invite')) {
      calls.push({ fn: 'send-invite', body: JSON.parse(init.body) });
      return j({ ok: true });
    }
    if (u.endsWith('/functions/v1/send-invoice-notification')) {
      calls.push({ fn: 'send-invoice-notification', body: JSON.parse(init.body) });
      return j({ ok: true });
    }
    throw new Error(`unexpected fetch in sync-invoice-to-portal: ${method} ${u}`);
  };
  const call = loadFunction('sync-invoice-to-portal-index.ts', 'sync-invoice-to-portal', { fetchStub });
  return { call, calls };
}

const BASE_INVOICE = {
  source_invoice_id: 42, client_email: 'client@example.com', client_name: 'Jane Smith',
  invoice_number: 'INV-1', invoice_date: '2026-10-23', total: 250,
};

test('a brand-new client never gets send-invite -- only send-invoice-notification, with has_portal_account:false', async () => {
  const { call, calls } = setupSync({ existingClient: false });
  const res = await call({ ...BASE_INVOICE, pdf_base64: 'ZmFrZXBkZg==', pdf_filename: 'invoice.pdf' });
  assert.equal(res.body.ok, true);
  assert.equal(calls.length, 1, 'exactly one downstream email call');
  assert.equal(calls[0].fn, 'send-invoice-notification');
  assert.equal(calls[0].body.has_portal_account, false);
  assert.equal(calls[0].body.pdf_base64, 'ZmFrZXBkZg==');
  assert.equal(calls[0].body.pdf_filename, 'invoice.pdf');
  assert.ok(!calls.some((c) => c.fn === 'send-invite'), 'send-invite must never fire for an invoice sync anymore');
});

test('a client who already has a prior invoice gets has_portal_account:true', async () => {
  const { call, calls } = setupSync({ existingClient: true });
  await call({ ...BASE_INVOICE });
  assert.equal(calls[0].fn, 'send-invoice-notification');
  assert.equal(calls[0].body.has_portal_account, true);
});

test('pdf_base64/pdf_filename are optional -- omitting them still sends a notification, just without an attachment', async () => {
  const { call, calls } = setupSync();
  const res = await call(BASE_INVOICE);
  assert.equal(res.body.ok, true);
  assert.equal(calls[0].body.pdf_base64, null);
  assert.equal(calls[0].body.pdf_filename, null);
});

// ---------- the client side: generatePDF() actually sends the PDF it just built ----------

const INVOICE_GEN = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');

test('generatePDF(opts) base64-encodes the same jsPDF document it just saved/shared, not a second render', () => {
  const fn = INVOICE_GEN.match(/async function generatePDF\(opts\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'expected to isolate generatePDF()');
  assert.match(fn[0], /doc\.output\('datauristring'\)/);
  const saveShareAt = Math.max(fn[0].indexOf('doc.save(filename)'), fn[0].indexOf("sharePdfOrDownload(doc, filename, 'Invoice')"));
  const outputAt = fn[0].indexOf("doc.output('datauristring')");
  assert.ok(saveShareAt !== -1 && outputAt !== -1 && outputAt > saveShareAt);
});

test('generatePDF(opts) forwards pdf_base64/pdf_filename to sync-invoice-to-portal', () => {
  const fn = INVOICE_GEN.match(/async function generatePDF\(opts\)[\s\S]*?\n  \}\n/);
  const syncCall = fn[0].match(/fetch\(`\$\{SUPABASE_URL\}\/functions\/v1\/sync-invoice-to-portal`[\s\S]*?\n        \}\);/);
  assert.ok(syncCall, 'expected to isolate the sync-invoice-to-portal fetch call');
  assert.match(syncCall[0], /pdf_base64: pdfBase64,/);
  assert.match(syncCall[0], /pdf_filename: filename,/);
});

test('the success alert mentions the PDF, not a bare portal claim, when one was attached', () => {
  const fn = INVOICE_GEN.match(/async function generatePDF\(opts\)[\s\S]*?\n  \}\n/);
  assert.match(fn[0], /pdfBase64 \? ' with the PDF attached\.' : ' and posted to their portal\.'/);
});
