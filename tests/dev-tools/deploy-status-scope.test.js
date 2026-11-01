// Health's "latest deploy" must look only at the workflows that decide
// whether the site is live, on main. A failing nightly backup is its
// own line ("Backup failed"), never a failed deploy.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools.html'), 'utf8');

function load(runs) {
  const urls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      // External scripts (dev-tools-shared.js) don't load in jsdom; stub what the function uses.
      w.escapeHtml = (x) => String(x).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
      w.fetchWithTimeout = (u) => w.fetch(u);
      w.fetch = async (u) => { urls.push(String(u)); return { json: async () => ({ workflow_runs: runs }) }; };
    },
  });
  return { window: dom.window, urls };
}

const run = (name, conclusion, id) => ({ id, name, conclusion, status: 'completed', updated_at: '2026-10-31T15:17:00Z' });

test('a failed backup run does not turn the latest deploy red and gets its own line', async () => {
  const { window, urls } = load([
    run('Backup sensitive data (every table)', 'failure', 3),
    run('pages build and deployment', 'success', 2),
    run('Tests and consistency check', 'success', 1),
  ]);
  await window.renderDeployStatus();
  assert.match(urls[0], /branch=main/);
  const doc = window.document;
  const first = doc.querySelector('#deployStatus .dev-check-status');
  assert.ok(first.classList.contains('pass'), 'deploy row is green');
  assert.match(doc.getElementById('deployStatus').textContent, /pages build and deployment/);
  const other = doc.querySelectorAll('#deployStatus .dev-other-failure');
  assert.equal(other.length, 1);
  assert.match(other[0].textContent, /Backup failed/);
});

test('a failed pages deploy or failed tests still shows as a failed deploy', async () => {
  const { window } = load([
    run('Backup sensitive data (every table)', 'success', 3),
    run('Tests and consistency check', 'failure', 2),
    run('pages build and deployment', 'success', 1),
  ]);
  await window.renderDeployStatus();
  const first = window.document.querySelector('#deployStatus .dev-check-status');
  assert.ok(first.classList.contains('fail'));
  assert.equal(window.document.querySelectorAll('#deployStatus .dev-other-failure').length, 0);
});

test('only the newest run of each other workflow counts, so a fixed backup clears its line', () => {
  const { window } = load([]);
  const s = window.summarizeDeployRuns([
    run('Backup sensitive data (x)', 'success', 5),
    run('Backup sensitive data (x)', 'failure', 4),
    run('Check links', 'failure', 3),
  ]);
  assert.equal(s.deployRun, null);
  assert.deepEqual(Array.from(s.otherFailures, r => r.name), ['Check links']);
});

// P4 (2026-11-01): Health badges in sentence case.
test('Health: "All clear" / "N issues" badges and the Live status header are sentence case, with no uppercase transform on the page', () => {
  assert.doesNotMatch(html, /text-transform:\s*uppercase/);
  assert.match(html, /data-th-page="dev-tools"\] :is\(h1, h2, h3, h4, th\),/, 'the shared h1-h3 caps rule is neutralised on this page');
  assert.match(html, />All clear<\/span>/);
  assert.doesNotMatch(html, /ALL CLEAR/);
  assert.match(html, /' issue' \+ \(issues\.length === 1 \? '' : 's'\)/);
  assert.match(html, /<h2 class="dev-section-title" id="devSecHealthLive">Live status<\/h2>/);
});

test('deploy-run badges read "Success" / "In progress", not capitals', async () => {
  const { window } = load([
    { id: 1, name: 'pages build and deployment', conclusion: 'success', status: 'completed', updated_at: '2026-10-31T15:17:00Z' },
    { id: 2, name: 'Tests and consistency check', conclusion: null, status: 'in_progress', updated_at: '2026-10-31T15:17:00Z' },
  ]);
  await window.renderDeployStatus();
  const doc = window.document;
  assert.equal(doc.querySelector('#deployStatus .dev-check-status').textContent, 'Success');
  const states = [...doc.querySelectorAll('#deployHistoryList .dev-check-status')].map((e) => e.textContent);
  assert.deepEqual(states, ['Success', 'In progress']);
});
