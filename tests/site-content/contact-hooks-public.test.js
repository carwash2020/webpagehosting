// Phone + email on booking.html, manage-booking.html, manage-job.html and
// 404.html (2026-09-23). These four pages used to show only the number
// built into the site, and tools/site-content.html told the owner so. They
// now read site_content's phone/email the way the other public pages do:
// .js-phone-text / .js-phone-link / .js-email-text / .js-email-link hooks,
// a fail-silent fetch, and window.__siteOverridePhone for the messages a
// page builds in script.
//
// The promise is "follows the saved value, otherwise changes nothing": the
// hooks are classes on elements that already existed (an extra <span> once
// shifted booking.html's text by a sub-pixel), and applying today's values,
// or a failed fetch, leaves each page byte-for-byte identical. (A real
// Chromium before/after screenshot diff of every spot on all four pages
// was also byte-identical; see the PR.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { publicHtmlFiles } = require('./public-pages');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const PAGES = ['booking.html', 'manage-booking.html', 'manage-job.html', '404.html'];
const BUILT_IN_PHONE = '(435) 414-1667';
const BUILT_IN_TEL = 'tel:+14354141667';
const BUILT_IN_EMAIL = 'steve@triplehenterprisesllc.biz';
const NEW_PHONE = '(435) 555-0142';
const NEW_TEL = 'tel:+14355550142';
const NEW_EMAIL = 'office@example.com';

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 5000) {
  const t = Date.now();
  while (Date.now() - t < timeout) { if (fn()) return; await tick(20); }
  throw new Error('condition never became true');
}

function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}
function contactScript(file) {
  const found = inlineScripts(read(file)).filter(s => s.includes('function applySiteContact('));
  assert.equal(found.length, 1, file + ' has one site_content script with applySiteContact()');
  return found[0];
}
function rowsFrom(values) {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}
function answering(body, calls = []) {
  return async (url) => { calls.push(String(url)); return { ok: true, json: async () => body }; };
}

// Only the page's site_content script runs, on the real page's DOM.
async function withContactScript(file, fetchImpl) {
  const dom = new JSDOM(read(file), { runScripts: 'outside-only', url: 'https://www.triplehenterprisesllc.biz/' + file });
  const w = dom.window;
  w.fetch = fetchImpl;
  const before = w.document.documentElement.outerHTML;
  w.eval(contactScript(file));
  await tick(10);
  return { w, before, after: w.document.documentElement.outerHTML };
}

// Every visible text node (not script/style) that matches.
function visibleTextNodes(doc, re) {
  const out = [];
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement.closest('script, style')) continue;
    if (re.test(n.nodeValue)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identical render when nothing changed
// ---------------------------------------------------------------------------

for (const file of PAGES) {
  test(`${file}: today's saved phone and email leave the page byte-for-byte unchanged`, async () => {
    const { before, after } = await withContactScript(file, answering(rowsFrom({
      phone: BUILT_IN_PHONE, email: BUILT_IN_EMAIL, googleRating: '5.0', googleReviewCount: '7',
    })));
    assert.equal(after, before);
  });

  test(`${file}: a failed, refused, or malformed answer leaves the page byte-for-byte unchanged`, async () => {
    const answers = [
      async () => { throw new TypeError('Failed to fetch'); },
      async () => ({ ok: false, status: 503 }),
      async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }),
      answering(null), answering({}), answering('nope'), answering([]),
      answering([{ key: 'phone', value: null }, { key: 'email', value: '' }]),
    ];
    for (const fetchImpl of answers) {
      const { w, before, after } = await withContactScript(file, fetchImpl);
      assert.equal(after, before);
      assert.equal(w.__siteOverridePhone, undefined);
    }
  });
}

// ---------------------------------------------------------------------------
// A new number reaches every spot -- and only those spots change
// ---------------------------------------------------------------------------

for (const file of PAGES) {
  test(`${file}: a new phone number replaces every shown number and every Call link, and nothing else`, async () => {
    const calls = [];
    const { w, before, after } = await withContactScript(file, answering(rowsFrom({ phone: NEW_PHONE, email: NEW_EMAIL }), calls));
    const doc = w.document;
    assert.deepEqual(visibleTextNodes(doc, /414-1667/), [], 'no visible built-in number left');
    const tels = [...doc.querySelectorAll('a[href^="tel:"]')].map(a => a.getAttribute('href'));
    assert.ok(tels.length >= 1);
    assert.deepEqual([...new Set(tels)], [NEW_TEL]);
    assert.equal(w.__siteOverridePhone, NEW_PHONE);
    // Putting the old number back gives the original page exactly: no
    // element, attribute, icon, or whitespace changed except the number.
    assert.equal(after.split(NEW_PHONE).join(BUILT_IN_PHONE).split(NEW_TEL).join(BUILT_IN_TEL), before);
    assert.equal(calls.length, 1);
  });
}

test('the header phone link keeps its icon and the whitespace around the number', async () => {
  for (const file of ['booking.html', 'manage-booking.html', 'manage-job.html']) {
    const { w } = await withContactScript(file, answering(rowsFrom({ phone: NEW_PHONE })));
    const link = w.document.querySelector('.site-header .phone-link');
    assert.ok(link.querySelector('svg path'), file + ' icon kept');
    assert.equal(link.textContent.trim(), NEW_PHONE, file);
    assert.match(link.lastChild.nodeValue, /^\n\s+\(435\) 555-0142\n\s+$/, file);
  }
});

test('404.html: the Call button keeps its "Call" and becomes "Call (435) 555-0142"', async () => {
  const { w } = await withContactScript('404.html', answering(rowsFrom({ phone: NEW_PHONE })));
  const btn = w.document.querySelector('a.btn.orange');
  assert.equal(btn.textContent, 'Call ' + NEW_PHONE);
  assert.equal(btn.getAttribute('href'), NEW_TEL);
});

test('an email hook, if one is added to these pages, follows the saved address the same careful way', async () => {
  const dom = new JSDOM('<p class="js-email-text">Write to steve@triplehenterprisesllc.biz any time</p><a class="js-email-link" href="mailto:steve@triplehenterprisesllc.biz">x</a>', { runScripts: 'outside-only' });
  dom.window.fetch = answering(rowsFrom({ email: NEW_EMAIL }));
  dom.window.eval(contactScript('404.html'));
  await tick(10);
  assert.equal(dom.window.document.querySelector('p').textContent, 'Write to ' + NEW_EMAIL + ' any time');
  assert.equal(dom.window.document.querySelector('a').getAttribute('href'), 'mailto:' + NEW_EMAIL);
});

// ---------------------------------------------------------------------------
// Messages the pages build in script, on the real pages
// ---------------------------------------------------------------------------

const BUSINESS_HOURS_SRC = read('js', 'business-hours.js')
  + '\nwindow.BUSINESS_TIMEZONE = BUSINESS_TIMEZONE; window.HOURS_BY_WEEKDAY = HOURS_BY_WEEKDAY; window.DAYS_AHEAD_SHOWN = DAYS_AHEAD_SHOWN;';
const FLOW_SRC = read('js', 'booking-flow.js');
const DAY = 86400000;
const FULLY_BOOKED = [{ start_at: new Date(Date.now() - 3 * DAY).toISOString(), end_at: new Date(Date.now() + 40 * DAY).toISOString() }];

function realPage(file, query, rpcAnswers, siteContent) {
  const dom = new JSDOM(read(file), {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/' + file + (query || ''),
    beforeParse(w) {
      w.fetch = async (url) => {
        url = String(url);
        if (url.includes('/rest/v1/site_content')) {
          if (!siteContent) throw new TypeError('Failed to fetch');
          return { ok: true, json: async () => rowsFrom(siteContent) };
        }
        const name = (url.match(/\/rpc\/([a-z_]+)/) || [])[1];
        if (name && rpcAnswers[name]) {
          const [status, body] = rpcAnswers[name];
          return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
        }
        return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      };
      if (file.startsWith('booking') || file.startsWith('manage-booking')) { w.eval(BUSINESS_HOURS_SRC); w.eval(FLOW_SRC); }
    },
  });
  return dom.window;
}
async function bookThrough(w) {
  await until(() => w.document.querySelector('.slot-btn'));
  w.document.querySelector('.slot-btn').dispatchEvent(new w.Event('click', { bubbles: true }));
  w.document.getElementById('bName').value = 'Jane Smith';
  w.document.getElementById('bPhone').value = '(555) 123-4567';
  w.document.getElementById('bAddress').value = '12 Elm St';
  w.document.getElementById('bookingForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}
function futureBooking() {
  const start = new Date(Date.now() + 3 * DAY);
  return { service_label: 'Inspection', start_at: start.toISOString(), end_at: new Date(start.getTime() + 45 * 60000).toISOString(), name: 'Test', status: 'confirmed' };
}
const JOB = { title: 'Fix Fridge', job_date: '2026-12-20', address: '123 Main St', cancelled_at: null, reschedule_requested_date: null };

for (const [label, siteContent, phone, tel] of [
  ['the saved number', { phone: NEW_PHONE }, NEW_PHONE, NEW_TEL],
  ['the built-in number when the fetch fails', null, BUILT_IN_PHONE, BUILT_IN_TEL],
]) {
  test(`booking.html: "Nothing open online" and the submit error use ${label}`, async () => {
    let w = realPage('booking.html', '', { get_booking_availability: [200, FULLY_BOOKED] }, siteContent);
    await until(() => w.document.querySelector('.service-option'));
    await tick(20);
    w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
    await until(() => w.document.querySelector('.no-availability'));
    assert.equal(w.document.querySelector('.no-availability a.js-phone-link').getAttribute('href'), tel);

    w = realPage('booking.html', '', { get_booking_availability: [200, []], create_booking: [500, 'boom'] }, siteContent);
    await until(() => w.document.querySelector('.service-option'));
    await tick(20);
    w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
    await bookThrough(w);
    await until(() => w.document.getElementById('statusMsg').classList.contains('is-visible'));
    assert.equal(w.document.getElementById('statusMsg').textContent, 'Something went wrong submitting your booking. Please call us at ' + phone + '.');
  });

  test(`manage-booking.html: "Nothing open online", the move error, and the cancel error use ${label}`, async () => {
    const query = '?token=abc-123';
    let w = realPage('manage-booking.html', query, { get_booking_by_cancel_token: [200, [futureBooking()]], get_booking_availability: [200, FULLY_BOOKED] }, siteContent);
    await until(() => w.document.getElementById('startRescheduleBtn'));
    await tick(20);
    w.document.getElementById('startRescheduleBtn').click();
    await until(() => w.document.querySelector('#slotsGrid .slots-empty a'));
    assert.equal(w.document.querySelector('#slotsGrid .slots-empty a[href^="tel:"]').getAttribute('href'), tel);

    w = realPage('manage-booking.html', query, { get_booking_by_cancel_token: [200, [futureBooking()]], get_booking_availability: [200, []], reschedule_booking_by_token: [500, 'x'] }, siteContent);
    await until(() => w.document.getElementById('startRescheduleBtn'));
    await tick(20);
    w.document.getElementById('startRescheduleBtn').click();
    await until(() => w.document.querySelector('.slot-btn'));
    w.document.querySelector('.slot-btn').click();
    w.document.getElementById('confirmRescheduleBtn').click();
    await until(() => !w.document.getElementById('rescheduleError').hidden);
    assert.equal(w.document.getElementById('rescheduleError').textContent, 'Something went wrong moving your visit. Try again, or call us at ' + phone + '.');

    w = realPage('manage-booking.html', query, { get_booking_by_cancel_token: [200, [futureBooking()]], cancel_booking_by_token: [500, 'x'] }, siteContent);
    await until(() => w.document.getElementById('startCancelBtn'));
    await tick(20);
    w.document.getElementById('startCancelBtn').click();
    w.document.getElementById('confirmCancelBtn').click();
    await until(() => w.document.querySelector('.state-msg.is-error'));
    assert.equal(w.document.querySelector('.state-msg.is-error').textContent, 'Something went wrong cancelling this booking. Please call us at ' + phone + '.');
  });

  test(`manage-job.html: the reschedule-request and cancel errors use ${label}`, async () => {
    const query = '?token=abc-123';
    let w = realPage('manage-job.html', query, { get_job_by_cancel_token: [200, [JOB]], request_job_reschedule_by_token: [500, 'x'] }, siteContent);
    await until(() => w.document.getElementById('startRescheduleBtn'));
    await tick(20);
    w.document.getElementById('startRescheduleBtn').click();
    w.document.getElementById('newDateInput').value = '2026-12-28';
    w.document.getElementById('submitRescheduleBtn').click();
    await until(() => w.document.querySelector('.state-msg.is-error'));
    assert.equal(w.document.querySelector('.state-msg.is-error').textContent, 'Something went wrong sending that request. Please call us at ' + phone + '.');

    w = realPage('manage-job.html', query, { get_job_by_cancel_token: [200, [JOB]], cancel_job_by_token: [500, 'x'] }, siteContent);
    await until(() => w.document.getElementById('startCancelBtn'));
    await tick(20);
    w.document.getElementById('startCancelBtn').click();
    w.document.getElementById('confirmCancelBtn').click();
    await until(() => w.document.querySelector('.state-msg.is-error'));
    assert.equal(w.document.querySelector('.state-msg.is-error').textContent, 'Something went wrong cancelling this appointment. Please call us at ' + phone + '.');
  });
}

// ---------------------------------------------------------------------------
// The hooks and the wiring
// ---------------------------------------------------------------------------

for (const file of PAGES) {
  test(`${file}: every Call link and every shown number is hooked, on the link itself (no wrapper elements)`, () => {
    const doc = new JSDOM(read(file)).window.document;
    const tels = [...doc.querySelectorAll('a[href^="tel:"]')];
    assert.ok(tels.length >= 1);
    tels.forEach(a => assert.ok(a.classList.contains('js-phone-link'), file + ': ' + a.outerHTML.slice(0, 80)));
    visibleTextNodes(doc, /414-1667/).forEach(n => assert.ok(n.parentElement.closest('.js-phone-text'), file + ': ' + n.nodeValue.trim()));
    visibleTextNodes(doc, /steve@triplehenterprisesllc/).forEach(n => assert.ok(n.parentElement.closest('.js-email-text'), file));
    doc.querySelectorAll('a[href^="mailto:"]').forEach(a => assert.ok(a.classList.contains('js-email-link'), file));
    doc.querySelectorAll('.js-phone-text, .js-email-text').forEach(el => assert.equal(el.tagName, 'A', file + ': the hook sits on the link, not a new <span>'));
  });

  test(`${file}: the page's own scripts never hard-code the number except as the fallback`, () => {
    const scripts = inlineScripts(read(file)).join('\n');
    const uses = [...scripts.matchAll(/.{0,40}\(435\) 414-1667/g)].map(m => m[0]);
    uses.forEach(u => assert.match(u, /window\.__siteOverridePhone \|\| '\(435\) 414-1667|swapText\('\.js-phone-text', '\(435\) 414-1667/, file + ': ' + u));
    assert.doesNotMatch(scripts, /tel:\+14354141667/, file + ': build tel: links from the saved number');
  });

  test(`${file}: the fetch asks only for what the page shows and fails silently`, () => {
    const src = contactScript(file);
    const keys = file === 'booking.html' ? 'googleRating,googleReviewCount,phone,email' : 'phone,email';
    assert.ok(src.includes("/rest/v1/site_content?select=key,value&key=in.(" + keys + ")'"), file);
    assert.match(src, /\.then\(res => res\.ok \? res\.json\(\) : \[\]\)/);
    assert.match(src, /\.catch\(\(\) => \{/);
  });
}

test('the four pages carry the same applySiteContact()', () => {
  const fn = file => contactScript(file).match(/ {4}function applySiteContact\(map\) \{[\s\S]*?\n {4}\}\n/)[0];
  const first = fn(PAGES[0]);
  PAGES.slice(1).forEach(file => assert.equal(fn(file), first, file));
});

test('booking.html applies phone/email from the same fetch as the review stats, after handing that map over', () => {
  assert.match(contactScript('booking.html'), /window\.__siteContentMap = map;\s*\n\s*if \(typeof applyReviewStats === 'function'\) applyReviewStats\(map\);\s*\n\s*applySiteContact\(map\);/);
});

// ---------------------------------------------------------------------------
// Site-wide: the spots the editor still tells the owner about
// ---------------------------------------------------------------------------

// Public pages where some shown number/email or Call link is NOT hooked
// yet, so it keeps the built-in value when the owner changes it. The
// editor's "Phone and email" intro names exactly these (homepage, About,
// Our Work, Careers, blog, appliance-repair pages). Hooking one of them
// fails this test on purpose: update this list AND that intro together.
// Any other page gaining an unhooked number fails it too.
const KNOWN_UNHOOKED_PAGES = [
  'about.html', 'careers.html', 'index.html', 'our-work.html',
  'blog/appliance-repair-or-replace.html', 'blog/dishwasher-not-cleaning.html', 'blog/dryer-not-heating.html',
  'blog/drywall-crack-above-door.html', 'blog/fridge-not-cooling.html', 'blog/handyman-to-do-list.html',
  'blog/index.html', 'blog/oven-not-heating-right.html', 'blog/toilet-running-flapper-valve.html',
  'blog/tv-mount-drywall-anchors.html', 'blog/washer-wont-drain.html',
  'services/dishwasher-repair-st-george-ut.html', 'services/refrigerator-repair-st-george-ut.html',
  'services/washer-dryer-repair-st-george-ut.html',
];

test('the pages with an unhooked number or email are exactly the ones the editor names', () => {
  const unhooked = publicHtmlFiles().filter(file => {
    const doc = new JSDOM(read(file)).window.document;
    return [...doc.querySelectorAll('a[href^="tel:"]')].some(a => !a.classList.contains('js-phone-link'))
      || [...doc.querySelectorAll('a[href^="mailto:"]')].some(a => !a.classList.contains('js-email-link') && !a.classList.contains('js-email-mailto'))
      || visibleTextNodes(doc, /414-1667/).some(n => !n.parentElement.closest('.js-phone-text'))
      || visibleTextNodes(doc, /steve@triplehenterprisesllc/).some(n => !n.parentElement.closest('.js-email-text'));
  }).sort();
  assert.deepEqual(unhooked, [...KNOWN_UNHOOKED_PAGES].sort());
  PAGES.forEach(file => assert.ok(!unhooked.includes(file), file));

  const intro = read('tools', 'site-content.html').match(/\{ id: 'contact', title: 'Phone and email',\s*intro: '((?:[^'\\]|\\.)*)' \}/)[1];
  assert.match(intro, /homepage, About, Our Work, Careers, blog, and appliance-repair pages/);
  // No page has a hook for sms: links yet, so the intro keeps saying so.
  assert.ok(publicHtmlFiles().some(file => read(file).includes('href="sms:+14354141667')));
  assert.match(intro, /every "text us" link/);
});
