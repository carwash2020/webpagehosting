// Tests for the guest work-order request flow (2026-09-02), requested
// directly: "add a workflow on the portal for the guest to create
// work orders or request a job be done."
//
// This page matters more than the other portal pages from a security
// standpoint: it is the FIRST and only place a client WRITES rows,
// rather than reading a one-way mirror that only edge functions
// populate. So these tests focus on the things that would be
// genuinely harmful to get wrong -- a client filing a request as
// someone else, a client self-assigning a workflow status, or
// internal-only notes leaking to a client -- not just on the markup
// existing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORK_ORDERS = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'work-orders.html'), 'utf8');
const INVOICE_GEN = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');

test('the request insert never sends client_email -- the database attributes it from the verified JWT', () => {
  const fnMatch = WORK_ORDERS.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate submitRequest()');
  const body = fnMatch[0];
  assert.match(body, /\.from\('client_portal_work_orders'\)\.insert\(/);
  // The whole point: client_email is a column default of auth.email()
  // and the INSERT policy requires it to equal auth.email(). Sending
  // it from the browser would be redundant at best, and a thing to
  // get wrong at worst -- a client must never be able to file a
  // request attributed to a different address.
  assert.doesNotMatch(body, /client_email\s*:/,
    'client_email must never be sent from the client -- the database sets it from the JWT');
});

test('the request insert never sends a status -- a client cannot self-assign a workflow state', () => {
  const fnMatch = WORK_ORDERS.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  // status defaults to 'submitted' and the INSERT policy permits only
  // that value from a client. A client must not be able to mark their
  // own request 'scheduled' or 'completed'.
  assert.doesNotMatch(fnMatch[0], /status\s*:/,
    'status must never be sent from the client -- it defaults to submitted and only internal accounts advance it');
});

test('the request insert never sends internal-only fields', () => {
  const fnMatch = WORK_ORDERS.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  for (const field of ['internal_notes', 'linked_quote_id', 'linked_job_id']) {
    assert.doesNotMatch(fnMatch[0], new RegExp(`${field}\\s*:`),
      `${field} is internal-only and must never be set by a client`);
  }
});

test('reading requests selects an explicit column list, never * -- internal_notes must not reach a client', () => {
  const fnMatch = WORK_ORDERS.match(/async function renderMyRequests\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderMyRequests()');
  const body = fnMatch[0];
  // Postgres RLS is row-level, not column-level -- a client reading
  // their own row could technically read internal_notes too. The
  // explicit select list is what actually keeps it out, so a
  // regression to select('*') would be a real leak.
  assert.doesNotMatch(body, /\.select\('\*'\)/,
    'must not select * -- that would expose internal_notes to the client');
  assert.match(body, /\.select\('id,title,description,urgency,status,scheduled_at,created_at'\)/);
  // Checks the select call specifically, not the whole function --
  // the surrounding comment legitimately explains why internal_notes
  // is excluded, and mentioning it there is correct, not a leak.
  const selectCall = body.match(/\.select\('[^']*'\)/);
  assert.ok(selectCall, 'expected to find the select call');
  assert.doesNotMatch(selectCall[0], /internal_notes/);
});

test('an unauthenticated visitor is redirected to login, not shown the form', () => {
  assert.match(WORK_ORDERS, /if \(!session\) \{ window\.location\.replace\('\/portal\/login\.html'\); return; \}/);
  // Both on initial load AND at submit time -- a session can expire
  // while the form sits open, and submitting into a dead session
  // should send them to log in rather than silently fail.
  const initMatch = WORK_ORDERS.match(/async function init\(\)[\s\S]*?\n  \}\n/);
  const submitMatch = WORK_ORDERS.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.match(initMatch[0], /login\.html/);
  assert.match(submitMatch[0], /login\.html/);
});

test('blank title or description is caught client-side, matching the database CHECK constraints', () => {
  const fnMatch = WORK_ORDERS.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  // The table has not-blank CHECK constraints on both; validating
  // here too avoids a pointless round trip that just returns an error.
  assert.match(fnMatch[0], /if \(!title\)/);
  assert.match(fnMatch[0], /if \(!description\)/);
});

test('portal/work-orders.html loads none of the internal /tools/ scripts', () => {
  // Same hard isolation boundary every other portal page holds: the
  // client-facing portal never loads internal tooling JS.
  assert.doesNotMatch(WORK_ORDERS, /src="\/tools\/[^"]*\.js/);
  // Shared stylesheets are fine and intentional, for visual consistency.
  assert.match(WORK_ORDERS, /href="\/tools\/styles-tools\.css/);
});

test('work-orders.html allows Supabase in its CSP connect-src', () => {
  // The exact class of bug that caused a multi-hour lockout on
  // review-request.html earlier the same day: a permission/data page
  // whose CSP blocked Supabase entirely, surfacing only as a generic
  // "Failed to fetch".
  const connectSrc = (WORK_ORDERS.match(/connect-src([^;"]*)/) || [])[1];
  assert.ok(connectSrc !== undefined, 'expected a connect-src directive');
  assert.match(connectSrc, /csvfqdjuobylgafgolho\.supabase\.co/);
});

test('all four portal pages cross-link to each other, each marking its own page active', () => {
  const pages = {
    'work-orders.html': 'Request',
    'quotes.html': 'Quotes',
    'dashboard.html': 'Invoices',
    'jobs.html': 'Jobs',
  };
  for (const [file, activeLabel] of Object.entries(pages)) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', file), 'utf8');
    const navMatch = src.match(/<nav class="portal-nav"[\s\S]*?<\/nav>/);
    assert.ok(navMatch, `${file}: expected a portal-nav block`);
    const nav = navMatch[0];
    // Every page links to all four.
    for (const target of Object.keys(pages)) {
      assert.match(nav, new RegExp(`href="/portal/${target.replace('.', '\\.')}"`),
        `${file}: should link to ${target}`);
    }
    // And marks exactly its own as active.
    assert.match(nav, new RegExp(`class="is-active" aria-current="page">[\\s\\S]*?<span>${activeLabel}</span>`),
      `${file}: should mark ${activeLabel} as the active tab`);
    assert.equal((nav.match(/is-active/g) || []).length, 1,
      `${file}: exactly one nav item should be active`);
  }
});

// ---- collision-proof invoice/quote numbering ----

test('invoice and quote numbers are drawn from the database sequence, never generated randomly', () => {
  // The old scheme was INV-<year>-<random 4 digits> generated in the
  // browser -- a real birthday-paradox collision risk whose only
  // guard could see one device's own localStorage and could warn but
  // never prevent. nextval() on a Postgres sequence is atomic and
  // transactional, so it cannot return the same value twice.
  assert.doesNotMatch(INVOICE_GEN, /Math\.random\(\) \* 9000/,
    'no invoice or quote number should be generated randomly anymore');
  assert.match(INVOICE_GEN, /rpc\/\$\{rpcName\}/);
  assert.match(INVOICE_GEN, /assignNextNumber\('invoiceNumber', 'next_invoice_number', 'INV-'\)/);
  assert.match(INVOICE_GEN, /assignNextNumber\('quoteNumber', 'next_quote_number', 'EST-'\)/);
});

test('every number-assignment site uses the sequence -- initial load and both form resets', () => {
  // Three sites total: page load, the post-generate invoice reset, and
  // the post-generate quote reset. Missing one would silently
  // reintroduce random numbering on that path only.
  const invoiceCalls = (INVOICE_GEN.match(/assignNextNumber\('invoiceNumber'/g) || []).length;
  const quoteCalls = (INVOICE_GEN.match(/assignNextNumber\('quoteNumber'/g) || []).length;
  assert.equal(invoiceCalls, 2, 'expected invoice number drawn on page load and on form reset');
  assert.equal(quoteCalls, 2, 'expected quote number drawn on page load and on form reset');
});

test('a failed number draw falls back to a clearly-marked temporary number, never blank', () => {
  const fnMatch = INVOICE_GEN.match(/async function assignNextNumber\([\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate assignNextNumber()');
  const body = fnMatch[0];
  // Being unable to invoice a client standing in front of you is
  // worse than a number needing a manual fix later -- but the
  // fallback has to be obvious on sight, hence TMP-.
  assert.match(body, /'-TMP-'/);
  assert.match(body, /logClientError/, 'a fallback should be logged so it can be found and corrected later');
});

// ---- internal queue (tools/workspace.html) ----

const WORKSPACE = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'workspace.html'), 'utf8');

test('the internal queue includes scheduled requests, dropping only completed and declined ones', () => {
  // Rewritten 2026-09-03. This test's old premise -- that a scheduled
  // request "lives in the Job Tracker and calendar" instead -- was
  // never actually true: the real Approve & Schedule flow just sets
  // status='scheduled' and a real scheduled_at directly on THIS row
  // (see openWorkOrderApproval/confirmWorkOrderApproval), with no
  // separate Job Tracker or calendar entry created at all. Excluding
  // 'scheduled' from the open list would have made an upcoming,
  // already-confirmed appointment disappear from the one place
  // tracking it, before the work was even done.
  assert.match(WORKSPACE, /const WORK_REQUEST_OPEN_STATUSES = \['submitted', 'reviewing', 'quoted', 'scheduled'\];/);
  const fnMatch = WORKSPACE.match(/async function loadAndRenderWorkRequests\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate loadAndRenderWorkRequests()');
  assert.match(fnMatch[0], /status=in\.\(\$\{statusList\}\)/);
});

test('work requests count toward the Action Items badge, like every other item in that section', () => {
  assert.match(WORKSPACE, /const actionItemCounts = \{ workrequests: 0,/);
  assert.match(WORKSPACE, /actionItemCounts\.workrequests \+ actionItemCounts\.leads/,
    'the badge total must include work requests');
});

test('advancing a request is a real PATCH, and the status set matches the database CHECK constraint', () => {
  const fnMatch = WORKSPACE.match(/async function advanceWorkRequest\(id, newStatus\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate advanceWorkRequest()');
  assert.match(fnMatch[0], /method: 'PATCH'/);
  assert.match(fnMatch[0], /client_portal_work_orders\?id=eq\./);
  // Every status this UI can write must be one the table's own CHECK
  // constraint actually permits, or the PATCH fails at the database.
  const allowed = ['submitted', 'reviewing', 'quoted', 'scheduled', 'completed', 'declined'];
  const nextMatch = WORKSPACE.match(/const WORK_REQUEST_NEXT_STATUS = \{[\s\S]*?\n  \};/);
  assert.ok(nextMatch, 'expected to find WORK_REQUEST_NEXT_STATUS');
  for (const m of nextMatch[0].matchAll(/next: '([a-z]+)'/g)) {
    assert.ok(allowed.includes(m[1]), `${m[1]} is not a valid work order status`);
  }
});

test('the queue is loaded on dashboard init, not only on demand', () => {
  assert.match(WORKSPACE, /loadAndRenderWorkRequests\(\);\n    loadAndRenderLeads\(\);/,
    'work requests should load alongside leads on dashboard load');
});
