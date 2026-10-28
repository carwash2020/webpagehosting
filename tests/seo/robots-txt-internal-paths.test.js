// robots.txt: keep crawlers off internal app paths that already noindex.
// Complements the per-page noindex checks in portal-login-noindex.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROBOTS = fs.readFileSync(path.join(__dirname, '..', '..', 'robots.txt'), 'utf8');

function blockFor(userAgent) {
  const re = new RegExp(
    `User-agent:\\s*${userAgent}\\n([\\s\\S]*?)(?=\\nUser-agent:|\\nSitemap:|$)`
  );
  const m = ROBOTS.match(re);
  assert.ok(m, `expected a User-agent: ${userAgent} block in robots.txt`);
  return m[1];
}

test('the * crawler block disallows /tools/, /portal/, and /rest/ in addition to /.claude/', () => {
  const star = blockFor('\\*');
  assert.match(star, /Disallow:\s*\/\.claude\//);
  assert.match(star, /Disallow:\s*\/tools\//);
  assert.match(star, /Disallow:\s*\/portal\//);
  // /rest/ (2026-10-26) -- not a real page; Google crawled a bare
  // '/rest/v1/...' substring out of page source as if it were a
  // same-host relative path and indexed it as a 404 (GSC: .../rest/v1/
  // site_terms?..., first detected 2026-10-23). The underlying page
  // source no longer produces that bare substring, but this costs
  // nothing as a backstop.
  assert.match(star, /Disallow:\s*\/rest\//);
});

test('every repeated AI answer-engine bot group also disallows /rest/, matching its other internal-path blocks', () => {
  for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User']) {
    const block = blockFor(bot);
    assert.match(block, /Disallow:\s*\/\.claude\//, bot);
    assert.match(block, /Disallow:\s*\/tools\//, bot);
    assert.match(block, /Disallow:\s*\/portal\//, bot);
    assert.match(block, /Disallow:\s*\/rest\//, bot);
  }
});

test('Sitemap URL is unchanged', () => {
  assert.match(ROBOTS, /^Sitemap: https:\/\/www\.triplehenterprisesllc\.biz\/sitemap\.xml$/m);
});

test('bulk AI-training crawlers remain fully disallowed', () => {
  for (const bot of ['GPTBot', 'CCBot', 'Google-Extended']) {
    assert.match(blockFor(bot), /Disallow:\s*\/\s*$/m, `${bot} should Disallow: /`);
  }
});

test('live-retrieval / answer-engine bots remain allowed', () => {
  for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User']) {
    assert.match(blockFor(bot), /Allow:\s*\/\s*$/m, `${bot} should Allow: /`);
  }
});
