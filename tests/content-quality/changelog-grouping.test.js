// Tests for grouping the "What's new" changelog panel by calendar day
// (2026-08-21), requested directly (suggestion #1: a plain-English
// recent-fixes summary): a single day's work is often several
// separate commits, and seeing them clustered under one date header
// makes it obvious they're the same effort rather than reading as
// unrelated, scattered entries.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const DEV_TOOLS_PATH = path.join(TOOLS_DIR, 'dev-tools.html');

function loadWithMockCommits(commits) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dialogsSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-dialogs.js'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) { w.requireAuth = () => {}; },
  });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = dialogsSrc;
  window.document.head.appendChild(s);
  window.fetchWithTimeout = async () => ({ json: async () => commits });
  return window;
}

test('commits from the same calendar day are grouped under one date header, not repeated for each commit', async () => {
  const window = loadWithMockCommits([
    { sha: 'aaa1111111', html_url: 'https://x/1', commit: { message: 'Fix A', author: { date: '2026-08-21T14:00:00Z' } } },
    { sha: 'bbb2222222', html_url: 'https://x/2', commit: { message: 'Fix B', author: { date: '2026-08-21T10:00:00Z' } } },
  ]);
  await window.renderChangelog();
  const el = window.document.getElementById('changelogList');
  const headers = [...el.querySelectorAll('div')].filter(d => d.style.textTransform === 'uppercase');
  assert.equal(headers.length, 1, 'two same-day commits should share one header, not get one each');
});

test('commits from different calendar days get separate headers, in the correct order', async () => {
  const window = loadWithMockCommits([
    { sha: 'aaa1111111', html_url: 'https://x/1', commit: { message: 'Fix A', author: { date: '2026-08-21T14:00:00Z' } } },
    { sha: 'ccc3333333', html_url: 'https://x/3', commit: { message: 'Fix C', author: { date: '2026-08-20T09:00:00Z' } } },
  ]);
  await window.renderChangelog();
  const el = window.document.getElementById('changelogList');
  const headers = [...el.querySelectorAll('div')].filter(d => d.style.textTransform === 'uppercase').map(d => d.textContent);
  assert.equal(headers.length, 2);
  assert.match(headers[0], /August 21/);
  assert.match(headers[1], /August 20/);
});

test('every commit\'s content still renders correctly regardless of grouping -- summary, link, and expandable full message', async () => {
  const window = loadWithMockCommits([
    { sha: 'aaa1111111', html_url: 'https://x/1', commit: { message: 'Fix A\n\nFull body text here', author: { date: '2026-08-21T14:00:00Z' } } },
  ]);
  await window.renderChangelog();
  const el = window.document.getElementById('changelogList');
  assert.match(el.innerHTML, /Fix A/);
  assert.match(el.innerHTML, /aaa1111/);
  assert.match(el.innerHTML, /Full body text here/);
});

test('now shows 25 commits instead of the previous 15, since grouping makes a longer list easier to scan', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  assert.match(src, /commits\?per_page=25/);
});
