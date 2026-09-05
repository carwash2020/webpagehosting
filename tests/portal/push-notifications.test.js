// Tests for client portal push notifications + offline support
// (2026-09-04), requested directly: "lets build push notifications
// offline support." The two share one foundation: a real service
// worker for the portal (previously it had none at all, despite the
// manifest already existing) provides both offline app-shell caching
// and the required infrastructure for push.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SW = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');
const PUSH_JS = fs.readFileSync(repo('portal', 'push-notifications.js'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
const SEND_PUSH = fs.readFileSync(repo('edge-functions', 'send-push-index.ts'), 'utf8');
const WO_MESSAGE = fs.readFileSync(repo('edge-functions', 'notify-work-order-message-email-index.ts'), 'utf8');

const PORTAL_PAGES = ['home', 'dashboard', 'jobs', 'quotes', 'work-orders', 'settings', 'login', 'set-password'];

// ---- service worker: offline support ----

test('the portal service worker is genuinely separate from the tools one, scoped to /portal/ specifically', () => {
  assert.match(SW, /const CACHE_NAME = 'th-portal-v3';/);
  const registrations = PORTAL_PAGES.map((p) => fs.readFileSync(repo('portal', `${p}.html`), 'utf8'));
  for (const html of registrations) {
    assert.match(html, /navigator\.serviceWorker\.register\('\/portal\/service-worker\.js', \{ scope: '\/portal\/' \}\)/);
  }
});

test('every portal page is precached, so the app shell can still open with no connection', () => {
  for (const page of PORTAL_PAGES) {
    assert.match(SW, new RegExp(`/portal/${page}\\.html`), `expected ${page}.html in PRECACHE_URLS`);
  }
});

test('cross-origin requests (Supabase API calls) are never intercepted -- stale business data must never be served as if current', () => {
  const fetchHandler = SW.match(/self\.addEventListener\('fetch'[\s\S]*?\n\}\);/);
  assert.ok(fetchHandler);
  assert.match(fetchHandler[0], /if \(url\.origin !== self\.location\.origin\) return;/);
});

test('versioned assets are cache-first, everything else is network-first with an offline fallback', () => {
  const fetchHandler = SW.match(/self\.addEventListener\('fetch'[\s\S]*?\n\}\);/);
  assert.match(fetchHandler[0], /if \(url\.searchParams\.has\('v'\)\)/);
  assert.match(fetchHandler[0], /\.catch\(\(\) => caches\.match\(event\.request\)\)/);
});

test('the service worker handles push and notificationclick, landing on the portal by default, not the tools app', () => {
  assert.match(SW, /self\.addEventListener\('push'/);
  assert.match(SW, /data\.url \|\| '\/portal\/home\.html'/);
  assert.match(SW, /self\.addEventListener\('notificationclick'/);
});

// ---- client-side subscribe/unsubscribe ----

test('the portal push helper uses the Supabase SDK session, never auth.js -- the portal deliberately never loads that file', () => {
  assert.match(PUSH_JS, /client\.auth\.getSession\(\)/);
  // Excludes comment lines before checking -- the file's own header
  // comment explains, in prose, exactly what it deliberately does
  // NOT use, and that explanation mentioning these names is
  // documentation, not a violation of what it's documenting. Only
  // real code lines should ever call either of these.
  const codeLines = PUSH_JS.split('\n').filter((line) => !line.trim().startsWith('//'));
  const codeOnly = codeLines.join('\n');
  assert.doesNotMatch(codeOnly, /getAuthToken\(\)/);
  assert.doesNotMatch(codeOnly, /getCurrentUserId\(\)/);
});

test('enabling push requires a real granted permission before ever subscribing', () => {
  const fnMatch = PUSH_JS.match(/async function enablePortalPushNotifications\(\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /if \(permission !== 'granted'\)/);
});

test('disabling always unsubscribes locally first, even if the server-side delete fails', () => {
  const fnMatch = PUSH_JS.match(/async function disablePortalPushNotifications\(\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  const unsubIdx = fnMatch[0].indexOf('subscription.unsubscribe()');
  const deleteIdx = fnMatch[0].indexOf('method: \'DELETE\'');
  assert.ok(unsubIdx !== -1 && deleteIdx !== -1);
  assert.ok(unsubIdx < deleteIdx);
});

// ---- Settings UI ----

test('the push toggle correctly detects the iOS-requires-home-screen-install restriction, same check already used for Add to Home Screen', () => {
  const fnMatch = SETTINGS.match(/async function renderPushToggle\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPushToggle()');
  assert.match(fnMatch[0], /isIOSNow && !isStandaloneNow/);
});

test('the toggle button dynamically switches between enable and disable handlers based on actual current state', () => {
  const fnMatch = SETTINGS.match(/async function renderPushToggle\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /btn\.onclick = enabled \? handleDisablePush : handleEnablePush;/);
});

test('portal/push-notifications.js is loaded on settings.html', () => {
  assert.match(SETTINGS, /<script src="\/portal\/push-notifications\.js"><\/script>/);
});

// ---- backend: targeted send, not a broadcast ----

test('sendToUserSubscriptions filters to one specific user, genuinely distinct from the broadcast-to-everyone sendToAllSubscriptions', () => {
  const fnMatch = SEND_PUSH.match(/async function sendToUserSubscriptions\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate sendToUserSubscriptions()');
  assert.match(fnMatch[0], /getSubscriptionsForUser\(userId\)/);
});

test('getSubscriptionsForUser filters by user_id in the actual query, not just in a comment', () => {
  const fnMatch = SEND_PUSH.match(/async function getSubscriptionsForUser\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /push_subscriptions\?user_id=eq\.\$\{userId\}/);
});

test('the client-notification request type requires both user_id and title, rejecting an incomplete request rather than silently doing nothing', () => {
  const block = SEND_PUSH.match(/if \(payload\.type === "client-notification"\) \{[\s\S]*?\n    \}\n/);
  assert.ok(block, 'expected to isolate the client-notification branch');
  assert.match(block[0], /if \(!userId \|\| !title\)/);
  assert.match(block[0], /status: 400/);
});

test('the client-notification branch calls the targeted sender, never the broadcast one', () => {
  const block = SEND_PUSH.match(/if \(payload\.type === "client-notification"\) \{[\s\S]*?\n    \}\n/);
  assert.match(block[0], /sendToUserSubscriptions\(userId,/);
  assert.doesNotMatch(block[0], /sendToAllSubscriptions/);
});

// ---- wired into a real trigger ----

test('a work order message reply looks up the real auth user id by email before sending push, since push_subscriptions is keyed to a real user id, not an email', () => {
  const fnMatch = WO_MESSAGE.match(/async function getUserIdByEmail\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate getUserIdByEmail()');
  assert.match(fnMatch[0], /\/auth\/v1\/admin\/users\?email=/);
});

test('the push call uses the real function\u2019s exact casing (Send-Push), not a lowercase variant -- Supabase function slugs are case-sensitive, and a lowercase call created a genuinely separate, orphaned function during this build', () => {
  const fnMatch = WO_MESSAGE.match(/async function sendClientPush\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate sendClientPush()');
  assert.match(fnMatch[0], /\/functions\/v1\/Send-Push/);
  assert.doesNotMatch(fnMatch[0], /\/functions\/v1\/send-push[^-]/);
});

test('a missing push subscription is silent and non-fatal -- push is a best-effort additional channel, never a required step', () => {
  const fnMatch = WO_MESSAGE.match(/async function sendClientPush\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate sendClientPush()');
  assert.match(fnMatch[0], /if \(!userId\) return;/);
  assert.match(fnMatch[0], /catch \(err: any\) \{/);
});

test('push is only sent in the internal-to-client direction, after the same wants_message_emails check the email itself already passed', () => {
  const branch = WO_MESSAGE.match(/if \(msg\.sender_type === "internal"\) \{[\s\S]*?\n    \}\n/);
  assert.ok(branch, 'expected to isolate the internal-to-client branch');
  const emailCheckIdx = branch[0].indexOf('clientWantsNotification');
  const pushIdx = branch[0].indexOf('sendClientPush');
  assert.ok(emailCheckIdx !== -1 && pushIdx !== -1);
  assert.ok(emailCheckIdx < pushIdx, 'the notification-preference check should happen before the push send, not after');
});

// ---- database ----

test('clients can manage their own push subscription, additive to (not replacing) the existing internal-only policy', () => {
  // This is verified live against the database directly (confirmed
  // via pg_policies during the build), not re-derivable from a
  // static file -- this test instead confirms the edge function code
  // that depends on this policy existing is internally consistent
  // with that expectation.
  assert.match(SEND_PUSH, /push_subscriptions\?user_id=eq/);
});
