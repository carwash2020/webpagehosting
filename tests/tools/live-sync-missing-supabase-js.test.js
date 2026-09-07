// Real, reproducible bug found via direct user report (2026-09-07,
// screenshot of tools/job-detail.html): "Live sync unavailable" every
// time, on every device, regardless of actual network conditions.
//
// Root cause: startRealtimeSync()/startLeadsRealtime() in sync.js both
// bail out to onStatusChange('unavailable') the moment
// getSupabaseClient() returns null, which happens whenever
// window.supabase (the supabase-js UMD global) was never loaded on
// the page at all -- not a real connectivity problem. job-detail.html,
// client-detail.html, and finance.html all call startRealtimeSync but
// never actually loaded the supabase-js <script> tag that every other
// tool page using realtime sync (job-tracker.html, etc.) already has
// right before sync.js -- so live sync could never have worked on any
// of these three pages, ever.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SUPABASE_JS_TAG = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+" integrity="[^"]+" crossorigin="anonymous" defer><\/script>/;

test('every tool page that calls startRealtimeSync/startLeadsRealtime/getSupabaseClient actually loads supabase-js', () => {
  const toolsDir = repo('tools');
  const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.html'));
  const usesSupabase = [];
  for (const file of files) {
    const html = fs.readFileSync(path.join(toolsDir, file), 'utf8');
    if (/startRealtimeSync|startLeadsRealtime|getSupabaseClient\(/.test(html)) {
      usesSupabase.push(file);
      assert.match(html, SUPABASE_JS_TAG, `${file} calls into sync.js's Supabase realtime helpers but never loads supabase-js -- live sync can never work there`);
    }
  }
  // Sanity check that this test is actually exercising something --
  // if the pattern search above ever stops matching any file, the
  // assertions inside the loop would silently never run.
  assert.ok(usesSupabase.length >= 4, `expected at least 4 tool pages using realtime sync, found ${usesSupabase.length}`);
});

for (const file of ['job-detail.html', 'client-detail.html', 'finance.html']) {
  test(`${file}: supabase-js now loads with the exact same URL/integrity/order as job-tracker.html, right before sync.js`, () => {
    const html = fs.readFileSync(repo('tools', file), 'utf8');
    const jobTracker = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
    const expectedTag = jobTracker.match(SUPABASE_JS_TAG)[0];
    assert.match(html, SUPABASE_JS_TAG);
    assert.equal(html.match(SUPABASE_JS_TAG)[0], expectedTag, 'expected the exact same supabase-js URL/integrity as job-tracker.html');
    const supabaseIdx = html.search(SUPABASE_JS_TAG);
    const syncIdx = html.indexOf('/tools/sync.js?v=');
    assert.ok(supabaseIdx > 0 && syncIdx > supabaseIdx, 'expected supabase-js to load before sync.js');
  });
}

test('the tools service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 80, `expected v80 or later, got v${version}`);
});
