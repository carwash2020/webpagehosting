// Fix plan Group 3 (FP5, 2026-11-06). Pins for the customer-facing fixes:
//   FP5.3  the FAQ answer collapses to a true 0px (no padding on a closed
//          grid item; verified in Chromium: 20px before, 0px after);
//   FP5.4  microwaves are bookable and in the symptom checker (D6);
//   FP5.7  the portal rail shows the real Triple H logo, not a CSS hexagon.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');

test('FP5.3: a closed FAQ answer has no bottom padding; only an open one does', () => {
  const css = read('styles.css');
  const closed = css.match(/\.faq-answer p\{([^}]*)\}/)[1];
  assert.match(closed, /padding:0 22px;/);
  assert.doesNotMatch(closed, /padding:0 22px 20px/);
  assert.match(css, /\.faq-item\.is-open \.faq-answer p\{padding-bottom:20px;\}/);
});

test('FP5.4: booking lists microwaves, and the symptom checker has a Microwave row with D6\'s three symptoms', () => {
  assert.match(read('booking.html'), /desc: 'Washing machines, dryers, dishwashers, refrigerators, ranges, and microwaves\.'/);
  const src = read('js/triage.js');
  const ctx = { window: {}, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const mw = ctx.window.TRIAGE_DATA.microwave;
  assert.equal(mw.label, 'Microwave');
  assert.deepEqual([...mw.symptoms].map((s) => s.q), ["Runs but won't heat", 'Turntable or buttons not working', "Door won't latch, or it stops when you touch the door"]);
  for (const s of mw.symptoms) assert.doesNotMatch(s.a + s.v, /\$|\d+%/, 'no prices or percentages');
  assert.match(mw.symptoms[0].a, /don't open it yourself/, 'the high-voltage warning');
});

test('FP5.7: the portal rail shows the real logo image, with no CSS-drawn stand-in', () => {
  const css = read('portal', 'portal-app.css');
  assert.doesNotMatch(css, /\.portal-rail-brand::before/);
  assert.doesNotMatch(css, /\.portal-rail-brand img \{ display: none; \}/);
  assert.match(css, /\.portal-rail-brand img \{ display: block; flex-shrink: 0; width: 34px; height: 34px; object-fit: contain; \}/);
  for (const f of fs.readdirSync(repo('portal')).filter((n) => n.endsWith('.html'))) {
    const html = read('portal', f);
    if (!html.includes('class="portal-rail-brand"')) continue;
    assert.match(html, /<a class="portal-rail-brand" href="\/portal\/home\.html">\s*<img src="\/images\/logo-signature-orange\.webp\?v=[0-9a-f]+"/, f);
  }
});

// ---- FP5.1 (D4): the license row opens in place --------------------------------
const { JSDOM } = require('jsdom');
function licensePage(licenses, today = '2026-11-06') {
  const WS = read('tools', 'workspace.html');
  const block = WS.slice(WS.indexOf('  let openLicenseIdx = null;'), WS.indexOf('  const SECURE_DOC_CATEGORY_LABEL = {'));
  const helpers = WS.slice(WS.indexOf('  function daysUntil(dateStr) {'), WS.indexOf('\n  }\n', WS.indexOf('  function daysUntil(dateStr) {')) + 4);
  const dom = new JSDOM('<!doctype html><body><div id="licensesList"></div></body>', { runScripts: 'dangerously' });
  const w = dom.window;
  w.__licenses = licenses;
  w.eval(`
    var justAddedLicenseIdx = null;
    function loadCompliance() { return { licenses: window.__licenses }; }
    function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
    function escapeHtml(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    var RealDate = Date;
    Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : ['${today}T12:00:00'])); } static now() { return new RealDate('${today}T12:00:00').getTime(); } };
  ` + helpers + block.replace('  let openLicenseIdx = null;', '  var openLicenseIdx = null;') + '\nwindow.__api = { renderLicensesList, toggleLicense };');
  w.__api.renderLicensesList();
  const rows = () => [...w.document.querySelectorAll('.license-item')];
  return { w, rows };
}

test('FP5.1: each license row is one button with a status badge; nothing is open at first, and Remove is not in reach', () => {
  const { rows } = licensePage([
    { city: 'St. George', licenseNumber: 'MSB26-000529', expirationDate: '2027-09-02' },
    { city: 'Hurricane', licenseNumber: 'HUR-1', expirationDate: '2026-11-30' },
    { city: 'Ivins', licenseNumber: '', expirationDate: '2026-10-01' },
    { city: 'Santa Clara', licenseNumber: 'SC-9', expirationDate: '' },
  ]);
  const r = rows();
  assert.deepEqual(r.map((x) => x.querySelector('.license-badge').textContent), ['Active', 'Renews in 24 days', 'Expired', 'No expiry on file']);
  for (const row of r) {
    const btn = row.querySelector('button.license-row-toggle');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(row.querySelector('.license-detail').hidden, true, 'Remove sits inside the closed detail');
    assert.equal(btn.getAttribute('aria-controls'), row.querySelector('.license-detail').id);
  }
});

test('FP5.1: tapping opens it in place with number, expiry and days left; one open at a time; tapping again closes', () => {
  const { w, rows } = licensePage([
    { city: 'St. George', licenseNumber: 'MSB26-000529', expirationDate: '2027-09-02' },
    { city: 'Hurricane', licenseNumber: 'HUR-1', expirationDate: '2026-11-30' },
  ]);
  rows()[0].querySelector('.license-row-toggle').click();
  let r = rows();
  assert.equal(r[0].querySelector('.license-row-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(r[0].querySelector('.license-detail').hidden, false);
  const facts = [...r[0].querySelectorAll('.license-facts dt')].map((dt) => dt.textContent + ': ' + dt.nextElementSibling.textContent);
  assert.equal(facts[0], 'License number: MSB26-000529');
  assert.match(facts[1], /^Expires: .*2027 · in 300 days$/);
  assert.equal(r[0].querySelector('.license-detail .small-btn.danger').textContent, 'Remove license');
  r[1].querySelector('.license-row-toggle').click();
  r = rows();
  assert.equal(r[0].querySelector('.license-detail').hidden, true, 'one open at a time');
  assert.equal(r[1].querySelector('.license-detail').hidden, false);
  r[1].querySelector('.license-row-toggle').click();
  assert.equal(rows()[1].querySelector('.license-detail').hidden, true);
  assert.ok(w.document.querySelector('.license-item'));
});

test('FP5.1: escaped -- a city or number with markup is shown as text', () => {
  const { rows } = licensePage([{ city: '<b>x</b>', licenseNumber: '<i>1</i>', expirationDate: '2027-01-01' }]);
  rows()[0].querySelector('.license-row-toggle').click();
  assert.equal(rows()[0].querySelector('.dash-list-item-title').textContent, '<b>x</b>');
  assert.equal(rows()[0].querySelector('.license-facts dd').textContent, '<i>1</i>');
});

test('FP5.2 (D5): calendar day numbers and job dots center in their cell', () => {
  const jt = read('tools', 'job-tracker.html');
  const day = jt.match(/  \.cal-day \{([\s\S]*?)\n  \}/)[1];
  assert.match(day, /flex-direction: column/);
  assert.match(day, /align-items: center;/);
  assert.match(jt, /\.cal-day-dots \{ display: flex; gap: 3px; flex-wrap: wrap; justify-content: center; margin-top: auto; \}/);
});

test('FP5.5: Settings shows "Triple H Homebase V1.0", never the cache stamp; Dev Tools > Health shows the build', () => {
  const settings = read('tools', 'settings.html');
  assert.match(settings, /const APP_PRODUCT_LABEL = 'Triple H Homebase V1\.0';/);
  const show = settings.slice(settings.indexOf('async function showAppVersion('), settings.indexOf('function waitForWorkerSwitch('));
  assert.doesNotMatch(show, /currentAppVersion|th-workspace|Version v/);
  const dev = read('tools', 'dev-tools.html');
  assert.match(dev, /<div class="dev-health-run-note" id="devBuildStamp">Build: checking&hellip;<\/div>/);
  assert.match(dev, /el\.textContent = v \? 'Build ' \+ v \+ ' on this device' : 'Build: not available on this device';/);
});
