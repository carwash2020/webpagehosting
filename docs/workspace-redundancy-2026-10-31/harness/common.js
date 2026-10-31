// Shared by shoot.js and verify.js for the Workspace redundancy pass
// (2026-10-31, 19 Connor-approved items). Dev-only; nothing loads this.
//
// Same approach as Phase 2/3 (docs/workspace-phase2-native-app-2026-10-30/
// harness/, docs/workspace-phase3-money-2026-10-30/harness/): every
// supabase.co request is answered locally, the pages run their own code
// against seeded localStorage, and Phase 2's live-stub.js (required, not
// copied) answers the Realtime join when SUPABASE_UMD is set.
// REAL_FONTS=1 serves the repo's own fonts/pdf/ copies of Anton / Archivo /
// Oswald for the blocked Google Fonts request, as Phase 3 round 2 does.
// OWNER_LIMITED=1 signs in as an Owner without "Dev Tools (full technical)"
// (Steve's account) instead of the all-permissions role.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');
const { installLiveStub } = require('../../workspace-phase2-native-app-2026-10-30/harness/live-stub');

const REPO = path.join(__dirname, '../../..');
const REAL_FONTS = !!process.env.REAL_FONTS;
const FONT_DIR = path.join(REPO, 'fonts/pdf/');
const FONT_FILES = { 'anton.ttf': 'Anton-Regular.ttf', 'archivo4.ttf': 'Archivo-Regular.ttf', 'archivo6.ttf': 'Archivo-SemiBold.ttf', 'oswald.ttf': 'Oswald-Medium.ttf' };
const FONT_CSS = "@font-face{font-family:'Anton';src:url(https://fonts.gstatic.com/th/anton.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:100 500;src:url(https://fonts.gstatic.com/th/archivo4.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:501 900;src:url(https://fonts.gstatic.com/th/archivo6.ttf)}" +
  "@font-face{font-family:'Oswald';font-weight:100 900;src:url(https://fonts.gstatic.com/th/oswald.ttf)}";
const PHOTO = fs.readFileSync(path.join(REPO, 'images/gallery/curtain-track-installation.webp'));
const PHOTO2 = fs.readFileSync(path.join(REPO, 'images/gallery/baseboard-detail-1.webp'));

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const now = Date.now();

const jobs = [
  { id: 101, title: 'Dryer not heating', client: 'Maria Lopez', phone: '435-555-0101', address: '123 Red Cliffs Dr, St. George, UT', priority: 'high', date: addDays(0), status: 'in-progress', hoursWorked: 1.5, showOnCalendar: true },
  { id: 102, title: 'Dishwasher leak', client: 'Dan Ortiz', phone: '435-555-0102', address: '88 Bluff St, St. George, UT', priority: 'medium', date: addDays(0), status: 'not-started', showOnCalendar: true },
  { id: 107, title: 'Range hood fan', client: 'Lia Chen', phone: '435-555-0107', address: '5 Sunset Blvd, St. George, UT', priority: 'low', date: addDays(0), status: 'not-started', showOnCalendar: true },
  { id: 103, title: 'Hang 3 shelves + TV mount', client: 'Kim Reyes', phone: '435-555-0103', address: '9 Snow Canyon Pkwy, Ivins, UT', priority: 'low', date: addDays(1), status: 'not-started', showOnCalendar: true },
  { id: 104, title: 'Fridge ice maker', client: 'Greg Hall', phone: '435-555-0104', address: '410 Telegraph St, Washington, UT', priority: 'medium', date: addDays(-2), status: 'done', hoursWorked: 2, statusChangedAt: new Date(now - 2 * 864e5).toISOString(), showOnCalendar: true },
  { id: 108, title: 'Water heater relight', client: 'Dana Fox', phone: '435-555-0108', address: '2 Canyon View Dr, St. George, UT', priority: 'low', date: addDays(-4), status: 'done', statusChangedAt: new Date(now - 4 * 864e5).toISOString(), showOnCalendar: true },
  { id: 106, title: 'Garbage disposal swap', client: 'Tom Ruiz', phone: '435-555-0106', address: '12 Main St, Hurricane, UT', priority: 'medium', date: addDays(-1), status: 'done', statusChangedAt: new Date(now - 864e5).toISOString(), showOnCalendar: true },
];
const inv = (k, client, total, days, extra) => Object.assign({ id: now - k * 1000, invoiceNumber: 'INV-10' + (40 + k), clientName: client, total, subtotal: total, tax: 0, date: addDays(days), terms: 'Net 15', paid: false, lineItems: [{ description: 'Repair', qty: 1, rate: total, amount: total }] }, extra || {});
const invoices = [
  inv(1, 'Preferred Property Mgmt', 1180, -40),
  inv(2, 'Maria Lopez', 312.5, -1, { jobRefId: '101' }),
  inv(3, 'Kim Reyes', 640, -5, { paidAmount: 200, terms: 'Net 30' }),
  inv(4, 'Ana Smith', 410, -20),
  inv(5, 'Bill Adams', 285, -3),
  inv(6, 'Jen Park', 160, -2),
  inv(7, 'Sam Ortiz', 95, -9, { terms: 'Net 30' }),
  inv(8, 'Greg Hall', 285, -20, { paid: true, paidAmount: 285, jobRefId: '104' }),
];
const invoiceRows = invoices.map((i) => ({ id: i.id, invoice_number: i.invoiceNumber, client_name: i.clientName, client_email: null, invoice_date: i.date, terms: i.terms, invoice_type: 'standard', subtotal: i.subtotal, tax: i.tax, discount: 0, total: i.total, paid: !!i.paid, paid_amount: i.paidAmount ?? null, job_id: i.jobRefId || null, job_ref_title: null, source_quote_id: null, generated_by: null }));
const quotes = [{ id: now - 1500, quoteNumber: 'Q-2031', clientName: 'Ana Smith', clientEmail: 'ana@example.com', date: addDays(-2), subtotal: 410, tax: 0, discount: 0, total: 410 }];
const income = [
  { id: now - 100, date: addDays(-20), desc: 'INV-1048 Greg Hall', amount: 285, source: 'Greg Hall', origin: 'invoice', invoiceId: now - 8000 },
  { id: now - 200, date: addDays(-3), desc: 'Cash job, garbage disposal', amount: 150, source: 'Tom Ruiz', origin: 'manual', jobRefId: '106' },
];
const expenses = [
  { id: now - 10, date: addDays(-1), type: 'expense', desc: 'Thermal fuse', vendor: 'Reliable Parts', payment: 'card', amount: 18.42, miles: 0, jobRefId: '101', jobRefTitle: 'Dryer not heating', receiptPath: '', partNumber: '3392519' },
  { id: now - 30, date: addDays(-2), type: 'mileage', desc: 'Washington + Ivins', vendor: '', payment: '', amount: 26.13, miles: 39, jobRefId: '', jobRefTitle: '', receiptPath: '', partNumber: '' },
];
const contacts = [
  { id: 1, name: 'Ray Bice', role: 'Glamour Works - appliance parts', phone: '435-674-7477', email: '', notes: '' },
  { id: 2, name: 'Desert Supply', role: 'Plumbing parts', phone: '435-555-0190', email: 'orders@example.com', notes: '' },
];
const seed = {
  th_tracker_jobs: jobs, th_invoices: invoices, th_quotes: quotes, th_income_log: income, th_expense_log: expenses,
  th_tracker_contacts: contacts, th_inventory: [{ id: 1, name: 'Dryer thermal fuse', qty: 3 }],
  th_price_reference: [{ id: 1, label: 'Dishwasher install', hours: 2, rate: 85 }],
  th_setaside_rate: 25, 'rd_budget-settings': { savingsPct: 20, taxSetAsideRate: 30 },
  'rd_business-months': [{ month: addDays(-35).slice(0, 7), revenue: 3200, expenses: 400, fuel: 120, other: 0, draws: 1500, cash: 4200 }],
};

const ownerLimited = !!process.env.OWNER_LIMITED;
const roleRow = [{ email: 'connor@triplehenterprisesllc.biz', role_name: 'Owner', can_manage_roles: !ownerLimited, can_access_dev_tools: true, can_access_dev_tools_full: !ownerLimited, can_manage_site_content: true, can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true }];
const photos = [
  { id: 11, job_id: 104, storage_path: 'job-104/a.webp', photo_type: 'before', featured: true, public_caption: 'Fridge ice maker, before', job_title: 'Fridge ice maker' },
  { id: 12, job_id: 104, storage_path: 'job-104/b.webp', photo_type: 'after', featured: true, public_caption: 'Fridge ice maker, after', job_title: 'Fridge ice maker' },
  { id: 13, job_id: 106, storage_path: 'job-106/c.webp', photo_type: 'photo', featured: true, public_caption: 'Curtain track install', job_title: 'Garbage disposal swap' },
];
const workOrders = [
  { id: 501, client_email: 'ana@example.com', client_name: 'Ana Smith', title: 'Washer won\'t drain', description: 'Standing water after cycle.', urgency: 'soon', preferred_timing: 'Weekday mornings', status: 'submitted', photo_storage_paths: [], created_at: new Date(now - 864e5).toISOString() },
];
const bugReports = [{ id: 1, message: 'The pay button did nothing on my phone.', client_email: 'ana@example.com', page_url: '/portal/invoices.html', resolved: false, created_at: new Date(now - 3600e3).toISOString() }];
const clientErrors = [{ id: 1, message: 'TypeError: x is undefined', client_email: null, page_url: '/portal/login.html', source: 'portal-app.js', line: 212, created_at: new Date(now - 7200e3).toISOString() }];

function fakeJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b({ alg: 'HS256' }) + '.' + b({ aal: 'aal2', email: 'connor@triplehenterprisesllc.biz', exp: 9999999999 }) + '.sig';
}

async function newContext(browser, base, opts) {
  const { width = 390, height = 844, theme = 'dark', touch = true, role = null } = opts || {};
  // opts.role (rebase round, 2026-10-31): fields merged over the signed-in
  // role, e.g. { can_manage_invoices: false } for the #cost redirect's
  // stay-on-Finance path.
  const roleRows = role ? [Object.assign({}, roleRow[0], role)] : roleRow;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 2 : 1, colorScheme: theme, isMobile: !!touch, hasTouch: !!touch, serviceWorkers: 'block' });
  await ctx.addInitScript(({ seed, jwt, theme }) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      const sess = { access_token: jwt, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, email: 'connor@triplehenterprisesllc.biz', remember_until: Date.now() + 864e5 };
      localStorage.setItem('th_auth_session', JSON.stringify(sess));
      Object.keys(seed).forEach((k) => localStorage.setItem(k, typeof seed[k] === 'string' ? seed[k] : JSON.stringify(seed[k])));
      localStorage.setItem('th_tools_theme', theme);
      localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1');
      localStorage.setItem('th_onboarding_v1_seen', '1');
      sessionStorage.setItem('th_mfa_nag_dismissed', '1');
      localStorage.setItem('th_onboarding_dismissed', '1');
      localStorage.setItem('th_install_dismissed', String(Date.now()));
      // One-time page tips off, so shots show the page itself.
      ['jobs', 'money', 'invoices', 'clients', 'calendar', 'settings', 'workspace'].forEach((k) => localStorage.setItem('th_tip_' + k, '1'));
    } catch (e) { /* ignore */ }
  }, { seed, jwt: fakeJwt(), theme });
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (REAL_FONTS && /fonts\.googleapis\.com\/css/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: FONT_CSS });
    if (REAL_FONTS && /fonts\.gstatic\.com\/th\//.test(u)) return route.fulfill({ status: 200, contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(FONT_DIR + FONT_FILES[u.split('/').pop()]) });
    if (/supabase\.co/.test(u)) {
      if (/account_roles/.test(u)) return json(route, roleRows);
      if (/rpc\/internal_mfa_session_status/.test(u)) return json(route, { blocked: false });
      if (/\/storage\/v1\/object\/sign\/job-photos\//.test(u) && route.request().method() === 'POST') return json(route, { signedURL: '/object/sign/job-photos/' + u.split('/job-photos/')[1] + '?token=t' });
      if (/\/storage\/v1\/object\/sign\/job-photos\//.test(u)) return route.fulfill({ status: 200, contentType: 'image/webp', headers: { 'access-control-allow-origin': '*' }, body: /c\.webp/.test(u) ? PHOTO : PHOTO2 });
      if (/th_job_photos\?featured=eq\.true/.test(u)) return json(route, photos);
      if (/internal_read_client_portal_work_orders/.test(u)) return json(route, workOrders);
      if (/portal_bug_reports/.test(u)) return json(route, bugReports);
      if (/portal_client_errors/.test(u)) return json(route, clientErrors);
      if (/\/rest\/v1\/invoices\?/.test(u)) return json(route, invoiceRows);
      return json(route, []);
    }
    return route.abort();
  });
  await installLiveStub(ctx);
  return ctx;
}

async function launch() {
  return chromium.launch({ executablePath: process.env.CHROME || undefined });
}

module.exports = { launch, newContext, REPO, seed, jobs, invoices };
