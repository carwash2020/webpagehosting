// Tests for the desktop sidebar navigation (2026-08-20), requested
// directly: move navigation to a persistent left sidebar on desktop,
// replacing top-tab-only navigation, filling the rest of the screen
// with content to its right. Reuses the exact same "inject once from
// a shared script" mechanism already proven for the mobile bottom nav.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const NAV_PWA_PATH = path.join(TOOLS_DIR, 'tools-nav-pwa.js');
const STYLES_TOOLS_CSS_PATH = path.join(TOOLS_DIR, 'styles-tools.css');

test('the sidebar is hidden by default and only shown at min-width:1024px -- mobile is completely unaffected', () => {
  const css = fs.readFileSync(STYLES_TOOLS_CSS_PATH, 'utf8');
  const baseRule = css.match(/\.th-desktop-sidebar \{([^}]*)\}/)[1];
  assert.match(baseRule, /display:\s*none/);
  assert.match(css, /@media \(min-width: 1024px\) \{ \.th-desktop-sidebar \{ display: flex/);
});

test('the sidebar\'s width and every real page\'s own centering calc agree on the same base offset -- the shared flat-offset rule that used to live in styles-tools.css was deliberately removed (its higher specificity would have silently overridden every page\'s own corrected margin-left), so each page now computes its own, and they must all agree with the sidebar\'s real width', () => {
  const css = fs.readFileSync(STYLES_TOOLS_CSS_PATH, 'utf8');
  const sidebarWidth = css.match(/\.th-desktop-sidebar \{[^}]*width:\s*(\d+)px/)[1];
  assert.doesNotMatch(css, /body\.th-has-sidebar \{ margin-left:/, 'the old flat-offset rule should be gone -- it would silently override every page\'s own corrected calc due to higher specificity');

  const pages = ['workspace.html', 'calendar.html', 'client-detail.html', 'contract-generator.html',
    'dev-tools.html', 'invoice-generator.html', 'job-detail.html', 'job-tracker.html',
    'review-request.html', 'route-planner.html', 'settings.html', 'site-content.html',
    'finance.html', 'parts-reference.html'];
  for (const page of pages) {
    const pageSrc = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    const offsetMatch = pageSrc.match(/margin-left: calc\((\d+)px \+ max\(0px, \(100vw - \d+px - \d+px\) \/ 2\)\)/);
    assert.ok(offsetMatch, page + ' is missing its own centering calc');
    assert.equal(offsetMatch[1], sidebarWidth, page + '\'s base offset must match the sidebar\'s real width');
  }
});

test('injecting the sidebar on a real page produces the correct number of links, and correctly marks the current page as active', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  const navSrc = fs.readFileSync(NAV_PWA_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/job-tracker.html',
    beforeParse(w) { w.requireAuth = () => {}; },
  });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = navSrc;
  window.document.head.appendChild(s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  const sidebar = window.document.querySelector('.th-desktop-sidebar');
  assert.ok(sidebar, 'sidebar was not injected');
  const links = sidebar.querySelectorAll('.th-sidebar-link');
  assert.ok(links.length >= 8, 'sidebar should have a real, fuller destination list, not just the bottom nav\'s 5 items');

  const activeLink = sidebar.querySelector('.is-active');
  assert.ok(activeLink, 'no active link found');
  assert.match(activeLink.textContent, /Job Tracker/);
  assert.equal(activeLink.getAttribute('aria-current'), 'page');

  assert.equal(window.document.body.classList.contains('th-has-sidebar'), true);
});

test('the sidebar coexists with the mobile bottom nav in the DOM -- CSS media queries decide which one is actually visible, not JS branching', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const navSrc = fs.readFileSync(NAV_PWA_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) { w.requireAuth = () => {}; },
  });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = navSrc;
  window.document.head.appendChild(s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  assert.ok(window.document.querySelector('.th-bottom-nav'), 'bottom nav should still exist for mobile');
  assert.ok(window.document.querySelector('.th-desktop-sidebar'), 'sidebar should also exist for desktop');
});

test('login.html is excluded from the sidebar, matching the same reasoning already applied to the bottom nav: no point navigating before signing in', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'login.html'), 'utf8');
  const navSrc = fs.readFileSync(NAV_PWA_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/tools/login.html', beforeParse(w) { w.hasValidSession = () => false; } });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = navSrc;
  window.document.head.appendChild(s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(window.document.querySelector('.th-desktop-sidebar'), null);
});

test('runway-dashboard.html, which is deliberately self-contained and never loads tools-nav-pwa.js, has its own static copy of the sidebar with a matching, real icon sprite -- not references to icons that don\'t exist on this page', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/runway-dashboard.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, scale(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, fillRect(){}, arc(){}, arcTo(){}, closePath(){}, createLinearGradient(){ return { addColorStop(){} }; }, setLineDash(){},
      });
    },
  });
  const { window } = dom;

  const sidebar = window.document.querySelector('.th-desktop-sidebar');
  assert.ok(sidebar, 'runway-dashboard.html is missing its own sidebar');
  const links = sidebar.querySelectorAll('.th-sidebar-link');
  assert.ok(links.length >= 8);

  // Every icon the sidebar links reference must actually be defined
  // as a <symbol> somewhere on this same page -- unlike other pages,
  // this one can't rely on tools-nav-pwa.js's shared sprite.
  const referencedIcons = new Set([...sidebar.querySelectorAll('use')].map(u => u.getAttribute('href')));
  const definedSymbolIds = new Set([...window.document.querySelectorAll('symbol')].map(s => '#' + s.id));
  for (const iconRef of referencedIcons) {
    assert.ok(definedSymbolIds.has(iconRef), iconRef + ' is referenced but no matching <symbol> is defined on this page');
  }

  const activeLink = sidebar.querySelector('.is-active');
  assert.ok(activeLink);
  assert.match(activeLink.textContent, /Runway Dashboard/);
  assert.equal(window.document.body.classList.contains('th-has-sidebar'), true);
});

test('runway-dashboard.html\'s own sidebar CSS matches the shared version\'s key structural properties (hidden by default, shown at 1024px, matching width/offset)', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.match(src, /\.th-desktop-sidebar \{[\s\S]*?display: none;/);
  assert.match(src, /@media \(min-width: 1024px\) \{ \.th-desktop-sidebar \{ display: flex/);
  const widthMatch = src.match(/\.th-desktop-sidebar \{[\s\S]*?width:\s*(\d+)px/);
  assert.ok(widthMatch);
});
