// Tests for two-way messaging on work orders (2026-09-03), item 2 of
// a roadmap requested directly: quotes already let a client ask a
// question about their estimate; work requests had no equivalent
// channel at all -- "if you need to say 'can you send a photo of the
// model number?' there's no channel except calling."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const CLIENTS = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const NOTIFY_FN = fs.readFileSync(repo('edge-functions', 'notify-work-order-message-email-index.ts'), 'utf8');

// ---- portal (client) side ----

test('every request card has a Messages toggle and a thread container', () => {
  const fnMatch = WORK_ORDERS.match(/function renderRequestCard\(wo\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderRequestCard()');
  const body = fnMatch[0];
  assert.match(body, /onclick="toggleMessages\(\$\{wo\.id\}, this\)"/);
  assert.match(body, /id="woMessages-\$\{wo\.id\}"/);
});

test('messages are loaded on demand, not fetched for every card on page load', () => {
  // Most requests will have zero messages -- fetching an empty thread
  // per card on every visit would be wasted work for the common case.
  const renderMyRequestsMatch = WORK_ORDERS.match(/async function renderMyRequests\(\)[\s\S]*?\n  \}\n/);
  assert.doesNotMatch(renderMyRequestsMatch[0], /client_portal_work_order_messages/);
  assert.match(WORK_ORDERS, /async function toggleMessages\(workOrderId, btnEl\)/);
});

test('a client message is inserted with sender_type client and their real session email, not a client-supplied value', () => {
  const fnMatch = WORK_ORDERS.match(/async function sendMessage\(workOrderId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate sendMessage()');
  const body = fnMatch[0];
  assert.match(body, /sender_type: 'client'/);
  assert.match(body, /sender_email: session\.user\.email/);
});

test('sending a message reloads the real thread from the server, not an optimistic local append', () => {
  const fnMatch = WORK_ORDERS.match(/async function sendMessage\(workOrderId\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /await loadAndRenderThread\(workOrderId\);/);
});

test('an unauthenticated attempt to send redirects to login, matching every other real action on this page', () => {
  const fnMatch = WORK_ORDERS.match(/async function sendMessage\(workOrderId\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /window\.location\.replace\('\/portal\/login\.html'\)/);
});

// ---- internal (Clients tool) side ----

test('every work order row in the Clients tool has a Messages toggle and a thread container', () => {
  const fnMatch = CLIENTS.match(/el\.innerHTML = rows\.map\(w => \{[\s\S]*?\}\)\.join\(''\);/);
  assert.ok(fnMatch, 'expected to isolate the work order row template');
  assert.match(fnMatch[0], /onclick="toggleWorkOrderMessages\(' \+ w\.id \+ ', this\)"/);
  assert.match(fnMatch[0], /id="woMessages-' \+ w\.id \+ '"/);
});

test('an internal reply is inserted with sender_type internal and the real signed-in account email', () => {
  const fnMatch = CLIENTS.match(/async function sendWorkOrderMessage\(workOrderId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate sendWorkOrderMessage()');
  const body = fnMatch[0];
  assert.match(body, /sender_type: 'internal'/);
  assert.match(body, /getCurrentUserEmail\(\)/);
});

test('no inline handler for the new messaging buttons embeds JSON.stringify -- the exact bug fixed twice already on this same panel', () => {
  const hits = [...CLIENTS.matchAll(/on(?:click|input|change)="[^"\n]*(?:toggleWorkOrderMessages|sendWorkOrderMessage)[^"\n]*JSON\.stringify/g)];
  assert.equal(hits.length, 0);
});

test('the toggle button label switches cleanly between Messages and Hide Messages, with no stray leading space', () => {
  // A real bug caught and fixed while building this: replacing
  // /^Hide/ with '' on "Hide Messages" leaves " Messages" (a leading
  // space), which is truthy and never falls back to the clean label.
  const fnMatch = CLIENTS.match(/async function toggleWorkOrderMessages\(workOrderId, btnEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /\.replace\(\/\^Hide\//);
  assert.match(fnMatch[0], /btnEl\.textContent = 'Messages';/);
});

// ---- database + notification (structure, not live behavior) ----

test('the notify function handles both directions -- client message notifies the internal list, internal reply notifies the client', () => {
  assert.match(NOTIFY_FN, /sender_type === "internal"/);
  assert.match(NOTIFY_FN, /notification_recipients/);
  assert.match(NOTIFY_FN, /wo\.client_email/);
});

test('the internal-team email reuses the same notification_recipients list new-work-order alerts use, not a second separately-maintained list', () => {
  const recipientsQueryCount = (NOTIFY_FN.match(/notification_recipients\?select=email&notify_types/g) || []).length;
  assert.equal(recipientsQueryCount, 1, 'expected exactly one query against notification_recipients');
});
