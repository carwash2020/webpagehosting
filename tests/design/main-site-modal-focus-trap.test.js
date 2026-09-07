// Basic focus containment for index.html's own modals (2026-09-07),
// found missing from all of them during a codebase-wide accessibility
// survey: Gallery/FAQ/Terms (setupSimpleModal), the email modal, and
// the service-details modal. Tab could previously move keyboard focus
// onto background page content while any of them covered the screen --
// the same gap already fixed for every portal modal via
// trapFocusWithin() in portal/portal-app.js. Kept as a local copy in
// index.html rather than promoted to a new shared file, since none of
// the 5 city landing pages that also load site-motion.js carry any of
// these modals at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

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

// Same fake-DOM approach already proven for the portal's own
// trapFocusWithin() tests: elements track their own listeners,
// focus() moves a single shared activeElement, and offsetParent is a
// plain truthy stand-in for "visible."
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

  return { container, els, outside, documentMock, setActive: (el) => { activeElement = el; }, getActive: () => activeElement };
}

test('trapFocusWithin() cycles Tab/Shift+Tab within the container and release() restores prior focus', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  env.setActive(env.outside);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(INDEX, 'trapFocusWithin'), sandbox);

  const release = sandbox.trapFocusWithin(env.container);
  assert.equal(env.getActive(), env.els[0], 'should focus the first focusable element by default');

  env.setActive(env.els[2]);
  let prevented = false;
  env.documentMock._fireKeydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(env.getActive(), env.els[0], 'Tab on the last element should wrap to the first');
  assert.ok(prevented);

  release();
  assert.equal(env.getActive(), env.outside, 'release() should restore the pre-trap focus');
});

test('trapFocusWithin() focuses an explicit initialFocusEl instead of the first element', () => {
  const env = makeFakeEnvironment(['first', 'middle', 'last']);
  const sandbox = { document: env.documentMock };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(INDEX, 'trapFocusWithin'), sandbox);

  sandbox.trapFocusWithin(env.container, env.els[2]);
  assert.equal(env.getActive(), env.els[2]);
});

test('setupSimpleModal() establishes the trap on open() and releases it on close(), and returns {open, close}', () => {
  const fnSrc = extractFn(INDEX, 'setupSimpleModal');
  assert.match(fnSrc, /releaseFocusTrap = trapFocusWithin\(overlay, closeBtn\);/);
  assert.match(fnSrc, /if \(releaseFocusTrap\) \{ releaseFocusTrap\(\); releaseFocusTrap = null; \}/);
  assert.match(fnSrc, /return \{ open, close \};/);
});

test('the #terms hash auto-open path reuses setupSimpleModal()\'s own open() instead of duplicating overlay/focus logic by hand', () => {
  assert.match(INDEX, /const termsModal = setupSimpleModal\('termsOverlay', 'termsClose', \['navTermsFooter'\]\);/);
  const hashBlock = INDEX.slice(INDEX.indexOf("if (window.location.hash === '#terms'"));
  const ifLine = hashBlock.slice(0, hashBlock.indexOf('\n'));
  assert.match(ifLine, /window\.location\.hash === '#terms' && termsModal/);
  assert.match(hashBlock.slice(0, 200), /termsModal\.open\(\);/);
});

test('the email modal establishes the trap on open and releases it on close', () => {
  const openFn = extractFn(INDEX, 'openEmailModal');
  assert.match(openFn, /releaseEmailFocusTrap = trapFocusWithin\(emailOverlay, emailClose\);/);
  const closeFn = extractFn(INDEX, 'closeEmailModal');
  assert.match(closeFn, /if \(releaseEmailFocusTrap\) \{ releaseEmailFocusTrap\(\); releaseEmailFocusTrap = null; \}/);
});

test('the service-details modal establishes the trap on open and releases it on close', () => {
  const openFn = extractFn(INDEX, 'openModal');
  assert.match(openFn, /releaseModalFocusTrap = trapFocusWithin\(overlay, modalClose\);/);
  const closeFn = extractFn(INDEX, 'closeModal');
  assert.match(closeFn, /if \(releaseModalFocusTrap\) \{ releaseModalFocusTrap\(\); releaseModalFocusTrap = null; \}/);
});

test('none of the 5 city landing pages carry any of these modals, confirming the local (non-shared-file) placement is correct', () => {
  const pages = ['handyman-cedar-city-ut.html', 'handyman-hurricane-ut.html', 'handyman-mesquite-nv.html', 'handyman-santa-clara-ivins-ut.html', 'handyman-washington-city-ut.html'];
  for (const page of pages) {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.doesNotMatch(html, /id="galleryOverlay"|id="emailOverlay"|id="modalOverlay"/, `${page} unexpectedly carries a modal this fix assumed only index.html has`);
  }
});
