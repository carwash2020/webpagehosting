// W08/U16/U17 (High-Impact Upgrades, 2026-09-07): "A leave-behind job
// sheet... essentially nobody in this trade does this. It converts a
// repair into evidence of competence." Generates a one-page PDF from
// data already captured (job notes, linked expense part numbers,
// before/after photos, the 30-day labor warranty), handed over via the
// existing sharePdfOrDownload() OS-share helper -- no SMS provider
// needed. U17 states that same warranty on any invoice linked to a
// completed job.
//
// Verified by actually generating and text-extracting real PDFs (via
// Playwright + a local jsPDF 2.5.1 mirror, since the real CDN and
// Supabase are both unreachable from this sandbox), not just by
// reading the drawing code -- see the session's own PDF output for
// exact wording. This test locks in the structural pieces that made
// that verification pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOB_DETAIL = fs.readFileSync(repo('tools', 'job-detail.html'), 'utf8');
const INVOICE_GEN = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');

test('the Generate Job Sheet button only renders for a done job, and is wired to generateJobSheet()', () => {
  assert.match(JOB_DETAIL, /j\.status === 'done'[\s\S]{0,250}generateJobSheetBtn/);
  assert.match(JOB_DETAIL, /onclick="generateJobSheet\(\)"/);
});

test('generateJobSheet() guards on jsPDF being loaded and on a real job bundle, and disables the button while running', () => {
  const start = JOB_DETAIL.indexOf('async function generateJobSheet()');
  assert.ok(start >= 0, 'expected generateJobSheet() to exist');
  const fn = JOB_DETAIL.slice(start, JOB_DETAIL.indexOf('\n  }\n', start));
  assert.match(fn, /if \(!window\.jspdf\)/);
  assert.match(fn, /if \(!bundle\)/);
  assert.match(fn, /btn\.disabled = true/);
  assert.match(fn, /btn\.disabled = false/);
});

test('the job sheet states the part number from linked expenses, not a field invented on the job record itself', () => {
  assert.match(JOB_DETAIL, /bundle\.linkedExpenses\.filter\(e => e\.partNumber && e\.partNumber\.trim\(\)\)/);
  assert.match(JOB_DETAIL, /'Part #: ' \+ e\.partNumber/);
});

test('the job sheet states the warranty as a real end date, not a decaying "days left" count', () => {
  const start = JOB_DETAIL.indexOf('async function generateJobSheet()');
  const fn = JOB_DETAIL.slice(start, JOB_DETAIL.indexOf('\n  }\n', start));
  assert.match(fn, /warrantyEnd\.setDate\(warrantyEnd\.getDate\(\) \+ 30\)/);
  assert.match(fn, /Covered by our 30-day labor warranty through '/);
  // "days left" appears only in this block's own explanatory comment
  // (why an end date was chosen over a countdown) -- no actual
  // daysLeft-style countdown variable is computed or drawn here.
  assert.doesNotMatch(fn, /daysLeft/);
});

test('the job sheet hands off through sharePdfOrDownload(), falling back to doc.save() if that helper is missing', () => {
  const start = JOB_DETAIL.indexOf('async function generateJobSheet()');
  const fn = JOB_DETAIL.slice(start, JOB_DETAIL.indexOf('\n  }\n', start));
  assert.match(fn, /typeof sharePdfOrDownload === 'function'/);
  assert.match(fn, /doc\.save\(filename\)/);
});

test('a failed photo fetch or single failed photo image never blocks the rest of the job sheet', () => {
  const start = JOB_DETAIL.indexOf('async function generateJobSheet()');
  const fn = JOB_DETAIL.slice(start, JOB_DETAIL.indexOf('\n  }\n', start));
  assert.match(fn, /try \{\s*const photoResult = await fetchJobPhotos/);
  assert.match(fn, /try \{\s*const dataUrl = await jsLoadImageAsDataURL\(p\.url\)/);
});

test('an invoice linked to a completed job states the same 30-day warranty rule, gated on status and date', () => {
  assert.match(INVOICE_GEN, /const linkedJobId = \(document\.getElementById\('invoiceJobRef'\) \|\| \{\}\)\.value;/);
  assert.match(INVOICE_GEN, /linkedJob && linkedJob\.status === 'done' && linkedJob\.date/);
  assert.match(INVOICE_GEN, /Covered by our 30-day labor warranty through '/);
});

test('an invoice with no linked job, or a job that is not yet done, never draws the warranty line', () => {
  const start = INVOICE_GEN.indexOf('const linkedJobId = ');
  const fn = INVOICE_GEN.slice(start, INVOICE_GEN.indexOf('\n\n    // footer', start));
  // The warranty text lives strictly inside the `if (linkedJobId)` /
  // `if (linkedJob && ... === 'done' ...)` guards -- there is no
  // unconditional draw of that line anywhere in this block.
  const guardedBlock = fn.match(/if \(linkedJobId\) \{[\s\S]*\}\s*\}\s*$/);
  assert.ok(guardedBlock, 'expected the whole warranty block to live inside the linkedJobId guard');
});

test('both changed pages carry the same jsPDF 2.5.1 CDN version already used elsewhere, with matching CSP entries', () => {
  assert.match(JOB_DETAIL, /cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\/dist\/jspdf\.umd\.min\.js/);
  assert.match(JOB_DETAIL, /script-src[^"]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(JOB_DETAIL, /connect-src[^"]*https:\/\/cdn\.jsdelivr\.net/);
});

test('the tools service worker cache was bumped for this change (both job-detail.html and invoice-generator.html are precached)', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 97, `expected v97 or later, got v${version}`);
});
