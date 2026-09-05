// Tests for five design/UX fixes reported directly from screenshots
// (2026-09-02): the Dev Tools sticky tab bar covering content, the
// new footer portal column wrapping to the bottom-left, the portal
// needing a Home hub instead of landing straight on invoices, a
// settings button, and a white flash on every portal navigation.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const DEV_TOOLS = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');

const PORTAL_PAGES = ['home.html', 'settings.html', 'work-orders.html', 'quotes.html', 'dashboard.html', 'jobs.html'];
const ALL_PORTAL_PAGES = [...PORTAL_PAGES, 'login.html', 'set-password.html'];

// ---- 1. footer grid fits the new column ----

test('the footer grid has enough columns for the Client Portal column, so it does not wrap', () => {
  // With the old 4-column rule the fifth column wrapped onto a second
  // row and sat alone under the brand, which read as broken.
  const gridMatch = STYLES.match(/\.footer-grid\{display:grid; grid-template-columns:([^;]+);/);
  assert.ok(gridMatch, 'expected the .footer-grid rule');
  const cols = gridMatch[1].trim().split(/\s+/);
  assert.ok(cols.length >= 5, `expected at least 5 footer columns, found ${cols.length}`);
});

test('the footer collapses at an intermediate width before going single-column', () => {
  // Five columns get crushed at tablet widths without a mid
  // breakpoint between the desktop rule and the existing 760px rule.
  assert.match(STYLES, /@media \(max-width:1100px\)\{\.footer-grid/);
  assert.match(STYLES, /@media \(max-width:760px\)\{\.footer-grid\{grid-template-columns:1fr/);
});

// ---- 2. the Dev Tools sticky tab bar ----

test('the sticky tab bar no longer paints an opaque block over the content above it', () => {
  // The old rule had `box-shadow: 0 -44px 0 0 var(--bg)` to mask
  // content while stuck -- but a box-shadow paints unconditionally,
  // not only while stuck, so it permanently covered the bottom 44px
  // of the identity badge and status chips sitting above it.
  const barMatch = DEV_TOOLS.match(/\.dev-tab-bar \{[\s\S]*?\n  \}/);
  assert.ok(barMatch, 'expected the .dev-tab-bar rule');
  assert.doesNotMatch(barMatch[0], /-44px/,
    'the upward masking box-shadow must be gone -- it clipped real content');
  // The downward drop shadow is still wanted.
  assert.match(barMatch[0], /box-shadow: 0 4px 12px/);
});

test('the sticky tab bar clears the fixed desktop header instead of covering it', () => {
  // styles-tools.css makes .tool-header `position: fixed; top: 0` at
  // >=1024px, so a tab bar sticking to top:0 lands underneath it --
  // and wins, since the bar has the higher z-index.
  assert.match(DEV_TOOLS, /@media \(min-width: 1024px\) \{\s*\.dev-tab-bar \{ top: 56px; \}/);
});

// ---- 3 & 5. white flash on navigation ----

test('every portal page declares a dark color-scheme, preventing the white flash', () => {
  // Without this the browser paints its own WHITE default canvas
  // before any CSS is parsed -- which is exactly the flash seen when
  // switching portal tabs. The inline background on <html> is not
  // enough: that only applies once HTML parsing starts.
  for (const page of ALL_PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(src, /<meta name="color-scheme" content="dark">/,
      `${page}: missing the dark color-scheme meta`);
  }
});

test('every portal page sets a background on body, not only on html', () => {
  // A body with no background can render as a light box over a dark
  // html root during first paint on some browsers.
  for (const page of ALL_PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(src, /body \{ background: #0a0a0a;/,
      `${page}: body should set its own background`);
  }
});

// ---- 4. the Home hub and settings button ----

test('the portal has a Home page that summarises rather than duplicating the lists', () => {
  const home = fs.readFileSync(repo('portal', 'home.html'), 'utf8');
  // Reads counts from all four portal tables...
  for (const table of ['client_portal_invoices', 'client_portal_quotes', 'client_portal_jobs', 'client_portal_work_orders']) {
    assert.match(home, new RegExp(`from\\('${table}'\\)`), `home should summarise ${table}`);
  }
  // ...but must not re-render the full lists, which would put the same
  // data in two places with no clear owner.
  assert.doesNotMatch(home, /renderInvoiceCard|renderQuoteCard|renderJobCard/);
});

test('login and set-password land on Home, not straight into the invoice list', () => {
  for (const page of ['login.html', 'set-password.html']) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(src, /window\.location\.replace\('\/portal\/home\.html'\)/,
      `${page}: should land on the Home hub`);
    assert.doesNotMatch(src, /window\.location\.replace\('\/portal\/dashboard\.html'\)/,
      `${page}: should no longer land straight on invoices`);
  }
});

test('every signed-in portal page has a settings button, like the internal tools do', () => {
  for (const page of PORTAL_PAGES) {
    if (page === 'settings.html') continue; // the settings page itself
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(src, /href="\/portal\/settings\.html" class="portal-icon-btn"/,
      `${page}: missing the settings button`);
  }
});

test('all six signed-in portal pages share the same five-item nav, each marking its own tab', () => {
  const expected = {
    'home.html': 'Home',
    'work-orders.html': 'Request',
    'quotes.html': 'Quotes',
    'dashboard.html': 'Invoices',
    'jobs.html': 'Jobs',
  };
  for (const [page, activeLabel] of Object.entries(expected)) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    const navMatch = src.match(/<nav class="portal-nav"[\s\S]*?<\/nav>/);
    assert.ok(navMatch, `${page}: expected a portal-nav block`);
    const nav = navMatch[0];
    for (const target of Object.keys(expected)) {
      assert.match(nav, new RegExp(`href="/portal/${target.replace('.', '\\.')}"`),
        `${page}: should link to ${target}`);
    }
    assert.match(nav, new RegExp(`class="is-active" aria-current="page">[\\s\\S]*?<span>${activeLabel}</span>`),
      `${page}: should mark ${activeLabel} active`);
    assert.equal((nav.match(/is-active/g) || []).length, 1,
      `${page}: exactly one nav item should be active`);
  }
});

test('settings does not let a client edit the email every portal table joins on', () => {
  // client_email is what RLS scopes every query by and what every
  // portal table joins on -- a client changing it themselves would
  // orphan all their invoices, quotes, jobs and requests.
  const settings = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
  assert.doesNotMatch(settings, /updateUser\(\{ email/);
  assert.match(settings, /auth\.updateUser\(\{ password/, 'password change should still be offered');
  // And says why rather than showing an unexplained disabled field.
  assert.match(settings, /tied to all your invoices/);
});

// ---- three more fixes, all from real screenshots ----

test('the portal nav uses a 5-column grid, never flex-wrap, so the last tab cannot orphan onto its own stretched row', () => {
  // The actual reported bug: flex-wrap + flex:1 meant "Jobs" (the 5th
  // item) couldn't fit on the first row on a real phone, wrapped alone
  // onto a second row, and a lone flex:1 item on its own row always
  // stretches to fill 100% width -- a huge, broken-looking orphan pill.
  // Rewritten 2026-09-04: this used to read each page's own inline
  // <style> and `continue` past any page that didn't have the rule.
  // The app-shell pass moved that CSS into one shared file, so the
  // skip condition became true for EVERY page -- the test would have
  // kept passing while asserting nothing at all. It now checks the
  // single real source of truth instead, which is also the whole
  // point of having consolidated it.
  const shared = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
  const navRule = shared.match(/\.portal-nav \{[\s\S]*?\}/);
  assert.ok(navRule, 'expected a .portal-nav rule in the shared stylesheet');
  assert.match(navRule[0], /grid-template-columns: repeat\(5, 1fr\);/,
    'nav should be a 5-column grid, not flex-wrap');
  assert.doesNotMatch(navRule[0], /flex-wrap: wrap/,
    'the old flex-wrap nav rule should stay gone');

  // And no page should have quietly reintroduced its own copy.
  for (const page of PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.doesNotMatch(src, /\.portal-nav \{ display: grid/,
      `${page}: nav CSS belongs in the shared file, not duplicated back into the page`);
  }
});

test('the header can shrink and the email truncates, instead of overflowing into the action buttons', () => {
  // The actual reported bug: a flex child defaults to min-width:auto,
  // so a long email never shrank and ran straight through the
  // settings/sign-out buttons next to it.
  for (const page of PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    if (!src.includes('.portal-header-left {')) continue;
    assert.match(src, /\.portal-header-left \{[^}]*min-width: 0/,
      `${page}: header-left must be allowed to shrink`);
    assert.match(src, /\.portal-sub \{[^}]*text-overflow: ellipsis/,
      `${page}: the email display must truncate rather than overflow`);
  }
});

test('every signed-in portal page can report a problem, not only Invoices', () => {
  // Previously only dashboard.html had this -- a client hitting a
  // problem on Home, Settings, Quotes, Jobs, or Request had no way to
  // report it at all.
  for (const page of PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(src, /id="reportBugLink"/, `${page}: missing the report-a-problem link`);
    assert.match(src, /id="reportBugOverlay"/, `${page}: missing the report-a-problem modal`);
  }
});

test('reporting a problem posts page_url as the real current page, so every page is distinguishable in the reports panel', () => {
  for (const page of PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    if (!src.includes('reportBugLink')) continue;
    assert.match(src, /page_url: window\.location\.pathname/, `${page}: should report its own real path`);
  }
});

// ---- desktop layout was never widened past mobile's 640px ----
//
// Reported directly from real desktop screenshots: "not good on desk
// top, doesnt even take up the full screen." 640px was chosen for
// mobile (where it's effectively full-width), but on a real monitor
// it left an obviously unintentional-looking narrow column with a
// huge gap on both sides.

test('every signed-in portal page widens past 640px on a real desktop screen', () => {
  for (const page of PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    if (!src.includes('max-width: 640px')) continue;
    assert.match(src, /@media \(min-width: 860px\) \{\s*body \{ max-width: 900px; \}/,
      `${page}: should widen past 640px on desktop`);
  }
});

test('the Home page cards expand to a full 4-column row on desktop instead of just stretching 2 wide cards', () => {
  const src = fs.readFileSync(repo('portal', 'home.html'), 'utf8');
  assert.match(src, /@media \(min-width: 860px\) \{\s*\.home-cards \{ grid-template-columns: repeat\(4, 1fr\); \}/);
});
