// Tests for reducing realtime retry logging noise (2026-09-05),
// found while investigating a real reported complaint: repeated
// client-side error entries were crowding out th_client_errors' own
// 20-entry cap. The retry mechanism itself is a deliberate,
// well-reasoned fix for a documented Supabase infrastructure
// behavior (a cold-starting realtime tenant) -- correct as-is. The
// actual problem was logging every EXPECTED intermediate retry
// attempt at error severity, not the retry logic itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SYNC = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'sync.js'), 'utf8');

for (const channel of ['workspace_sync', 'th_leads', 'th_bookings']) {
  test(`${channel}: an intermediate, expected retry is no longer logged as a client error`, () => {
    assert.doesNotMatch(SYNC, new RegExp(`Realtime ${channel} channel status: CHANNEL_ERROR -- retrying`));
  });

  test(`${channel}: the genuine failure case (retries actually exhausted) still logs -- this is a real, actionable problem worth keeping visible`, () => {
    const re = new RegExp(`logClientError\\('Realtime ${channel} channel status: ' \\+ status`);
    assert.match(SYNC, re);
  });
}

test('the retry mechanism itself is untouched -- still retries up to twice, 2 seconds apart, for all three channels', () => {
  const retryCalls = SYNC.match(/setTimeout\(\(\) => attemptSubscribe\(retriesLeft - 1\), 2000\);/g) || [];
  assert.equal(retryCalls.length, 3, 'expected the retry scheduling itself, for all three channels, to remain exactly as it was');
});
