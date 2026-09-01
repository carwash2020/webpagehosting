// Tests for portal/jobs.html (2026-09-02), phase 4 of the client
// portal roadmap in docs/CLIENT-PORTAL.md. Source-inspection style,
// same reasoning as the other portal test files: this page depends on
// a real Supabase session that isn't practical to simulate end-to-end
// in this test environment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'jobs.html');
const html = fs.readFileSync(PAGE_PATH, 'utf8');

test('portal/jobs.html loads none of the internal /tools/ scripts', () => {
  for (const forbidden of ['auth.js', 'sync.js', 'data-layer.js', 'tools-nav-pwa.js']) {
    assert.ok(!html.includes(forbidden), `portal/jobs.html should never load /tools/${forbidden}`);
  }
});

test('jobs.html cross-links with quotes.html and dashboard.html, and vice versa', () => {
  assert.match(html, /<a href="\/portal\/quotes\.html">Quotes<\/a>/);
  assert.match(html, /<a href="\/portal\/dashboard\.html">Invoices<\/a>/);

  const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'dashboard.html'), 'utf8');
  const quotesHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'quotes.html'), 'utf8');
  assert.match(dashboardHtml, /<a href="\/portal\/jobs\.html">Jobs<\/a>/);
  assert.match(quotesHtml, /<a href="\/portal\/jobs\.html">Jobs<\/a>/);
});

test('an unauthenticated visitor is redirected to login, not shown job history', () => {
  assert.match(html, /if \(!session\) \{\s*window\.location\.replace\('\/portal\/login\.html'\);/);
});

test('the warranty formula matches tools/job-tracker.html\'s warrantyBadgeHtml() exactly, not a reinvented version', () => {
  const jobTrackerHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  const trackerFormula = jobTrackerHtml.match(/const daysSince = Math\.round\(\(today - completionDate\) \/ \(24 \* 60 \* 60 \* 1000\)\);\s*\n\s*const daysLeft = 30 - daysSince;/);
  const portalFormula = html.match(/const daysSince = Math\.round\(\(today - completionDate\) \/ \(24 \* 60 \* 60 \* 1000\)\);\s*\n\s*const daysLeft = 30 - daysSince;/);
  assert.ok(trackerFormula, 'expected to find the warranty formula in tools/job-tracker.html to compare against');
  assert.ok(portalFormula, 'expected portal/jobs.html to use the identical formula');
});

test('warranty status is computed from job_date every render, never read from a stored column', () => {
  // client_portal_jobs has no warranty/warranty_expires column at all
  // (see sql/portal/create_client_portal_jobs.sql) -- confirms the
  // page never expects one.
  assert.doesNotMatch(html, /j\.warranty/);
  assert.match(html, /warrantyBadgeHtml\(j\.job_date\)/);
});

test('the job card only reads fields that actually exist on client_portal_jobs', () => {
  const fnMatch = html.match(/function renderJobCard\(j\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate the renderJobCard function body');
  const realFields = ['id', 'title', 'job_date', 'photo_storage_paths'];
  const fieldRefs = [...fnMatch[0].matchAll(/j\.([a-zA-Z_]+)/g)].map(m => m[1]);
  for (const field of fieldRefs) {
    assert.ok(realFields.includes(field), `renderJobCard references j.${field}, which isn't a real client_portal_jobs column read here`);
  }
});

// ---- tools/job-tracker.html: the internal side of phase 4 ----

const TRACKER_PATH = path.join(__dirname, '..', '..', 'tools', 'job-tracker.html');
const trackerHtml = fs.readFileSync(TRACKER_PATH, 'utf8');

test('the job form has a client email field, mirroring the invoice/quote pattern', () => {
  assert.match(trackerHtml, /<input type="email" id="jobClientEmail"/);
});

test('a job only syncs to the portal once marked Done, with both an email and a real date on file', () => {
  assert.match(trackerHtml, /if \(fields\.status === 'done' && clientEmailVal && fields\.date && typeof getAuthToken === 'function'\) \{/);
  assert.match(trackerHtml, /functions\/v1\/sync-job-to-portal/);
});

test('the internal jobNotes field is never sent to the portal', () => {
  const fnMatch = trackerHtml.match(/if \(fields\.status === 'done' && clientEmailVal[\s\S]*?\n    \}\n/);
  assert.ok(fnMatch, 'expected to isolate the sync-to-portal call block');
  // Matches the actual field usage (fields.notes, or a notes: key in
  // the request body) rather than any occurrence of the English word
  // "notes" -- a surrounding comment mentioning something unrelated
  // (e.g. "see that function's own notes") shouldn't fail this.
  assert.doesNotMatch(fnMatch[0], /fields\.notes\b/);
  assert.doesNotMatch(fnMatch[0], /\bnotes\s*:/);
});

test('editing a job repopulates the previously-saved client email', () => {
  assert.match(trackerHtml, /document\.getElementById\('jobClientEmail'\)\.value = job\.clientEmail \|\| '';/);
});
