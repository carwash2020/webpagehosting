// Tests for two features requested directly (2026-09-03): a real
// business-hours-aware day picker replacing the free-text "any timing
// that works best?" field, and client photo uploads (up to 3) on the
// Request Work form.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const html = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');

// ---- day picker ----

test('the free-text timing input is gone, replaced by a real day-picker grid', () => {
  assert.doesNotMatch(html, /id="woTiming"/);
  assert.match(html, /id="woDayGrid"/);
});

test('the day picker is built from the real shared business hours, not invented values', () => {
  const fnMatch = html.match(/function renderDayPicker\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderDayPicker()');
  const body = fnMatch[0];
  assert.match(body, /todayDateStrInBusinessTz\(\)/);
  assert.match(body, /addDaysToDateStr\(today, i\)/);
  assert.match(body, /businessWeekday\(dateStr\)/);
  assert.match(body, /formatHoursLabel\(d\.weekday\)/);
  assert.match(body, /DAYS_AHEAD_SHOWN/);
});

test('day selection is single-select and deselectable, matching the free-text field it replaced being optional', () => {
  const fnMatch = html.match(/document\.getElementById\('woDayGrid'\)\.addEventListener\('click', \(e\) => \{[\s\S]*?\n  \}\);\n/);
  assert.ok(fnMatch, 'expected to isolate the day-grid click handler');
  assert.match(fnMatch[0], /selectedDayStr = \(selectedDayStr === clickedDate\) \? null : clickedDate;/,
    'clicking an already-selected day should deselect it -- "no preference" must stay a valid choice');
});

test('the submission sends a formatted real day + hours label, not raw free text', () => {
  const fnMatch = html.match(/function formatSelectedDayForSubmission\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate formatSelectedDayForSubmission()');
  const body = fnMatch[0];
  assert.match(body, /if \(!selectedDayStr\) return null;/, 'no selection should submit as null, not an empty string');
  assert.match(body, /formatHoursLabel\(weekday\)/, 'the submitted value should include the real hours for that day');

  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.match(submitMatch[0], /preferred_timing: formatSelectedDayForSubmission\(\),/);
});

test('a submitted request resets the day-picker selection, not just the text fields', () => {
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  const body = submitMatch[0];
  assert.match(body, /selectedDayStr = null;/);
  assert.match(body, /document\.querySelectorAll\('\.wo-day-btn'\)\.forEach\(b => b\.classList\.remove\('is-selected'\)\);/);
});

// ---- photo upload ----

test('the photo upload is capped at 3 photos client-side', () => {
  assert.match(html, /const MAX_WO_PHOTOS = 3;/);
  const changeMatch = html.match(/document\.getElementById\('woPhotoInput'\)\.addEventListener\('change', \(e\) => \{[\s\S]*?\n  \}\);\n/);
  assert.ok(changeMatch);
  assert.match(changeMatch[0], /selectedPhotos\.length >= MAX_WO_PHOTOS/);
});

test('the photo upload uses a plain file input with image/* and multiple, so the OS offers camera or gallery -- no separate picker needs building', () => {
  assert.match(html, /<input type="file" id="woPhotoInput" accept="image\/\*" multiple/);
});

test('each photo is size-checked against the same 8MB convention already used by the internal tools', () => {
  assert.match(html, /const MAX_WO_PHOTO_BYTES = 8 \* 1024 \* 1024;/);
});

test('photos upload to Storage only at submit time, never the moment a file is picked', () => {
  const changeMatch = html.match(/document\.getElementById\('woPhotoInput'\)\.addEventListener\('change', \(e\) => \{[\s\S]*?\n  \}\);\n/);
  assert.doesNotMatch(changeMatch[0], /fetch\(/, 'selecting a file should only stage it locally, not upload it yet');
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.match(submitMatch[0], /uploadSelectedPhotos\(\)/);
});

test('a failed photo upload shows a real error and does not silently submit the request without them', () => {
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  const body = submitMatch[0];
  const tryMatch = body.match(/try \{\s*photoPaths = await uploadSelectedPhotos\(\);\s*\} catch \(e\) \{([\s\S]*?)\}/);
  assert.ok(tryMatch, 'expected the photo upload to be wrapped in its own try/catch');
  assert.match(tryMatch[1], /return;/, 'a failed upload should stop the submission, not proceed to insert without the photos silently');
});

test('a successful submission includes the real uploaded paths, and clears the staged photos afterward', () => {
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  const body = submitMatch[0];
  assert.match(body, /photo_storage_paths: photoPaths\.length \? photoPaths : null,/);
  assert.match(body, /selectedPhotos = \[\];/);
  assert.match(body, /renderPhotoRow\(\);/);
});

test('photo uploads go to the dedicated work-order-photos bucket, not job-photos', () => {
  const fnMatch = html.match(/async function uploadSelectedPhotos\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /storage\/v1\/object\/work-order-photos\//);
});

// ---- desktop: Add to Home Screen hidden ----

test('the Add to Home Screen card is hidden on desktop, at the same breakpoint used everywhere else in the portal', () => {
  const settingsHtml = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
  assert.match(settingsHtml, /@media \(min-width: 860px\) \{\s*#addHomeScreenCard \{ display: none; \}/);
});
