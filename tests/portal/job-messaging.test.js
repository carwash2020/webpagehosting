// Tests for two-way messaging on a COMPLETED job (2026-09-16),
// closing the gap docs/CLIENT-PORTAL.md flagged: phase 6 built
// messaging on work orders (a not-yet-assessed request), but a client
// with a question about a job that's already done had no channel at
// all except a brand-new work order or a phone call. Mirrors
// tests/portal/work-order-messaging.test.js closely, since the feature
// itself mirrors that one closely by design.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const CLIENTS = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const NOTIFY_FN = fs.readFileSync(repo('edge-functions', 'notify-job-message-email-index.ts'), 'utf8');
const MIGRATION = fs.readFileSync(repo('sql', 'portal', 'create_client_portal_job_messages.sql'), 'utf8');

// ---- portal (client) side ----

test('every job card has a Messages toggle and a thread container', () => {
  const fnMatch = JOBS.match(/function renderJobCard\(j\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderJobCard()');
  const body = fnMatch[0];
  assert.match(body, /onclick="toggleJobMessages\(\$\{j\.id\}, this\)"/);
  assert.match(body, /id="jobMessages-\$\{j\.id\}"/);
});

test('messages are loaded on demand, not fetched for every card on page load', () => {
  const renderJobsMatch = JOBS.match(/async function renderJobs\(\)[\s\S]*?\n  \}\n/);
  assert.ok(renderJobsMatch, 'expected to isolate renderJobs()');
  assert.doesNotMatch(renderJobsMatch[0], /client_portal_job_messages/);
  assert.match(JOBS, /async function toggleJobMessages\(jobId, btnEl\)/);
});

test('a client message is inserted with sender_type client and their real session email, not a client-supplied value', () => {
  const fnMatch = JOBS.match(/async function sendJobMessage\(jobId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate sendJobMessage()');
  const body = fnMatch[0];
  assert.match(body, /sender_type: 'client'/);
  assert.match(body, /sender_email: session\.user\.email/);
});

test('sending a message reloads the real thread from the server, not an optimistic local append', () => {
  const fnMatch = JOBS.match(/async function sendJobMessage\(jobId\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /await loadAndRenderJobThread\(jobId\);/);
});

test('an unauthenticated attempt to send redirects to login, matching every other real action on this page', () => {
  const fnMatch = JOBS.match(/async function sendJobMessage\(jobId\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /window\.location\.replace\('\/portal\/login\.html'\)/);
});

// ---- internal (Clients tool) side ----

test('every portal job row in the Clients tool has a Messages toggle and a thread container', () => {
  const fnMatch = CLIENTS.match(/async function renderPortalJobsForMessages\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPortalJobsForMessages()');
  assert.match(fnMatch[0], /onclick="toggleJobMessagesInternal\(' \+ j\.id \+ ', this\)"/);
  assert.match(fnMatch[0], /id="jobMsgPanel-' \+ j\.id \+ '"/);
});

test('an internal reply is inserted with sender_type internal and the real signed-in account email', () => {
  const fnMatch = CLIENTS.match(/async function sendJobMessageInternal\(jobId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate sendJobMessageInternal()');
  const body = fnMatch[0];
  assert.match(body, /sender_type: 'internal'/);
  assert.match(body, /getCurrentUserEmail\(\)/);
});

test('no inline handler for the new messaging buttons embeds JSON.stringify -- the exact bug fixed twice already on the work-order panel this mirrors', () => {
  const hits = [...CLIENTS.matchAll(/on(?:click|input|change)="[^"\n]*(?:toggleJobMessagesInternal|sendJobMessageInternal)[^"\n]*JSON\.stringify/g)];
  assert.equal(hits.length, 0);
});

test('the Portal job messages panel loads on init, alongside the other Portal panels', () => {
  // After renderEmailList() rather than directly after
  // renderPortalWorkOrders() -- a pre-existing test
  // (tests/dev-tools/email-list-and-work-order-notifications.test.js)
  // asserts that exact adjacency, and this call has no ordering
  // dependency on any of its neighbors, so it slots in after instead
  // of contesting that assertion.
  const initMatch = CLIENTS.match(/renderEmailList\(\);\s*\n\s*renderPortalJobsForMessages\(\);/);
  assert.ok(initMatch, 'expected renderPortalJobsForMessages() to be called in the page init sequence, right after renderEmailList()');
});

// ---- database + notification (structure, not live behavior) ----

test('the notify function handles both directions -- client message notifies the internal list, internal reply notifies the client', () => {
  assert.match(NOTIFY_FN, /sender_type === "internal"/);
  assert.match(NOTIFY_FN, /notification_recipients/);
  assert.match(NOTIFY_FN, /job\.client_email/);
});

test('the internal-team email reuses the same notification_recipients list new-work-order alerts use, not a second separately-maintained list', () => {
  const recipientsQueryCount = (NOTIFY_FN.match(/notification_recipients\?select=email&notify_types/g) || []).length;
  assert.equal(recipientsQueryCount, 1, 'expected exactly one query against notification_recipients');
});

test('the client opt-out check reuses wants_message_emails, the same column work-order messages already respect', () => {
  assert.match(NOTIFY_FN, /"wants_message_emails"/);
});

// ---- schema (structure, not live behavior) ----

test('a client can only ever post as themselves, on a job that is actually theirs', () => {
  const insertPolicyMatch = MIGRATION.match(/create policy "clients or internal accounts send job messages"[\s\S]*?;\n/);
  assert.ok(insertPolicyMatch, 'expected to isolate the insert policy');
  const body = insertPolicyMatch[0];
  assert.match(body, /sender_type = 'client'/);
  assert.match(body, /sender_email = \(select auth\.email\(\)\)/);
  assert.match(body, /j\.client_email = \(select auth\.email\(\)\)/);
});

test('an internal reply requires actually holding an account role, reusing the existing helper rather than a new check', () => {
  assert.match(MIGRATION, /current_user_has_any_role\(\)/);
});

test('the message content cannot be blank or whitespace-only', () => {
  assert.match(MIGRATION, /constraint job_message_not_blank check \(length\(trim\(message\)\) > 0\)/);
});
