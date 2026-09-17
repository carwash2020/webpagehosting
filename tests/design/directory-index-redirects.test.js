// Bare /portal/ and /tools/ directory URLs 404ed on GitHub Pages
// because those folders had no index.html. Soft-land on the real
// login pages with a dark canvas so the hop never flashes white.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

function readLanding(rel) {
  return fs.readFileSync(repo(rel), 'utf8');
}

test('portal/index.html redirects to portal/login.html without a white first paint', () => {
  const html = readLanding('portal/index.html');
  assert.match(html, /<meta http-equiv="refresh" content="0; url=\/portal\/login\.html">/);
  assert.match(html, /location\.replace\('\/portal\/login\.html'\)/);
  assert.match(html, /href="\/portal\/login\.html"/);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<html lang="en" style="background-color:#0a0a0a;">/);
  assert.doesNotMatch(html, /background:#fff|background:\s*white|background-color:\s*#fff/i);
});

test('tools/index.html redirects to tools/login.html without a white first paint', () => {
  const html = readLanding('tools/index.html');
  assert.match(html, /<meta http-equiv="refresh" content="0; url=\/tools\/login\.html">/);
  assert.match(html, /location\.replace\('\/tools\/login\.html'\)/);
  assert.match(html, /href="\/tools\/login\.html"/);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<html lang="en" style="background-color:#0a0a0a;">/);
  assert.doesNotMatch(html, /background:#fff|background:\s*white|background-color:\s*#fff/i);
});

test('tools/index.html is noindex; portal/index.html matches login (noindex, nofollow)', () => {
  const tools = readLanding('tools/index.html');
  const portal = readLanding('portal/index.html');
  const login = readLanding('portal/login.html');
  assert.match(tools, /<meta name="robots" content="noindex, nofollow">/);
  const loginRobots = login.match(/<meta name="robots" content="([^"]*)">/);
  const portalRobots = portal.match(/<meta name="robots" content="([^"]*)">/);
  assert.ok(loginRobots && portalRobots);
  assert.equal(portalRobots[1], loginRobots[1]);
});

test('directory landings are redirect stubs: no shared styles.css, no app chrome', () => {
  for (const file of ['portal/index.html', 'tools/index.html']) {
    const html = readLanding(file);
    assert.doesNotMatch(html, /styles\.css/, `${file} should not load styles.css`);
    assert.doesNotMatch(html, /class="sticky-call"/);
    assert.doesNotMatch(html, /requireAuth\s*\(/);
  }
});
