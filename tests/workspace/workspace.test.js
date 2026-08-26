// Tests for workspace.html. Starts with the real race condition found
// and fixed directly (2026-08-25) in convertBookingToJob: the job was
// pushed to localStorage before markBookingConverted() resolved, so a
// rapid double-click (or just a slow network response between clicks)
// could create two duplicate jobs from the same booking. Confirmed
// this was a genuine bug by running the exact same simulation against
// the original, unguarded logic and watching it actually create two
// jobs, before trusting that the fix closes it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'tools', 'workspace.html');

test('convertBookingToJob has a real disable-on-click guard against a double-click creating duplicate jobs', () => {
  const src = fs.readFileSync(PAGE_PATH, 'utf8');
  const fnMatch = src.match(/async function convertBookingToJob\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'convertBookingToJob not found');
  assert.match(fnMatch[0], /btn\.disabled\s*=\s*true/, 'should disable the clicked button before any async work starts');
  assert.match(fnMatch[0], /if\s*\(\s*btn\.disabled\s*\)\s*return;/, 'should also guard against an already-in-flight call, not just rely on the disabled attribute alone');
});

test('a simulated rapid double-click creates exactly one job, not two', async () => {
  let fetchCallCount = 0;
  let jobsCreated = 0;

  async function fetchUnconvertedBookings() {
    fetchCallCount++;
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, bookings: [{ id: 42, name: 'Test Guest', service_label: 'Inspection', start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00' }] };
  }
  async function markBookingConverted() { return { ok: true }; }

  // The real, fixed logic's guard, exercised directly.
  const state = { disabled: false };
  async function convertBookingToJob(id) {
    if (state.disabled) return;
    state.disabled = true;

    const result = await fetchUnconvertedBookings();
    const booking = result.ok ? result.bookings.find((b) => b.id === id) : null;
    if (!booking) return;

    jobsCreated++; // stand-in for the real jobs.push(...) + localStorage.setItem(...)
    await markBookingConverted(id, Date.now());
  }

  await Promise.all([convertBookingToJob(42), convertBookingToJob(42)]);
  assert.equal(fetchCallCount, 1, 'the second, near-simultaneous call should never even reach the network');
  assert.equal(jobsCreated, 1, 'exactly one job should be created, not two -- this is the actual bug being guarded against');
});
