// Cancel a work-order request (2026-09-19), requested directly from a
// portal audit finding: previously there was no client UPDATE or
// DELETE policy on client_portal_work_orders at all (by design -- see
// create_client_portal_work_orders.sql's own comment #3), so a client
// who fat-fingered a request or changed their mind had no option but
// to call. That comment specifically anticipated this exact feature:
// "an explicit status transition through an edge function, not a raw
// delete." cancel-work-order-index.ts is that function; this only
// covers the portal-side wiring (server-side authorization/status
// checks live in the edge function itself, not tested here in JS).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const CANCEL_FN = fs.readFileSync(repo('edge-functions', 'cancel-work-order-index.ts'), 'utf8');
const CREATE_SQL = fs.readFileSync(repo('sql', 'portal', 'create_client_portal_work_orders.sql'), 'utf8');
const CANCEL_SQL = fs.readFileSync(repo('sql', 'portal', 'add_work_order_cancel.sql'), 'utf8');

test('Cancel request only renders for a still-submitted request, not once Steve has started working it', () => {
  const fnMatch = WORK_ORDERS.match(/function renderRequestCard\(wo\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderRequestCard()');
  assert.match(fnMatch[0], /statusKey === 'submitted' \? `<button type="button" class="btn secondary-btn"[\s\S]*?onclick="cancelWorkOrder\(\$\{wo\.id\}\)">Cancel request<\/button>` : ''/);
});

test('cancelWorkOrder() confirms first, then calls the cancel-work-order edge function with the caller\'s own session token', () => {
  const fnMatch = WORK_ORDERS.match(/async function cancelWorkOrder\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate cancelWorkOrder()');
  const body = fnMatch[0];
  // Confirm + optional reason in one step (2026-09-22): null is "keep it".
  assert.match(body, /const reason = await portalPromptTextarea\('Cancel this request\?/);
  assert.match(body, /if \(reason === null\) return;/);
  assert.match(body, /work_order_id: id, reason/);
  assert.match(body, /functions\/v1\/cancel-work-order/);
  assert.match(body, /'Authorization': `Bearer \$\{session\.access_token\}`/);
  assert.match(body, /work_order_id: id/);
});

test('a cancelled request no longer counts as "open" in the banner, same treatment as completed/declined', () => {
  assert.match(WORK_ORDERS, /s !== 'completed' && s !== 'declined' && s !== 'cancelled'/);
});

test('cancelled has a real client-facing status label and badge style, not a raw db value', () => {
  assert.match(WORK_ORDERS, /cancelled: 'Cancelled'/);
  assert.match(WORK_ORDERS, /\.wo-status\.is-cancelled\s*\{/);
});

test('the edge function only allows cancelling from \'submitted\', and only the request\'s own owner', () => {
  assert.match(CANCEL_FN, /workOrder\.status !== "submitted"/);
  assert.match(CANCEL_FN, /workOrder\.client_email\.toLowerCase\(\) !== claims\.email\.toLowerCase\(\)/);
  assert.match(CANCEL_FN, /status: "cancelled"/);
});

test('the edge function uses the service role to write, matching every other client-status-change function (respond-to-quote) rather than a client-facing UPDATE policy', () => {
  assert.match(CANCEL_FN, /SERVICE_ROLE_KEY/);
  assert.doesNotMatch(CREATE_SQL, /clients (can |may )?(cancel|update) their own work orders/i);
});

test('the sql migration only widens the status CHECK constraint -- it does not add a client UPDATE/DELETE policy (the edge function is still the only write path)', () => {
  assert.match(CANCEL_SQL, /work_order_status_valid/);
  assert.match(CANCEL_SQL, /'cancelled'/);
  assert.doesNotMatch(CANCEL_SQL, /create policy/i);
});

// ---- 2026-09-22: a cancel tells Steve, and in-progress requests can ask ----

test('a cancel posts a note on the request\'s thread -- which is what emails the internal team', () => {
  assert.match(CANCEL_FN, /const reasonText = typeof reason === "string" \? reason\.trim\(\)\.slice\(0, 500\) : "";/);
  const insertAt = CANCEL_FN.indexOf('/rest/v1/client_portal_work_order_messages');
  const patchAt = CANCEL_FN.indexOf('method: "PATCH"');
  assert.ok(patchAt > 0 && insertAt > patchAt, 'the note is only posted after the cancel itself succeeded');
  assert.match(CANCEL_FN, /sender_type: "client",\s*sender_email: workOrder\.client_email,\s*message,/);
  assert.match(CANCEL_FN, /"I've cancelled this request in the portal\." \+ \(reasonText \? `\\n\\nReason: \$\{reasonText\}` : ""\)/);
  assert.match(CANCEL_FN, /return json\(\{ ok: true, notified \}\);/);
});

test('the cancel only lands if the request is STILL submitted when it writes -- a race with Steve updates nothing', () => {
  assert.match(CANCEL_FN, /client_portal_work_orders\?id=eq\.\$\{work_order_id\}&status=eq\.submitted`/);
  assert.match(CANCEL_FN, /Prefer: "return=representation"/);
  assert.match(CANCEL_FN, /if \(!Array\.isArray\(updated\) \|\| !updated\.length\) \{\s*return json\(\{ ok: false, error: "This request is already being worked on/);
});

test('a failed note never turns a successful cancel into an error', () => {
  const tail = CANCEL_FN.slice(CANCEL_FN.indexOf("const message = \"I've cancelled"));
  assert.match(tail, /try \{[\s\S]*notified = msgRes\.ok;[\s\S]*\} catch \(err: any\) \{\s*console\.error/);
  assert.match(extractCancelFn(), /showToast\(result\.notified \? "Request cancelled\. We've let Triple H know\." : 'Request cancelled\.'\);/);
});

function extractCancelFn() {
  return WORK_ORDERS.match(/async function cancelWorkOrder\(id\)[\s\S]*?\n  \}\n/)[0];
}

test('once work has started, "Need to cancel?" asks in the thread instead of changing the status', () => {
  assert.match(WORK_ORDERS, /const ASK_TO_CANCEL_STATUSES = \['reviewing', 'quoted', 'scheduled'\];/);
  const card = WORK_ORDERS.match(/function renderRequestCard\(wo\)[\s\S]*?\n  \}\n/)[0];
  assert.match(card, /\$\{ASK_TO_CANCEL_STATUSES\.includes\(statusKey\) \? `<button type="button" class="wo-cancel-ask" onclick="askToCancelWorkOrder\(\$\{wo\.id\}\)">Need to cancel\?<\/button>` : ''\}/);
  const ask = WORK_ORDERS.match(/async function askToCancelWorkOrder\(id\)[\s\S]*?\n  \}\n/)[0];
  assert.match(ask, /if \(reason === null\) return;/);
  assert.match(ask, /from\('client_portal_work_order_messages'\)\.insert\(\{\s*work_order_id: id,\s*sender_type: 'client',\s*sender_email: session\.user\.email,\s*message: 'Please cancel this request\.' \+ \(reason \? '\\n\\n' \+ reason : ''\),/);
  assert.doesNotMatch(ask, /cancel-work-order/, 'no status change from the client past submitted');
  assert.match(ask, /if \(woThreadIsOpen\(id\)\) loadAndRenderThread\(id\);\s*else if \(toggle\) toggleMessages\(id, toggle\);/);
});
