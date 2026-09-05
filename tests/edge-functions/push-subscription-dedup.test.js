// Tests for a real duplicate-subscription bug found during a direct
// scale audit (2026-09-05), requested: "Is everything we have set up
// to scale?" A client toggling push notifications off and back on
// repeatedly on the same device inserted a fresh row for the same
// real endpoint each time -- genuinely duplicate push notifications
// on every future send, not just a wasted row. Confirmed no existing
// duplicates before adding a unique constraint, then fixed both
// client files to perform a real upsert against it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_PUSH = fs.readFileSync(repo('tools', 'push-notifications.js'), 'utf8');
const PORTAL_PUSH = fs.readFileSync(repo('portal', 'push-notifications.js'), 'utf8');

for (const [name, src] of [['tools', TOOLS_PUSH], ['portal', PORTAL_PUSH]]) {
  test(`${name}: enabling push performs a real upsert against the unique (user_id, endpoint) index, not a plain insert`, () => {
    assert.match(src, /on_conflict=user_id,endpoint/);
    assert.match(src, /resolution=merge-duplicates/);
  });

  test(`${name}: the endpoint is sent as its own real column, not just nested inside the subscription JSON`, () => {
    assert.match(src, /endpoint: subJson\.endpoint/);
  });

  test(`${name}: disabling filters on the real endpoint column, matching the index that actually backs it now`, () => {
    assert.match(src, /push_subscriptions\?endpoint=eq\./);
    assert.doesNotMatch(src, /subscription->>endpoint=eq\./,
      'the old JSONB-expression filter has no supporting index anymore and should be gone');
  });
}
