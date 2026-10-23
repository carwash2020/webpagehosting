// URGENT bug fix (2026-10-23), reported directly: "When sending an
// ESTIMATE from the tools, the customer email contains a client-portal
// invite link instead of the PDF estimate."
//
// Root cause: sync-quote-to-portal-index.ts called send-invite (a bare
// "create your account" email with zero mention of the quote) for a
// brand-new client's first-ever quote. Invoices still auto-invite a new
// client (they need an account to pay) -- but a quote recipient doesn't
// need an account just to see a price, so quotes should deliver the
// actual estimate instead. Fix: sync-quote-to-portal now always calls
// send-quote-notification (never send-invite), forwarding an optional
// pdf_base64/pdf_filename through for Resend to attach; the "review
// online" CTA is only shown when has_portal_account is true (a
// brand-new, never-invited client has no password set, so a login link
// would be a dead end).
//
// Runs the real handlers from both files via a vm sandbox, same harness
// style as tests/edge-functions/send-booking-email.test.js.

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

// A fake JWT whose payload is just base64url(JSON) -- decodeJwtPayload in
// both functions only ever reads the payload segment, never verifies the
// signature (the gateway already did that via verify_jwt), so a 2-part
// fake with a throwaway signature segment is enough here.
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

// ---------- send-quote-notification ----------

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
    throw new Error(`unexpected fetch in send-quote-notification: ${method} ${u}`);
  };
  const call = loadFunction('send-quote-notification-index.ts', 'send-quote-notification', { fetchStub });
  return { call, resendCalls };
}

test('send-quote-notification attaches the PDF and says "attached" when pdf_base64 is given', async () => {
  const { call, resendCalls } = setupNotify();
  const res = await call({
    client_email: 'client@example.com', client_name: 'Jane Smith', quote_number: 'EST-1', total: 250,
    pdf_base64: 'ZmFrZXBkZg==', pdf_filename: 'estimate.pdf', has_portal_account: false,
  });
  assert.equal(res.body.ok, true);
  assert.equal(resendCalls.length, 1);
  assert.deepEqual(resendCalls[0].attachments, [{ filename: 'estimate.pdf', content: 'ZmFrZXBkZg==' }]);
  assert.match(resendCalls[0].subject, /Your estimate from Triple H Enterprises/);
  assert.match(resendCalls[0].html, /Your estimate is attached/);
  assert.match(resendCalls[0].html, /is attached to this email as a PDF/);
});

test('send-quote-notification without pdf_base64 falls back to the PDF-less "review" copy (the resend path)', async () => {
  const { call, resendCalls } = setupNotify();
  await call({ client_email: 'client@example.com', client_name: 'Jane Smith', quote_number: 'EST-1', total: 250, has_portal_account: true });
  assert.equal(resendCalls[0].attachments, undefined);
  assert.match(resendCalls[0].subject, /New quote to review/);
  assert.match(resendCalls[0].html, /You have a new quote to review/);
});

test('the "review online" CTA only appears when has_portal_account is true', async () => {
  const { call, resendCalls } = setupNotify();
  await call({ client_email: 'a@example.com', client_name: 'A', quote_number: 'EST-2', total: 10, pdf_base64: 'eA==', has_portal_account: false });
  assert.doesNotMatch(resendCalls[0].html, /portal\/quotes\.html/, 'no portal link for a client with no account to log into');

  await call({ client_email: 'b@example.com', client_name: 'B', quote_number: 'EST-3', total: 10, pdf_base64: 'eA==', has_portal_account: true });
  assert.match(resendCalls[1].html, /portal\/quotes\.html/);
});

test('a failed Resend send is still reported as a real failure, not silently ok', async () => {
  const { call } = setupNotify({ resendOk: false });
  const res = await call({ client_email: 'a@example.com', client_name: 'A', quote_number: 'EST-4', total: 10, pdf_base64: 'eA==' });
  assert.equal(res.body.ok, false);
});

// ---------- sync-quote-to-portal ----------

function setupSync({ existingQuoteClient = false, existingInvoiceClient = false, existingQuote = false } = {}) {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.includes('/rest/v1/account_roles')) return j([{ can_manage_invoices: true }]);
    if (u.includes('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return j(true);
    if (u.includes('/rest/v1/client_portal_quotes?client_email=')) return j(existingQuoteClient ? [{ id: 1 }] : []);
    if (u.includes('/rest/v1/client_portal_invoices?client_email=')) return j(existingInvoiceClient ? [{ id: 1 }] : []);
    if (u.includes('/rest/v1/client_portal_quotes?source_quote_id=')) return j(existingQuote ? [{ id: 1 }] : []);
    if (u.includes('/rest/v1/client_portal_quotes?on_conflict=')) return j([{ id: 1 }]);
    if (u.endsWith('/functions/v1/send-invite')) {
      calls.push({ fn: 'send-invite', body: JSON.parse(init.body) });
      return j({ ok: true });
    }
    if (u.endsWith('/functions/v1/send-quote-notification')) {
      calls.push({ fn: 'send-quote-notification', body: JSON.parse(init.body) });
      return j({ ok: true });
    }
    throw new Error(`unexpected fetch in sync-quote-to-portal: ${method} ${u}`);
  };
  const call = loadFunction('sync-quote-to-portal-index.ts', 'sync-quote-to-portal', { fetchStub });
  return { call, calls };
}

const BASE_QUOTE = {
  source_quote_id: 42, client_email: 'client@example.com', client_name: 'Jane Smith',
  quote_number: 'EST-1', quote_date: '2026-10-23', total: 250,
};

test('a brand-new client never gets send-invite -- only send-quote-notification, with has_portal_account:false', async () => {
  const { call, calls } = setupSync({ existingQuoteClient: false, existingInvoiceClient: false });
  const res = await call({ ...BASE_QUOTE, pdf_base64: 'ZmFrZXBkZg==', pdf_filename: 'estimate.pdf' });
  assert.equal(res.body.ok, true);
  assert.equal(calls.length, 1, 'exactly one downstream email call');
  assert.equal(calls[0].fn, 'send-quote-notification');
  assert.equal(calls[0].body.has_portal_account, false);
  assert.equal(calls[0].body.pdf_base64, 'ZmFrZXBkZg==');
  assert.equal(calls[0].body.pdf_filename, 'estimate.pdf');
  assert.ok(!calls.some((c) => c.fn === 'send-invite'), 'send-invite must never fire for a quote');
});

test('a client who already has portal presence (from a prior invoice or quote) gets has_portal_account:true', async () => {
  const { call, calls } = setupSync({ existingInvoiceClient: true });
  await call({ ...BASE_QUOTE });
  assert.equal(calls[0].fn, 'send-quote-notification');
  assert.equal(calls[0].body.has_portal_account, true);
});

test('pdf_base64/pdf_filename are optional -- omitting them still sends a notification, just without an attachment', async () => {
  const { call, calls } = setupSync();
  const res = await call(BASE_QUOTE);
  assert.equal(res.body.ok, true);
  assert.equal(calls[0].body.pdf_base64, null);
  assert.equal(calls[0].body.pdf_filename, null);
});

// ---------- the client side: generateQuotePDF() actually sends the PDF it just built ----------

const INVOICE_GEN = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');

test('generateQuotePDF() base64-encodes the same jsPDF document it just downloaded/shared, not a second render', () => {
  const fn = INVOICE_GEN.match(/async function generateQuotePDF\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'expected to isolate generateQuotePDF()');
  assert.match(fn[0], /doc\.output\('datauristring'\)/);
  // Computed after sharePdfOrDownload(doc, ...) -- confirms it reuses
  // the exact doc instance already finalized for the local copy.
  const shareAt = fn[0].indexOf('sharePdfOrDownload(doc,');
  const outputAt = fn[0].indexOf("doc.output('datauristring')");
  assert.ok(shareAt !== -1 && outputAt !== -1 && outputAt > shareAt);
});

test('generateQuotePDF() forwards pdf_base64/pdf_filename to sync-quote-to-portal', () => {
  const fn = INVOICE_GEN.match(/async function generateQuotePDF\(\)[\s\S]*?\n  \}\n/);
  const syncCall = fn[0].match(/fetch\(`\$\{SUPABASE_URL\}\/functions\/v1\/sync-quote-to-portal`[\s\S]*?\n        \}\);/);
  assert.ok(syncCall, 'expected to isolate the sync-quote-to-portal fetch call');
  assert.match(syncCall[0], /pdf_base64: pdfBase64,/);
  assert.match(syncCall[0], /pdf_filename: filename,/);
});

test('the success alert mentions the PDF, not a bare portal claim, when one was attached', () => {
  const fn = INVOICE_GEN.match(/async function generateQuotePDF\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn[0], /pdfBase64 \? ' with the PDF attached\.' : ' and posted to their portal\.'/);
});
