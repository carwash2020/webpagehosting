// Handoff 2026-11-03 §2/§7.2: "automate the stamps". The ?v= stamps on
// shared tools/portal/site files and both service-worker CACHE_NAMEs were
// already content hashes fixed by `npm run fix-versions`. What was still
// stamped by hand: portal-app.js/.css (12-digit timestamps), tools/qrcode-lib.js
// (one page loads it, so it never counted as "shared"), and ~230 image
// stamps (/images/...?v=YYYYMMDDHHMM) -- a replaced image kept its old URL and
// stayed cached. Now every ?v= on a reference to a real file in this repo is
// that file's content hash, checked by check-consistency and rewritten by
// --fix-versions. BUILD/minBuild (js/app-freshness.js, version.json) stays a
// deliberate, human-set "force every device to update" lever.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const cc = require(path.join(ROOT, 'scripts', 'check-consistency.js'));
const hash10 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 10);

test('every ?v= stamp on a local file in the real repo is that file\'s content hash right now', () => {
  const refs = cc.collectLocalStampRefs(ROOT);
  assert.ok(refs.length > 600, 'scans html, css, js and both service workers (' + refs.length + ' refs)');
  const kinds = new Set(refs.map((r) => path.extname(r.target)));
  for (const ext of ['.png', '.webp', '.js', '.css']) assert.ok(kinds.has(ext), 'covers ' + ext);
  const stale = refs.filter((r) => r.stamp !== hash10(path.join(ROOT, r.target)));
  assert.deepEqual(stale.map((r) => r.file + ' -> ' + r.target + '?v=' + r.stamp), []);
});

test('the hand-stamped ones are covered now: portal-app.js/.css, qrcode-lib.js, images', () => {
  const targets = new Set(cc.collectLocalStampRefs(ROOT).map((r) => r.target));
  for (const t of ['portal/portal-app.js', 'portal/portal-app.css', 'tools/qrcode-lib.js', 'images/logo-signature-orange.webp']) {
    assert.ok(targets.has(t), t);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'scripts', 'check-consistency.js'), 'utf8'), /PORTAL_TIMESTAMP_VERSIONED/);
});

test('--fix-versions rewrites a stale stamp, follows a CSS file\'s own hash change, and is a no-op the second time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamps-'));
  fs.mkdirSync(path.join(dir, 'images'));
  fs.writeFileSync(path.join(dir, 'images', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'site.css'), '.x{background:url(/images/a.png?v=202601010000)}\n');
  fs.writeFileSync(path.join(dir, 'index.html'), '<link href="/site.css?v=old0000000"><img src="/images/a.png?v=202601010000"><img src="/images/missing.png?v=1">\n');
  const first = cc.fixLocalStamps(dir);
  assert.ok(first > 0);
  const css = fs.readFileSync(path.join(dir, 'site.css'), 'utf8');
  assert.match(css, new RegExp('a\\.png\\?v=' + hash10(path.join(dir, 'images', 'a.png'))));
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, new RegExp('site\\.css\\?v=' + hash10(path.join(dir, 'site.css'))), 'the page follows the CSS file\'s NEW hash');
  assert.match(html, /missing\.png\?v=1/, 'a reference to a file that does not exist is left alone');
  assert.equal(cc.fixLocalStamps(dir), 0, 'stable on the second run');
  const problems = [];
  cc.checkLocalStamps(dir, problems);
  assert.deepEqual(problems, []);
  fs.writeFileSync(path.join(dir, 'images', 'a.png'), Buffer.from([9, 9, 9]));
  cc.checkLocalStamps(dir, problems);
  assert.equal(problems.length, 2, 'a replaced image flags both its references');
});

test('tests, docs, scripts and node_modules are never rewritten', () => {
  const files = new Set(cc.collectLocalStampRefs(ROOT).map((r) => r.file.split(path.sep)[0]));
  for (const d of ['tests', 'docs', 'scripts', 'node_modules', 'backups', 'edge-functions', 'sql']) assert.ok(!files.has(d), d);
});

test('check-consistency fails on a stale local stamp (wired into main, not just exported)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'check-consistency.js'), 'utf8');
  const main = src.slice(src.indexOf('function main() {'));
  assert.match(main, /checkLocalStamps\(ROOT_DIR, problems\);/);
  const fix = src.slice(src.indexOf("process.argv.includes('--fix-versions')"));
  assert.ok(fix.indexOf('fixLocalStamps(ROOT_DIR)') < fix.indexOf('fixCacheFingerprint('), 'stamps settle before the service-worker fingerprints are taken');
  void execFileSync;
});
