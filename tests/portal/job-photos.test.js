// Tests for job photos on the portal (2026-09-02). Source-inspection
// style, same reasoning as the other portal test files: signed URLs
// and real Storage round trips aren't practical to simulate
// end-to-end in this test environment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const JOBS_PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'jobs.html');
const html = fs.readFileSync(JOBS_PAGE_PATH, 'utf8');

test('photo URLs are always fetched fresh via get-job-photo-urls, never read from a stored URL column', () => {
  // client_portal_jobs only ever stores photo_storage_paths (raw
  // paths), never a urls/photo_urls column -- confirms the page never
  // expects a stored URL.
  assert.doesNotMatch(html, /j\.photo_urls/);
  assert.doesNotMatch(html, /j\.urls/);
  assert.match(html, /functions\/v1\/get-job-photo-urls/);
});

test('photos only load for a job that actually has photo_storage_paths', () => {
  assert.match(html, /if \(Array\.isArray\(j\.photo_storage_paths\) && j\.photo_storage_paths\.length\) loadJobPhotos\(j\.id\);/);
});

test('loadJobPhotos requires a real session before requesting signed URLs', () => {
  const fnMatch = html.match(/async function loadJobPhotos\(jobId\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate loadJobPhotos()');
  assert.match(fnMatch[0], /if \(!session\) return;/);
});

// ---- tools/job-tracker.html: the internal side ----

const TRACKER_PATH = path.join(__dirname, '..', '..', 'tools', 'job-tracker.html');
const trackerHtml = fs.readFileSync(TRACKER_PATH, 'utf8');

test('completed jobs gather their photo storage paths before syncing to the portal', () => {
  const fnMatch = trackerHtml.match(/if \(fields\.status === 'done' && clientEmailVal[\s\S]*?\n    \}\n/);
  assert.ok(fnMatch, 'expected to isolate the sync-to-portal block');
  assert.match(fnMatch[0], /fetchJobPhotos\(savedJobId\)/);
  assert.match(fnMatch[0], /photo_storage_paths: photoStoragePaths/);
});

test('a job with no photos still syncs -- photo fetching is best-effort, not a hard requirement', () => {
  const fnMatch = trackerHtml.match(/if \(fields\.status === 'done' && clientEmailVal[\s\S]*?\n    \}\n/);
  assert.match(fnMatch[0], /let photoStoragePaths = \[\];/);
  assert.match(fnMatch[0], /catch \(e\) \{ \/\* best-effort/);
});
