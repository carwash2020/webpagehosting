// Fix plan RP4.9 (2026-11-07): every portal page on the shared shell has a
// skip link -- first in the tab order, off-screen until focused -- that
// jumps past the app bar and navigation to <main id="portalMain">.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
// The pages that carry the shell (app bar + rail).
const SHELL_PAGES = fs.readdirSync(repo('portal')).filter((f) => f.endsWith('.html'))
  .filter((f) => fs.readFileSync(repo('portal', f), 'utf8').includes('<div class="portal-rail">'));
// The content each page's main must hold.
const KEY_CONTENT = {
  'contracts.html': 'contractList', 'dashboard.html': 'invoiceList', 'home.html': 'homeGreeting',
  'jobs.html': 'jobList', 'quotes.html': 'quoteList', 'settings.html': null, 'work-orders.html': 'myRequests',
};

test('every shell page is covered', () => {
  assert.deepEqual(SHELL_PAGES.sort(), Object.keys(KEY_CONTENT).sort());
});

for (const page of SHELL_PAGES) {
  test(`${page}: the skip link is first in the body and lands on one <main id="portalMain"> after the navigation`, () => {
    const dom = new JSDOM(fs.readFileSync(repo('portal', page), 'utf8'));
    const d = dom.window.document;
    const firstFocusable = d.body.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    assert.equal(firstFocusable.className, 'portal-skip-link');
    assert.equal(firstFocusable.getAttribute('href'), '#portalMain');
    assert.equal(firstFocusable.textContent, 'Skip to main content');
    const mains = d.querySelectorAll('main');
    assert.equal(mains.length, 1);
    const main = mains[0];
    assert.equal(main.id, 'portalMain');
    assert.equal(main.getAttribute('tabindex'), '-1');
    assert.equal(main.parentElement, d.body);
    assert.ok(!main.contains(d.querySelector('.portal-rail')) && !main.contains(d.querySelector('.portal-header')), 'navigation stays outside main');
    assert.ok(d.querySelector('.portal-rail').compareDocumentPosition(main) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'main follows the rail');
    assert.equal(main.querySelector('#reportBugOverlay'), null, 'overlays stay outside main');
    const key = KEY_CONTENT[page];
    if (key) assert.ok(main.querySelector('#' + key), `${page}: #${key} is inside main`);
    else assert.ok(main.querySelector('.settings-shell'));
    dom.window.close();
  });
}

test('portal-app.css hides the link until focused, the same way the public site does', () => {
  assert.match(CSS, /\.portal-skip-link \{\s*position: absolute; top: -80px;/);
  assert.match(CSS, /\.portal-skip-link:focus \{ top: calc\(12px \+ env\(safe-area-inset-top, 0px\)\);/);
});

test('activating the link focuses main without changing the URL hash (Settings routes on the hash)', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><a href="#portalMain" class="portal-skip-link">Skip to main content</a><nav><a href="/x">x</a></nav><main id="portalMain" tabindex="-1"><p>hi</p></main></body>', {
    runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/portal/settings.html#payment',
    beforeParse(w) { w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) }); },
  });
  const w = dom.window;
  const s = w.document.createElement('script');
  s.textContent = APP;
  w.document.body.appendChild(s);
  w.document.querySelector('.portal-skip-link').click();
  assert.equal(w.document.activeElement.id, 'portalMain');
  assert.equal(w.location.hash, '#payment');
  w.close();
});
