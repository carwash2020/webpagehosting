// UI audit findings F06, F07, F08, F15, F16, F17 (7 September 2026) --
// "the tools do not read as one product": two incompatible page-header
// systems, an inconsistent header title font, seven ad-hoc content-column
// widths, and inconsistent (or entirely absent) base body padding.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const STYLES_TOOLS = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');

const CONVERTED_PAGES = {
  'calendar.html': 'Calendar',
  'clients.html': 'Clients',
  'contract-generator.html': 'Contract Generator',
  'invoice-generator.html': 'Invoice Generator',
  'job-tracker.html': 'Job Tracker',
  'parts-reference.html': 'Appliance Wiki',
  'pos.html': 'POS',
  'review-request.html': 'Review Request Sender',
  'route-planner.html': 'Route Planner',
};

test('F06/F07: all 9 former .tool-header pages now use .hub-header, which names the page directly in the sticky bar', () => {
  for (const [page, title] of Object.entries(CONVERTED_PAGES)) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.doesNotMatch(src, /class="tool-header"/, `${page} should no longer use .tool-header`);
    assert.doesNotMatch(src, /class="tool-header-brand"/, `${page} should no longer use .tool-header-brand`);
    assert.match(src, /<div class="hub-header">/, `${page} is missing .hub-header`);
    assert.match(src, new RegExp(`<span class="hub-title" id="mainContent">${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`), `${page}'s title should live inside the sticky header now`);
    // Both existing features (help modal, workspace link) must survive
    // the conversion, not just one of them.
    assert.match(src, /<button class="help-btn" onclick="openHelpModal\(\)"/, `${page} lost its help button`);
    assert.match(src, /<a href="\/tools\/workspace\.html" class="help-btn" aria-label="Back to Workspace"/, `${page} lost its back-to-workspace link`);
  }
});

test('F08: every hub page (converted or original) gets Anton via the one shared body .hub-title rule, not a per-page copy', () => {
  assert.match(STYLES_TOOLS, /body \.hub-title \{ font-family: var\(--font-display\); font-size: 22px; letter-spacing: \.5px; \}/);
  const workspace = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.doesNotMatch(workspace, /\.hub-title \{ font-family:var\(--font-display\)/, 'workspace.html\'s local font-family override should be gone -- it\'s promoted into the shared rule now');
  assert.match(workspace, /\.hub-title \{ color: var\(--white\); \}/, 'the still-genuinely-local color:white should survive (the shared rule never sets color)');
});

test('F15: only two content-width tokens exist now, and every non-workspace desktop rule uses one of them', () => {
  assert.match(STYLES_TOOLS, /body\.th-tool-page \{ --tool-maxw-narrow: 1050px; --tool-maxw-wide: 1500px; \}/);

  const narrowPages = ['review-request.html', 'route-planner.html', 'job-detail.html', 'client-detail.html', 'calendar.html', 'pos.html', 'settings.html'];
  const widePages = ['finance.html', 'invoice-generator.html', 'contract-generator.html', 'parts-reference.html', 'job-tracker.html', 'clients.html', 'dev-tools.html', 'site-content.html'];
  for (const page of narrowPages) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(src, /max-width: var\(--tool-maxw-narrow\)/, `${page} should use --tool-maxw-narrow`);
  }
  for (const page of widePages) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(src, /max-width: var\(--tool-maxw-wide\)/, `${page} should use --tool-maxw-wide`);
  }
  // workspace.html is a deliberate, documented exception -- it keeps
  // its own unique 1400px, not tokenized.
  const workspace = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.match(workspace, /max-width: 1400px;/);
});

test('F16/F17: one shared base padding rule replaces the old 90px/44px/absent-entirely split', () => {
  assert.match(STYLES_TOOLS, /body\.th-tool-page \{ padding: 44px 20px 60px; \}/);

  const allTouchedPages = [
    'calendar.html', 'contract-generator.html', 'invoice-generator.html', 'job-tracker.html',
    'review-request.html', 'route-planner.html', 'client-detail.html', 'dev-tools.html',
    'job-detail.html', 'settings.html', 'site-content.html', 'workspace.html',
  ];
  for (const page of allTouchedPages) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.doesNotMatch(src, /body \{ padding: (90px|44px) 20px 60px;/, `${page} should no longer have its own local base padding -- it comes from the shared body.th-tool-page rule now`);
  }
  // finance/clients/pos/parts-reference had NO base body rule at all
  // before this fix -- confirmed they still don't need one now that
  // the shared class-scoped rule covers padding for every page that
  // loads tools-nav-pwa.js (which adds body.th-tool-page).
  for (const page of ['finance.html', 'clients.html', 'pos.html', 'parts-reference.html']) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.doesNotMatch(src, /body \{ padding:/, `${page} should still have no local body padding rule`);
  }
});
