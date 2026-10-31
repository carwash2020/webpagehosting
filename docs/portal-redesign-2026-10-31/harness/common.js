// Shared by shoot.js and verify.js for the client portal redesign
// (2026-10-31). Dev-only; nothing on the site loads this.
//
// Same approach as the Workspace Phase 2/3/4 and redundancy harnesses
// (docs/workspace-*-2026-10-3x/harness/), adapted to the portal's own
// auth and data model:
//   - a tiny static server per checkout (so main and this branch can be
//     served side by side and compared);
//   - every supabase.co request answered locally: PostgREST reads return the
//     seeded rows for one client (Kim Reyes), RPCs return seeded visits and
//     unread counts, edge functions return canned answers, and every write
//     (POST/PATCH/DELETE, edge-function call) is recorded in a log so
//     verify.js can compare what a client action sends on main vs. here;
//   - a signed-in aal1 session (no 2FA factor) seeded into localStorage
//     under the key supabase-js reads, so pages pass their own auth checks;
//   - Stripe.js is replaced by a small mock (Payment Element mounts a fake
//     card box; confirmPayment "succeeds") so the pay sheet can be walked
//     end to end without a real card or network;
//   - SUPABASE_UMD serves the pinned supabase-js@2.112.3 (same bytes, the
//     page's SRI still has to match); the unpinned @2 on the sign-in pages
//     gets the same file;
//   - REAL_FONTS=1 serves the repo's fonts/pdf/ Anton / Archivo / Oswald in
//     place of the blocked Google Fonts request (Phase 3's approach).
//     Newsreader has no local copy and falls back.
//   - EMPTY=1 seeds a client with nothing on file (the empty states).
//   - FAIL=1 makes every PostgREST read fail (the "couldn't load" state);
//     verify.js flips the same switch at run time (control.fail) to check
//     the banner's Try again recovers;
//   - JSPDF_UMD serves the pinned jspdf@2.5.1 for the PDF buttons
//     (npm pack jspdf@2.5.1, dist/jspdf.umd.min.js).
const fs = require('fs');
const http = require('http');
const path = require('path');

const REAL_FONTS = !!process.env.REAL_FONTS;
const EMPTY = !!process.env.EMPTY;
const UMD = process.env.SUPABASE_UMD;
const JSPDF_UMD = process.env.JSPDF_UMD;
const PW = process.env.PLAYWRIGHT || 'playwright';
const SB = 'https://csvfqdjuobylgafgolho.supabase.co';
const STORAGE_KEY = 'sb-csvfqdjuobylgafgolho-auth-token';
const EMAIL = 'kim@example.com';

const FONT_DIR = path.join(__dirname, '../../../fonts/pdf/');
const FONT_FILES = { 'anton.ttf': 'Anton-Regular.ttf', 'archivo4.ttf': 'Archivo-Regular.ttf', 'archivo6.ttf': 'Archivo-SemiBold.ttf', 'oswald.ttf': 'Oswald-Medium.ttf' };
const FONT_CSS = "@font-face{font-family:'Anton';src:url(https://fonts.gstatic.com/th/anton.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:100 500;src:url(https://fonts.gstatic.com/th/archivo4.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:501 900;src:url(https://fonts.gstatic.com/th/archivo6.ttf)}" +
  "@font-face{font-family:'Oswald';font-weight:100 900;src:url(https://fonts.gstatic.com/th/oswald.ttf)}";

// ---- Seed data (one client, relative dates so every run reads the same) --
// A fixed clock: Date.now() is pinned in the page (see FIXED_NOW below), so
// "In 3 days", "Requested Oct 28" and the warranty rings are identical on
// main and the branch however far apart the two runs are.
const FIXED_NOW = Date.parse('2026-10-31T16:00:00Z');
const day = (n) => new Date(FIXED_NOW + n * 864e5);
const d10 = (n) => day(n).toISOString().slice(0, 10);
const ts = (n, h) => { const d = day(n); d.setUTCHours(h == null ? 17 : h, 0, 0, 0); return d.toISOString(); };
const li = (description, quantity, rate) => ({ description, quantity, rate, amount: quantity * rate });

const ROWS = EMPTY ? {} : {
  client_profiles: [{ client_email: EMAIL, display_name: 'Kim Reyes', phone: '435-555-0103' }],
  client_portal_invoices: [
    { id: 501, source_invoice_id: 9001, client_email: EMAIL, client_name: 'Kim Reyes', invoice_number: 'INV-2026-0146', invoice_date: d10(-3), description: 'Dryer not heating: thermal fuse + labor', total: 312.5, paid: false, paid_at: null, stripe_payment_intent_id: null, line_items: [li('Thermal fuse', 1, 42.5), li('Labor', 2, 135)], created_at: ts(-3), updated_at: ts(-3) },
    { id: 502, source_invoice_id: 9002, client_email: EMAIL, client_name: 'Kim Reyes', invoice_number: 'INV-2026-0139', invoice_date: d10(-24), description: 'Hang 3 shelves + TV mount', total: 1180, paid: false, paid_at: null, stripe_payment_intent_id: null, line_items: [li('Shelving install', 3, 160), li('TV mount + cable concealment', 1, 700)], created_at: ts(-24), updated_at: ts(-24) },
    { id: 503, source_invoice_id: 9003, client_email: EMAIL, client_name: 'Kim Reyes', invoice_number: 'INV-2026-0121', invoice_date: d10(-60), description: 'Fridge ice maker valve', total: 285, paid: true, paid_at: ts(-55), stripe_payment_intent_id: 'pi_3TestPaid0121', line_items: [li('Ice maker valve', 1, 85), li('Labor', 2, 100)], created_at: ts(-60), updated_at: ts(-55) },
    { id: 504, source_invoice_id: 9004, client_email: EMAIL, client_name: 'Kim Reyes', invoice_number: 'INV-2026-0098', invoice_date: d10(-120), description: 'Washer drain pump', total: 246.75, paid: true, paid_at: ts(-118), stripe_payment_intent_id: null, line_items: [li('Drain pump', 1, 96.75), li('Labor', 1, 150)], created_at: ts(-120), updated_at: ts(-118) },
  ],
  client_portal_quotes: [
    { id: 601, source_quote_id: 9101, client_email: EMAIL, client_name: 'Kim Reyes', quote_number: 'Q-2031', quote_date: d10(-2), description: 'Replace kitchen faucet and garbage disposal', total: 640, line_items: [li('Faucet (client supplied)', 1, 0), li('Garbage disposal, 3/4 HP', 1, 240), li('Labor', 2.5, 160)], status: 'pending', responded_at: null, client_address: '9 Snow Canyon Pkwy, Ivins, UT', scheduled_at: null, decline_reason: null, created_at: ts(-2), updated_at: ts(-2) },
    { id: 602, source_quote_id: 9102, client_email: EMAIL, client_name: 'Kim Reyes', quote_number: 'Q-2019', quote_date: d10(-30), description: 'Hang 3 shelves + TV mount', total: 1180, line_items: [li('Shelving install', 3, 160), li('TV mount + cable concealment', 1, 700)], status: 'approved', responded_at: ts(-29), client_address: '9 Snow Canyon Pkwy, Ivins, UT', scheduled_at: ts(-25), decline_reason: null, created_at: ts(-30), updated_at: ts(-29) },
  ],
  quote_questions: [],
  client_portal_jobs: [
    { id: 701, source_job_id: 103, client_email: EMAIL, client_name: 'Kim Reyes', title: 'Dryer not heating', job_date: d10(-3), photo_storage_paths: null, created_at: ts(-3), updated_at: ts(-3) },
    { id: 702, source_job_id: 98, client_email: EMAIL, client_name: 'Kim Reyes', title: 'Hang 3 shelves + TV mount', job_date: d10(-25), photo_storage_paths: null, created_at: ts(-25), updated_at: ts(-25) },
    { id: 703, source_job_id: 77, client_email: EMAIL, client_name: 'Kim Reyes', title: 'Fridge ice maker valve', job_date: d10(-60), photo_storage_paths: null, created_at: ts(-60), updated_at: ts(-60) },
  ],
  client_portal_job_messages: [
    { id: 801, job_id: 701, sender_type: 'internal', sender_email: 'steve@triplehenterprisesllc.biz', message: 'All done. The fuse was the culprit; vent line looked clean too.', created_at: ts(-3, 22) },
  ],
  client_portal_checkups: [
    { id: 901, source_template_id: 3, client_email: EMAIL, client_name: 'Kim Reyes', title: 'Dryer vent cleaning', interval_months: 12, last_created_date: d10(-340), created_at: ts(-400), updated_at: ts(-340) },
  ],
  client_portal_work_orders: [
    { id: 1001, client_email: EMAIL, client_name: 'Kim Reyes', title: 'Garage door opener is noisy', description: 'Grinding noise on open, started last week.', urgency: 'soon', preferred_timing: 'Weekday mornings', address: '9 Snow Canyon Pkwy, Ivins, UT', phone: '435-555-0103', photo_storage_paths: null, status: 'scheduled', scheduled_at: ts(3, 16), linked_quote_id: null, linked_job_id: null, created_at: ts(-4), updated_at: ts(-1) },
    { id: 1002, client_email: EMAIL, client_name: 'Kim Reyes', title: 'Bathroom fan replacement', description: 'Fan hums but does not spin.', urgency: 'normal', preferred_timing: null, address: '9 Snow Canyon Pkwy, Ivins, UT', phone: '435-555-0103', photo_storage_paths: null, status: 'submitted', scheduled_at: null, linked_quote_id: null, linked_job_id: null, created_at: ts(-1), updated_at: ts(-1) },
  ],
  client_portal_work_order_messages: [
    { id: 1101, work_order_id: 1001, sender_type: 'internal', sender_email: 'steve@triplehenterprisesllc.biz', message: 'Got it. I have you down for Tuesday morning.', created_at: ts(-1, 15) },
  ],
  client_portal_contracts: [
    { id: 1201, source_contract_id: 9201, client_email: EMAIL, client_name: 'Kim Reyes', contract_type: 'pwo', contract_title: 'Project work order: kitchen faucet + disposal', blocks: [
      { type: 'heading', text: 'Project work order', sub: 'Triple H Enterprises LLC' },
      { type: 'field', label: 'Client', value: 'Kim Reyes' },
      { type: 'field', label: 'Service address', value: '9 Snow Canyon Pkwy, Ivins, UT' },
      { type: 'field', label: 'Scheduled date', value: 'Week of Nov 9' },
      { type: 'sectionLabel', text: 'Scope of work' },
      { type: 'paragraph', text: 'Remove the existing garbage disposal and install a new 3/4 HP unit. Install the client-supplied faucet. Test for leaks.' },
      { type: 'totalHighlight', label: 'Total price', value: '$640.00' },
      { type: 'field', label: 'Payment terms', value: 'Balance due on completion' },
      { type: 'footnote', text: 'Signing confirms you have read and agree to this work order.' },
    ], business_signature_data_url: null, client_signature_data_url: null, status: 'pending', responded_at: null, created_at: ts(-2), updated_at: ts(-2) },
    { id: 1202, source_contract_id: 9202, client_email: EMAIL, client_name: 'Kim Reyes', contract_type: 'pwo', contract_title: 'Project work order: shelves + TV mount', blocks: [
      { type: 'heading', text: 'Project work order' },
      { type: 'totalHighlight', label: 'Total price', value: '$1,180.00' },
    ], business_signature_data_url: null, client_signature_data_url: null, status: 'signed', responded_at: ts(-29), created_at: ts(-30), updated_at: ts(-29) },
  ],
  client_notification_preferences: [],
  card_authorizations: [],
};

const RPC = {
  get_my_portal_visits: EMPTY ? [] : [
    { id: 41, status: 'confirmed', start_at: ts(9, 16), end_at: ts(9, 18), service_label: 'Kitchen faucet + disposal', visit_kind: 'quote', quote_id: 601, address: '9 Snow Canyon Pkwy, Ivins, UT', manage_token: 'tok_demo_41' },
  ],
  get_portal_unread_counts: EMPTY ? [] : [
    { thread_type: 'work_order', thread_id: 1001, unread_count: 1, latest_unread_at: ts(-1, 15), message: 'Got it. I have you down for Tuesday morning.' },
  ],
  mark_portal_thread_read: null,
};

// Edge functions: canned answers. The payment intents ask for a signature
// first (a client's first saved card), then hand back a client secret --
// the same two-step path a real first payment takes.
function functionAnswer(name, body) {
  switch (name) {
    case 'create-payment-intent':
    case 'create-bulk-payment-intent':
      return body && body.signer_name ? { ok: true, client_secret: 'pi_demo_secret_demo' } : { ok: false, needs_signature: true };
    case 'ensure-my-referral-code': return { ok: true, code: 'KIMR25', referral_code: 'KIMR25' };
    case 'manage-saved-card': return { ok: true, card: null, cards: [] };
    case 'get-job-photo-urls': return { ok: true, urls: [] };
    default: return { ok: true };
  }
}

// ---- Session ---------------------------------------------------------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessionJson() {
  const exp = 9999999999;
  const access = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ iss: SB + '/auth/v1', sub: 'user-kim', aud: 'authenticated', role: 'authenticated', email: EMAIL, aal: 'aal1', amr: [{ method: 'password', timestamp: 1 }], session_id: 's1', iat: 1, exp }), 'sig'].join('.');
  return JSON.stringify({ access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r1',
    user: { id: 'user-kim', aud: 'authenticated', role: 'authenticated', email: EMAIL, factors: [], app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
}

// ---- Static server -----------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function startServer(root) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}

// ---- Stripe mock -------------------------------------------------------------
const STRIPE_MOCK = `
window.__stripeCalls = [];
window.Stripe = function (key) {
  window.__stripeCalls.push({ fn: 'Stripe', key: String(key).slice(0, 8) });
  return {
    elements: function (opts) {
      window.__stripeCalls.push({ fn: 'elements', clientSecret: opts && opts.clientSecret });
      return { create: function (type) {
        window.__stripeCalls.push({ fn: 'create', type: type });
        return { on: function () {}, unmount: function () {}, destroy: function () {},
          mount: function (sel) {
            var el = typeof sel === 'string' ? document.querySelector(sel) : sel;
            window.__stripeCalls.push({ fn: 'mount', sel: String(sel), found: !!el });
            if (el) el.innerHTML = '<div data-stripe-mock style="height:190px;border:1px solid #444;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#aaa;font:14px system-ui">[Stripe Payment Element]</div>';
          } };
      } };
    },
    confirmPayment: function (o) {
      window.__stripeCalls.push({ fn: 'confirmPayment', redirect: o && o.redirect, hasElements: !!(o && o.elements) });
      return Promise.resolve({ paymentIntent: { status: 'succeeded', amount: window.__stripeAmount || 31250 } });
    },
  };
};`;

// ---- Context setup -------------------------------------------------------------
// Returns { ctx, log, control } where log collects every write/edge call in
// order and control.fail switches PostgREST reads to failing and back.
async function newContext(browser, opts) {
  opts = opts || {};
  const control = { fail: opts.fail != null ? !!opts.fail : !!process.env.FAIL, reads: 0 };
  const vp = opts.viewport || { width: 390, height: 844 };
  const touch = vp.width < 1024;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: opts.dpr || 2, isMobile: touch, hasTouch: touch, colorScheme: opts.colorScheme || 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const log = [];
  const signedIn = opts.signedIn !== false;
  await ctx.addInitScript(({ key, value, signedIn, fixed }) => {
    // Pin the clock so relative dates match across runs.
    const RealDate = Date;
    const offset = fixed - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); } static now() { return RealDate.now() + offset; } };
    try {
      if (signedIn && !localStorage.getItem('__seeded')) { localStorage.setItem(key, value); localStorage.setItem('__seeded', '1'); }
      // One-time page tips off, so first-visit hints don't vary by run.
      localStorage.setItem('th_portal_install_dismissed', '1');
    } catch (e) { /* ignore */ }
  }, { key: STORAGE_KEY, value: sessionJson(), signedIn, fixed: FIXED_NOW });

  if (UMD) {
    const body = fs.readFileSync(UMD);
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body, headers: { 'access-control-allow-origin': '*' } }));
  }
  if (JSPDF_UMD) {
    const pdf = fs.readFileSync(JSPDF_UMD);
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: pdf, headers: { 'access-control-allow-origin': '*' } }));
  }
  await ctx.route(/js\.stripe\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STRIPE_MOCK }));
  await ctx.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: REAL_FONTS ? FONT_CSS : '' }));
  await ctx.route(/fonts\.gstatic\.com/, (r) => {
    const f = FONT_FILES[r.request().url().split('/').pop()];
    if (REAL_FONTS && f) return r.fulfill({ status: 200, contentType: 'font/ttf', body: fs.readFileSync(path.join(FONT_DIR, f)), headers: { 'access-control-allow-origin': '*' } });
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.fulfill({ status: 200, body: '' }));

  await ctx.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    let body = null;
    try { body = req.postDataJSON(); } catch (e) { body = req.postData(); }
    const json = (status, data, headers) => route.fulfill({ status, contentType: 'application/json', headers: Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, headers || {}), body: data === undefined ? '' : JSON.stringify(data) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const p = url.pathname;
    if (p.startsWith('/auth/v1/')) {
      if (p.endsWith('/user')) return json(200, JSON.parse(sessionJson()).user);
      if (p.endsWith('/logout')) { log.push({ kind: 'auth', path: p }); return json(204); }
      log.push({ kind: 'auth', path: p, method });
      return json(200, {});
    }
    if (p.startsWith('/functions/v1/')) {
      const name = p.split('/').pop();
      log.push({ kind: 'fn', name, body: scrub(body) });
      return json(200, functionAnswer(name, body));
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.split('/').pop();
      if (name === 'mark_portal_thread_read') log.push({ kind: 'rpc', name, body: scrub(body) });
      return json(200, RPC[name] === undefined ? null : RPC[name]);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/').pop();
      if (method !== 'GET' && method !== 'HEAD') {
        log.push({ kind: 'write', method, table, query: url.search.replace(/[?&]select=[^&]*/, ''), body: scrub(body) });
        const rows = Array.isArray(body) ? body : [Object.assign({ id: 99000 + log.length }, body || {})];
        return json(201, rows);
      }
      control.reads++;
      if (control.fail) return json(500, { message: 'stub failure', code: 'XX000' });
      let rows = (ROWS[table] || []).slice();
      // Honour simple eq.* filters on columns the rows actually have, so a
      // thread fetch (work_order_id=eq.1001) gets only its own messages.
      for (const [k, v] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
        const m = /^eq\.(.*)$/.exec(v);
        if (m && rows.length && Object.prototype.hasOwnProperty.call(rows[0], k)) rows = rows.filter((r) => String(r[k]).toLowerCase() === m[1].toLowerCase());
      }
      const range = { 'content-range': '0-' + Math.max(rows.length - 1, 0) + '/' + rows.length };
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, range), body: '' });
      const accept = req.headers().accept || '';
      if (accept.includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows, range);
    }
    if (p.startsWith('/storage/v1/')) return json(200, {});
    return json(200, {});
  });
  return { ctx, log, control };
}

// Data URLs (drawn signatures) differ per stroke rendering; keep their kind.
function scrub(body) {
  if (!body || typeof body !== 'object') return body;
  const out = Array.isArray(body) ? [] : {};
  for (const [k, v] of Object.entries(body)) out[k] = typeof v === 'string' && v.startsWith('data:image') ? '<signature image>' : (v && typeof v === 'object' ? scrub(v) : v);
  return out;
}

const PAGES = ['home', 'dashboard', 'quotes', 'jobs', 'work-orders', 'contracts', 'settings', 'login', 'set-password'];

// ---- Audits ----------------------------------------------------------------------
// Every visible interactive element under 44x44 (coarse pointer). Inline
// links inside a prose line are reported but flagged, as in Phase 2.
const TARGET_AUDIT = () => {
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [onclick], summary, label[for]';
  const out = []; const seen = new Set();
  document.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return;
    if (el.closest('[hidden], [aria-hidden="true"]')) return;
    let p = el; while (p && p !== document.body) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return; p = p.parentElement; }
    // Inputs inside a label row, checkboxes/radios whose label is the row.
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.height >= 44) return; }
    if (r.width >= 44 && r.height >= 44) return;
    // ::after/::before hit areas: probe just outside the box.
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const probe = (x, y) => { const h = document.elementFromPoint(x, y); return h && (h === el || el.contains(h)); };
    const hitW = r.width >= 44 || (probe(cx - 22 + 1, cy) && probe(cx + 22 - 1, cy));
    const hitH = r.height >= 44 || (probe(cx, cy - 22 + 1) && probe(cx, cy + 22 - 1));
    if (hitW && hitH) return;
    const inlineProse = cs.display === 'inline' && el.tagName === 'A' && el.parentElement && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length + 20;
    const id = el.id ? '#' + el.id : '';
    const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    out.push({ el: el.tagName.toLowerCase() + id + cls, w: Math.round(r.width), h: Math.round(r.height), txt: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40), inlineProse, offscreen: r.bottom < 0 || r.top > innerHeight * 6 });
  });
  return out;
};

// The chrome checklist, measured on the portal's own components.
const CHROME_AUDIT = () => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const hdr = document.querySelector('.portal-header');
  const hr = hdr && hdr.getBoundingClientRect();
  const title = document.querySelector('.portal-header .portal-title');
  const kids = hdr ? [...hdr.querySelectorAll('.portal-kicker, .portal-title, .portal-icon-btn, .portal-back, .portal-status, a, button')].filter(vis) : [];
  const tops = [...new Set(kids.filter((k) => !k.matches('.portal-kicker')).map((k) => Math.round(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2)))];
  const header = hdr ? {
    top: Math.round(hr.top), h: Math.round(hr.height), padTop: getComputedStyle(hdr).paddingTop, position: getComputedStyle(hdr).position,
    title: title ? { text: title.textContent.trim(), clipped: title.scrollWidth > title.clientWidth + 1, tt: getComputedStyle(title).textTransform, size: getComputedStyle(title).fontSize } : null,
    buttons: [...hdr.querySelectorAll('a, button, .portal-status')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), cls: b.className, x: Math.round(r.left), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; }),
    centres: tops,
    status: (() => { const s = document.querySelector('.portal-status'); return s && vis(s) ? { cls: s.className, label: s.getAttribute('aria-label') } : null; })(),
    note: (() => { const n = document.getElementById('portalSyncNote'); return n ? { text: n.textContent.trim(), shown: vis(n) } : null; })(),
  } : null;
  const segs = [...document.querySelectorAll('[role="tablist"], .seg, .portal-seg, .segmented, .wo-urgency-seg, .urgency-options, .set-seg')].filter(vis).map((seg) => {
    const parent = seg.parentElement; const ps = getComputedStyle(parent);
    const inner = parent.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    return { cls: seg.className, w: Math.round(seg.getBoundingClientRect().width), parentInner: Math.round(inner), segs: [...seg.children].filter(vis).map((c) => ({ t: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 24), w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) })) };
  });
  const caps = [];
  document.querySelectorAll('h1,h2,h3,h4,button,a,label,summary,[class*="title"],[class*="btn"],[class*="label"],[class*="kicker"],[class*="head"],[class*="chip"],[class*="pill"],[class*="tab"]').forEach((el) => {
    if (!vis(el) || el.closest('.portal-nav, .portal-rail')) return;
    const s = getComputedStyle(el);
    if (s.textTransform !== 'uppercase') return;
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length < 2) return;
    caps.push({ el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''), t: t.slice(0, 40), size: s.fontSize, ls: s.letterSpacing });
  });
  const primaries = [...document.querySelectorAll('.btn.orange, .primary-btn, .btn-primary, a.primary, .pay-first-btn, .schedule-cta')].filter(vis).map((b) => { const s = getComputedStyle(b); return { t: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 30), shadow: s.boxShadow, weight: s.fontWeight, tt: s.textTransform, border: s.borderTopWidth, font: s.fontFamily.split(',')[0] }; });
  const chips = [...document.querySelectorAll('[class*="chip"], [class*="filter"] button')].filter(vis).filter((c) => c.matches('button, a, [role="button"], label')).slice(0, 16).map((c) => { const s = getComputedStyle(c); const r = c.getBoundingClientRect(); return { t: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 20), cls: c.className, h: Math.round(r.height), font: s.fontFamily.split(',')[0] + ' ' + s.fontSize + '/' + s.fontWeight, radius: s.borderTopLeftRadius, tt: s.textTransform }; });
  const nav = document.querySelector('.portal-nav');
  const nr = nav && vis(nav) ? nav.getBoundingClientRect() : null;
  return { header, segs, caps, primaries, chips, nav: nr ? { top: Math.round(nr.top), h: Math.round(nr.height), padBottom: getComputedStyle(nav).paddingBottom } : null };
};

const OVERFLOW = () => {
  const w = document.documentElement.clientWidth;
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const wide = [];
  if (sw > w + 1) document.querySelectorAll('body *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > w + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed') wide.push((el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : '')).slice(0, 50) + ' ' + Math.round(r.right)); });
  return { w, sw, over: sw > w + 1, wide: wide.slice(0, 8) };
};

// The data/wiring fingerprint. Money and counts a client reads must be
// byte-identical to main; wiring (ids, onclick, href) is reported so any
// change is visible and explained.
const FINGERPRINT = () => {
  const money = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || el.closest('script, style, [hidden]')) continue;
    const t = n.textContent.replace(/\s+/g, ' ');
    const m = t.match(/\$\s?[\d,]+(\.\d\d)?|\b\d+ (unpaid|invoices?|estimates?|visits?|days?|new|paid|requests?|contracts?)\b/gi);
    if (m) money.push(...m.map((s) => s.trim()));
  }
  const wiring = [];
  document.querySelectorAll('[id], [onclick], a[href], form[action], [data-tab]').forEach((el) => {
    if (el.closest('script, style')) return;
    wiring.push([el.tagName.toLowerCase(), el.id || '', el.getAttribute('onclick') || '', el.getAttribute('href') || '', el.getAttribute('data-tab') || ''].join('|'));
  });
  return { money, wiring };
};

async function launch() {
  const { chromium } = require(PW);
  return chromium.launch({ args: ['--font-render-hinting=none'] });
}

async function settle(page, ms) {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(ms || 1400);
  if (REAL_FONTS) await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
}

module.exports = { startServer, newContext, launch, settle, PAGES, TARGET_AUDIT, CHROME_AUDIT, OVERFLOW, FINGERPRINT, ROWS, EMAIL, STORAGE_KEY, FIXED_NOW, EMPTY, REAL_FONTS };
