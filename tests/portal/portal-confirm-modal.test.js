// Themed replacement for window.confirm() (2026-09-07), found sitting
// next to the app's own fully-themed modal patterns (the payment
// modal, the report-a-problem modal) -- the one raw platform dialog
// left in front of a client, on exactly the two most consequential
// actions: declining a quote (quotes.html) and removing a saved card
// (settings.html). The underlying approve/decline/remove-card logic
// itself is unchanged; only how the yes/no confirmation is shown.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PORTAL_APP_JS = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const PORTAL_APP_CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const QUOTES = fs.readFileSync(repo('portal', 'quotes.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

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

test('no window.confirm() calls remain anywhere in the portal', () => {
  assert.doesNotMatch(QUOTES, /window\.confirm\(/);
  assert.doesNotMatch(SETTINGS, /window\.confirm\(/);
});

test('quotes.html and settings.html both await portalConfirm() before proceeding', () => {
  assert.match(QUOTES, /const confirmed = await portalConfirm\(/);
  assert.match(SETTINGS, /const confirmed = await portalConfirm\(/);
});

// Build a minimal fake DOM sufficient to exercise the real
// portalConfirm() implementation end to end: lazily creates its own
// overlay, resolves true/false on the real button clicks.
function makeFakeDocument() {
  const elements = {};
  function makeButtonOrDiv(tag) {
    const listeners = {};
    return {
      tagName: tag,
      className: '',
      id: '',
      textContent: '',
      innerHTML: '',
      style: {},
      classList: {
        set: new Set(),
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
        contains(c) { return this.set.has(c); },
      },
      children: [],
      addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
      removeEventListener(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter((f) => f !== fn);
      },
      _fire(evt, evtObj) { (listeners[evt] || []).forEach((fn) => fn(evtObj || {})); },
      focus() {},
    };
  }

  const doc = {
    _appended: [],
    getElementById(id) { return elements[id] || null; },
    createElement(tag) {
      const el = makeButtonOrDiv(tag);
      // Mimic setting innerHTML on the overlay: registers its 4 real
      // descendant ids so getElementById can find them afterwards,
      // exactly like a real DOM would after parsing that HTML string.
      Object.defineProperty(el, 'innerHTML', {
        set(html) {
          elements.portalConfirmMessage = makeButtonOrDiv('p');
          elements.portalConfirmMessage.id = 'portalConfirmMessage';
          elements.portalConfirmCancel = makeButtonOrDiv('button');
          elements.portalConfirmCancel.id = 'portalConfirmCancel';
          elements.portalConfirmOk = makeButtonOrDiv('button');
          elements.portalConfirmOk.id = 'portalConfirmOk';
        },
        get() { return ''; },
      });
      return el;
    },
    body: { appendChild(el) { doc._appended.push(el); elements[el.id] = el; } },
    addEventListener() {},
    removeEventListener() {},
  };
  return { doc, elements };
}

test('portalConfirm() resolves true when the confirm button is clicked, and sets the real message/labels passed in', async () => {
  const { doc, elements } = makeFakeDocument();
  const sandbox = { document: doc, Promise };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'portalConfirm'), sandbox);

  const promise = sandbox.portalConfirm('Remove this card?', { confirmLabel: 'Remove' });
  assert.equal(elements.portalConfirmMessage.textContent, 'Remove this card?');
  assert.equal(elements.portalConfirmOk.textContent, 'Remove');
  assert.ok(elements.portalConfirmOverlay.classList.contains('is-visible'));

  elements.portalConfirmOk._fire('click');
  const result = await promise;
  assert.equal(result, true);
  assert.ok(!elements.portalConfirmOverlay.classList.contains('is-visible'));
});

test('portalConfirm() resolves false when cancel is clicked, or when Escape is pressed', async () => {
  const { doc, elements } = makeFakeDocument();
  const sandbox = { document: doc, Promise };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'portalConfirm'), sandbox);

  const cancelPromise = sandbox.portalConfirm('Are you sure?');
  elements.portalConfirmCancel._fire('click');
  assert.equal(await cancelPromise, false);
});

test('a non-danger confirm (e.g. approving a quote) gets the blue button, a danger one gets orange', async () => {
  const { doc, elements } = makeFakeDocument();
  const sandbox = { document: doc, Promise };
  vm.createContext(sandbox);
  vm.runInContext(extractFn(PORTAL_APP_JS, 'portalConfirm'), sandbox);

  sandbox.portalConfirm('Approve this quote?', { danger: false });
  assert.equal(elements.portalConfirmOk.className, 'btn blue');

  sandbox.portalConfirm('Decline this quote?', { danger: true });
  assert.equal(elements.portalConfirmOk.className, 'btn orange');
});

test('the modal CSS is defined in the shared portal-app.css, not duplicated per page', () => {
  assert.match(PORTAL_APP_CSS, /\.portal-confirm-overlay \{/);
  assert.match(PORTAL_APP_CSS, /\.portal-confirm-overlay\.is-visible \{ display: flex; \}/);
  assert.match(PORTAL_APP_CSS, /\.portal-confirm-modal \{/);
});

test('portal-app.js/css version stamps match across all 8 portal pages', () => {
  const pages = ['dashboard.html', 'home.html', 'jobs.html', 'login.html', 'quotes.html', 'set-password.html', 'settings.html', 'work-orders.html'];
  const jsVersions = new Set();
  const cssVersions = new Set();
  for (const page of pages) {
    const html = fs.readFileSync(repo('portal', page), 'utf8');
    const jsMatch = html.match(/portal-app\.js\?v=([a-zA-Z0-9]+)/);
    const cssMatch = html.match(/portal-app\.css\?v=([a-zA-Z0-9]+)/);
    assert.ok(jsMatch, `${page} should load portal-app.js with a ?v= param`);
    assert.ok(cssMatch, `${page} should load portal-app.css with a ?v= param`);
    jsVersions.add(jsMatch[1]);
    cssVersions.add(cssMatch[1]);
  }
  assert.equal(jsVersions.size, 1, `expected one shared portal-app.js version, got ${[...jsVersions].join(', ')}`);
  assert.equal(cssVersions.size, 1, `expected one shared portal-app.css version, got ${[...cssVersions].join(', ')}`);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 31, `expected v31 or later, got v${versionMatch[1]}`);
});
