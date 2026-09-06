// Tests for skeleton loading states (2026-09-04), requested directly:
// "Skeleton loading states." Grounded in the research done before the
// build: skeletons for content being fetched where layout context
// matters (lists, dashboards); spinners stay for short blocking
// actions with unknown content structure (payment, auth) -- which is
// why the payment modal and set-password's token check deliberately
// still show plain text here, not a skeleton.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const JS = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');

test('the shared skeleton helper generates a real card shape, not a spinner or bare text', () => {
  const fnMatch = JS.match(/function portalSkeletonCards\(count\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate portalSkeletonCards()');
  assert.match(fnMatch[0], /skeleton-card/);
  assert.match(fnMatch[0], /is-title/);
  assert.match(fnMatch[0], /\.repeat\(count\)/);
});

test('the mini variant exists for nested contexts, distinct from the full card shape', () => {
  const fnMatch = JS.match(/function portalSkeletonLines\(count\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate portalSkeletonLines()');
  assert.match(fnMatch[0], /skeleton-mini/);
});

test('every list page that fetches data now calls a real skeleton function, not literal Loading text', () => {
  const targets = [
    ['home', /skeleton-card/],
    ['jobs', /portalSkeletonCards\(4\)/],
    ['quotes', /portalSkeletonCards\(3\)/],
    ['work-orders', /portalSkeletonCards\(3\)/],
    ['settings', /skeleton-mini/],
  ];
  for (const [page, pattern] of targets) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    assert.match(html, pattern, `${page}.html: expected a real skeleton, not Loading text`);
    assert.doesNotMatch(html, /class="empty-state">Loading\.\.\.<\/div>/, `${page}.html: old Loading placeholder should be gone`);
  }
});

test('the nested work-order message panel uses the smaller mini variant, not the full card shape', () => {
  const html = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
  assert.match(html, /panel\.innerHTML = portalSkeletonLines\(2\);/);
});

test('short blocking actions deliberately keep plain loading text, not a skeleton -- content structure is unknown for these', () => {
  const dashboard = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');
  assert.match(dashboard, /paymentModalBody'\)\.innerHTML = '<div class="empty-state">Loading\.\.\.<\/div>'/,
    'the payment modal should still use plain text -- a short blocking action with no predictable content shape');

  const setPassword = fs.readFileSync(repo('portal', 'set-password.html'), 'utf8');
  assert.match(setPassword, /id="loginSub">Loading\.\.\.<\/div>/,
    'the token-validation state should still use plain text -- same reasoning, a short blocking auth check');
});

test('the skeleton animation respects prefers-reduced-motion', () => {
  const reducedBlocks = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g)];
  const coversSkeletons = reducedBlocks.some((b) => /skeleton-line/.test(b[0]));
  assert.ok(coversSkeletons, 'expected at least one reduced-motion block to cover .skeleton-line');
});

test('portal-app.js is precached and CACHE_NAME was bumped again for this change', () => {
  const SW = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');
  assert.match(SW, /'\/portal\/portal-app\.js'/);
  // Asserts a FLOOR, not an exact value (2026-09-07). This used to pin the
  // literal 'th-portal-v10', which put the test in permanent conflict with this
  // project's own mandatory rule that CACHE_NAME is bumped on every precached
  // file change -- so every correct bump broke the suite. It did, at
  // th-portal-v11, and stayed broken. A floor still catches the real
  // regression (a missing, malformed, or lowered version) without failing on
  // a correct future bump.
  {
    const m = SW.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
    assert.ok(m, "expected a 'th-portal-v<N>' CACHE_NAME declaration");
    assert.ok(Number(m[1]) >= 10, `expected th-portal cache at or above v10 for this change, found v${m[1]}`);
  }
});
