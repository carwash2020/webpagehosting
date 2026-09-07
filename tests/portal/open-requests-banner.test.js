// An "N requests in progress" summary banner above the work-order
// request list (2026-09-07), continuing the same real-data summary
// pattern already shipped on quotes.html (pending-quotes banner),
// dashboard.html (paid/outstanding ring) and home.html (next-
// appointment banner): computed from the exact same `requests` array
// the cards below it already render from, and omitted entirely --
// not a misleading "0 requests" state -- when nothing is open.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

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

function runOpenRequestsBanner(requests) {
  const fnSrc = extractFn(WORK_ORDERS, 'openRequestsBannerHtml');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);
  return sandbox.openRequestsBannerHtml(requests);
}

test('renders nothing when every request is completed or declined, not a "0 requests" banner', () => {
  assert.equal(runOpenRequestsBanner([{ status: 'completed' }, { status: 'declined' }]), '');
  assert.equal(runOpenRequestsBanner([]), '');
});

test('counts submitted/reviewing/quoted/scheduled as open, with correct singular/plural wording', () => {
  const single = runOpenRequestsBanner([{ status: 'submitted' }, { status: 'completed' }]);
  assert.match(single, /1 request in progress/);

  const multiple = runOpenRequestsBanner([
    { status: 'submitted' }, { status: 'reviewing' }, { status: 'quoted' }, { status: 'scheduled' }, { status: 'completed' }, { status: 'declined' },
  ]);
  assert.match(multiple, /4 requests in progress/);
});

test('a request with no status field at all is treated as "submitted" (the real default elsewhere on this page), so it still counts as open', () => {
  const html = runOpenRequestsBanner([{}]);
  assert.match(html, /1 request in progress/);
});

test('the banner reuses the exact Request tab icon already used as this page\'s own neutral empty-state icon, not a new shape', () => {
  const fnSrc = extractFn(WORK_ORDERS, 'openRequestsBannerHtml');
  assert.match(fnSrc, /<circle cx="12" cy="12" r="8\.5"\/><path d="M12 8\.5v7M8\.5 12h7"\/>/);
});

test('the banner is wired into renderMyRequests before the request cards, driven off the same `requests` array', () => {
  const renderFn = extractFn(WORK_ORDERS, 'renderMyRequests');
  const successBlock = renderFn.slice(renderFn.indexOf("listEl.innerHTML = '<div class=\"wo-section-title\">Your requests</div>' +\n      openRequestsBannerHtml"));
  assert.match(successBlock, /openRequestsBannerHtml\(requests\)/);
  const bannerIdx = successBlock.indexOf('openRequestsBannerHtml(requests)');
  const cardsIdx = successBlock.indexOf('requests.map(renderRequestCard)');
  assert.ok(bannerIdx >= 0 && cardsIdx > bannerIdx, 'banner should render above the request cards');
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 30, `expected v30 or later, got v${versionMatch[1]}`);
});
