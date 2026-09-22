// Applicants panel on workspace.html (2026-09-19), requested directly
// ("Applicants panel so nothing gets missed") after the careers.html
// apply form started writing to th_job_applications: previously the
// only way to see a new application was the notification email
// actually landing correctly, with no fallback inside the tools app
// itself. Mirrors the existing Leads Inbox exactly -- same
// fetch/toggle/delete trio in sync.js, same undoable-delete pattern,
// same action-items badge wiring, same realtime channel shape -- so an
// application is exactly as hard to miss as a lead already is.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const workspaceHtml = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const syncJs = fs.readFileSync(repo('tools', 'sync.js'), 'utf8');
const realtimeMigration = fs.readFileSync(repo('sql', 'infra', 'add_job_applications_to_realtime.sql'), 'utf8');

test('sync.js: fetchJobApplications queries th_job_applications ordered newest-first, same shape as fetchLeads', () => {
  const fn = syncJs.match(/async function fetchJobApplications\(\)[\s\S]*?\n}\n/)[0];
  assert.match(fn, /rest\/v1\/th_job_applications\?select=\*&order=created_at\.desc&limit=50/);
  assert.match(fn, /Authorization.*Bearer \$\{getAuthToken\(\)\}/);
});

test('sync.js: markJobApplicationHandled PATCHes handled and stamps/clears handled_at', () => {
  const fn = syncJs.match(/async function markJobApplicationHandled\(id, handled\)[\s\S]*?\n}\n/)[0];
  assert.match(fn, /method: 'PATCH'/);
  assert.match(fn, /th_job_applications\?id=eq\.\$\{id\}/);
  assert.match(fn, /handled, handled_at: handled \? new Date\(\)\.toISOString\(\) : null/);
});

test('sync.js: deleteJobApplication DELETEs by id', () => {
  const fn = syncJs.match(/async function deleteJobApplication\(id\)[\s\S]*?\n}\n/)[0];
  assert.match(fn, /method: 'DELETE'/);
  assert.match(fn, /th_job_applications\?id=eq\.\$\{id\}/);
});

test('sync.js: startApplicantsRealtime subscribes to th_job_applications changes, same retry/backoff shape as startLeadsRealtime', () => {
  const fn = syncJs.match(/function startApplicantsRealtime\(onChange, onStatusChange\)[\s\S]*?\n}\n/)[0];
  assert.match(fn, /\.channel\('applicants-realtime'\)/);
  assert.match(fn, /table: 'th_job_applications'/);
  assert.match(fn, /REALTIME_RETRY_DELAYS/);
  assert.match(syncJs, /if \(_applicantsRealtimeChannel\) \{ _applicantsRealtimeChannel\.unsubscribe\(\); _applicantsRealtimeChannel = null; \}/, 'stopRealtimeSync() should also tear this channel down');
});

test('sql migration: th_job_applications is added to the supabase_realtime publication', () => {
  assert.match(realtimeMigration, /alter publication supabase_realtime add table public\.th_job_applications;/);
});

test('workspace.html: the Applicants section sits in the "Needs response" lane, right after New Leads', () => {
  const leadsIdx = workspaceHtml.indexOf('New Leads');
  const applicantsIdx = workspaceHtml.indexOf('New Applicants');
  const bookingsIdx = workspaceHtml.indexOf('Upcoming Bookings');
  assert.ok(leadsIdx > 0 && applicantsIdx > 0 && bookingsIdx > 0);
  assert.ok(leadsIdx < applicantsIdx && applicantsIdx < bookingsIdx);
  assert.match(workspaceHtml, /<div id="applicantsList"><\/div>/);
});

test('workspace.html: loadAndRenderApplicants renders each application as a lead-card (reuses the existing card styling, not a new one), with a handled toggle and an undoable delete', () => {
  const fn = workspaceHtml.match(/async function loadAndRenderApplicants\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /fetchJobApplications/);
  assert.match(fn, /class="lead-card\$\{!a\.handled \? ' is-unread' : ''\}" data-applicant-id="\$\{a\.id\}"/);
  assert.match(fn, /toggleApplicantHandled\(\$\{a\.id\}, \$\{!a\.handled\}\)/);
  assert.match(fn, /deleteApplicantFromDashboard\(\$\{a\.id\}\)/);
  // Shows experience/message quotes when present, same as a lead's details line.
  assert.match(fn, /a\.experience/);
  assert.match(fn, /a\.message/);
});

test('workspace.html: deleteApplicantFromDashboard is undoable, same 6-second-then-real-delete pattern as deleteLeadFromDashboard', () => {
  const fn = workspaceHtml.match(/async function deleteApplicantFromDashboard\(id\)[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /showConfirm\('Delete this application\?'/);
  assert.match(fn, /setTimeout\(async \(\) => \{[\s\S]*?deleteJobApplication\(id\)/);
  assert.match(fn, /6000/);
  assert.match(fn, /showUndoToast\('Application deleted\.'/);
});

test('workspace.html: an unhandled applicant counts toward the Action Items badge and the "Needs response" lane count, same as an unhandled lead', () => {
  assert.match(workspaceHtml, /const actionItemCounts = \{ workrequests: 0, leads: 0, applicants: 0, bookings: 0, duesoon: 0, followups: 0, unpaid: 0, toinvoice: 0 \};/);
  const badgeFn = workspaceHtml.match(/function updateActionItemsBadge\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(badgeFn, /actionItemCounts\.workrequests \+ actionItemCounts\.leads \+ actionItemCounts\.applicants \+ actionItemCounts\.bookings/);
  assert.match(badgeFn, /actionItemCounts\.applicants > 0.*new applicant/);
  assert.match(badgeFn, /setOpsLaneCount\('laneRespondCount', 'lane-respond', actionItemCounts\.workrequests \+ actionItemCounts\.leads \+ actionItemCounts\.applicants \+ actionItemCounts\.bookings\)/);
});

test('workspace.html: renderDashboard() and the realtime startup block both wire up the applicants panel', () => {
  const renderFn = workspaceHtml.match(/function renderDashboard\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(renderFn, /loadAndRenderApplicants\(\);/);
  assert.match(workspaceHtml, /startApplicantsRealtime\(loadAndRenderApplicants, updateRealtimeBadge\)/);
});
