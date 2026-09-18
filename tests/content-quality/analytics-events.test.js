// Audit Round 5 (2026-09-10): GA4 previously only ever received the
// default pageview -- no custom event existed anywhere on the site, so
// there was no way to tell which page/post/traffic source actually drove
// a real call, text, or booking. This adds a handful of gtag('event', ...)
// calls at points that already exist (phone/text link clicks, the lead
// form's real success path, the booking flow's step transitions and real
// completion, and the chat bubble opening) via a small shared script.
//
// 2026-09-17: same shared file now also covers mailto clicks, Book/
// Schedule CTAs to /booking.html, booking_page_view, and
// booking_form_start. Existing event names are unchanged.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const ANALYTICS_JS = fs.readFileSync(repo('js/analytics-events.js'), 'utf8');

const PUBLIC_PAGES = [
  'index.html', 'booking.html', 'terms.html', 'privacy.html', 'about.html', 'our-work.html',
  'handyman-hurricane-ut.html', 'handyman-washington-city-ut.html',
  'handyman-santa-clara-ivins-ut.html', 'handyman-cedar-city-ut.html',
  'handyman-mesquite-nv.html', 'handyman-la-verkin-ut.html', 'handyman-leeds-ut.html',
  'handyman-st-george-ut.html',
  'washer-dryer-repair.html', 'plumbing-repairs.html', 'drywall-painting.html',
  'assembly-installation.html', 'handyman-repairs.html',
  'washer-dryer-repair-st-george-ut.html',
  'refrigerator-repair-st-george-ut.html',
  'dishwasher-repair-st-george-ut.html',
];
const BLOG_PAGES = [
  'blog/index.html', 'blog/dryer-not-heating.html', 'blog/handyman-to-do-list.html',
  'blog/appliance-repair-or-replace.html', 'blog/washer-wont-drain.html',
  'blog/dishwasher-not-cleaning.html', 'blog/fridge-not-cooling.html',
  'blog/toilet-running-flapper-valve.html', 'blog/drywall-crack-above-door.html',
  'blog/tv-mount-drywall-anchors.html', 'blog/oven-not-heating-right.html',
];

function loadAnalytics({ url, body }) {
  const events = [];
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${body || ''}</body></html>`, {
    url: url || 'https://www.triplehenterprisesllc.biz/',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.gtag = function () { events.push(Array.from(arguments)); };
    },
  });
  const script = dom.window.document.createElement('script');
  script.textContent = ANALYTICS_JS;
  dom.window.document.body.appendChild(script);
  return { window: dom.window, document: dom.window.document, events };
}

function eventNames(events) {
  return events.filter((args) => args[0] === 'event').map((args) => args[1]);
}

test('analytics-events.js tracks phone/text clicks and the chat bubble opening, and never throws if gtag is missing', () => {
  assert.match(ANALYTICS_JS, /if \(typeof gtag !== 'function'\) return;/);
  assert.match(ANALYTICS_JS, /phone_click/);
  assert.match(ANALYTICS_JS, /text_click/);
  assert.match(ANALYTICS_JS, /chat_opened/);
  assert.match(ANALYTICS_JS, /try \{ gtag\('event', name, params \|\| \{\}\); \} catch/);
});

test('analytics-events.js adds booking/lead funnel events without renaming existing ones', () => {
  assert.match(ANALYTICS_JS, /email_click/);
  assert.match(ANALYTICS_JS, /book_cta_click/);
  assert.match(ANALYTICS_JS, /booking_page_view/);
  assert.match(ANALYTICS_JS, /booking_form_start/);
  assert.match(ANALYTICS_JS, /G-TMJJMGY2DQ/);
  const code = ANALYTICS_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /track\('lead_form_submitted'/, 'lead_form_submitted stays inline on the real success path');
  assert.doesNotMatch(code, /track\('booking_completed'/, 'booking_completed stays inline on the real insert path');
});

test('every public page (root, blog index + posts, about, our-work, terms, privacy, booking, city and service pages) loads analytics-events.js with a matching cache-bust version', () => {
  const versions = new Set();
  for (const page of [...PUBLIC_PAGES, ...BLOG_PAGES]) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const m = html.match(/analytics-events\.js\?v=([a-zA-Z0-9]+)/);
    assert.ok(m, `${page} should load /analytics-events.js with a ?v= cache-bust param`);
    versions.add(m[1]);
  }
  assert.equal(versions.size, 1, `expected one shared analytics-events.js version, got ${[...versions].join(', ')}`);
});

test('/tools/ and /portal/ do not load the public marketing analytics-events.js', () => {
  for (const dir of ['tools', 'portal']) {
    const files = fs.readdirSync(repo(dir)).filter((f) => f.endsWith('.html'));
    for (const name of files) {
      const html = fs.readFileSync(repo(dir, name), 'utf8');
      assert.doesNotMatch(html, /analytics-events\.js/, `${dir}/${name} should not load public marketing analytics`);
    }
  }
});

test('the homepage lead form fires lead_form_submitted only on a real successful insert, not optimistically', () => {
  const html = fs.readFileSync(repo('index.html'), 'utf8');
  const successBlock = html.slice(html.indexOf("fetch(LEADS_SUPABASE_URL"), html.indexOf("fetch(LEADS_SUPABASE_URL") + 1900);
  assert.match(successBlock, /if \(response\.ok \|\| response\.status === 409\) \{[\s\S]*?lead_form_submitted[\s\S]*?\}/);
});

test('booking.html fires booking_step_view on real step navigation and booking_completed only on a real successful insert (not the honeypot bot-trap path)', () => {
  const html = fs.readFileSync(repo('booking.html'), 'utf8');
  assert.match(html, /function goToStep\(n\) \{[\s\S]*?booking_step_view[\s\S]*?\n  \}/);
  const honeypotBlock = html.slice(html.indexOf("if (formData.get('_gotcha'))"), html.indexOf("if (formData.get('_gotcha'))") + 400);
  assert.doesNotMatch(honeypotBlock, /booking_completed/, 'the honeypot bot-trap path should never fire a real conversion event');
  const realSuccessBlock = html.slice(html.indexOf('if (res.ok) {'), html.indexOf('if (res.ok) {') + 700);
  assert.match(realSuccessBlock, /booking_completed/);
});

test('booking.html now actually loads GA4 (it previously had none at all), with a CSP that allows it', () => {
  const html = fs.readFileSync(repo('booking.html'), 'utf8');
  assert.match(html, /googletagmanager\.com\/gtag\/js\?id=G-TMJJMGY2DQ/);
  assert.match(html, /gtag\('config', 'G-TMJJMGY2DQ'\)/);
  const cspMatch = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(cspMatch, 'booking.html should have a CSP meta tag');
  assert.match(cspMatch[1], /script-src[^;]*https:\/\/www\.googletagmanager\.com/);
  assert.match(cspMatch[1], /connect-src[^;]*google-analytics\.com/);
});

test('404.html gives a visitor a phone number, not just a link back home', () => {
  const html = fs.readFileSync(repo('404.html'), 'utf8');
  assert.match(html, /href="tel:\+14354141667"/);
});

test('clicking tel/sms/mailto and Book CTAs fires the matching GA4 events', () => {
  const { document, events } = loadAnalytics({
    url: 'https://www.triplehenterprisesllc.biz/',
    body: `
      <a id="call" href="tel:+14354141667">Call</a>
      <a id="text" href="sms:+14354141667">Text</a>
      <a id="mail" href="mailto:steve@triplehenterprisesllc.biz">Email</a>
      <a id="book" href="/booking.html">Schedule an appointment</a>
      <a id="elsewhere" href="/about.html">About</a>
    `,
  });
  document.getElementById('call').click();
  document.getElementById('text').click();
  document.getElementById('mail').click();
  document.getElementById('book').click();
  document.getElementById('elsewhere').click();
  assert.deepEqual(eventNames(events), ['phone_click', 'text_click', 'email_click', 'book_cta_click']);
});

test('book_cta_click does not fire on the booking page itself, and booking_page_view does', () => {
  const { document, events } = loadAnalytics({
    url: 'https://www.triplehenterprisesllc.biz/booking.html',
    body: `<main class="booking-main"><a id="book" href="/booking.html">Book</a><div id="serviceList"></div></main>`,
  });
  document.getElementById('book').click();
  const names = eventNames(events);
  assert.ok(names.includes('booking_page_view'));
  assert.ok(!names.includes('book_cta_click'));
});

test('booking_form_start fires once on first engagement with the booking flow', () => {
  const { document, events } = loadAnalytics({
    url: 'https://www.triplehenterprisesllc.biz/booking.html',
    body: `<main class="booking-main"><div id="serviceList"><button type="button" id="svc" class="service-option">Washer</button></div><form id="bookingForm"><input id="bName"></form></main>`,
  });
  document.getElementById('svc').click();
  document.getElementById('svc').click();
  document.getElementById('bName').dispatchEvent(new (document.defaultView.Event)('input', { bubbles: true }));
  const starts = eventNames(events).filter((n) => n === 'booking_form_start');
  assert.equal(starts.length, 1);
});

test('a page without gtag does not throw when analytics-events.js loads', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><a href="tel:+14354141667">Call</a></body></html>`, {
    url: 'https://www.triplehenterprisesllc.biz/',
    runScripts: 'dangerously',
  });
  const script = dom.window.document.createElement('script');
  script.textContent = ANALYTICS_JS;
  assert.doesNotThrow(() => {
    dom.window.document.body.appendChild(script);
    dom.window.document.querySelector('a').click();
  });
});
