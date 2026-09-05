// Tests for tombstone retention (2026-09-05), requested directly:
// "Should we clean up the blob?" Every th_*_tombstones array grew
// forever, one entry per deletion, with no expiry -- each entry only
// needs to survive long enough for every device to have synced the
// deletion at least once, not indefinitely.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DATA_LAYER = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'data-layer.js'), 'utf8');

test('thPruneTombstones filters by age, keeping malformed/missing deletedAt rather than risk dropping something real', () => {
  const fnMatch = DATA_LAYER.match(/function thPruneTombstones\(list\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate thPruneTombstones()');
  assert.match(fnMatch[0], /isNaN\(deletedAtMs\) \|\| deletedAtMs >= cutoffMs/);
});

test('the retention window is a real, named constant, not a magic number buried in the filter', () => {
  assert.match(DATA_LAYER, /const TOMBSTONE_RETENTION_DAYS = 90;/);
});

test('every one of the 13 known tombstone-adding functions actually calls the prune helper, not just some of them', () => {
  const addFns = [...DATA_LAYER.matchAll(/function (thAdd\w*Tombstone)\([^)]*\)\s*\{[\s\S]*?\n\}\n/g)];
  assert.equal(addFns.length, 13, 'expected exactly 13 tombstone-adding functions -- a change in this count means this test needs updating too');
  for (const m of addFns) {
    assert.match(m[0], /list = thPruneTombstones\(list\);/, `${m[1]} should prune before writing`);
  }
});

test('pruning happens before the new entry is pushed, not after -- the just-added entry never needs re-checking against its own timestamp', () => {
  const fnMatch = DATA_LAYER.match(/function thAddClientTombstone\(id, name\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate thAddClientTombstone() as a representative example');
  const pruneIdx = fnMatch[0].indexOf('thPruneTombstones');
  const pushIdx = fnMatch[0].indexOf('.push(');
  assert.ok(pruneIdx !== -1 && pushIdx !== -1);
  assert.ok(pruneIdx < pushIdx);
});

test('the wiki-routed tombstones (pr_unit, pr_issue) also prune, despite writing through thWriteWiki instead of thWrite', () => {
  for (const fnName of ['thAddPrUnitTombstone', 'thAddPrIssueTombstone']) {
    const re = new RegExp(`function ${fnName}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}\\n`);
    const fnMatch = DATA_LAYER.match(re);
    assert.ok(fnMatch, `expected to isolate ${fnName}()`);
    assert.match(fnMatch[0], /thPruneTombstones/, `${fnName} should still prune even though it writes via thWriteWiki`);
  }
});
