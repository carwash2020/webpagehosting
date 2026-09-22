// Dashboard drawers stay closed by default. Chip counts still update,
// but list markup, gallery photo URLs, analytics charts, and the
// compliance document list wait until that drawer is opened.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKSPACE = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'workspace.html'), 'utf8');
const NAV = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'tools-nav-pwa.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

test('a closed gallery drawer refreshes the chip count without building the photo queue', () => {
  const fn = extractFn(WORKSPACE, 'renderDashboard');
  assert.match(fn, /dashSectionClosed\('gallery'\)\) refreshGalleryChip\(\)/);
  assert.match(fn, /loadAndRenderGalleryQueue\(\)/);
  assert.match(WORKSPACE, /async function refreshGalleryChip\(\)/);
  assert.doesNotMatch(extractFn(WORKSPACE, 'refreshGalleryChip'), /getSignedJobPhotoUrls/);
});

test('analytics charts and the compliance document list are skipped while those drawers are closed', () => {
  const fn = extractFn(WORKSPACE, 'renderDashboard');
  assert.match(fn, /if \(!dashSectionClosed\('analytics'\)\)/);
  assert.match(fn, /renderStatusBars\(\)/);
  assert.match(fn, /dashSectionClosed\('compliance'\)\) renderInsuranceCard\(\)/);
  assert.match(fn, /renderCompliance\(\)/);
});

test('opening a drawer paints that section, and action-item lists still update their counts before skipping markup', () => {
  const toggle = extractFn(WORKSPACE, 'toggleSection');
  assert.match(toggle, /renderOpenedSection\(key\)/);
  const invoices = extractFn(WORKSPACE, 'renderInvoicesList');
  const countAt = invoices.indexOf('actionItemCounts.unpaid');
  const skipAt = invoices.indexOf("dashSectionClosed('actionitems')");
  assert.ok(countAt >= 0 && skipAt > countAt);
});

test('Find a client starts open on the dashboard', () => {
  assert.match(WORKSPACE, /id="globalSearchWrap"[^>]*class="icon-search is-expanded"|class="icon-search is-expanded" id="globalSearchWrap"/);
});

test('sidebar and More sheet share grouped short labels without dropping a destination', () => {
  assert.match(NAV, /group: 'Work'/);
  assert.match(NAV, /group: 'Money'/);
  assert.match(NAV, /group: 'Office'/);
  assert.match(NAV, /label: 'Invoices'/);
  assert.match(NAV, /label: 'Contracts'/);
  assert.match(NAV, /label: 'Reviews'/);
  assert.match(NAV, /label: 'Job Tracker'/);
  assert.match(NAV, /label: 'Runway Dashboard'/);
  assert.match(NAV, /function destLinksHtml\(dests\)/);
  assert.match(NAV, /class="th-sidebar-group"/);
  for (const href of [
    '/tools/workspace.html',
    '/tools/job-tracker.html',
    '/tools/route-planner.html',
    '/tools/clients.html',
    '/tools/invoice-generator.html',
    '/tools/finance.html',
    '/tools/runway-dashboard.html',
    '/tools/contract-generator.html',
    '/tools/review-request.html',
    '/tools/parts-reference.html',
    '/tools/dev-tools.html',
    '/tools/settings.html',
  ]) {
    assert.ok(NAV.includes(href), `expected ${href} in NAV`);
  }
});
