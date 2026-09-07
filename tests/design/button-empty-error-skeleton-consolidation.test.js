// UI audit findings F09, F10, F11, F12, F13 (7 September 2026) -- Tier 3,
// "consolidate the tool suite's near-duplicate visual systems": empty
// states, error copy, loading skeletons, buttons, and tab bars had each
// grown 3-5 slightly different local implementations across the 22 tool
// pages.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const STYLES_TOOLS = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');

test('F09: .empty-state and .error-state are canonical, shared classes', () => {
  assert.match(STYLES_TOOLS, /\.empty-state \{ text-align: center;/);
  assert.match(STYLES_TOOLS, /\.empty-state\.empty-state-first-run \{/);
  assert.match(STYLES_TOOLS, /\.empty-state \.th-icon \{/);
  assert.match(STYLES_TOOLS, /\.error-state \{ color: #e05252; font-weight: 500; \}/);
  assert.match(STYLES_TOOLS, /\.error-state::before \{ content: '\\26a0  '; \}/);

  // job-tracker.html no longer carries its own local .empty-state rule --
  // only the promotion comment remains.
  const jobTracker = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  assert.doesNotMatch(jobTracker, /\.empty-state\s*\{\s*text-align/);

  // parts-reference.html's old page-local .pr-empty class is gone, and
  // every former user renamed to the shared class.
  const partsRef = fs.readFileSync(path.join(TOOLS_DIR, 'parts-reference.html'), 'utf8');
  assert.doesNotMatch(partsRef, /\.pr-empty\s*\{/);
  assert.doesNotMatch(partsRef, /class="pr-empty"/);
  assert.ok(
    [...partsRef.matchAll(/class="empty-state"/g)].length >= 3,
    'expected parts-reference.html\'s former .pr-empty spots to use the shared .empty-state class'
  );
});

test('F11: clients.html\'s admin-panel fetch failures use .error-state, not plain .tool-sub copy', () => {
  const clients = fs.readFileSync(path.join(TOOLS_DIR, 'clients.html'), 'utf8');
  const errorStateCount = [...clients.matchAll(/class="error-state">Could not /g)].length;
  assert.ok(errorStateCount >= 7, `expected at least 7 "Could not ..." messages using .error-state, found ${errorStateCount}`);
  assert.doesNotMatch(clients, /class="tool-sub">Could not /);
});

test('F10: the four site-content.html panels that make a real network fetch before rendering all show a skeleton, not a bare empty div', () => {
  const siteContent = fs.readFileSync(path.join(TOOLS_DIR, 'site-content.html'), 'utf8');
  for (const id of ['siteContentForm', 'contentHistoryList', 'faqEditorList', 'termsEditorList']) {
    const re = new RegExp(`<div id="${id}"[^>]*><div class="skeleton-line`);
    assert.match(siteContent, re, `expected #${id} to start with a skeleton-line placeholder`);
  }
  // Confirm none of the four were left as a bare empty container.
  for (const id of ['siteContentForm', 'contentHistoryList', 'faqEditorList', 'termsEditorList']) {
    assert.doesNotMatch(siteContent, new RegExp(`<div id="${id}"[^>]*></div>`));
  }
});

test('F12: review-request.html\'s button row uses the shared .primary-btn/.secondary-btn system, not a page-local .action-btn/.btn-copy/.btn-send system', () => {
  const reviewRequest = fs.readFileSync(path.join(TOOLS_DIR, 'review-request.html'), 'utf8');
  assert.doesNotMatch(reviewRequest, /\.action-btn\s*\{/);
  assert.doesNotMatch(reviewRequest, /\.btn-copy\s*\{/);
  assert.doesNotMatch(reviewRequest, /\.btn-send\s*\{/);
  assert.match(reviewRequest, /\.btn-row \.primary-btn, \.btn-row \.secondary-btn \{/);
  assert.ok(
    [...reviewRequest.matchAll(/class="secondary-btn"/g)].length >= 4,
    'expected the former .action-btn.btn-copy buttons to be renamed to .secondary-btn'
  );
  assert.match(reviewRequest, /class="primary-btn"[^>]*>\s*Open Text Message/s);
});

test('F12: the public-site marketing .btn.blue class no longer appears anywhere in the tools suite (role-blocked overlays and save/confirm buttons alike)', () => {
  const toolFiles = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
  for (const file of toolFiles) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
    assert.doesNotMatch(src, /class="btn blue"/, `${file} still uses the public-site .btn.blue class`);
    assert.doesNotMatch(src, /class="btn "/, `${file} still uses the bare public-site .btn class`);
  }
});

test('F12: Runway Dashboard\'s self-contained .action-btn matches the shared .primary-btn.wide gradient/spacing, not a flat-color one-off', () => {
  const runway = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.match(runway, /button\.action-btn\{\s*\/\* F12 fix/);
  assert.match(runway, /background:linear-gradient\(135deg, var\(--orange-light\), var\(--orange\) 60%, var\(--orange-dark\)\);color:#1a0d02;border:none;font-family:var\(--font-ui\);font-weight:700;font-size:16px;\s*text-transform:uppercase;letter-spacing:1px;padding:14px 28px;/);
});

test('F12: the two conflicting .icon-btn classes (route-planner\'s 32px bordered square vs Runway\'s 21px borderless) are disambiguated by name', () => {
  const routePlanner = fs.readFileSync(path.join(TOOLS_DIR, 'route-planner.html'), 'utf8');
  assert.doesNotMatch(routePlanner, /\.icon-btn\s*\{/);
  assert.match(routePlanner, /\.stop-icon-btn\s*\{/);
  assert.ok(
    [...routePlanner.matchAll(/class="stop-icon-btn/g)].length >= 3,
    'expected all 3 stop-row action buttons to use the renamed class'
  );

  // Runway's own (visually distinct, borderless) .icon-btn is untouched --
  // this is a genuine second design, not the same bug, so only the name
  // collision needed resolving and it was resolved on the other side.
  const runway = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.match(runway, /\.icon-btn\{background:transparent;border:none;/);
});

test('F13: Runway Dashboard\'s folder tabs use .rw-tab-btn/.is-active, not a name that collides with the shared underline .tab-btn system', () => {
  const runway = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  // (the file's own comment explaining this rename mentions the old name
  // literally, so exclude comment lines when checking no live selector
  // or class attribute still uses it)
  const liveCode = runway.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(liveCode, /[^-]\.tab-btn/, 'no bare .tab-btn selector should remain in runway-dashboard.html');
  assert.match(runway, /\.rw-tab-btn\{background:var\(--bg-card\)/);
  assert.match(runway, /\.rw-tab-btn\.is-active\{background:var\(--bg-elevated\)/);
  assert.match(runway, /<button class="rw-tab-btn is-active" data-tab="personal">/);
  // JS toggles the same is-active convention used by this file's own
  // sidebar/bottom-nav components (tools-nav-pwa.js), not a one-off.
  assert.match(runway, /b\.classList\.remove\('is-active'\)/);
  assert.match(runway, /btn\.classList\.add\('is-active'\)/);

  // The shared underline .tab-btn system in styles-tools.css is untouched
  // -- this was a rename on Runway's side only, not a redesign.
  assert.match(STYLES_TOOLS, /^\.tab-btn \{/m);
  assert.match(STYLES_TOOLS, /^\.tab-btn\.is-active \{/m);
});
