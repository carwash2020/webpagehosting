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

// The rest of the public site (2026-09-24). The spots the editor still
// named -- Call buttons on the homepage, About, Our Work, Careers and the
// blog, the St. George repair pages' FAQ answers, the Careers contact
// line, and every sms: link -- follow too, the same careful way:
//   - "Call (435) 414-1667" buttons (one text node) and whole sentences
//     carry .js-phone-text / .js-email-text on the element that already
//     holds them; applySiteContact() swaps only the number inside it.
//   - .js-sms-link is the sms: hook; like .js-email-mailto's ?subject=,
//     it keeps the pre-filled ?body=.
//   - the St. George FAQPage search data follows its visible answer.
//   - index.html keeps its own site_content script (its FAQ is rebuilt
//     from site_faq); it gains the sms swap and the desktop chat note.
// Every page except index carries the same applySiteContact(). A before/
// after real-Chromium screenshot run (element + viewport, three screen
// sizes, pinned clock, seeded Math.random, local fonts) was byte-identical
// for every spot; see the PR.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const PAGES = ['booking.html', 'manage-booking.html', 'manage-job.html', '404.html'];
const BUILT_IN_PHONE = '(435) 414-1667';
const BUILT_IN_TEL = 'tel:+14354141667';
const BUILT_IN_EMAIL = 'steve@triplehenterprisesllc.biz';
const NEW_PHONE = '(435) 555-0142';
const NEW_TEL = 'tel:+14355550142';
const NEW_EMAIL = 'office@example.com';
const BUILT_IN_SMS = 'sms:+14354141667';
const NEW_SMS = 'sms:+14355550142';
const BLOG_PAGES = fs.readdirSync(path.join(ROOT, 'blog')).filter(f => f.endsWith('.html')).sort().map(f => 'blog/' + f);
const ST_GEORGE_REPAIR_PAGES = ['dishwasher', 'refrigerator', 'washer-dryer'].map(kind => `services/${kind}-repair-st-george-ut.html`);
// Every page that carries applySiteContact(): the four above, plus the
// pages whose hooks sit on elements holding more than the number.
const TEXT_NODE_PAGES = [...PAGES, 'about.html', 'our-work.html', 'careers.html', ...BLOG_PAGES, ...ST_GEORGE_REPAIR_PAGES];
// ...and every page whose site_content script this file runs.
const CONTACT_PAGES = [...TEXT_NODE_PAGES, 'index.html'];

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
// The page's one inline script that reads site_content (index.html's has
// no applySiteContact(); every other page's does).
function siteContentScript(file) {
  const found = inlineScripts(read(file)).filter(s => s.includes('/rest/v1/site_content'));
  assert.equal(found.length, 1, file + ' has one site_content script');
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
  w.eval(siteContentScript(file));
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

for (const file of CONTACT_PAGES) {
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

for (const file of CONTACT_PAGES) {
  test(`${file}: a new number and email replace every shown one and every Call, Text, and Email link, and nothing else`, async () => {
    const calls = [];
    const { w, before, after } = await withContactScript(file, answering(rowsFrom({ phone: NEW_PHONE, email: NEW_EMAIL }), calls));
    const doc = w.document;
    assert.deepEqual(visibleTextNodes(doc, /414-1667/).map(n => n.nodeValue.trim()), [], 'no visible built-in number left');
    assert.deepEqual(visibleTextNodes(doc, /steve@triplehenterprisesllc/).map(n => n.nodeValue.trim()), [], 'no visible built-in address left');
    const hrefs = sel => [...doc.querySelectorAll(sel)].map(a => a.getAttribute('href'));
    const tels = hrefs('a[href^="tel:"]');
    assert.ok(tels.length >= 1);
    assert.deepEqual([...new Set(tels)], [NEW_TEL]);
    hrefs('a[href^="sms:"]').forEach(h => assert.ok(h === NEW_SMS || h.startsWith(NEW_SMS + '?body='), file + ': ' + h));
    hrefs('a[href^="mailto:"]').forEach(h => assert.ok(h === 'mailto:' + NEW_EMAIL || h.startsWith('mailto:' + NEW_EMAIL + '?'), file + ': ' + h));
    assert.equal(w.__siteOverridePhone, NEW_PHONE);
    assert.equal(w.__siteOverrideEmail, NEW_EMAIL);
    // Putting the old values back gives the original page exactly: no
    // element, attribute, icon, or whitespace changed except the number
    // and the address. (A Call button written tel:4354141667 now dials
    // in the +1 form every other link uses.)
    const undo = html => html.split(NEW_PHONE).join(BUILT_IN_PHONE).split(NEW_TEL).join(BUILT_IN_TEL)
      .split(NEW_SMS).join(BUILT_IN_SMS).split(NEW_EMAIL).join(BUILT_IN_EMAIL);
    assert.equal(undo(after), before.split('href="tel:4354141667"').join('href="' + BUILT_IN_TEL + '"'));
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
  test(`booking.html: "Nothing open online" (its Call and Text links) and the submit error use ${label}`, async () => {
    let w = realPage('booking.html', '', { get_booking_availability: [200, FULLY_BOOKED] }, siteContent);
    await until(() => w.document.querySelector('.service-option'));
    await tick(20);
    w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
    await until(() => w.document.querySelector('.no-availability'));
    assert.equal(w.document.querySelector('.no-availability a.js-phone-link').getAttribute('href'), tel);
    assert.equal(w.document.querySelector('.no-availability a.js-sms-link').getAttribute('href'), tel.replace('tel:', 'sms:'));

    w = realPage('booking.html', '', { get_booking_availability: [200, []], create_booking: [500, 'boom'] }, siteContent);
    await until(() => w.document.querySelector('.service-option'));
    await tick(20);
    w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
    await bookThrough(w);
    await until(() => w.document.getElementById('statusMsg').classList.contains('is-visible'));
    assert.equal(w.document.getElementById('statusMsg').textContent, 'Something went wrong submitting your booking. Please call us at ' + phone + '.');
  });

  test(`manage-booking.html: "Nothing open online" (its Call and Text links), the move error, and the cancel error use ${label}`, async () => {
    const query = '?token=abc-123';
    let w = realPage('manage-booking.html', query, { get_booking_by_cancel_token: [200, [futureBooking()]], get_booking_availability: [200, FULLY_BOOKED] }, siteContent);
    await until(() => w.document.getElementById('startRescheduleBtn'));
    await tick(20);
    w.document.getElementById('startRescheduleBtn').click();
    await until(() => w.document.querySelector('#slotsGrid .slots-empty a'));
    assert.equal(w.document.querySelector('#slotsGrid .slots-empty a[href^="tel:"]').getAttribute('href'), tel);
    assert.equal(w.document.querySelector('#slotsGrid .slots-empty a[href^="sms:"]').getAttribute('href'), tel.replace('tel:', 'sms:'));

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
  test(`${file}: every Call and Text link and every shown number is hooked, on the link itself (no wrapper elements)`, () => {
    const doc = new JSDOM(read(file)).window.document;
    const tels = [...doc.querySelectorAll('a[href^="tel:"]')];
    assert.ok(tels.length >= 1);
    tels.forEach(a => assert.ok(a.classList.contains('js-phone-link'), file + ': ' + a.outerHTML.slice(0, 80)));
    doc.querySelectorAll('a[href^="sms:"]').forEach(a => assert.ok(a.classList.contains('js-sms-link'), file + ': ' + a.outerHTML.slice(0, 80)));
    visibleTextNodes(doc, /414-1667/).forEach(n => assert.ok(n.parentElement.closest('.js-phone-text'), file + ': ' + n.nodeValue.trim()));
    visibleTextNodes(doc, /steve@triplehenterprisesllc/).forEach(n => assert.ok(n.parentElement.closest('.js-email-text'), file));
    doc.querySelectorAll('a[href^="mailto:"]').forEach(a => assert.ok(a.classList.contains('js-email-link'), file));
    doc.querySelectorAll('.js-phone-text, .js-email-text').forEach(el => assert.equal(el.tagName, 'A', file + ': the hook sits on the link, not a new <span>'));
  });

  test(`${file}: the fetch asks only for what the page shows and fails silently`, () => {
    const src = contactScript(file);
    const keys = file === 'booking.html' ? 'googleRating,googleReviewCount,phone,email' : 'phone,email';
    assert.ok(src.includes("/rest/v1/site_content?select=key,value&key=in.(" + keys + ")'"), file);
    assert.match(src, /\.then\(res => res\.ok \? res\.json\(\) : \[\]\)/);
    assert.match(src, /\.catch\(\(\) => \{/);
  });
}

for (const file of TEXT_NODE_PAGES) {
  test(`${file}: the page's own scripts never hard-code the number except as the fallback`, () => {
    const scripts = inlineScripts(read(file)).join('\n');
    const uses = [...scripts.matchAll(/.{0,40}\(435\) 414-1667/g)].map(m => m[0]);
    uses.forEach(u => assert.match(u, /window\.__siteOverridePhone \|\| '\(435\) 414-1667|swapText\('\.js-phone-text', '\(435\) 414-1667|swapFaqSchema\('\(435\) 414-1667/, file + ': ' + u));
    assert.doesNotMatch(scripts, /tel:\+?1?4354141667/, file + ': build tel: links from the saved number');
    assert.doesNotMatch(scripts, /sms:\+?1?4354141667/, file + ': build sms: links from the saved number');
  });
}

test('every page that carries applySiteContact() carries the same one, and exactly the pages this file lists do', () => {
  const fn = file => contactScript(file).match(/ {4}function applySiteContact\(map\) \{[\s\S]*?\n {4}\}\n/)[0];
  const first = fn(PAGES[0]);
  TEXT_NODE_PAGES.slice(1).forEach(file => assert.equal(fn(file), first, file));
  const carriers = publicHtmlFiles().filter(file => read(file).includes('function applySiteContact(')).sort();
  assert.deepEqual(carriers, [...TEXT_NODE_PAGES].sort());
  TEXT_NODE_PAGES.filter(f => !PAGES.includes(f)).forEach(file => {
    assert.match(contactScript(file), /\(Array\.isArray\(rows\) \? rows : \[\]\)\.forEach\(r => \{ if \(r\.value\) map\[r\.key\] = r\.value; \}\);\n(?:.*\n)*? {8}applySiteContact\(map\);\n/, file);
    assert.doesNotMatch(contactScript(file), /\.textContent = map\.(phone|email)/, file + ': the whole-text swap would erase "Call " and the rest of a sentence');
  });
});

test('booking.html applies phone/email from the same fetch as the review stats, after handing that map over', () => {
  assert.match(contactScript('booking.html'), /window\.__siteContentMap = map;\s*\n\s*if \(typeof applyReviewStats === 'function'\) applyReviewStats\(map\);\s*\n\s*applySiteContact\(map\);/);
});

test('each page\'s built-in number and email are the ones the editor says a blank field shows', () => {
  const src = read('tools', 'site-content.html').match(/const CMS_BUILT_IN = \{[\s\S]*?\n {2}\};/)[0];
  const builtIn = new Function(src + '; return CMS_BUILT_IN;')();
  assert.equal(builtIn.phone, BUILT_IN_PHONE);
  assert.equal(builtIn.email, BUILT_IN_EMAIL);
  const digits = builtIn.phone.replace(/\D/g, '');
  const base = href => href.split('?')[0];
  for (const file of CONTACT_PAGES) {
    const doc = new JSDOM(read(file)).window.document;
    doc.querySelectorAll('.js-phone-text').forEach(el => assert.ok(el.textContent.includes(builtIn.phone), file));
    doc.querySelectorAll('.js-phone-link').forEach(el => assert.ok(['tel:+1' + digits, 'tel:' + digits].includes(el.getAttribute('href')), file + ': ' + el.getAttribute('href')));
    doc.querySelectorAll('.js-sms-link').forEach(el => assert.equal(base(el.getAttribute('href')), 'sms:+1' + digits, file));
    doc.querySelectorAll('.js-email-text').forEach(el => assert.ok(el.textContent.includes(builtIn.email), file));
    doc.querySelectorAll('.js-email-link, .js-email-mailto').forEach(el => assert.equal(base(el.getAttribute('href')), 'mailto:' + builtIn.email, file));
  }
});

// ---------------------------------------------------------------------------
// The rest of the site (2026-09-24): the spots the editor used to name
// ---------------------------------------------------------------------------

test('a hook on an element that holds more than the number or address only goes where the text-node swap runs', () => {
  // index.html's (and the city/service pages') whole-text swap would turn
  // "Call (435) 414-1667" into just the number. Those pages must hook
  // elements that hold exactly the number or address.
  for (const file of publicHtmlFiles()) {
    const doc = new JSDOM(read(file)).window.document;
    const mixed = [
      ...[...doc.querySelectorAll('.js-phone-text')].filter(el => el.textContent.trim() !== BUILT_IN_PHONE),
      ...[...doc.querySelectorAll('.js-email-text')].filter(el => el.textContent.trim() !== BUILT_IN_EMAIL),
    ];
    if (mixed.length) assert.ok(TEXT_NODE_PAGES.includes(file), file + ': ' + mixed[0].outerHTML.slice(0, 90));
    // ...and each such element holds the value in its own text, which is
    // the only place applySiteContact() looks.
    for (const el of doc.querySelectorAll('.js-phone-text, .js-email-text')) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('');
      if (el.classList.contains('js-phone-text')) assert.ok(own.includes(BUILT_IN_PHONE), file + ': ' + el.outerHTML.slice(0, 90));
      if (el.classList.contains('js-email-text')) assert.ok(own.includes(BUILT_IN_EMAIL), file + ': ' + el.outerHTML.slice(0, 90));
    }
    // A Text link only gets a hook where something swaps it.
    if (doc.querySelector('.js-sms-link')) {
      assert.ok(TEXT_NODE_PAGES.includes(file) || siteContentScript(file).includes("querySelectorAll('.js-sms-link')"), file);
    }
  }
});

test('the "Call (435) 414-1667" buttons keep "Call ", dial the new number, and are still one text node', async () => {
  const pages = ['about.html', 'our-work.html', ...BLOG_PAGES.filter(f => f !== 'blog/index.html')];
  assert.equal(pages.length, 12);
  for (const file of pages) {
    const { w } = await withContactScript(file, answering(rowsFrom({ phone: NEW_PHONE })));
    const btns = [...w.document.querySelectorAll('a.btn.orange.js-phone-link.js-phone-text')];
    assert.equal(btns.length, 1, file);
    assert.equal(btns[0].textContent, 'Call ' + NEW_PHONE, file);
    assert.equal(btns[0].childNodes.length, 1, file + ': no wrapper element');
    assert.equal(btns[0].getAttribute('href'), NEW_TEL, file);
  }
});

test('the header "Call <number>" buttons now dial the saved number too', async () => {
  for (const file of ['index.html', 'about.html', 'our-work.html', 'careers.html', ...BLOG_PAGES]) {
    const { w } = await withContactScript(file, answering(rowsFrom({ phone: NEW_PHONE })));
    const btn = [...w.document.querySelectorAll('a.btn.orange')].find(a => /^Call /.test(a.textContent.trim()) && a.querySelector('.js-phone-text'));
    assert.ok(btn, file);
    assert.equal(btn.getAttribute('href'), NEW_TEL, file);
    assert.equal(btn.textContent.replace(/\s+/g, ' ').trim(), 'Call ' + NEW_PHONE, file);
  }
});

test('index.html: "Call Now" in the service pop-up and the chat panel\'s Call and Text buttons follow', async () => {
  const { w } = await withContactScript('index.html', answering(rowsFrom({ phone: NEW_PHONE })));
  const doc = w.document;
  assert.equal(doc.querySelector('#modal .modal-actions a.btn.orange').getAttribute('href'), NEW_TEL);
  assert.equal(doc.getElementById('chatCallBtn').getAttribute('href'), NEW_TEL);
  assert.equal(doc.getElementById('chatTextBtn').getAttribute('href'), NEW_SMS + '?body=Hi%2C%20I%27m%20interested%20in%20a%20service%20from%20your%20website.');
});

test('Text links keep their pre-filled message: only the number before ?body= changes', async () => {
  const BODY = '?body=Hi%2C%20I%27m%20interested%20in%20a%20service%20from%20your%20website.';
  for (const [file, count] of [['index.html', 3], ['services/washer-dryer-repair-st-george-ut.html', 1]]) {
    const html = read(file);
    assert.equal(html.split('href="' + BUILT_IN_SMS + BODY + '"').length - 1, count, file);
    const { w } = await withContactScript(file, answering(rowsFrom({ phone: NEW_PHONE })));
    const hrefs = [...w.document.querySelectorAll('a.js-sms-link')].map(a => a.getAttribute('href'));
    assert.deepEqual(hrefs, new Array(count).fill(NEW_SMS + BODY), file);
  }
  const { w } = await withContactScript('careers.html', answering(rowsFrom({ phone: NEW_PHONE })));
  assert.deepEqual([...w.document.querySelectorAll('a[href^="sms:"]')].map(a => a.getAttribute('href')), [NEW_SMS]);
});

for (const file of ST_GEORGE_REPAIR_PAGES) {
  test(`${file}: the same-day FAQ answer and its FAQPage search data follow the saved number together`, async () => {
    const ld = doc => [...doc.querySelectorAll('script[type="application/ld+json"]')].map(sc => sc.textContent);
    const answerOf = doc => {
      const faq = ld(doc).map(t => JSON.parse(t)).find(d => d['@type'] === 'FAQPage');
      return faq.mainEntity.map(q => q.acceptedAnswer.text).find(t => t.startsWith('Same-day arrival'));
    };
    const staticDoc = new JSDOM(read(file)).window.document;
    const p = staticDoc.querySelector('details p.js-phone-text');
    assert.ok(p.textContent.startsWith('Same-day arrival'), file);
    assert.equal(answerOf(staticDoc), p.textContent, 'the search data repeats the answer word for word');

    const { w } = await withContactScript(file, answering(rowsFrom({ phone: NEW_PHONE })));
    const shown = w.document.querySelector('details p.js-phone-text').textContent;
    assert.ok(shown.includes('Call or text ' + NEW_PHONE + ' to check'), file);
    assert.equal(answerOf(w.document), shown, 'still word for word, with the new number');
    // Only the FAQPage block changed; the business/Service data is untouched.
    const beforeLd = ld(staticDoc);
    const afterLd = ld(w.document);
    afterLd.forEach((t, i) => {
      if (JSON.parse(t)['@type'] === 'FAQPage') assert.equal(t, beforeLd[i].split(BUILT_IN_PHONE).join(NEW_PHONE));
      else assert.equal(t, beforeLd[i]);
    });
  });
}

test('careers.html: the "Call or text ... or email ..." line follows both, and the apply error message can use them', async () => {
  const { w } = await withContactScript('careers.html', answering(rowsFrom({ phone: NEW_PHONE, email: NEW_EMAIL })));
  const line = w.document.querySelector('p.js-phone-text.js-email-text');
  assert.equal(line.textContent, 'Call or text ' + NEW_PHONE + ', or email ' + NEW_EMAIL + ' with a bit about your background and repair experience.');
  assert.equal(line.childNodes.length, 1);
  // The form's failure message reads these two (it used to fall back to
  // the built-in values every time, since nothing on this page set them).
  assert.equal(w.__siteOverridePhone, NEW_PHONE);
  assert.equal(w.__siteOverrideEmail, NEW_EMAIL);
  assert.match(read('careers.html'), /\(window\.__siteOverridePhone \|\| '\(435\) 414-1667'\) \+ " or email " \+ \(window\.__siteOverrideEmail \|\| 'steve@triplehenterprisesllc\.biz'\)/);
});

// index.html, every script running, on a desktop (fine pointer) or a phone.
function realIndex(siteContent, coarse) {
  const dom = new JSDOM(read('index.html'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://www.triplehenterprisesllc.biz/',
    beforeParse(w) {
      w.matchMedia = q => ({ matches: q.includes('coarse') ? coarse : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.fetch = async (url) => {
        if (String(url).includes('/rest/v1/site_content') && siteContent) return { ok: true, json: async () => rowsFrom(siteContent) };
        return { ok: false, status: 503, json: async () => [] };
      };
    },
  });
  return dom.window;
}

for (const [label, siteContent, phone] of [
  ['the saved number', { phone: NEW_PHONE }, NEW_PHONE],
  ['the built-in number when the fetch fails', null, BUILT_IN_PHONE],
]) {
  test(`index.html: the desktop chat note uses ${label}`, async () => {
    const w = realIndex(siteContent, false);
    await tick(50);
    assert.equal(w.document.getElementById('chatNote').textContent, 'Prefer to text? Message us from your phone at ' + phone + '.');
  });
}

test('index.html: the phone chat note has no number and is left as written', async () => {
  const w = realIndex({ phone: NEW_PHONE }, true);
  await tick(50);
  assert.equal(w.document.getElementById('chatNote').textContent, "On desktop? Texting opens on your phone's messaging app if it's linked, or use Call/Email instead.");
});

// ---------------------------------------------------------------------------
// Site-wide: the spots the editor still tells the owner about
// ---------------------------------------------------------------------------

// Public pages where some shown number/email or Call/Text/Email link is
// NOT hooked, so it keeps the built-in value when the owner changes it.
// Empty since 2026-09-24, and the editor's "Phone and email" intro says
// every public-site spot follows. A page gaining an unhooked number or
// link fails this on purpose: hook it, or list it here AND name it in
// that intro, together.
const KNOWN_UNHOOKED_PAGES = [];

function publicHtmlFiles() {
  const out = [];
  for (const dir of ['', 'services', 'locations', 'blog']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(f)) out.push(path.posix.join(dir, f));
    }
  }
  return out;
}

test('the pages with an unhooked number, email, or Call/Text/Email link are exactly the ones the editor names (none)', () => {
  const unhooked = publicHtmlFiles().filter(file => {
    const doc = new JSDOM(read(file)).window.document;
    return [...doc.querySelectorAll('a[href^="tel:"]')].some(a => !a.classList.contains('js-phone-link'))
      || [...doc.querySelectorAll('a[href^="sms:"]')].some(a => !a.classList.contains('js-sms-link'))
      || [...doc.querySelectorAll('a[href^="mailto:"]')].some(a => !a.classList.contains('js-email-link') && !a.classList.contains('js-email-mailto'))
      || visibleTextNodes(doc, /414-1667/).some(n => !n.parentElement.closest('.js-phone-text'))
      || visibleTextNodes(doc, /steve@triplehenterprisesllc/).some(n => !n.parentElement.closest('.js-email-text'));
  }).sort();
  assert.deepEqual(unhooked, [...KNOWN_UNHOOKED_PAGES].sort());
  CONTACT_PAGES.forEach(file => assert.ok(!unhooked.includes(file), file));

  const intro = read('tools', 'site-content.html').match(/\{ id: 'contact', title: 'Phone and email',\s*intro: '((?:[^'\\]|\\.)*)' \}/)[1];
  assert.match(intro, /on every Call, Text, and Email button and everywhere else the public website shows them/);
  assert.doesNotMatch(intro, /"text us"|A few spots|homepage, About, Our Work/);
  // The two places the intro does still name really don't follow: the
  // client portal never reads site_content (but has Call/Text links), and
  // each page's business search data keeps the built-in telephone.
  assert.match(intro, /Two places still use the ones built into the site: the client portal, and the business details Google reads behind the scenes on each page\./);
  const portal = fs.readdirSync(path.join(ROOT, 'portal')).filter(f => f.endsWith('.html'));
  assert.ok(portal.every(f => !read('portal', f).includes('/rest/v1/site_content')));
  assert.ok(portal.some(f => read('portal', f).includes('href="tel:+14354141667"')));
  assert.ok(publicHtmlFiles().some(file => read(file).includes('"telephone": "+14354141667"')));
});
