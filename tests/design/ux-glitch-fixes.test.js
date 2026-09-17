// UX-study glitch fixes (2026-09-17): footer Hours actually published,
// FAQ / Terms / Cookie Preferences no longer href="#", portal Send
// Request cleared of the fixed bottom nav, cheap booking date-row
// scrollbar polish. Does not touch AggregateRating / reviewCount.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const PRIVACY = fs.readFileSync(repo('privacy.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');
const WO = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const APP_CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const POLISH = fs.readFileSync(repo('portal', 'portal-polish.css'), 'utf8');

function footerOf(html) {
  const start = html.indexOf('<footer>');
  const end = html.indexOf('</footer>');
  assert.ok(start >= 0 && end > start, 'expected a <footer>');
  return html.slice(start, end);
}

test('the homepage footer Hours section publishes the documented business hours, not an empty heading', () => {
  const footer = footerOf(INDEX);
  assert.match(footer, /<h4>Hours<\/h4>/);
  assert.match(footer, /js-hours-monday">2:00 PM &ndash; 10:00 PM/);
  assert.match(footer, /js-hours-friday">2:00 PM &ndash; 10:00 PM/);
  assert.match(footer, /js-hours-saturday">7:00 AM &ndash; 10:00 PM/);
  assert.match(footer, /js-hours-sunday">2:00 PM &ndash; 8:00 PM/);
  assert.match(STYLES, /\.footer-col ul \+ h4\{margin-top:22px;\}/);
});

test('site_content hour overrides update every .js-hours-* node, not only the first', () => {
  assert.match(INDEX, /document\.querySelectorAll\('\.js-hours-' \+ day\)\.forEach\(el => \{ el\.textContent = map\[key\]; \}\);/);
  assert.doesNotMatch(INDEX, /const el = document\.querySelector\('\.js-hours-' \+ day\);/);
});

test('homepage FAQ links point at #faq (the existing hash that opens the modal), not href="#"', () => {
  assert.match(INDEX, /<a href="#faq" id="navFaqDesktop">FAQ<\/a>/);
  assert.match(INDEX, /<a href="#faq" id="navFaqMobile">FAQ<\/a>/);
  assert.match(INDEX, /<a href="#faq" id="navFaqFooter">FAQ<\/a>/);
  assert.match(INDEX, /if \(window\.location\.hash === '#faq' && faqModal\)/);
});

test('homepage Terms & Conditions points at the real terms.html page, not href="#"', () => {
  assert.match(INDEX, /<a href="\/terms\.html" id="navTermsFooter">Terms &amp; Conditions<\/a>/);
});

test('Cookie Preferences links go to privacy.html#cookies and still reopen the banner', () => {
  assert.match(PRIVACY, /<h4 id="cookies">Cookies and Analytics<\/h4>/);
  const pages = [
    'index.html',
    'terms.html',
    'about.html',
    'our-work.html',
    'handyman-st-george-ut.html',
    'blog/index.html',
  ];
  for (const file of pages) {
    const html = fs.readFileSync(repo(file), 'utf8');
    assert.match(
      html,
      /href="\/privacy\.html#cookies" onclick="window\.reopenCookiePreferences && window\.reopenCookiePreferences\(event\)"/,
      `${file}: Cookie Preferences should fall back to the privacy cookies section`
    );
    assert.doesNotMatch(
      html,
      /href="#" onclick="window\.reopenCookiePreferences/,
      `${file}: Cookie Preferences must not be a dead href="#"`
    );
  }
});

test('Request Work Send Request sits above a spacer, and body padding clears the fixed tab bar', () => {
  assert.match(WO, /id="woSubmitBtn">Send Request<\/button>\s*<div class="portal-nav-clearance" aria-hidden="true"><\/div>/);
  assert.match(APP_CSS, /body\.portal-page \{[\s\S]*?padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(APP_CSS, /\.portal-nav-clearance \{[\s\S]*?height: 16px;/);
  const standalone = POLISH.match(/@media \(display-mode: standalone\) \{[\s\S]*?\n\}/);
  assert.ok(standalone, 'expected a standalone display-mode block');
  assert.match(standalone[0], /padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.doesNotMatch(
    standalone[0],
    /body\.portal-page \{[\s\S]*?padding-bottom: env\(safe-area-inset-bottom, 0px\);/,
    'standalone mode must not wipe the nav-clearance padding'
  );
});

test('the booking date row uses a thin themed scrollbar instead of the default chunky bar', () => {
  assert.match(BOOKING, /\.date-row\{[^}]*scrollbar-width:thin;/);
  assert.match(BOOKING, /\.date-row::-webkit-scrollbar\{height:6px;\}/);
  assert.match(WO, /\.date-row \{[^}]*scrollbar-width: thin;/);
});
