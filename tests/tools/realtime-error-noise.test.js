// Tests for reducing realtime retry logging noise (2026-09-05),
// found while investigating a real reported complaint: repeated
// client-side error entries were crowding out th_client_errors' own
// 20-entry cap. The actual problem was logging every EXPECTED
// intermediate retry attempt at error severity, not the retry logic
// itself.
//
// The retry mechanism was later (2026-09-07) widened after a second,
// separate real complaint: CHANNEL_ERROR/TIMED_OUT recurring "almost
// daily." See tests/tools/realtime-retry-resilience.test.js for that
// change -- this file still covers the original noise-reduction fix.

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

test('the retry mechanism now uses the shared exponential-backoff schedule, for all three channels -- see realtime-retry-resilience.test.js for the full behavior', () => {
  const retryCalls = SYNC.match(/setTimeout\(\(\) => attemptSubscribe\(attempt \+ 1\), REALTIME_RETRY_DELAYS\[attempt\]\);/g) || [];
  assert.equal(retryCalls.length, 3, 'expected the retry scheduling itself, for all three channels, to use the shared backoff schedule');
});
