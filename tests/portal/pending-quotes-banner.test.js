// A "N quotes awaiting your response, $X total" summary banner above
// the pending-quotes list (2026-09-07), continuing the same real-data
// summary pattern already shipped on dashboard.html (paid/outstanding
// ring) and home.html (next-appointment banner): computed from the
// exact same `pending` array the section below it already renders
// from, and omitted entirely -- not a misleading "0 quotes" state --
// when nothing is pending.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const QUOTES = fs.readFileSync(repo('portal', 'quotes.html'), 'utf8');
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

function runPendingQuotesBanner(pending) {
  const fnSrc = extractFn(QUOTES, 'pendingQuotesBannerHtml');
  const formatCurrencySrc = extractFn(QUOTES, 'formatCurrency');
  const sandbox = { Intl };
  vm.createContext(sandbox);
  vm.runInContext(`${formatCurrencySrc}\n${fnSrc}`, sandbox);
  return sandbox.pendingQuotesBannerHtml(pending);
}

test('renders nothing at all when there are no pending quotes, not a "0 quotes" banner', () => {
  assert.equal(runPendingQuotesBanner([]), '');
});

test('sums the real total field off the exact pending quotes passed in, for both singular and plural wording', () => {
  const single = runPendingQuotesBanner([{ total: 450 }]);
  assert.match(single, /1 quote awaiting your response/);
  assert.match(single, /\$450\.00 total/);

  const multiple = runPendingQuotesBanner([{ total: 450 }, { total: 89.5 }, { total: 200 }]);
  assert.match(multiple, /3 quotes awaiting your response/);
  assert.match(multiple, /\$739\.50 total/);
});

test('a missing or non-numeric total on one quote does not break the sum for the others', () => {
  const html = runPendingQuotesBanner([{ total: 100 }, { total: null }, {}]);
  assert.match(html, /\$100\.00 total/);
});

test('the banner reuses the exact Quotes nav icon rather than inventing a new shape', () => {
  const fnSrc = extractFn(QUOTES, 'pendingQuotesBannerHtml');
  assert.match(fnSrc, /<path d="M6 3\.5h7\.5L18 8v12\.5H6z"\/><path d="M13\.5 3\.5V8H18"\/><path d="M9 12\.5h6M9 16h6"\/>/);
});

test('the banner is wired into renderQuotes before the pending list, driven off the same `pending` array', () => {
  const renderFn = extractFn(QUOTES, 'renderQuotes');
  const pendingBlock = renderFn.slice(renderFn.indexOf('if (pending.length)'));
  assert.match(pendingBlock, /pendingQuotesBannerHtml\(pending\)/);
  const bannerCallIdx = pendingBlock.indexOf('pendingQuotesBannerHtml(pending)');
  const sectionTitleIdx = pendingBlock.indexOf('Needs your response');
  assert.ok(bannerCallIdx < sectionTitleIdx, 'banner should render above the "Needs your response" heading');
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 26, `expected v26 or later, got v${versionMatch[1]}`);
});
