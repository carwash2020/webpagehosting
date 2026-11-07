// Phase 5 screens (2026-11-04; approved designs "Insights: source -> paid,
// and the website" and "A lead becomes a job and keeps its source"). Runs the
// shipped code in jsdom: js/utm-tracking.js, tools/data-layer.js's source
// labels, the Jobs form's Make a job / Came from code from job-tracker.html,
// and the Dashboard's Insights cards from workspace.html, with the network
// stubbed. Made-up people only; nothing is sent anywhere.
//
// What is proved:
//   - the public site keeps the first outside site that sent a visitor (host
//     only, first touch) and hands over the Google Analytics visit ID ONLY
//     when the visitor accepted analytics cookies;
//   - the staff-side labels match the database's insights_channel() cases;
//   - Make a job fills the usual form from the lead, saving copies the lead's
//     source to the job and links the lead to it; a hand-made job takes the
//     Came from picker; an edit never rewrites a source copied from a lead;
//   - a booking turned into a job keeps the booking's source;
//   - Insights shows the funnel and By source for the chosen period, money
//     only for finance accounts, and the website card from the daily copy,
//     with an honest empty state until the first Google Analytics update.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const UTM = fs.readFileSync(repo('js', 'utm-tracking.js'), 'utf8');
const DL = fs.readFileSync(repo('tools', 'data-layer.js'), 'utf8');
const JT = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
const WS = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const SYNC = fs.readFileSync(repo('tools', 'sync.js'), 'utf8');
const ESC = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i > -1, a); const j = src.indexOf(b, i); assert.ok(j > -1, b); return src.slice(i, j); };

// ------------------------------------------------------------ public site
function site({ url = 'https://www.triplehenterprisesllc.biz/', referrer = '', consent = null, gaCookie = null, before } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', Object.assign({ url, runScripts: 'outside-only' }, referrer ? { referrer } : {}));
  const w = dom.window;
  if (consent) w.localStorage.setItem('th-cookie-consent', consent);
  if (gaCookie) w.document.cookie = '_ga=' + gaCookie + '; path=/';
  if (before) before(w);
  w.eval(UTM);
  return w;
}

test('the first outside site that sent the visitor is kept (host only, first touch); our own site and a later referrer never replace it', () => {
  // (consent 'granted': kept in localStorage; without it, tab-only -- RP2.16, utm-lead-tracking.test.js)
  let w = site({ consent: 'granted', referrer: 'https://www.google.com/search?q=dryer+repair+st+george' });
  assert.deepEqual(JSON.parse(JSON.stringify(w.getStoredAttributionExtras())), { landing_referrer: 'www.google.com', ga_client_id: null });
  assert.doesNotMatch(w.localStorage.getItem('th_first_referrer'), /dryer|search/, 'never the search terms or path');
  const kept = w.localStorage.getItem('th_first_referrer');
  w = site({ consent: 'granted', referrer: 'https://m.facebook.com/', before: (x) => x.localStorage.setItem('th_first_referrer', kept) });
  assert.equal(w.getStoredAttributionExtras().landing_referrer, 'www.google.com');
  w = site({ referrer: 'https://www.triplehenterprisesllc.biz/our-work.html' });
  assert.equal(w.getStoredAttributionExtras().landing_referrer, null);
  w = site({ before: (x) => x.localStorage.setItem('th_first_referrer', JSON.stringify({ host: 'www.bing.com', captured_at: Date.now() - 91 * 86400000 })) });
  assert.equal(w.getStoredAttributionExtras().landing_referrer, null, 'past 90 days it no longer counts');
});

test('the Google Analytics visit ID is handed over only when the visitor accepted analytics cookies', () => {
  const cookie = 'GA1.1.1234567890.1700000000';
  assert.equal(site({ consent: 'granted', gaCookie: cookie }).getStoredAttributionExtras().ga_client_id, '1234567890.1700000000');
  assert.equal(site({ consent: 'denied', gaCookie: cookie }).getStoredAttributionExtras().ga_client_id, null);
  assert.equal(site({ gaCookie: cookie }).getStoredAttributionExtras().ga_client_id, null, 'no choice yet means no');
  assert.equal(site({ consent: 'granted' }).getStoredAttributionExtras().ga_client_id, null, 'no GA cookie, nothing');
  assert.equal(site({ consent: 'granted', gaCookie: 'GA1.1.abc.def' }).getStoredAttributionExtras().ga_client_id, null, 'junk is dropped');
});

test('both public forms send it with the lead / booking, next to the UTM values', () => {
  const idx = fs.readFileSync(repo('index.html'), 'utf8');
  const bk = fs.readFileSync(repo('booking.html'), 'utf8');
  assert.match(idx, /window\.getStoredUtmParams\(\)\) \|\| \{\},\s*\(typeof window\.getStoredAttributionExtras === 'function' && window\.getStoredAttributionExtras\(\)\) \|\| \{\}\)\]\),/);
  assert.match(bk, /window\.getStoredUtmParams\(\)\) \|\| \{\},\s*\(typeof window\.getStoredAttributionExtras === 'function' && window\.getStoredAttributionExtras\(\)\) \|\| \{\}\);\s*\n\s*submitBooking\(bookingPayload\)/);
});

// ------------------------------------------------------------ labels
function dl() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/', runScripts: 'outside-only' });
  dom.window.eval(DL + ';Object.assign(window, { thChannelLabel, thCameFrom, thJobAttributionFrom, TH_SOURCE_CHOICES });');
  return dom.window;
}

test('staff-side source labels match the database (same cases as insights_channel in phase5-attribution-db.test.js)', () => {
  const w = dl();
  const L = (source, utm_source, utm_medium, utm_campaign, referred_by, landing_referrer) => w.thChannelLabel({ source, utm_source, utm_medium, utm_campaign, referred_by, landing_referrer });
  assert.equal(L('Google Search'), 'Google search');
  assert.equal(L(null, null, null, null, null, 'www.google.com'), 'Google search');
  assert.equal(L(null, 'google', 'organic', 'gbp', null, 'www.google.com'), 'Google Business');
  assert.equal(L('Google Search', 'google', 'cpc'), 'Google Ads');
  assert.equal(L(null, 'facebook', 'paid', 'spring-tuneup'), 'spring-tuneup');
  assert.equal(L('Referral (friend or family)'), 'Referral');
  assert.equal(L(null, null, null, 'spring-tuneup', 'Pat Neighbor'), 'Referral');
  assert.equal(L(null, null, null, null, null, 'm.facebook.com'), 'Social');
  assert.equal(L('Yelp / Online Reviews'), 'Yelp / Online Reviews');
  assert.equal(L(), 'Not known');
  // A job (camelCase) reads the same.
  assert.equal(w.thChannelLabel({ utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'spring-tuneup' }), 'spring-tuneup');
  assert.deepEqual(JSON.parse(JSON.stringify(w.thCameFrom({ utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'spring-tuneup' }))), { label: 'facebook', campaign: 'spring-tuneup', known: true }, 'chips: platform, then campaign');
  assert.equal(w.thCameFrom({}).known, false);
  assert.deepEqual(Array.from(w.TH_SOURCE_CHOICES), ['Google Search', 'Yelp / Online Reviews', 'Referral (friend or family)', 'Repeat Customer', 'Saw Our Vehicle or Sign', 'Social Media', 'Other'], 'the same choices as the public forms');
  const idx = fs.readFileSync(repo('index.html'), 'utf8');
  for (const c of w.TH_SOURCE_CHOICES) assert.ok(idx.includes('<option>' + c + '</option>'), c);
});

// ------------------------------------------------------------ Jobs form
const FORM = between(JT, '<div class="form-section is-collapsed" id="jobFormSection">', '<div class="form-section is-collapsed" id="templatesFormSection"');
const JT_CODE = between(JT, '  let jtFromLead = null;', '  function applyPresetClientFromUrl() {') +
  between(JT, '  async function addJob() {', '  function editJob(id) {') +
  between(JT, '  function editJob(id) {', '  // A completed job synced to the client portal');

function jobs({ stored = [], linkOk = true, lead = null, url = 'https://example.com/tools/job-tracker.html' } = {}) {
  const dom = new JSDOM('<!doctype html><body>' + FORM + '</body>', { url, runScripts: 'outside-only' });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  if (lead) w.sessionStorage.setItem('th_job_from_lead', JSON.stringify(lead));
  let rows = stored.slice();
  const st = { links: [], toasts: [], rows: () => rows };
  Object.assign(w, {
    escapeHtml: ESC, showAlert: async (m) => { throw new Error('alert: ' + m); }, showToast: (m) => st.toasts.push(m),
    thJobs: { all: () => rows.map((r) => ({ ...r })), get: (id) => rows.find((r) => r.id === id) || null, replaceAll: (r) => { rows = r; } },
    getCurrentUserEmail: () => 'owner@example.com', renderJobs() {}, toggleFormSection() {}, updateFirstTimeNudge() {},
    linkLeadToJob: async (id, jobId) => { st.links.push([id, jobId]); return linkOk ? { ok: true } : { ok: false, error: 'http-403' }; },
  });
  w.eval(DL + ';Object.assign(window, { thCameFrom, thJobAttributionFrom, TH_SOURCE_CHOICES });');
  w.eval('let editingJobId = null; let justAddedJobId = null; let presetClientId = null;' +
    'function isPlausiblePhone() { return true; }\n' + JT_CODE +
    '\nObject.assign(window, { jtApplyFromLead, jtShowCameFrom, addJob, editJob, cancelJobEdit, get jtFromLead() { return jtFromLead; } });');
  return { w, st, $: (id) => w.document.getElementById(id) };
}
const LEAD = {
  id: 77, name: 'Sample Client', phone: '(435) 555-0100', email: 'sample@example.com', service: 'Dryer repair',
  details: 'Makes a squeal', preferred_date: '2026-11-12', preferred_time: 'Morning', referred_by: '',
  source: 'Google Search', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'spring-tuneup', landing_referrer: 'm.facebook.com',
};

test('Make a job: the usual form opens filled from the lead, with "Came from" shown and the hand-made picker hidden', () => {
  const { w, $ } = jobs({ lead: LEAD });
  w.jtShowCameFrom(null);
  assert.equal(w.jtApplyFromLead(new w.URLSearchParams('fromLead=77')), true);
  assert.equal($('jobClient').value, 'Sample Client');
  assert.equal($('jobTitle').value, 'Dryer repair');
  assert.equal($('jobPhone').value, '(435) 555-0100');
  assert.equal($('jobClientEmail').value, 'sample@example.com');
  assert.equal($('jobDate').value, '2026-11-12');
  assert.equal($('jobNotes').value, 'Time: Morning\n\nMakes a squeal');
  assert.equal($('jobCameFrom').hidden, false);
  assert.equal($('jobCameFrom').textContent, 'Came from: facebook · spring-tuneup (from the lead)');
  assert.equal($('jobSourceRow').hidden, true);
});

test('saving it copies the lead\'s source onto the job, links the lead to the job, and forgets the hand-off', async () => {
  const { w, st, $ } = jobs({ lead: LEAD });
  w.jtShowCameFrom(null);
  w.jtApplyFromLead(new w.URLSearchParams('fromLead=77'));
  await w.addJob();
  const job = st.rows()[0];
  assert.equal(job.title, 'Dryer repair');
  assert.deepEqual([job.source, job.utmSource, job.utmMedium, job.utmCampaign, job.landingReferrer, job.sourceFrom],
    ['Google Search', 'facebook', 'paid', 'spring-tuneup', 'm.facebook.com', 'lead']);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(st.links, [[77, job.id]]);
  assert.equal(w.sessionStorage.getItem('th_job_from_lead'), null);
  assert.equal(w.jtFromLead, null);
  assert.equal($('jobCameFrom').hidden, true, 'the next job starts hand-made');
  assert.equal($('jobSourceRow').hidden, false);
});

test('if the lead can\'t be marked, the job still saves and the toast says the lead may still show', async () => {
  const { w, st } = jobs({ lead: LEAD, linkOk: false });
  w.jtShowCameFrom(null);
  w.jtApplyFromLead(new w.URLSearchParams('fromLead=77'));
  await w.addJob();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(st.rows().length, 1);
  assert.ok(st.toasts.some((t) => /lead couldn't be marked as done \(http-403\)/.test(t)), st.toasts.join(' | '));
});

test('a lead hand-off for a different lead is ignored, never mixed into the form', () => {
  const { w, $ } = jobs({ lead: LEAD });
  w.jtShowCameFrom(null);
  w.jtApplyFromLead(new w.URLSearchParams('fromLead=78'));
  assert.equal($('jobClient').value, '');
  assert.equal(w.jtFromLead, null);
});

test('a hand-made job takes the Came from picker; editing a job copied from a lead never rewrites its source', async () => {
  const { w, st, $ } = jobs();
  w.jtShowCameFrom(null);
  assert.deepEqual(Array.from($('jobSource').options, (o) => o.textContent)[0], 'Not known');
  $('jobTitle').value = 'Faucet swap';
  $('jobSource').value = 'Repeat Customer';
  await w.addJob();
  assert.equal(st.rows()[0].source, 'Repeat Customer');
  assert.equal(st.rows()[0].sourceFrom, undefined);

  const fromLead = { id: 5, title: 'Dryer repair', source: 'Google Search', utmCampaign: 'spring-tuneup', sourceFrom: 'lead' };
  const two = jobs({ stored: [fromLead] });
  two.w.jtShowCameFrom(null);
  two.w.editJob(5);
  assert.equal(two.$('jobSourceRow').hidden, true);
  assert.match(two.$('jobCameFrom').textContent, /^Came from: Google search · spring-tuneup \(from the lead\)$/);
  two.$('jobSource').value = 'Other';
  await two.w.addJob();
  assert.equal(two.st.rows()[0].source, 'Google Search');
  assert.equal(two.st.rows()[0].utmCampaign, 'spring-tuneup');
});

test('the Jobs mirror and read-back carry the source columns', () => {
  const mirror = between(SYNC, 'function mirrorJobsToRelational(jobs) {', 'function mirrorReferralCreated');
  assert.match(mirror, /source: j\.source \|\| null, utm_source: j\.utmSource \|\| null, utm_medium: j\.utmMedium \|\| null,\s*utm_campaign: j\.utmCampaign \|\| null, utm_term: j\.utmTerm \|\| null, utm_content: j\.utmContent \|\| null,\s*landing_referrer: j\.landingReferrer \|\| null,/);
  assert.match(SYNC, /source: r\.source, utmSource: r\.utm_source, utmMedium: r\.utm_medium, utmCampaign: r\.utm_campaign,\s*utmTerm: r\.utm_term, utmContent: r\.utm_content, landingReferrer: r\.landing_referrer,/);
  assert.match(SYNC, /body: JSON\.stringify\(\{ job_id: jobId, handled: true \}\),/);
});

// ------------------------------------------------------------ Dashboard
test('Needs attention: a lead without a job gets Make a job and its source chips; the hand-off goes to the Jobs form', () => {
  const tpl = between(WS, '    container.innerHTML = visibleLeads.map(l => `', '  // Make a job (Phase 5');
  assert.match(tpl, /\$\{l\.job_id \? '' : `<button class="lead-toggle-btn lead-make-job" data-make-job="\$\{l\.id\}" onclick="makeJobFromLead\(\$\{l\.id\}\)">Make a job<\/button>`\}/);
  assert.match(tpl, /\$\{leadSourceChipsHtml\(l\)\}/);
  const code = between(WS, '  function leadSourceChipsHtml(l) {', "  // A lead's, applicant's or booking's own words");
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/workspace.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.escapeHtml = ESC;
  w.eval(DL + ';window.thCameFrom = thCameFrom;');
  w.eval('let lastLoadedLeads = ' + JSON.stringify([LEAD]) + ';' + between(code, '  function leadSourceChipsHtml(l) {', '  // Make a job (Phase 5') + 'window.leadSourceChipsHtml = leadSourceChipsHtml;');
  assert.equal(w.leadSourceChipsHtml(LEAD), '<div class="lead-card-source"><span>From: facebook</span><span>spring-tuneup</span></div>');
  assert.equal(w.leadSourceChipsHtml({ name: 'x' }), '', 'nothing when nothing is known');
  assert.match(WS, /window\.location\.href = '\/tools\/job-tracker\.html\?fromLead=' \+ encodeURIComponent\(id\) \+ '#add-job';/);
  assert.match(WS, /sessionStorage\.setItem\(TH_JOB_FROM_LEAD_KEY, JSON\.stringify\(\{\s*id: lead\.id,/);
});

test('a booking turned into a job keeps the booking\'s source', () => {
  const fn = between(WS, '  async function convertBookingToJob(id) {', '  async function deleteBookingFromDashboard');
  assert.match(fn, /if \(typeof thJobAttributionFrom === 'function'\) Object\.assign\(newJob, thJobAttributionFrom\(booking\), \{ sourceFrom: 'booking' \}\);\s*jobs\.push\(newJob\);/);
});

const INS_MARKUP = between(WS, '      <div class="insights-card insights-card--funnel" id="insightsFunnelCard">', '    </div>\n  </div>\n</div>');
const INS_CODE = between(WS, '  // Phase 5 Insights. One period for both cards, kept on this device.', '  function renderTodayV2() {');
const REPORT = {
  sessions: 1240, calls: 41, bookings: 9,
  channels: [{ name: 'Google search', sessions: 700 }, { name: 'Direct', sessions: 300 }, { name: 'Google Business', sessions: 140 }, { name: 'Social', sessions: 100 }],
  pages: [{ path: '/', title: 'Home', views: 900 }, { path: '/booking.html', title: 'Book online', views: 200 }],
};
const FUNNEL = [
  { channel: 'Google search', leads: 6, jobs: 4, invoiced: 3, paid: 1250 },
  { channel: 'spring-tuneup', leads: 2, jobs: 1, invoiced: 1, paid: 300 },
  { channel: 'Not known', leads: 1, jobs: 2, invoiced: 2, paid: 80 },
];
function insights({ finance = true, report = REPORT, funnel = FUNNEL, saved = null } = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="insights-grid">' + INS_MARKUP + '</div></body>', { url: 'https://example.com/tools/workspace.html#insights', runScripts: 'outside-only' });
  const w = dom.window;
  if (saved) w.localStorage.setItem('th_insights_period', saved);
  const asked = [];
  Object.assign(w, {
    escapeHtml: ESC, escapeAttr: ESC, isSyncConfigured: () => true, anyFinanceAccessV2: () => finance,
    money: (n) => '$' + Number(n).toFixed(2),
    fetchInsightsFunnel: async (since) => { asked.push(['funnel', since]); return { ok: true, rows: funnel.map((r) => ({ ...r, paid: finance ? r.paid : null })) }; },
    fetchWebsiteReport: async (period) => { asked.push(['web', period]); return { ok: true, report, fetchedAt: report ? '2026-11-04T13:20:00Z' : null }; },
  });
  w.eval(INS_CODE + ';Object.assign(window, { renderInsightsFunnel, setInsPeriod });');
  return { w, asked, $: (id) => w.document.getElementById(id), text: (id) => w.document.getElementById(id).textContent.replace(/\s+/g, ' ').trim() };
}

test('Insights: the funnel and By source for the last 90 days by default, Not known last, money for finance accounts', async () => {
  const { w, asked, $, text } = insights();
  await w.renderInsightsFunnel();
  assert.deepEqual(asked.map((a) => a[0] === 'web' ? a : a[0]), ['funnel', ['web', '90d']]);
  const since = Date.parse(asked[0][1]);
  assert.ok(Math.abs(Date.now() - 90 * 86400000 - since) < 60000, '90 days back');
  assert.deepEqual(Array.from($('insFunnel').querySelectorAll('.ins-step'), (s) => s.textContent), ['1,240Visits', '9Leads & bookings', '7Jobs', '6Invoiced', '$1630.00Paid']);
  const rows = Array.from($('insBySource').querySelectorAll('.ins-row'), (r) => Array.from(r.children, (c) => c.textContent));
  assert.deepEqual(rows, [['Source', 'Leads', 'Jobs', 'Paid'], ['Google search', '6', '4', '$1250.00'], ['spring-tuneup', '2', '1', '$300.00'], ['Not known', '1', '2', '$80.00']]);
  assert.ok($('insBySource').querySelector('.ins-row:last-child').classList.contains('is-unknown'));
  assert.deepEqual(Array.from(w.document.querySelectorAll('[data-ins-period]'), (b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']);
});

test('Insights: the website card shows visits, calls tapped, bookings, where visits come from and top pages, and says where the numbers are from', async () => {
  const { w, $, text } = insights();
  await w.renderInsightsFunnel();
  assert.deepEqual(Array.from($('insWebBody').querySelectorAll('.ins-web-tile'), (t) => t.textContent), ['1,240Visits', '41Calls tapped', '9Bookings']);
  const lists = Array.from($('insWebBody').querySelectorAll('.ins-web-list'), (l) => Array.from(l.querySelectorAll('.ins-web-row'), (r) => r.textContent));
  assert.deepEqual(lists, [['Google search700', 'Direct300', 'Google Business140', 'Social100'], ['Home900', 'Book online200']]);
  assert.match(text('insWebNote'), /^From Google Analytics, refreshed once a day · updated Nov \d+\. Visitors who declined cookies aren't counted here\.$/);
  assert.equal(text('insWebPeriod'), 'last 90 days');
});

test('Insights: without finance access the Paid step and column are left out; the period switch is remembered on this device', async () => {
  const { w, asked, $ } = insights({ finance: false });
  await w.renderInsightsFunnel();
  assert.deepEqual(Array.from($('insFunnel').querySelectorAll('.ins-step span'), (s) => s.textContent), ['Visits', 'Leads & bookings', 'Jobs', 'Invoiced']);
  assert.deepEqual(Array.from($('insBySource').querySelector('.ins-row.is-head').children, (c) => c.textContent), ['Source', 'Leads', 'Jobs']);
  assert.doesNotMatch($('insBySource').innerHTML, /\$/);
  w.document.querySelector('[data-ins-period="365d"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.localStorage.getItem('th_insights_period'), '365d');
  assert.deepEqual(asked.filter((a) => a[0] === 'web').map((a) => a[1]), ['90d', '365d']);
  assert.equal($('insWebPeriod').textContent, 'last 12 months');
});

test('Insights: before the first Google Analytics update the website card says so plainly, and Visits reads a dash, never 0', async () => {
  const { w, $, text } = insights({ report: null, saved: '30d' });
  await w.renderInsightsFunnel();
  assert.equal($('insFunnel').querySelector('.ins-step b').textContent, '—');
  assert.equal(text('insWebBody'), 'Website numbers appear here after the first daily update from Google Analytics.');
  assert.equal(text('insWebNote'), "Visitors who declined cookies aren't counted here.");
  const empty = insights({ funnel: [] });
  await empty.w.renderInsightsFunnel();
  assert.equal(empty.text('insBySource'), 'No leads, jobs or invoices in this period yet.');
});

test('Insights replaces the old lead-source and campaign lists, keeps Business Snapshot and the other cards, and loads when Insights opens', () => {
  assert.match(WS, /<div class="section-block" id="section-snapshot">/);
  for (const id of ['insightsRevenueCard', 'insightsStatusDonut', 'topVendors', 'topClients', 'insightsFunnelCard', 'insightsWebsiteCard']) assert.ok(WS.includes('id="' + id + '"'), id);
  assert.match(WS, /expandSection\('analytics'\);\s*renderInsightsCharts\(\);\s*renderInsightsFunnel\(\);/);
});
