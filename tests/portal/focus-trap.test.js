// Basic focus containment for the portal's modals/overlays
// (2026-09-07), found missing from all of them: the confirm modal,
// the report-a-problem modal (every page), the payment modal
// (dashboard.html), and the job-photo lightbox (jobs.html). Tab could
// previously move keyboard focus onto background page content while
// any of them covered the screen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PORTAL_APP_JS = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

const REPORT_BUG_PAGES = ['dashboard.html', 'home.html', 'jobs.html', 'login.html', 'quotes.html', 'set-password.html', 'settings.html', 'work-orders.html'];

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

// A minimal fake DOM sufficient to exercise the real trapFocusWithin()
// implementation: elements track their own listeners, `focus()` moves
// a single shared activeElement, and offsetParent is a plain truthy
// stand-in for "visible" (jsdom has no real layout engine, so this is
// more direct than fighting it).
function makeFakeEnvironment(childIds) {
  let activeElement = null;
  function makeEl(id) {
    const listeners = {};
    const el = {
      id,
      offsetParent: {},
      addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
      removeEventListener(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter((f) => f !== fn);
      },
      focus() { activeElement = el; },
    };
    return el;
  }
  const els = childIds.map(makeEl);
  const outside = makeEl('outside');
  const container = { querySelectorAll: () => els };

  const docListeners = {};
  const documentMock = {
    get activeElement() { return activeElement; },
    addEventListener(evt, fn) { (docListeners[evt] = docListeners[evt] || []).push(fn); },
    removeEventListener(evt, fn) {
      if (!docListeners[evt]) return;
      docListeners[evt] = docListeners[evt].filter((f) => f !== fn);
    },
    _fireKeydown(evtObj) { (docListeners.keydown || []).slice().forEach((fn) => fn(evtObj)); },
  };

  return {
    container, els, outside, documentMock,
    setActive: (el) => { activeElement = el; },
    getActive: () => activeElement,
  };
}

function runTrapFocusWithin() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);
  return sandbox.trapFocusWithin;
}

test('focuses the first focusable element inside the container by default', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);

  sandbox.trapFocusWithin(env.container);
  assert.equal(env.getActive(), env.els[0]);
});

test('an explicit initialFocusEl is focused instead of the first element', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);

  sandbox.trapFocusWithin(env.container, env.els[2]);
  assert.equal(env.getActive(), env.els[2]);
});

test('Tab on the last element wraps focus to the first, preventing the default', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);

  sandbox.trapFocusWithin(env.container);
  env.setActive(env.els[2]); // pretend the user tabbed to the last element
  let prevented = false;
  env.documentMock._fireKeydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(env.getActive(), env.els[0]);
  assert.ok(prevented);
});

test('Shift+Tab on the first element wraps focus to the last', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);

  sandbox.trapFocusWithin(env.container);
  env.setActive(env.els[0]);
  env.documentMock._fireKeydown({ key: 'Tab', shiftKey: true, preventDefault: () => {} });
  assert.equal(env.getActive(), env.els[2]);
});

test('Tab in the middle of the list is left alone (no wrap, no preventDefault)', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);

  sandbox.trapFocusWithin(env.container);
  env.setActive(env.els[1]);
  let prevented = false;
  env.documentMock._fireKeydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(env.getActive(), env.els[1], 'focus should not have moved');
  assert.ok(!prevented);
});

test('release() restores focus to whatever was focused before the trap started, and stops intercepting Tab', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  env.setActive(env.outside);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);

  const release = sandbox.trapFocusWithin(env.container);
  assert.equal(env.getActive(), env.els[0], 'trap should have moved focus inside the container');

  release();
  assert.equal(env.getActive(), env.outside, 'release should restore the pre-trap focus');

  // Tab no longer does anything -- the listener was removed.
  env.setActive(env.els[2]);
  env.documentMock._fireKeydown({ key: 'Tab', shiftKey: false, preventDefault: () => { throw new Error('should not be called after release'); } });
  assert.equal(env.getActive(), env.els[2]);
});

test('non-Tab keys are ignored entirely', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'trapFocusWithin'), sandbox);

  sandbox.trapFocusWithin(env.container);
  env.setActive(env.els[2]);
  env.documentMock._fireKeydown({ key: 'Enter', shiftKey: false, preventDefault: () => { throw new Error('should not be called for non-Tab keys'); } });
  assert.equal(env.getActive(), env.els[2]);
});

// ---- wiring into each real call site ----

test('portalConfirm() establishes and releases the focus trap around its modal lifecycle', () => {
  const fnSrc = extractFn(PORTAL_APP_JS, 'portalConfirm');
  assert.match(fnSrc, /releaseFocusTrap = trapFocusWithin\(overlay, okBtn\);/);
  assert.match(fnSrc, /if \(releaseFocusTrap\) releaseFocusTrap\(\);/);
});

for (const page of REPORT_BUG_PAGES) {
  test(`${page}: the report-a-problem modal traps focus and closes on Escape`, () => {
    const html = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(html, /releaseReportBugFocusTrap = trapFocusWithin\(overlay\);/);
    assert.match(html, /if \(releaseReportBugFocusTrap\) \{ releaseReportBugFocusTrap\(\); releaseReportBugFocusTrap = null; \}/);
    assert.match(html, /if \(overlay\.style\.display === 'none'\) return;\s*\n\s*if \(e\.key === 'Escape'\) closeReportBug\(\);/);
  });
}

test('dashboard.html: the payment modal traps focus and closes on Escape, with every call site routed through the shared open/close functions', () => {
  assert.match(DASHBOARD, /function openPaymentModal\(\) \{[\s\S]*?releasePaymentModalFocusTrap = trapFocusWithin\(modal\);[\s\S]*?\}/);
  assert.match(DASHBOARD, /function closePaymentModal\(\) \{[\s\S]*?if \(releasePaymentModalFocusTrap\)/);
  assert.match(DASHBOARD, /if \(e\.key === 'Escape'\) closePaymentModal\(\);/);
  // Every real call site (both payment flows, the close (x) button,
  // and the post-payment auto-close) must go through the two shared
  // functions above rather than flipping the class directly, so the
  // trap is never silently skipped on some paths but not others.
  assert.match(DASHBOARD, /async function startPayment\(invoiceId, signerName\) \{\s*\n\s*openPaymentModal\(\);/);
  assert.match(DASHBOARD, /async function startBulkPayment\(invoiceIds, signerName\) \{\s*\n\s*openPaymentModal\(\);/);
  assert.match(DASHBOARD, /class="payment-modal-close" onclick="closePaymentModal\(\)"/);
  assert.match(DASHBOARD, /setTimeout\(\(\) => \{\s*\n\s*closePaymentModal\(\);/);
});

test('jobs.html: the lightbox traps focus once, not re-trapping on every prev/next navigation', () => {
  const openFn = extractFn(JOBS, 'openLightbox');
  assert.match(openFn, /if \(!releaseLightboxFocusTrap\) releaseLightboxFocusTrap = trapFocusWithin\(lightbox\);/);
  const closeFn = extractFn(JOBS, 'closeLightbox');
  assert.match(closeFn, /if \(releaseLightboxFocusTrap\) \{ releaseLightboxFocusTrap\(\); releaseLightboxFocusTrap = null; \}/);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 32, `expected v32 or later, got v${versionMatch[1]}`);
});

test('portal-app.js version stamp matches across all 8 portal pages', () => {
  const versions = new Set();
  for (const page of REPORT_BUG_PAGES) {
    const html = fs.readFileSync(repo('portal', page), 'utf8');
    const m = html.match(/portal-app\.js\?v=([a-zA-Z0-9]+)/);
    assert.ok(m, `${page} should load portal-app.js with a ?v= param`);
    versions.add(m[1]);
  }
  assert.equal(versions.size, 1, `expected one shared portal-app.js version, got ${[...versions].join(', ')}`);
});
