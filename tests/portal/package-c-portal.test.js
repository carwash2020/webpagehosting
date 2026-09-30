// Claude Design next pass, Package C (2026-09-29): client portal.
// C8 "Where things stand" on each request card (the step markup itself is
// covered in work-order-progress-track.test.js). C9 the money-owed dot on
// all 7 portal pages -- the owner's call, over the old Home-and-Invoices-
// only behaviour -- with "Invoices, N unpaid" for screen readers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const APP = read('portal', 'portal-app.js');
const POLISH = read('portal', 'portal-polish.css');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const head = src.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return head + src.slice(start, i);
}

function navDom() {
  const dom = new JSDOM('<!doctype html><nav class="portal-nav"><a href="/portal/dashboard.html">Invoices<span class="portal-nav-dot" aria-hidden="true" hidden></span></a></nav>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(extractFn(APP, 'portalApplyNavInvoiceDot'));
  w.eval(extractFn(APP, 'portalRefreshNavInvoiceDot'));
  return w;
}

test('C9: the dot shows while anything is owed, and the Invoices link says how many', () => {
  const w = navDom();
  const link = w.document.querySelector('a');
  const dot = link.querySelector('.portal-nav-dot');
  w.portalApplyNavInvoiceDot(2);
  assert.equal(dot.hidden, false);
  assert.ok(dot.classList.contains('is-visible'));
  assert.equal(dot.getAttribute('aria-hidden'), 'true', 'the dot itself stays visual only');
  assert.equal(link.getAttribute('aria-label'), 'Invoices, 2 unpaid');
  w.portalApplyNavInvoiceDot(true);
  assert.equal(link.getAttribute('aria-label'), 'Invoices, 1 unpaid');
  w.portalApplyNavInvoiceDot(0);
  assert.equal(dot.hidden, true);
  assert.equal(link.getAttribute('aria-label'), null, 'paid up: no dot and the plain link name');
});

test('C9: the other pages read one count-only request, filtered to the signed-in client', async () => {
  const w = navDom();
  const calls = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { email: 'Casey@Example.com' } } } }) },
    from(table) {
      calls.push(['from', table]);
      const q = {
        select(cols, opts) { calls.push(['select', cols, JSON.stringify(opts)]); return q; },
        eq(col, val) { calls.push(['eq', col, val]); return q; },
        then(resolve) { resolve({ count: 1, error: null }); },
      };
      return q;
    },
  };
  await w.portalRefreshNavInvoiceDot(client);
  assert.deepEqual(calls, [
    ['from', 'client_portal_invoices'],
    ['select', 'id', '{"count":"exact","head":true}'],
    ['eq', 'client_email', 'casey@example.com'],
    ['eq', 'paid', false],
  ]);
  assert.equal(w.document.querySelector('a').getAttribute('aria-label'), 'Invoices, 1 unpaid');
  // A failed check leaves the dot as it was.
  const failing = { from() { const q = { select: () => q, eq: () => q, then: (r) => r({ count: null, error: { message: 'offline' } }) }; return q; } };
  await w.portalRefreshNavInvoiceDot(failing, 'casey@example.com');
  assert.equal(w.document.querySelector('a').getAttribute('aria-label'), 'Invoices, 1 unpaid');
});

test('C9: every portal page sets the dot -- Home and Invoices from their own invoices, the rest with the count', () => {
  assert.match(read('portal', 'dashboard.html'), /portalApplyNavInvoiceDot\(invoices\.filter\(inv => !inv\.paid\)\.length\);/);
  assert.match(read('portal', 'home.html'), /portalApplyNavInvoiceDot\(summary\.invoices\.filter\(i => !i\.paid\)\.length\);/);
  for (const page of ['quotes.html', 'jobs.html', 'work-orders.html', 'contracts.html']) {
    assert.match(read('portal', page), /await portalGuardWithBiometricLock\(session\.user\.email, client\);\n\s*portalRefreshNavInvoiceDot\(client, session\.user\.email\);/, page);
  }
  assert.match(read('portal', 'settings.html'), /portalRefreshNavInvoiceDot\(client, email\);/);
});

test('C8: the request-card steps are styled blue, pulse only with motion allowed, and replace the old bar entirely', () => {
  assert.match(POLISH, /body\.portal-page \.th-stand \{[^}]*grid-auto-flow: column;/);
  assert.match(POLISH, /body\.portal-page \.th-stand li\.is-done \.th-stand-node \{ background: var\(--blue-text\); border-color: var\(--blue-text\); \}/);
  assert.match(POLISH, /@media \(prefers-reduced-motion: no-preference\) \{\s*body\.portal-page \.th-stand li\.is-current \.th-stand-node \{ animation: th-stand-pulse/);
  assert.doesNotMatch(POLISH + read('portal', 'work-orders.html'), /wo-progress/, 'no leftovers from the segmented bar');
});
