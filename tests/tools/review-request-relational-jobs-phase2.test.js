// Relational tables Phase 2, step 3 (2026-09-10): review-request.html's
// "Recent completed jobs" dropdown now reads from the real `jobs` table
// (fetchJobsFromRelational() in sync.js) instead of the localStorage
// copy. This page never loaded sync.js before at all (it doesn't
// otherwise participate in the blob-sync architecture) -- added
// narrowly, and only for this one read.
//
// Also fixes a real bug this conversion would otherwise have
// introduced: applyRecentJobSelection() used to call
// loadRecentDoneJobs() a second time (now async) and index straight
// into the returned array -- indexing into a Promise. Fixed by having
// renderRecentJobs() cache the exact list it rendered
// (cachedRecentDoneJobs) and having applyRecentJobSelection() read
// from that cache instead of re-fetching.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'review-request.html'), 'utf8');

function extractFn(name) {
  let start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const asyncStart = HTML.lastIndexOf('async ', start);
  if (asyncStart >= 0 && HTML.slice(asyncStart + 6, start).trim() === '') start = asyncStart;
  const braceStart = HTML.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

test('sync.js is now loaded on review-request.html, narrowly for this one read', () => {
  assert.match(HTML, /<script src="\/tools\/sync\.js\?v=[^"]+" defer><\/script>/);
});

test('loadRecentDoneJobs() prefers fetchJobsFromRelational() and only falls back to localStorage on a genuine failure', () => {
  const src = extractFn('loadRecentDoneJobs');
  assert.match(src, /if \(typeof fetchJobsFromRelational === 'function'\)/);
  assert.match(src, /if \(jobs === null\)/, 'must distinguish "fetch failed" (null) from "fetch succeeded with zero done jobs" ([])');
  assert.match(src, /localStorage\.getItem\('th_tracker_jobs'\)/);
});

test('applyRecentJobSelection() reads the cached rendered list, never re-calling loadRecentDoneJobs() (which is now async and would otherwise index into a Promise)', () => {
  const src = extractFn('applyRecentJobSelection');
  assert.match(src, /cachedRecentDoneJobs\[Number\(idx\)\]/);
  assert.doesNotMatch(src, /loadRecentDoneJobs\(\)/, 'must not call the async loader directly here -- see cachedRecentDoneJobs instead');
});

test('the DOMContentLoaded init awaits renderRecentJobs() before continuing', () => {
  assert.match(HTML, /await renderRecentJobs\(\);/);
});

// Functional test: actually run the extracted functions together
// against a sandboxed fetchJobsFromRelational/localStorage, confirming
// the real render-then-select flow works end to end.
function loadPage(fetchJobsFromRelational) {
  const loadSrc = extractFn('loadRecentDoneJobs');
  const renderSrc = extractFn('renderRecentJobs');
  const cacheDecl = 'let cachedRecentDoneJobs = [];\n';
  const stubs = {
    fetchJobsFromRelational,
    localStorage: {
      _store: {},
      getItem(key) { return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null; },
    },
    document: {
      getElementById: () => ({ style: {}, innerHTML: '' }),
    },
    escapeHtml: (s) => s,
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'fetchJobsFromRelational', 'localStorage', 'document', 'escapeHtml',
    `${cacheDecl}${loadSrc}\n${renderSrc}\nreturn { renderRecentJobs, getCache: () => cachedRecentDoneJobs };`
  );
  const built = factory(stubs.fetchJobsFromRelational, stubs.localStorage, stubs.document, stubs.escapeHtml);
  return { ...built, localStorage: stubs.localStorage };
}

test('a successful relational fetch is used directly and cached for selection, never falling back to a stale local copy', async () => {
  const { renderRecentJobs, getCache, localStorage } = loadPage(async () => ({
    ok: true,
    jobs: [{ title: 'Fix dryer', client: 'Alice', status: 'done', statusChangedAt: '2026-09-01' }],
  }));
  localStorage._store.th_tracker_jobs = JSON.stringify([{ title: 'STALE local job', client: 'Bob', status: 'done', statusChangedAt: '2026-01-01' }]);

  await renderRecentJobs();

  assert.equal(getCache().length, 1);
  assert.equal(getCache()[0].client, 'Alice');
});

test('a failed relational fetch falls back to the localStorage copy', async () => {
  const { renderRecentJobs, getCache, localStorage } = loadPage(async () => ({ ok: false, error: 'network', jobs: [] }));
  localStorage._store.th_tracker_jobs = JSON.stringify([{ title: 'Local-only job', client: 'Carol', status: 'done', statusChangedAt: '2026-01-01' }]);

  await renderRecentJobs();

  assert.equal(getCache().length, 1);
  assert.equal(getCache()[0].client, 'Carol');
});
