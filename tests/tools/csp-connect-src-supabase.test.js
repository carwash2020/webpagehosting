// Regression test for the real root cause of a multi-hour lockout
// (2026-09-02): review-request.html's CSP had `connect-src 'self'`
// with no Supabase origin, so the browser BLOCKED auth.js's own
// permission check before it ever reached the network.
//
// Why this was so hard to find, and why the check is keyed the way it
// is: the symptom was a generic "Failed to fetch" and a false "Review
// Requests isn't part of your role's access" screen -- on every
// device, every network, and in incognito, for an account whose
// database permissions were verified correct over and over. Several
// plausible-but-wrong theories got chased first (a flaky connection, a
// concurrent-token-refresh race, a privacy tool blocking a plaintext
// email in a URL) because the request failing before it left the
// browser looks identical to the request failing in transit.
//
// The tell: Dev Tools, on the SAME origin, querying the SAME table,
// worked fine -- because its CSP already allowed Supabase. Only this
// one page didn't, because it was permission-gated on 2026-08-27
// without its CSP being updated to match; before that gate it
// genuinely never needed to talk to Supabase.
//
// The page's own source never mentions Supabase at all -- grepping it
// for SUPABASE_URL returns nothing, since the call comes from
// auth.js. So both this test and scripts/check-consistency.js key the
// rule on "does this page load auth.js" rather than "does this page
// reference Supabase," which would have missed it entirely.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');

function toolPages() {
  return fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
}

test('every page that loads auth.js allows Supabase in its CSP connect-src', () => {
  const offenders = [];
  for (const file of toolPages()) {
    const html = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
    if (!/<script[^>]+src="\/tools\/auth\.js/.test(html)) continue;
    const connectSrc = (html.match(/connect-src([^;"]*)/) || [])[1];
    // A page loading auth.js with no CSP at all is caught by
    // check-consistency's own separate "missing CSP" rule, so the
    // only failure this test cares about is a CSP that exists but
    // doesn't permit Supabase.
    if (connectSrc !== undefined && !/supabase\.co/.test(connectSrc)) {
      offenders.push(`${file} (connect-src:${connectSrc})`);
    }
  }
  assert.deepEqual(offenders, [],
    'these pages can run a permission check but cannot reach Supabase to do it, which shows a FALSE "not part of your role\'s access" screen: ' + offenders.join(', '));
});

test('review-request.html specifically allows Supabase -- the exact page and directive that caused the real lockout', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'review-request.html'), 'utf8');
  const connectSrc = (html.match(/connect-src([^;"]*)/) || [])[1];
  assert.ok(connectSrc !== undefined, 'expected review-request.html to have a connect-src directive');
  assert.match(connectSrc, /https:\/\/\*\.supabase\.co/);
});

test('every permission-gated page allows Supabase, matching each other exactly on this directive', () => {
  // The 5 pages gated on a specific permission all run the same
  // auth.js check on load, so they must all be able to reach Supabase
  // -- there is no legitimate reason for one of them to differ here,
  // and one of them differing is precisely what caused the bug.
  const gated = [
    'review-request.html', 'finance.html', 'runway-dashboard.html',
    'invoice-generator.html', 'contract-generator.html',
  ];
  for (const file of gated) {
    const html = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
    const connectSrc = (html.match(/connect-src([^;"]*)/) || [])[1];
    assert.ok(connectSrc !== undefined, `${file}: expected a connect-src directive`);
    assert.match(connectSrc, /https:\/\/\*\.supabase\.co/, `${file}: must allow the Supabase REST origin`);
    assert.match(connectSrc, /wss:\/\/\*\.supabase\.co/, `${file}: must allow the Supabase realtime (wss) origin`);
  }
});
