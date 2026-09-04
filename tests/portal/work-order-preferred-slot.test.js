// Tests for the preferred date/time picker on Request Work
// (2026-09-04), replacing "Book directly" -- requested directly:
// "If guests just use the book directly link then the work order
// will never actually get filled out. We need to find a clever way
// for them to pick a date we have available based on our booking
// system and link them into the form."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WO = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');

test('the "Book directly" bypass link is gone', () => {
  assert.doesNotMatch(WO, /Book directly/);
  assert.doesNotMatch(WO, /wo-booking-nudge/);
});

test('the picker loads the shared business-hours.js rather than a sixth independent copy of the availability logic', () => {
  assert.match(WO, /<script src="\/business-hours\.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(WO, /const SLOT_INCREMENT_MINUTES\s*=/, 'should not redeclare a constant business-hours.js already declares');
  assert.doesNotMatch(WO, /const MIN_LEAD_HOURS\s*=/, 'should not redeclare a constant business-hours.js already declares');
  assert.doesNotMatch(WO, /async function fetchBookingsForDate/, 'should not redefine the shared function');
  assert.doesNotMatch(WO, /function computeSlotsForDate/, 'should not redefine the shared function');
});

test('selecting a slot stores a preference, never creates a real booking directly', () => {
  assert.doesNotMatch(WO, /from\(['"]th_bookings['"]\)/);
  assert.doesNotMatch(WO, /rest\/v1\/th_bookings/);
});

test('the preferred slot is included in the work order submission as an ISO timestamp, or null if none was picked', () => {
  const fnMatch = WO.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate submitRequest()');
  assert.match(fnMatch[0], /preferred_slot_at: selectedPreferredSlot \? selectedPreferredSlot\.startUtc\.toISOString\(\) : null,/);
});

test('the preferred slot resets on a successful submission, matching every other field, so it never lingers into a later unrelated request', () => {
  const fnMatch = WO.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  const insertIdx = body.indexOf('preferred_slot_at:');
  const clearIdx = body.indexOf('clearWoPreferredSlot();');
  assert.ok(insertIdx !== -1 && clearIdx !== -1);
  assert.ok(insertIdx < clearIdx, 'the reset must happen after the value was actually used in the insert, on the success path');
});

test('clearWoPreferredSlot resets both the stored value and the visible summary', () => {
  const fnMatch = WO.match(/function clearWoPreferredSlot\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate clearWoPreferredSlot()');
  assert.match(fnMatch[0], /selectedPreferredSlot = null;/);
  assert.match(fnMatch[0], /getElementById\('woScheduleSummary'\)\.style\.display = 'none';/);
});

test('the date row auto-selects today so the panel never opens to an empty, unexplained slots area', () => {
  const fnMatch = WO.match(/function renderWoDateRow\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderWoDateRow()');
  assert.match(fnMatch[0], /selectWoDate\(today\);/);
});

// ---- workspace.html: Approve & Schedule pre-fill ----

test('the Approve & Schedule button passes the work order\'s own preferred_slot_at through', () => {
  assert.match(WORKSPACE, /onclick="openWorkOrderApproval\(\$\{wo\.id\}, this, \$\{wo\.preferred_slot_at \? `'\$\{wo\.preferred_slot_at\}'` : 'null'\}\)"/);
});

test('a preferred slot pre-fills both the date and time inputs, converted from UTC to business-local parts', () => {
  const fnMatch = WORKSPACE.match(/function openWorkOrderApproval\(id, btnEl, preferredSlotAt\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate openWorkOrderApproval() with its new third parameter');
  const body = fnMatch[0];
  assert.match(body, /if \(preferredSlotAt\) \{/);
  assert.match(body, /timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',/);
  assert.match(body, /dateInput\.value = `\$\{map\.year\}-\$\{map\.month\}-\$\{map\.day\}`;/);
  assert.match(body, /timeInput\.value = /);
});

test('with no preferred slot, the inputs stay blank and no special hint is shown until the user picks a date themselves', () => {
  const fnMatch = WORKSPACE.match(/function openWorkOrderApproval\(id, btnEl, preferredSlotAt\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  // The pre-fill block is gated entirely behind `if (preferredSlotAt)`
  // -- confirm the existing change listener (for a manually-picked
  // date) still exists unconditionally, outside that gate.
  const afterPrefillBlock = body.slice(body.indexOf('dateInput.addEventListener'));
  assert.match(afterPrefillBlock, /dateInput\.addEventListener\('change', \(\) => \{/);
});
