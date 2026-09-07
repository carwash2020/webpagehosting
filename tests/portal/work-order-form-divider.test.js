// A visual divider between the work order form's required ask
// (title/description/urgency) and everything else (2026-09-07, direct
// feedback: "the work order form could look better"). Every field
// past this point was already individually marked "Optional" in its
// own hint; the divider's "All Optional" tag mirrors the existing
// .wo-required tag's own styling so the two read as a matched pair.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

test('the divider sits between the urgency field and the schedule/photos/address/phone fields', () => {
  const formBlock = WORK_ORDERS.slice(WORK_ORDERS.indexOf('id="requestForm"'), WORK_ORDERS.indexOf('id="woError"'));
  const dividerIdx = formBlock.indexOf('class="wo-form-divider"');
  const urgencyIdx = formBlock.indexOf('id="woUrgencyRow"');
  const scheduleIdx = formBlock.indexOf('id="woScheduleToggle"');
  assert.ok(dividerIdx > 0 && urgencyIdx > 0 && scheduleIdx > 0, 'expected to find all three markers');
  assert.ok(urgencyIdx < dividerIdx, 'divider should come after the urgency row');
  assert.ok(dividerIdx < scheduleIdx, 'divider should come before the schedule toggle');
});

test('the divider label and tag use the exact wording and reuse existing style classes rather than inventing new ones', () => {
  assert.match(WORK_ORDERS, /<div class="wo-form-divider">\s*<span class="wo-section-title">More Details<\/span>\s*<span class="wo-optional-tag">All Optional<\/span>\s*<\/div>/);
});

test('the .wo-optional-tag CSS mirrors .wo-required\'s own size/weight/letter-spacing, just a dim color instead of orange', () => {
  const requiredRule = WORK_ORDERS.match(/\.wo-required \{ ([^}]+) \}/)[1];
  const optionalRule = WORK_ORDERS.match(/\.wo-optional-tag \{ ([^}]+) \}/)[1];
  const strip = (s) => s.replace(/color:\s*[^;]+;?/, '').trim();
  assert.equal(strip(requiredRule), strip(optionalRule), 'expected identical rules apart from color');
  assert.match(optionalRule, /color:\s*var\(--text-dim\)/);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 34, `expected v34 or later, got v${versionMatch[1]}`);
});
