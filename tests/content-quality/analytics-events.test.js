// Audit Round 5 (2026-09-10): GA4 previously only ever received the
// default pageview -- no custom event existed anywhere on the site, so
// there was no way to tell which page/post/traffic source actually drove
// a real call, text, or booking. This adds a handful of gtag('event', ...)
// calls at points that already exist (phone/text link clicks, the lead
// form's real success path, the booking flow's step transitions and real
// completion, and the chat bubble opening) via a small shared script.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const ANALYTICS_JS = fs.readFileSync(repo('analytics-events.js'), 'utf8');

const PUBLIC_PAGES = [
  'index.html', 'booking.html', 'terms.html', 'about.html', 'our-work.html',
  'handyman-hurricane-ut.html', 'handyman-washington-city-ut.html',
  'handyman-santa-clara-ivins-ut.html', 'handyman-cedar-city-ut.html',
  'handyman-mesquite-nv.html', 'handyman-la-verkin-ut.html', 'handyman-leeds-ut.html',
];
const BLOG_PAGES = [
  'blog/index.html', 'blog/dryer-not-heating.html', 'blog/handyman-to-do-list.html',
  'blog/appliance-repair-or-replace.html', 'blog/washer-wont-drain.html',
  'blog/dishwasher-not-cleaning.html', 'blog/fridge-not-cooling.html',
];

test('analytics-events.js tracks phone/text clicks and the chat bubble opening, and never throws if gtag is missing', () => {
  assert.match(ANALYTICS_JS, /if \(typeof gtag !== 'function'\) return;/);
  assert.match(ANALYTICS_JS, /phone_click/);
  assert.match(ANALYTICS_JS, /text_click/);
  assert.match(ANALYTICS_JS, /chat_opened/);
  assert.match(ANALYTICS_JS, /try \{ gtag\('event', name, params \|\| \{\}\); \} catch/);
});

test('every public page (root, blog index + posts, about, our-work, terms, booking, city pages) loads analytics-events.js with a matching cache-bust version', () => {
  const versions = new Set();
  for (const page of [...PUBLIC_PAGES, ...BLOG_PAGES]) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const m = html.match(/analytics-events\.js\?v=([a-zA-Z0-9]+)/);
    assert.ok(m, `${page} should load /analytics-events.js with a ?v= cache-bust param`);
    versions.add(m[1]);
  }
  assert.equal(versions.size, 1, `expected one shared analytics-events.js version, got ${[...versions].join(', ')}`);
});

test('the homepage lead form fires lead_form_submitted only on a real successful insert, not optimistically', () => {
  const html = fs.readFileSync(repo('index.html'), 'utf8');
  const successBlock = html.slice(html.indexOf("fetch(LEADS_SUPABASE_URL"), html.indexOf("fetch(LEADS_SUPABASE_URL") + 1500);
  assert.match(successBlock, /if \(response\.ok\) \{[\s\S]*?lead_form_submitted[\s\S]*?\}/);
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
