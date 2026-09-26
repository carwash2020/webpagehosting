// Dev Tools' Live Consistency Check page list (2026-09-25, bug lane).
//
// "Run full health check" reported "1 tool page check failed" on every run
// from 2026-09-21: the list still named calendar.html, which became a
// redirect stub that day (no CSP, manifest link or PWA meta, by design).
// check-consistency.js exempted the stub; this list, which says it is kept
// in sync with that EXEMPT list, never dropped it.
//
// These run the same checks runLiveConsistencyCheck() runs, against the
// files it would fetch, so a listed page that can't pass fails here first.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEV = fs.readFileSync(path.join(ROOT, 'tools', 'dev-tools.html'), 'utf8');
const CONSISTENCY = fs.readFileSync(path.join(ROOT, 'scripts', 'check-consistency.js'), 'utf8');

const listSrc = DEV.match(/const TOOL_PAGES_TO_CHECK = \[([\s\S]*?)\];/);
const PAGES = listSrc ? [...listSrc[1].matchAll(/'([^']+\.html)'/g)].map((m) => m[1]) : [];
const NO_AUTH_CHECK = [...(DEV.match(/const NO_AUTH_CHECK = \[([^\]]*)\]/) || ['', ''])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const exemptSrc = CONSISTENCY.match(/const EXEMPT = \{([\s\S]*?)\n\};/);
const EXEMPT = exemptSrc ? [...exemptSrc[1].matchAll(/'([^']+\.html)'\s*:\s*(['"])(.*?)\2,?\s*$/gm)].map((m) => ({ page: m[1], why: m[3] })) : [];
const STUBS = EXEMPT.filter((e) => /redirect stub/.test(e.why)).map((e) => e.page);

test('the list and the EXEMPT list were both found', () => {
  assert.ok(PAGES.length >= 8, 'TOOL_PAGES_TO_CHECK: ' + PAGES.join(', '));
  assert.ok(STUBS.includes('calendar.html') && STUBS.includes('pos.html'), 'redirect stubs in EXEMPT: ' + STUBS.join(', '));
});

test('no retired redirect stub (per check-consistency.js EXEMPT) is on the live check list', () => {
  assert.deepEqual(PAGES.filter((p) => STUBS.includes(p)), []);
});

for (const page of PAGES) {
  test(`tools/${page} passes the live check's own tests (auth gate, CSP, manifest, PWA meta)`, () => {
    const html = fs.readFileSync(path.join(ROOT, 'tools', page), 'utf8');
    if (!NO_AUTH_CHECK.includes(page)) assert.match(html, /requireAuth\s*\(\s*\)/, 'missing requireAuth()');
    assert.match(html, /<meta[^>]+Content-Security-Policy/i, 'missing CSP');
    assert.match(html, /<link[^>]+rel="manifest"/, 'missing manifest link');
    assert.match(html, /apple-mobile-web-app-capable/, 'missing PWA meta');
  });
}
