// Tests for the return-service / check-up reminders feature
// (2026-09-02), phase 5 -- the last phase of the client portal
// roadmap in docs/CLIENT-PORTAL.md. Source-inspection style, same
// reasoning as the other portal test files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const JOBS_PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'jobs.html');
const html = fs.readFileSync(JOBS_PAGE_PATH, 'utf8');

test('the checkup due-date formula matches tools/job-tracker.html\'s templateDueInfo() exactly', () => {
  const jobTrackerHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  const trackerFormula = jobTrackerHtml.match(/next\.setMonth\(next\.getMonth\(\) \+ \(template\.intervalMonths \|\| 1\)\);[\s\S]*?const days = Math\.round\(\(next - today\) \/ \(24 \* 60 \* 60 \* 1000\)\);/);
  const portalFormula = html.match(/next\.setMonth\(next\.getMonth\(\) \+ \(c\.interval_months \|\| 1\)\);[\s\S]*?const days = Math\.round\(\(next - today\) \/ \(24 \* 60 \* 60 \* 1000\)\);/);
  assert.ok(trackerFormula, 'expected to find templateDueInfo()\'s formula in tools/job-tracker.html to compare against');
  assert.ok(portalFormula, 'expected portal/jobs.html to use the identical formula (field names differ: template.intervalMonths vs c.interval_months, same underlying rule)');
});

test('checkup due status is computed fresh, never read from a stored column', () => {
  // client_portal_checkups has no "due"/"status" column at all (see
  // sql/portal/create_client_portal_checkups.sql) -- confirms the
  // page never expects one.
  assert.doesNotMatch(html, /c\.due\b/);
  assert.doesNotMatch(html, /c\.status\b/);
  assert.match(html, /checkupDueInfo\(c\)/);
});

test('the checkup banner only reads fields that actually exist on client_portal_checkups', () => {
  const fnMatches = [
    html.match(/function checkupDueInfo\(c\) \{[\s\S]*?\n  \}\n/),
    html.match(/function renderCheckupBanner\(c\) \{[\s\S]*?\n  \}\n/),
  ];
  const realFields = ['title', 'interval_months', 'last_created_date'];
  for (const fnMatch of fnMatches) {
    assert.ok(fnMatch, 'expected to isolate a checkup-related function body');
    const fieldRefs = [...fnMatch[0].matchAll(/c\.([a-zA-Z_]+)/g)].map(m => m[1]);
    for (const field of fieldRefs) {
      assert.ok(realFields.includes(field), `references c.${field}, which isn't a real client_portal_checkups column`);
    }
  }
});

test('the checkup banner is read-only -- no scheduling action wired to it in this phase', () => {
  const fnMatch = html.match(/function renderCheckupBanner\(c\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /schedule-quote-job/);
  assert.doesNotMatch(fnMatch[0], /onclick/);
});

// ---- tools/job-tracker.html: the internal side of phase 5 ----

const TRACKER_PATH = path.join(__dirname, '..', '..', 'tools', 'job-tracker.html');
const trackerHtml = fs.readFileSync(TRACKER_PATH, 'utf8');

test('template sync is centralized in saveTemplates(), covering every call site (add/edit/delete/create-job-from-template)', () => {
  const fnMatch = trackerHtml.match(/function saveTemplates\(list\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate saveTemplates()');
  assert.match(fnMatch[0], /functions\/v1\/sync-checkup-to-portal/);
  assert.match(fnMatch[0], /thFindClientByName/);
});

test('a blank-client template (applies to different clients each time) never syncs', () => {
  const fnMatch = trackerHtml.match(/function saveTemplates\(list\) \{[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /if \(!t\.client\) return;/);
});

test('deleting a template also removes its portal row, so a stale reminder never lingers', () => {
  const fnMatch = trackerHtml.match(/async function deleteTemplate\(id\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate deleteTemplate()');
  assert.match(fnMatch[0], /delete: true/);
  assert.match(fnMatch[0], /functions\/v1\/sync-checkup-to-portal/);
});
