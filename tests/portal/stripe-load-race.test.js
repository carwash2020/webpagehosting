// Pay sheet vs. deferred Stripe.js (2026-10-31). #549 made
// portal/dashboard.html and portal/settings.html inject
// https://js.stripe.com/v3/ 3 seconds after window load. The pay sheet
// (single Pay and Pay all) and Settings' Add card called Stripe() as
// soon as the server returned a client secret, with no check that the
// script had arrived. A fast tap threw "ReferenceError: Stripe is not
// defined" and the pay sheet sat on "Loading..." for good. Found during
// the portal redesign (#553), reproduced there in the browser harness.
//
// These tests run the page's real head loader script and its real
// pay-flow functions in jsdom. jsdom never fetches the injected script,
// so each test decides when (or whether) "Stripe.js" arrives by setting
// window.Stripe and firing the tag's load/error event. The 3s and 20s
// timers are captured and fired by hand. Nothing here talks to Stripe
// or Supabase: fetch and client.auth are stubs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'portal', 'dashboard.html'), 'utf8');
const SETTINGS = fs.readFileSync(path.join(ROOT, 'portal', 'settings.html'), 'utf8');

const STRIPE_SRC = 'https://js.stripe.com/v3/';

function extractFn(src, name) {
  const start = src.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// The inline <head> script that schedules Stripe.js after load (#549).
function headStripeScript(src) {
  const marker = src.indexOf('Stripe.js is only needed once a client opens the card sheet');
  assert.ok(marker >= 0, 'expected the deferred Stripe.js loader script in <head>');
  const open = src.lastIndexOf('<script>', marker);
  const close = src.indexOf('</script>', marker);
  return src.slice(open + '<script>'.length, close);
}

// A fake Stripe.js: records what the page asked of it.
function fakeStripeFactory(rec) {
  return function Stripe(key) {
    rec.keys.push(key);
    return {
      elements({ clientSecret }) {
        rec.clientSecrets.push(clientSecret);
        return { create(type) { return { mount(sel) { rec.mounts.push({ type, sel }); } }; } };
      },
      confirmPayment() { return Promise.resolve({ paymentIntent: { status: 'processing' } }); },
      confirmSetup() { return Promise.resolve({ setupIntent: { status: 'processing' } }); },
    };
  };
}

function makeWindow(bodyHtml) {
  const dom = new JSDOM('<!DOCTYPE html><head></head><body>' + bodyHtml + '</body>', {
    url: 'https://example.com/portal/dashboard.html',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  const rec = { keys: [], clientSecrets: [], mounts: [], fetches: [], logged: [] };
  // Long timers (the 3s deferred load, the 20s give-up) are held so the
  // test can fire them; short ones run normally.
  const held = [];
  const realSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => {
    if (ms >= 3000) { held.push({ fn, ms }); return 100000 + held.length; }
    return realSetTimeout(fn, ms);
  };
  w.fireHeld = (ms) => {
    const due = held.filter((t) => t.ms === ms);
    due.forEach((t) => { held.splice(held.indexOf(t), 1); t.fn(); });
    return due.length;
  };
  w.client = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } };
  w.fetch = async (url, opts) => {
    rec.fetches.push({ url, body: JSON.parse(opts.body) });
    return { json: async () => ({ ok: true, client_secret: 'pi_test_123_secret_abc' }) };
  };
  w.logPortalClientError = (message, source) => rec.logged.push({ message, source });
  w.trapFocusWithin = () => () => {};
  w.escapeHtml = (s) => String(s);
  w.formatCurrency = (n) => '$' + Number(n).toFixed(2);
  w.renderInvoices = () => {};
  w.loadSavedCards = () => {};
  w.showToast = () => {};
  return { w, rec };
}

function dashboardPage() {
  const { w, rec } = makeWindow('<div id="paymentModal"><div id="paymentModalBody"></div></div>');
  w.eval(headStripeScript(DASHBOARD));
  w.eval([
    "const STRIPE_PUBLISHABLE_KEY = 'pk_test_harness';",
    'let stripeInstance = null;',
    'let elementsInstance = null;',
    'let releasePaymentModalFocusTrap = null;',
    extractFn(DASHBOARD, 'openPaymentModal'),
    extractFn(DASHBOARD, 'closePaymentModal'),
    extractFn(DASHBOARD, 'startPayment'),
    extractFn(DASHBOARD, 'startBulkPayment'),
    extractFn(DASHBOARD, 'mountPaymentUI'),
    'window.__t = { startPayment, startBulkPayment, closePaymentModal };',
  ].join('\n'));
  return { w, rec, t: w.__t };
}

function settingsPage() {
  const { w, rec } = makeWindow('<button id="addCardBtn" style="display:none">Add card</button><div id="addCardArea"></div>');
  w.eval(headStripeScript(SETTINGS));
  w.eval([
    "const STRIPE_PUBLISHABLE_KEY = 'pk_test_harness';",
    'let stripeInstance = null;',
    'let elementsInstance = null;',
    extractFn(SETTINGS, 'cancelAddCard'),
    extractFn(SETTINGS, 'mountAddCardSetupUI'),
    'window.__t = { mountAddCardSetupUI };',
  ].join('\n'));
  return { w, rec, t: w.__t };
}

const stripeTags = (w) => Array.from(w.document.querySelectorAll('script')).filter((s) => s.src === STRIPE_SRC);
const flush = () => new Promise((r) => setTimeout(r, 20));
const bodyText = (w) => w.document.getElementById('paymentModalBody').textContent;

function arrive(w, rec, tag) {
  w.Stripe = fakeStripeFactory(rec);
  tag.dispatchEvent(new w.Event('load'));
}

// ---- the bug: tapping Pay before Stripe.js is here ----

test('Pay tapped before Stripe.js loads: no "Stripe is not defined", the sheet waits, then mounts once it arrives', async () => {
  const { w, rec, t } = dashboardPage();
  assert.equal(typeof w.Stripe, 'undefined', 'precondition: Stripe.js has not arrived');

  // Pre-fix this promise rejected with ReferenceError: Stripe is not defined.
  await t.startPayment(7, 'Pat Client', 'data:image/png;base64,AAA');
  await flush();

  assert.match(bodyText(w), /Loading the secure card form/, 'an honest wait message, not a frozen "Loading..."');
  assert.equal(rec.mounts.length, 0);
  const tags = stripeTags(w);
  assert.equal(tags.length, 1, 'the tap starts Stripe.js instead of waiting out the 3s timer');

  arrive(w, rec, tags[0]);
  await flush();

  assert.deepEqual(rec.mounts, [{ type: 'payment', sel: '#paymentElement' }]);
  assert.deepEqual(rec.clientSecrets, ['pi_test_123_secret_abc']);
  assert.ok(w.document.getElementById('paymentSubmitBtn'), 'Pay button is shown');
  assert.equal(rec.fetches.length, 1, 'exactly one create-payment-intent call');
  assert.match(rec.fetches[0].url, /create-payment-intent$/);
});

test('Pay all tapped before Stripe.js loads: same -- waits, then mounts the one combined PaymentIntent', async () => {
  const { w, rec, t } = dashboardPage();
  await t.startBulkPayment([7, 8, 9], 'Pat Client', 'data:image/png;base64,AAA');
  await flush();

  assert.match(bodyText(w), /Loading the secure card form/);
  arrive(w, rec, stripeTags(w)[0]);
  await flush();

  assert.equal(rec.mounts.length, 1);
  assert.equal(rec.fetches.length, 1);
  assert.match(rec.fetches[0].url, /create-bulk-payment-intent$/);
  assert.deepEqual(rec.fetches[0].body.invoice_ids, [7, 8, 9]);
});

test('Pay tapped while the 3s timed load is already in flight shares that one request', async () => {
  const { w, rec, t } = dashboardPage();
  w.dispatchEvent(new w.Event('load'));
  assert.equal(w.fireHeld(3000), 1, 'the #549 timer is scheduled on window load');
  assert.equal(stripeTags(w).length, 1);

  await t.startPayment(7);
  await flush();
  assert.equal(stripeTags(w).length, 1, 'no second Stripe.js tag');

  arrive(w, rec, stripeTags(w)[0]);
  await flush();
  assert.equal(rec.mounts.length, 1);
});

// ---- the common case must not change ----

test('Stripe.js already loaded: mounts straight away, no wait message, no extra script tag', async () => {
  const { w, rec, t } = dashboardPage();
  w.Stripe = fakeStripeFactory(rec);

  await t.startPayment(7);
  // No flush: the mount happens in the same turn as the server reply.
  assert.equal(rec.mounts.length, 1);
  assert.doesNotMatch(bodyText(w), /Loading the secure card form/);
  assert.equal(stripeTags(w).length, 0, 'nothing is re-downloaded');
});

test('the #549 deferral is intact: nothing loads Stripe.js before window load + 3s', () => {
  const { w } = dashboardPage();
  assert.equal(stripeTags(w).length, 0, 'not at parse time');
  w.dispatchEvent(new w.Event('load'));
  assert.equal(stripeTags(w).length, 0, 'not at load');
  w.fireHeld(3000);
  assert.equal(stripeTags(w).length, 1, '3s after load');
  for (const html of [DASHBOARD, SETTINGS]) {
    assert.doesNotMatch(html, /<script[^>]+src="https:\/\/js\.stripe\.com/, 'no blocking <script src> for Stripe.js');
  }
});

// ---- Stripe.js never arrives ----

test('Stripe.js fails to load: a clear Try again, logged, and the retry reuses the same PaymentIntent', async () => {
  const { w, rec, t } = dashboardPage();
  await t.startPayment(7);
  await flush();

  stripeTags(w)[0].dispatchEvent(new w.Event('error'));
  await flush();

  assert.match(bodyText(w), /secure card form didn't load/);
  const retry = w.document.getElementById('paymentStripeRetryBtn');
  assert.ok(retry, 'a Try again button');
  assert.equal(stripeTags(w).length, 0, 'the failed tag is removed');
  assert.equal(rec.logged.length, 1);
  assert.equal(rec.logged[0].source, 'stripe-js-load');

  retry.click();
  await flush();
  assert.match(bodyText(w), /Loading the secure card form/);
  assert.equal(stripeTags(w).length, 1, 'retry injects a fresh tag');

  arrive(w, rec, stripeTags(w)[0]);
  await flush();
  assert.equal(rec.mounts.length, 1);
  assert.deepEqual(rec.clientSecrets, ['pi_test_123_secret_abc']);
  assert.equal(rec.fetches.length, 1, 'no second PaymentIntent was created');
});

test('Stripe.js stalls: after 20s the sheet offers Try again instead of waiting forever', async () => {
  const { w, rec, t } = dashboardPage();
  await t.startPayment(7);
  await flush();
  assert.equal(w.fireHeld(20000), 1);
  await flush();
  assert.ok(w.document.getElementById('paymentStripeRetryBtn'));
  assert.equal(rec.mounts.length, 0);
});

test('a sheet closed while waiting is not mounted into when Stripe.js turns up later', async () => {
  const { w, rec, t } = dashboardPage();
  await t.startPayment(7);
  await flush();
  t.closePaymentModal();
  arrive(w, rec, stripeTags(w)[0]);
  await flush();
  assert.equal(rec.mounts.length, 0);
});

// ---- Settings > Add card: same root cause ----

test('Settings Add card before Stripe.js loads: waits, then mounts the setup form', async () => {
  const { w, rec, t } = settingsPage();
  // Pre-fix this threw ReferenceError: Stripe is not defined.
  t.mountAddCardSetupUI('seti_test_123_secret_abc');
  await flush();
  const area = w.document.getElementById('addCardArea');
  assert.match(area.textContent, /Loading the secure card form/);

  arrive(w, rec, stripeTags(w)[0]);
  await flush();
  assert.deepEqual(rec.mounts, [{ type: 'payment', sel: '#addCardElement' }]);
  assert.deepEqual(rec.clientSecrets, ['seti_test_123_secret_abc']);
});

test('Settings Add card when Stripe.js fails: Try again and Cancel, retry reuses the SetupIntent', async () => {
  const { w, rec, t } = settingsPage();
  t.mountAddCardSetupUI('seti_test_123_secret_abc');
  await flush();
  stripeTags(w)[0].dispatchEvent(new w.Event('error'));
  await flush();
  const area = w.document.getElementById('addCardArea');
  assert.match(area.textContent, /secure card form didn't load/);
  assert.match(area.innerHTML, /cancelAddCard\(\)/);

  w.document.getElementById('addCardStripeRetryBtn').click();
  await flush();
  arrive(w, rec, stripeTags(w)[0]);
  await flush();
  assert.equal(rec.mounts.length, 1);
  assert.deepEqual(rec.clientSecrets, ['seti_test_123_secret_abc']);
});

test('Settings Add card with Stripe.js already loaded mounts immediately', () => {
  const { w, rec, t } = settingsPage();
  w.Stripe = fakeStripeFactory(rec);
  t.mountAddCardSetupUI('seti_test_123_secret_abc');
  assert.equal(rec.mounts.length, 1);
  assert.equal(stripeTags(w).length, 0);
});
