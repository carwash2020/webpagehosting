// Tests for the notification recipient list and the new-work-order /
// approve-and-schedule email flows (2026-09-03), requested directly:
// "when a client requests a work order it needs to email
// Steve@triplehenterprisesllc.biz and connor@triplehenterprisesllc.biz.
// We should also add an 'Email list' In dev tools so that way we can
// add emails to the notification pile in future if we ever hire,"
// plus "for 3 should we build an 'Approve work order' So which would
// pop up on their portal and send them an email that appointment is
// booked?"

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
// The Email list panel moved off Dev Tools onto its own
// /tools/clients.html (2026-09-03), requested directly: "lets split
// the portal out of tools and add it as its own [tool]." Approve &
// Schedule stayed on workspace.html -- that's a different feature
// (scheduling in Workspace, not portal administration) that was never
// part of the split.
const CLIENTS = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const SHARED = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');

// ---- Email list panel ----

test('the Email list panel exists on the Clients tool, with add and remove', () => {
  assert.match(CLIENTS, /<h2>Email list<\/h2>/);
  assert.match(CLIENTS, /id="emailListNewEmail"/);
  assert.match(CLIENTS, /onclick="addNotificationRecipient\(\)"/);
});

test('renderEmailList renders on page load with the other Clients panels', () => {
  assert.match(CLIENTS, /renderPortalWorkOrders\(\);\s*renderEmailList\(\);/);
});

test('removing a recipient does NOT embed JSON in an inline onclick -- the exact bug just fixed elsewhere in this file', () => {
  // The photo and PDF viewers had this same bug: JSON.stringify()
  // embedded inside a double-quoted onclick truncates the handler at
  // the JSON's own first internal quote. Caught in my own first draft
  // of this panel before it shipped -- guarded here so it can't
  // silently come back. Checks the actual onclick= attribute
  // specifically, not just the word "JSON.stringify" anywhere in the
  // function (which also appears, correctly, in this file's own
  // explanatory comment about the bug it avoids).
  const fnMatch = CLIENTS.match(/async function renderEmailList\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderEmailList()');
  assert.doesNotMatch(fnMatch[0], /onclick="[^"]*JSON\.stringify/);
  assert.match(fnMatch[0], /onclick="removeNotificationRecipient\(' \+ r\.id \+ '\)"/);
});

test('removeNotificationRecipient looks up the email from the cache rather than requiring it be passed in', () => {
  const fnMatch = CLIENTS.match(/async function removeNotificationRecipient\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate removeNotificationRecipient(id) -- a single numeric argument');
  assert.match(fnMatch[0], /_emailListCache \|\| \[\]\)\.find\(r => r\.id === id\)/);
});

test('adding a duplicate email is reported plainly, not as a generic error', () => {
  const fnMatch = CLIENTS.match(/async function addNotificationRecipient\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate addNotificationRecipient()');
  assert.match(fnMatch[0], /is already on the list/);
});

test('the panel has help text', () => {
  assert.match(CLIENTS, /openDevInfo\('emaillist'\)/);
  assert.match(SHARED, /emaillist: \{/);
});

// ---- Approve & Schedule (Workspace) ----

test('quoted -> scheduled is no longer a bare one-tap status bump', () => {
  // The other transitions (submitted->reviewing, reviewing->quoted)
  // stay simple one-tap bumps -- only this one needs a real date/time,
  // since that's what the client-facing email and portal card display.
  assert.doesNotMatch(WORKSPACE, /quoted: \{ next: 'scheduled'/);
  assert.match(WORKSPACE, /wo\.status === 'quoted'[\s\S]{0,80}openWorkOrderApproval/);
});

test('scheduled -> completed exists, closing the gap the approval flow would otherwise leave', () => {
  // Adding the quoted->scheduled special case removed it from the
  // generic map entirely -- without also adding scheduled->completed,
  // there would be no way to ever close out an approved request.
  assert.match(WORKSPACE, /scheduled: \{ next: 'completed', label: 'Mark completed' \}/);
});

test('confirming an approval warns, but does not block, scheduling outside real business hours', () => {
  const fnMatch = WORKSPACE.match(/async function confirmWorkOrderApproval\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate confirmWorkOrderApproval()');
  const body = fnMatch[0];
  // The warning block: checks real hours, asks via showConfirm (not a
  // hard block), and only returns early if the user actually declines.
  const warnBlock = body.match(/if \(hours && \(hh < hours\[0\] \|\| hh >= hours\[1\]\)\) \{[\s\S]*?\n    \}/);
  assert.ok(warnBlock, 'expected the outside-hours warning block');
  assert.match(warnBlock[0], /await showConfirm\(/);
  assert.match(warnBlock[0], /if \(!proceed\) return;/, 'only declining should stop the flow, not the warning itself');
  // Building the actual scheduled time comes AFTER that block, so
  // confirming "yes, schedule it anyway" reaches it.
  const afterWarnIdx = body.indexOf(warnBlock[0]) + warnBlock[0].length;
  assert.match(body.slice(afterWarnIdx), /const scheduledAtUtc = zonedTimeToUtc\(dateVal, hh, mm\);/);
});

test('approving sends both status and scheduled_at together in one PATCH', () => {
  const fnMatch = WORKSPACE.match(/async function confirmWorkOrderApproval\(id\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /status: 'scheduled', scheduled_at: scheduledAtUtc\.toISOString\(\)/);
});

test('workspace.html loads the shared business-hours file for the approval form\'s real-hours warning', () => {
  assert.match(WORKSPACE, /<script src="\/business-hours\.js\?v=\d+"><\/script>/);
});
