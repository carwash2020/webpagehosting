// Booking polish pass (2026-09-25, visual lane). See
// docs/specialist-logs/visual.md, same date, "scheduling audit".
//  1. Full/closed days on every picker kept their label at ~2.3:1 (the
//     whole tile sat at 45% opacity). They go hollow now; the label stays
//     readable.
//  2. Tap targets under 44px: the header phone link, "Change service",
//     "Not you? Forget this device".
//  3. manage-job.html: 15px date field (iOS zoom on focus), the old orange
//     hex + glyph on success, and errors that replaced the whole page.
//  4. manage-booking.html: "That time was just taken" stacked a copy per
//     conflict, under the times.
//  5. Portal picker: slot skeletons 40px vs 44px buttons (a jump when the
//     times land), and a Try again that looked like one more time tile.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const style = (f) => { const h = read(f); return h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>')); };
const rule = (css, sel) => {
  const i = css.indexOf(sel + '{') >= 0 ? css.indexOf(sel + '{') : css.indexOf(sel + ' {');
  assert.ok(i >= 0, 'missing rule ' + sel);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
};

for (const f of ['booking.html', 'manage-booking.html']) {
  test(`${f}: unavailable days are hollow, not faded`, () => {
    const body = rule(style(f), '.date-btn.is-unavailable');
    assert.doesNotMatch(body, /opacity/);
    assert.match(body, /border-style:dashed/);
    assert.match(style(f), /\.date-btn\.is-unavailable \.avail\{color:var\(--text-dim\);\}/);
  });
  test(`${f}: the header phone link is a 44px target`, () => {
    assert.match(rule(style(f), '.phone-link'), /min-height:44px/);
  });
}

test('portal-polish.css: unavailable days are hollow, and slot skeletons match the 44px buttons', () => {
  const css = read('portal/portal-polish.css');
  const section = css.slice(css.indexOf('25. booking picker'));
  assert.doesNotMatch(rule(section, '.date-btn.is-unavailable'), /opacity/);
  assert.match(rule(section, '.slot-skel'), /height: 44px/);
  assert.match(rule(section, '.booking-picker-retry'), /justify-self: center/);
});

test('booking.html: "Change service"/"Change date/time" and "Forget this device" are 44px targets', () => {
  assert.match(rule(style('booking.html'), '.btn-back'), /min-height:44px/);
  assert.match(rule(style('booking.html'), '.booked-banner-forget'), /min-height:44px/);
});

test('manage-job.html: 16px date field, and the green drawn check instead of the old glyph', () => {
  assert.match(rule(style('manage-job.html'), '.date-field'), /font-size:16px/);
  const html = read('manage-job.html');
  assert.doesNotMatch(html, /&#10003;/);
  assert.match(html, /checkmark is-success/);
});

function jobPage(rpc) {
  return new JSDOM(read('manage-job.html'), {
    runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    beforeParse(w) {
      w.fetch = async (url) => {
        for (const [name, res] of Object.entries(rpc)) if (String(url).includes(name)) return { ok: true, json: async () => res };
        return { ok: true, json: async () => [{ title: 'Fix Fridge', job_date: '2026-12-20', address: null, cancelled_at: null, reschedule_requested_date: null }] };
      };
    },
  }).window;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('manage-job.html: sending with no date says so instead of doing nothing', async () => {
  const w = jobPage({});
  await wait(150);
  w.document.getElementById('startRescheduleBtn').click();
  w.document.getElementById('submitRescheduleBtn').click();
  assert.equal(w.document.getElementById('rescheduleError').hidden, false);
  assert.equal(w.document.getElementById('rescheduleError').textContent, 'Choose a date first.');
});

test('manage-job.html: a sent request says the appointment stays put until confirmed', async () => {
  const w = jobPage({ request_job_reschedule_by_token: [{ ok: true, message: 'requested' }] });
  await wait(150);
  w.document.getElementById('startRescheduleBtn').click();
  w.document.getElementById('newDateInput').value = '2026-12-28';
  w.document.getElementById('submitRescheduleBtn').click();
  await wait(150);
  const html = w.document.getElementById('content').innerHTML;
  assert.match(html, /checkmark is-success/);
  assert.match(html, /we'll reach out to confirm Monday, December 28/);
  assert.match(html, /stays on Sunday, December 20/);
});

test('manage-booking.html: the "just taken" note is one element, placed above the times', () => {
  const html = read('manage-booking.html');
  assert.match(html, /getElementById\('slotsGrid'\)\.insertAdjacentHTML\('beforebegin', '<p class="slots-empty" id="slotTakenNote" role="alert"/);
  assert.match(html, /const taken = document\.getElementById\('slotTakenNote'\);\s+if \(taken\) taken\.remove\(\);/);
});

test('pickers animate arrivals without holding a transform over :active, and honor reduced motion', () => {
  for (const f of ['booking.html', 'manage-booking.html']) {
    const css = style(f);
    assert.match(css, /\.slots-grid \.slot-btn\{animation:slotIn \.22s ease-out backwards;\}/, f);
    assert.match(css, /\.date-btn \.avail:not\(\.is-loading\)\{animation:slotIn/, f);
    assert.match(css, /\*\{animation-duration:0\.001ms !important;/, f + ' page-wide reduced-motion rule');
  }
  const portal = read('portal/portal-polish.css');
  assert.match(portal, /\.slots-grid \.slot-btn \{ animation: bookingSlotIn \.22s ease-out backwards; \}/);
  assert.match(portal, /@media \(prefers-reduced-motion: reduce\) \{\n  \.slots-grid \.slot-btn, \.date-btn \.avail \{ animation: none; \}/);
  assert.match(style('manage-job.html'), /\.inline-error:not\(\[hidden\]\)\{animation:stepIn/);
});

// Second round, same day: blueprint backdrop, scroll hint, check mark on
// the selection, full-day taps that explain themselves, load skeletons,
// 12px labels.
test('booking pages carry the public site\'s blueprint backdrop', () => {
  for (const f of ['booking.html', 'manage-booking.html', 'manage-job.html']) {
    const html = read(f);
    assert.match(html, /<body>\n<div class="bg-blueprint" aria-hidden="true"><\/div>/, f);
    assert.match(style(f), /\.bg-blueprint\{\s*position:fixed; inset:0; z-index:-1;/, f);
    assert.match(style(f), /body\{\s*margin:0; background:transparent;/, f);
  }
});

test('date strips get edge fades, a check on the selection, and 12px labels', () => {
  assert.match(read('booking.html'), /<div class="date-row-wrap"><div class="date-row" id="dateRow"><\/div><\/div>/);
  assert.match(read('manage-booking.html'), /<div class="date-row-wrap"><div class="date-row" id="dateRow"><\/div><\/div>/);
  for (const f of ['booking.html', 'manage-booking.html']) {
    const css = style(f);
    assert.match(css, /\.date-row-wrap\.has-more-left::before, \.date-row-wrap\.has-more-right::after\{opacity:1;\}/, f);
    assert.match(css, /\.date-btn\.is-selected::after, \.slot-btn\.is-selected::before\{content:""/, f);
    assert.match(css, /\.date-btn \.dow\{font-size:12px;/, f);
    assert.match(css, /\.date-btn \.avail\{display:block; margin-top:4px; font-size:12px;/, f);
  }
  const portal = read('portal/portal-polish.css');
  assert.match(portal, /\.date-btn\.is-selected::after, \.slot-btn\.is-selected::before \{ content: ""/);
  assert.match(portal, /\.date-btn \.dow \{ font-size: 12px; \}/);
});

test('booking-flow.js explains a tapped full day, and the three pickers use it', () => {
  const src = read('js/booking-flow.js');
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
  w.eval(read('js/business-hours.js') + '\n' + src);
  assert.equal(w.bookingUnavailableDayText('2026-09-26', { slots: [], closed: false, noTimes: false }), '<strong>Saturday, Sep 26</strong> is fully booked. Pick another day.');
  assert.equal(w.bookingUnavailableDayText('2026-09-25', { slots: [], closed: false, noTimes: true }), '<strong>Friday, Sep 25</strong> has no times left to book online. Pick another day.');
  assert.match(src, /showDayNote\(bookingUnavailableDayText\(btn\.dataset\.date/);
  for (const f of ['booking.html', 'manage-booking.html']) {
    assert.match(read(f), /why\.innerHTML = bookingUnavailableDayText\(btn\.dataset\.date/, f);
    assert.match(read(f), /<p class="date-jump-note" id="dateJumpNote" role="status" hidden><\/p>/, f);
  }
});

test('manage pages load on a skeleton card, with the old text kept for screen readers', () => {
  assert.match(read('manage-booking.html'), /<div class="booking-card is-skeleton" aria-busy="true">[\s\S]*?<p class="sr-only" role="status">Loading your booking\.\.\.<\/p>/);
  assert.match(read('manage-job.html'), /<div class="job-card is-skeleton" aria-busy="true">[\s\S]*?<p class="sr-only" role="status">Loading your appointment\.\.\.<\/p>/);
});

test('one orange focus ring: public, tools and portal', () => {
  assert.match(read('styles.css'), /textarea:focus-visible\{[\s\S]*?outline:2px solid var\(--orange-text\);/);
  assert.match(read('tools/styles-tools.css'), /\.help-btn:focus-visible \{\n  outline: 2px solid var\(--orange\);/);
  assert.match(read('portal/portal-polish.css'), /\.portal-page textarea:focus-visible \{\n  outline: 2px solid var\(--orange\);/);
  assert.doesNotMatch(read('tools/styles-tools.css'), /outline: 2px solid var\(--blue-light\)/);
  assert.match(read('tools/styles-tools.css'), /body \.th-shift-input:focus-visible \{\n  outline: 2px solid var\(--orange\);/);
});

test('Workspace Compliance edit fields are .form-field (T4)', () => {
  const ws = read('tools/workspace.html');
  const seg = ws.slice(ws.indexOf('id="insuranceEditForm"'), ws.indexOf('City Business Licenses'));
  assert.doesNotMatch(seg, /padding:9px 11px/);
  assert.equal((seg.match(/<div class="form-field"><label for="/g) || []).length, 14);
});
