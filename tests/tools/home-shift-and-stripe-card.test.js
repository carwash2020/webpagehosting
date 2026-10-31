// Home (2026-10-31): Start my day / End my day in the greeting banner as the
// one bold element, and a read-only Stripe balance card for Finance roles.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WS = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

test('the shift button is in the greeting banner, near the top, and nowhere in Your week', () => {
  const banner = WS.slice(WS.indexOf('id="greetingBanner"'), WS.indexOf('id="todayRings"'));
  assert.match(banner, /id="shiftBanner"/);
  assert.ok(WS.indexOf('id="shiftBanner"') < WS.indexOf('id="todayHero"'), 'above Up next, the route, the lanes and money');
  assert.ok(WS.indexOf('id="shiftBanner"') < WS.indexOf('id="weekCard"'));
  const week = extractFn(WS, 'renderWeekCard');
  assert.doesNotMatch(week, /data-shift-open|shift-now/, 'the week card keeps only its stats');
  assert.match(week, /renderShiftBanner\(s, now, day, t\)/);
  assert.match(WS, /<div class="week-card" id="weekCard" aria-labelledby="weekCardLabel"><\/div>/, 'Your week stays where it was');
});

test('the shift banner offers exactly one primary button in every state, and no arrows or caps', () => {
  const fn = extractFn(WS, 'renderShiftBanner');
  const states = {};
  const el = { innerHTML: '', dataset: {}, addEventListener() {} };
  const ctx = { document: { getElementById: (id) => (id === 'shiftBanner' ? el : null) }, escapeHtml: String, thClockDuration: () => '2 min', thOpenShiftSheet() {}, Date };
  vm.createContext(ctx);
  vm.runInContext(fn + ';this.f = renderShiftBanner;', ctx);
  const day = () => 'Mon'; const t = () => '9:00 AM';
  ctx.f({ needsEnd: [{ start: new Date().toISOString() }], onShift: false }, Date.now(), day, t); states.due = el.innerHTML;
  ctx.f({ needsEnd: [], onShift: true, since: new Date().toISOString() }, Date.now(), day, t); states.on = el.innerHTML;
  ctx.f({ needsEnd: [], onShift: false }, Date.now(), day, t); states.off = el.innerHTML;
  for (const [k, html] of Object.entries(states)) {
    assert.equal((html.match(/<button/g) || []).length, 1, k);
    assert.match(html, /class="primary-btn" data-shift-open/, k);
    assert.doesNotMatch(html, /&rsaquo;|&rarr;|→|›/);
  }
  assert.match(states.due, />Fix it</); assert.match(states.on, />End my day</); assert.match(states.off, />Start my day</);
  ctx.f(null, Date.now(), day, t);
  assert.equal(el.innerHTML, '', 'no signed-in person: nothing');
});

test('Today\'s route is gone from Home', () => {
  assert.doesNotMatch(WS, /todayRouteCard|id="todayRoute"|renderTodayRoute|\.today-route/);
});

function renderCard({ finance, moneyState = 'shown', data = null, error = '' }) {
  const el = { hidden: true, innerHTML: '' };
  const fetches = [];
  const ctx = {
    document: { getElementById: (id) => (id === 'stripeBalance' ? el : null), body: { getAttribute: () => moneyState }, hidden: false },
    canViewFinance: () => finance, money: (n) => '$' + Number(n).toFixed(2), escapeHtml: String,
    fetch: () => { fetches.push(1); return new Promise(() => {}); }, getAuthToken: () => 'tok', SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'k',
    Date, Number, String, Promise,
  };
  vm.createContext(ctx);
  const src = 'const STRIPE_BALANCE_TTL_MS = 300000; const stripeBalance = { at: 0, data: null, error: "", loading: false };' +
    extractFn(WS, 'loadStripeBalance') + extractFn(WS, 'stripeAmount') + extractFn(WS, 'renderStripeBalance') +
    ';this.s = stripeBalance; this.f = renderStripeBalance;';
  vm.runInContext(src, ctx);
  ctx.s.data = data; ctx.s.error = error; ctx.s.at = data || error ? Date.now() : 0;
  ctx.f();
  return { el, fetches };
}
const BAL = { ok: true, currency: 'usd', available: 123456, pending: 7800, next_payout: { amount: 98765, currency: 'usd', arrival_date: 1793500000, status: 'in_transit' } };

test('the Stripe card: three figures and a link to Finance for Finance roles, nothing for anyone else, and no fetch for them', () => {
  const on = renderCard({ finance: true, data: BAL });
  assert.equal(on.el.hidden, false);
  assert.match(on.el.innerHTML, /\$1234\.56<\/div><div class="stripe-balance-label">Available/);
  assert.match(on.el.innerHTML, /\$78\.00<\/div><div class="stripe-balance-label">Pending/);
  assert.match(on.el.innerHTML, /\$987\.65<\/div><div class="stripe-balance-label">Next payout, /);
  assert.match(on.el.innerHTML, /<a class="th-v2-link" href="\/tools\/finance\.html">Open Finance<\/a>/);
  for (const c of [{ finance: false, data: BAL }, { finance: true, moneyState: 'hidden', data: BAL }]) {
    const off = renderCard(c);
    assert.equal(off.el.hidden, true); assert.equal(off.el.innerHTML, ''); assert.equal(off.fetches.length, 0);
  }
  assert.equal(renderCard({ finance: true }).fetches.length, 1, 'a Finance role with nothing cached asks once');
  assert.match(renderCard({ finance: true, data: { ...BAL, next_payout: { ...BAL.next_payout, status: 'paid' } } }).el.innerHTML, /Last payout/);
  assert.match(renderCard({ finance: true, error: 'Not set up yet' }).el.innerHTML, /Not set up yet/);
});

test('the Stripe card sits at the top of #todayMoney, is drawn by renderTodayMoney, and follows the design rules', () => {
  assert.ok(WS.indexOf('id="stripeBalance"') > WS.indexOf('id="todayMoney"') && WS.indexOf('id="stripeBalance"') < WS.indexOf('id="todayMoneyBody"'));
  assert.match(extractFn(WS, 'renderTodayMoney'), /renderStripeBalance\(\);/);
  const css = WS.split('\n').filter((l) => /\.stripe-balance|\.shift-banner/.test(l)).join('\n');
  assert.doesNotMatch(css, /text-transform|font-family: ?['"]?Inter|purple|#[89ab][0-9a-f]{2}[0-9a-f]{3}\b.*violet/i);
  assert.doesNotMatch(css.split('\n').filter((l) => /\.stripe-balance/.test(l)).join('\n'), /font-weight: ?(5|6|7|8|9)00|bold/, 'nothing bold in the card');
});

// ---- the edge function ----
function loadFn({ gate = true, finance = true, key = 'sk_test_restricted', stripe }) {
  const src = fs.readFileSync(repo('edge-functions', 'stripe-balance-index.ts'), 'utf8');
  const calls = [];
  let handler;
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const ctx = vm.createContext({
    Deno: { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', STRIPE_BALANCE_SECRET_KEY: key }[k]) }, serve: (h) => { handler = h; } },
    fetch: async (url, init = {}) => {
      const u = String(url); calls.push({ url: u, init });
      if (u.includes('/rest/v1/account_roles')) return json(finance ? [{ can_view_finance: true }] : [{ can_view_finance: false }]);
      if (u.includes('check_internal_mfa_for_edge_function')) return json(gate);
      if (u.startsWith('https://api.stripe.com')) return stripe(u);
      throw new Error('unexpected ' + u);
    },
    Response, Request, Headers, URL, atob, btoa, console, Promise, JSON, Math, Date,
  });
  vm.runInContext(stripTypeScriptTypes(src), ctx);
  return { handler, calls };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const req = (claims = { role: 'authenticated', email: 'steve@x.com', sub: 'u', aal: 'aal2' }) =>
  new Request('https://x/functions/v1/stripe-balance', { method: 'POST', headers: { Authorization: `Bearer h.${b64(claims)}.s` }, body: '{}' });
const stripeOk = (u) => new Response(JSON.stringify(u.includes('/v1/balance')
  ? { available: [{ amount: 1000, currency: 'usd' }, { amount: 500, currency: 'usd' }, { amount: 9, currency: 'eur' }], pending: [{ amount: 250, currency: 'usd' }] }
  : { data: [{ amount: 4200, currency: 'usd', arrival_date: 1793500000, status: 'pending', id: 'po_1' }] }), { status: 200 });

test('stripe-balance: returns available, pending and the payout; only reads from Stripe, with its own key', async () => {
  const { handler, calls } = loadFn({ stripe: stripeOk });
  const res = await handler(req());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, currency: 'usd', available: 1500, pending: 250, next_payout: { amount: 4200, currency: 'usd', arrival_date: 1793500000, status: 'pending' } });
  const stripe = calls.filter((c) => c.url.startsWith('https://api.stripe.com'));
  assert.deepEqual(stripe.map((c) => c.url).sort(), ['https://api.stripe.com/v1/balance', 'https://api.stripe.com/v1/payouts?limit=1']);
  for (const c of stripe) { assert.equal(c.init.method, undefined, 'GET only'); assert.equal(c.init.headers.Authorization, 'Bearer sk_test_restricted'); }
});

test('stripe-balance: signed-out 401, no finance role 403, refused two-factor 403, no key 503 -- and Stripe is not called for any of them', async () => {
  const cases = [
    [{ stripe: stripeOk }, req({ role: 'anon' }), 401, undefined],
    [{ stripe: stripeOk, finance: false }, req(), 403, undefined],
    [{ stripe: stripeOk, gate: false }, req(), 403, 'mfa_required'],
    [{ stripe: stripeOk, key: null }, req(), 503, 'not_configured'],
  ];
  for (const [opts, r, status, code] of cases) {
    const { handler, calls } = loadFn(opts);
    const res = await handler(r);
    assert.equal(res.status, status);
    assert.equal((await res.json()).code, code);
    assert.equal(calls.filter((c) => c.url.startsWith('https://api.stripe.com')).length, 0);
  }
});

test('stripe-balance: a Stripe failure is a 502 that does not repeat Stripe\'s own error text', async () => {
  const { handler } = loadFn({ stripe: () => new Response('{"error":{"message":"Invalid API Key provided: sk_test_restricted"}}', { status: 401 }) });
  const res = await handler(req());
  assert.equal(res.status, 502);
  assert.doesNotMatch(JSON.stringify(await res.json()), /sk_test|Invalid API Key/);
});
