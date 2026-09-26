// Desktop app shell (2026-09-22), reported directly with a screenshot:
// "The computer version looks like your looking at a phone on a monitor
// screen." It was a 900px centred column with the phone's bottom tab
// bar floating mid-screen.
//
// From 1024px every signed-in portal page gets a fixed left sidebar
// (.portal-rail) and content that fills the space beside it; from
// 1200px list-shaped pages split into main + side columns. Phones are
// untouched: .portal-rail is display:contents below 1024px, so the nav
// inside it is still the same fixed bottom bar.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const APP_CSS = read('portal', 'portal-app.css');
const NAV_PAGES = ['home', 'work-orders', 'quotes', 'dashboard', 'jobs', 'contracts', 'settings'];

function railOf(page) {
  const src = read('portal', page + '.html');
  const m = src.match(/<div class="portal-rail">[\s\S]*?<div class="portal-rail-help">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(m, `${page}: expected a .portal-rail block`);
  return new JSDOM('<!DOCTYPE html><body>' + m[0] + '</body>').window.document;
}
function mediaBlock(css, query) {
  const start = css.indexOf(`@media ${query} {`);
  assert.ok(start >= 0, `expected @media ${query}`);
  let depth = 0, i = css.indexOf('{', start);
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) break; }
  }
  return css.slice(start, i + 1);
}

// ---- markup ----

test('every signed-in page with the tab bar wraps it in the same rail: brand, the five tabs, Account links, and Call/Text', () => {
  for (const page of NAV_PAGES) {
    const doc = railOf(page);
    const rail = doc.querySelector('.portal-rail');
    assert.equal(rail.querySelector('.portal-rail-brand').getAttribute('href'), '/portal/home.html', page);
    const tabs = Array.from(rail.querySelectorAll('nav.portal-nav > a'), (a) => a.getAttribute('href'));
    // Order changed 2026-09-25 (design handoff): Home / Invoices / Request
    // (raised orange hex) / Estimates / Visits -- was Home / Request /
    // Quotes / Invoices / Jobs. Hrefs and page count are unchanged.
    assert.deepEqual(tabs, ['/portal/home.html', '/portal/dashboard.html', '/portal/work-orders.html', '/portal/quotes.html', '/portal/jobs.html'],
      `${page}: the tab bar must stay exactly five links -- a sixth would break the phone grid`);
    const more = Array.from(rail.querySelectorAll('.portal-rail-more > a'), (a) => a.getAttribute('href'));
    assert.deepEqual(more, ['/portal/contracts.html', '/portal/settings.html'], page);
    const help = Array.from(rail.querySelectorAll('.portal-rail-help-actions a'), (a) => a.getAttribute('href'));
    assert.deepEqual(help, ['tel:+14354141667', 'sms:+14354141667'], page);
  }
});

test('Contracts and Settings mark their own Account link current; no other page does', () => {
  for (const page of NAV_PAGES) {
    const current = Array.from(railOf(page).querySelectorAll('.portal-rail-more a.is-current'));
    if (page === 'contracts' || page === 'settings') {
      assert.equal(current.length, 1, page);
      assert.equal(current[0].getAttribute('href'), `/portal/${page}.html`);
      assert.equal(current[0].getAttribute('aria-current'), 'page');
    } else {
      assert.equal(current.length, 0, `${page} should not mark an Account link current`);
    }
  }
});

test('the rail is identical on every page apart from which link is current', () => {
  const normalise = (page) => {
    const doc = railOf(page);
    doc.querySelectorAll('.is-current, .is-active').forEach((a) => { a.classList.remove('is-current', 'is-active'); a.removeAttribute('aria-current'); if (!a.className) a.removeAttribute('class'); });
    return doc.querySelector('.portal-rail').outerHTML.replace(/\s+/g, ' ');
  };
  const first = normalise(NAV_PAGES[0]);
  for (const page of NAV_PAGES.slice(1)) assert.equal(normalise(page), first, `${page}: rail drifted from home.html's`);
});

// ---- CSS: phones untouched ----

test('below 1024px the rail is invisible to layout and its desktop extras are hidden', () => {
  assert.match(APP_CSS, /\n\.portal-rail \{ display: contents; \}/);
  assert.match(APP_CSS, /\.portal-rail-brand,\n\.portal-rail-more,\n\.portal-rail-help \{ display: none; \}/);
});

// ---- CSS: desktop ----

test('from 1024px the rail is a fixed sidebar and the content fills the space beside it', () => {
  const desk = mediaBlock(APP_CSS, '(min-width: 1024px)');
  assert.match(desk, /\.portal-rail \{\s*position: fixed; top: 0; bottom: 0; left: 0;/);
  assert.match(desk, /width: var\(--portal-rail-w\)/);
  assert.match(desk, /body\.portal-page \{[\s\S]*?max-width: none;[\s\S]*?padding: 30px var\(--portal-gutter\) 56px calc\(var\(--portal-rail-w\) \+ var\(--portal-gutter\)\);/);
  assert.match(APP_CSS, /:root \{ --portal-rail-w: 252px; --portal-measure: 1180px; \}/);
});

test('inside the rail the tab bar is reset to a plain vertical list, badge at the row end', () => {
  const desk = mediaBlock(APP_CSS, '(min-width: 1024px)');
  const nav = desk.match(/\.portal-rail \.portal-nav \{[^}]*\}/)[0];
  for (const reset of ['position: static', 'transform: none', 'flex-direction: column', 'background: none']) {
    assert.ok(nav.includes(reset), `expected ${reset} on the rail nav`);
  }
  assert.match(desk, /\.portal-rail \.portal-nav-badge \{\s*position: static; margin-left: auto;/);
  assert.match(desk, /\.portal-nav-clearance \{ display: none; \}/);
});

test('the header drops what the rail already shows (logo, Settings icon)', () => {
  const desk = mediaBlock(APP_CSS, '(min-width: 1024px)');
  assert.match(desk, /\.portal-header img \{ display: none; \}/);
  assert.match(desk, /\.portal-header \.portal-icon-btn\[aria-label="Settings"\] \{ display: none; \}/);
});

test('installed desktop app keeps the desktop padding instead of the phone safe-area padding', () => {
  const polish = read('portal', 'portal-polish.css');
  assert.match(polish, /@media \(display-mode: standalone\) and \(min-width: 1024px\) \{\s*body\.portal-page \{ padding-top: 30px; padding-bottom: 56px; \}/);
});

// ---- two-column pages ----

test('from 1200px Invoices, Jobs and Request split into a main list and a side column', () => {
  const wide = mediaBlock(APP_CSS, '(min-width: 1200px)');
  assert.match(wide, /\.page-split \{\s*display: grid; grid-template-columns: minmax\(0, 1fr\) 360px;/);
  assert.match(wide, /\.page-split-main \{ grid-column: 1; grid-row: 1;/);
  assert.match(wide, /\.page-split-side \{ grid-column: 2; grid-row: 1;/);
  const split = (page) => {
    const src = read('portal', page + '.html');
    const doc = new JSDOM(src).window.document;
    const s = doc.querySelector('.page-split');
    assert.ok(s, `${page}: expected a .page-split`);
    return { s, main: s.querySelector(':scope > .page-split-main'), side: s.querySelector(':scope > .page-split-side') };
  };
  const inv = split('dashboard');
  assert.ok(inv.main.querySelector('#invoiceList') && inv.side.querySelector('#payFirstArea') && inv.side.querySelector('#invoiceSummary'));
  const jobs = split('jobs');
  assert.ok(jobs.main.querySelector('#jobList') && jobs.side.querySelector('#checkupList') && jobs.side.querySelector('#warrantyOverview'));
  const wo = split('work-orders');
  assert.ok(wo.s.classList.contains('is-wide-side'));
  assert.ok(wo.main.querySelector('#requestForm') && wo.side.querySelector('#myRequests'));
});

test('on a phone the split keeps the old reading order: side content that came first still comes first', () => {
  for (const page of ['dashboard', 'jobs']) {
    const src = read('portal', page + '.html');
    assert.ok(src.indexOf('<div class="page-split-side">') < src.indexOf('<div class="page-split-main">'), page);
  }
});

test('quote and contract cards sit two across on a wide screen instead of one 1100px-wide card', () => {
  const wide = mediaBlock(APP_CSS, '(min-width: 1200px)');
  assert.match(wide, /\.card-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*align-items: start; \}/);
  assert.match(read('portal', 'quotes.html'), /<div class="quote-section-title">Needs your response<\/div><div class="card-grid">` \+ pending\.map\(renderQuoteCard\)\.join\(''\) \+ '<\/div>'/);
  assert.match(read('portal', 'contracts.html'), /<div class="contract-section-title">Needs your signature<\/div><div class="card-grid">` \+ pending\.map\(renderContractCard\)\.join\(''\) \+ '<\/div>'/);
});

test('button rows wrap by their own width, not the viewport -- a half-width card is narrow at any screen size', () => {
  // "RESCHEDULE OR CANCEL" clipped inside a two-across quote card at
  // 1440px, where a viewport breakpoint said there was plenty of room.
  assert.match(read('portal', 'quotes.html'), /\.quote-visit-actions \.btn \{ flex: 1 1 280px;/);
  assert.match(read('portal', 'home.html'), /flex: 1 1 260px;/);
});

test('Home: feed + attention in the main column, account cards + help in the side column from 1200px', () => {
  const home = read('portal', 'home.html');
  const doc = new JSDOM(home).window.document;
  const main = doc.querySelector('.home-layout > .home-main');
  const side = doc.querySelector('.home-layout > .home-side');
  assert.ok(main.querySelector('#nextAppointmentArea') && main.querySelector('#attentionArea') && main.querySelector('#recentActivity'));
  assert.ok(side.querySelector('#homeCards') && side.querySelector('.home-help'));
  assert.match(home, /\.home-layout \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 340px;/);
  // Plain divs, not <section>: styles.css gives every section 88px of
  // padding and a top border, which pushed the side column down.
  assert.equal(doc.querySelectorAll('.home-layout section').length, 0);
});
