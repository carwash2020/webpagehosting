// 2026-09-23: the 8 city and 8 service pages moved into locations/ and
// services/ on 2026-09-21, but scripts/check-consistency.js only scanned
// root/, tools/, portal/ and blog/ (htmlFilesIn() doesn't recurse). Neither
// the freshness check nor --fix-versions ever saw those 16 pages' stamps
// for styles.css and the other global shared files, so the next edit to
// any of them would have left all 16 serving a stale cached copy with
// nothing flagging it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SCRIPT = fs.readFileSync(repo('scripts', 'check-consistency.js'), 'utf8');

test('check-consistency scans locations/ and services/ for global shared-file stamps', () => {
  const m = SCRIPT.match(/const SCAN_DIRS = \[([^\]]*)\]/);
  assert.ok(m, 'SCAN_DIRS should be declared');
  assert.match(m[1], /LOCATIONS_DIR/);
  assert.match(m[1], /SERVICES_DIR/);
  assert.match(SCRIPT, /const LOCATIONS_DIR = path\.join\(__dirname, '\.\.', 'locations'\)/);
  assert.match(SCRIPT, /const SERVICES_DIR = path\.join\(__dirname, '\.\.', 'services'\)/);
});

test('every locations/ and services/ page loads each global shared file at its real content hash', () => {
  const shared = SCRIPT.match(/const GLOBAL_SHARED_FILES = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(repo(f), 'utf8')).digest('hex').slice(0, 10);
  let checked = 0;
  for (const dir of ['locations', 'services']) {
    for (const page of fs.readdirSync(repo(dir)).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(repo(dir, page), 'utf8');
      for (const file of shared) {
        const m = html.match(new RegExp(file.replace('.', '\\.') + '\\?v=([a-zA-Z0-9]+)'));
        if (!m) continue;
        checked++;
        assert.equal(m[1], hash(file), `${dir}/${page} loads ${file}?v=${m[1]}, but its real hash is ${hash(file)} -- run npm run fix-versions`);
      }
    }
  }
  assert.ok(checked >= 16, `expected every city/service page to load at least styles.css, checked ${checked}`);
});
