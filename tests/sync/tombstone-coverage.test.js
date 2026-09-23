// Every tombstone list is honored, and every Graveyard type can be restored
// (bug fix, 2026-09-23). Found when th_inventory turned out to have
// tombstones that applySyncData never read, so deleted parts came back from
// stale devices; and deleted parts went to the Graveyard as 'inventory',
// which Dev Tools had no config for, so Restore said "Unknown record type".
// Both were single missing entries in hand-kept lists. These checks read
// the lists themselves, so the next record type can't miss either one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const SYNC = fs.readFileSync(path.join(TOOLS, 'sync.js'), 'utf8');
const DEV = fs.readFileSync(path.join(TOOLS, 'dev-tools.html'), 'utf8');

function listed(constName) {
  const m = SYNC.match(new RegExp('const ' + constName + ' = \\[[\\s\\S]*?\\n\\];'));
  assert.ok(m, 'expected ' + constName);
  return [...m[0].matchAll(/'(th_[a-z_]+_tombstones)'/g)].map(x => x[1]);
}

test('applySyncData reads every tombstone list it syncs, after that list has merged', () => {
  const apply = SYNC.slice(SYNC.indexOf('function applySyncData('), SYNC.indexOf('const SYNC_HISTORY_KEY'));
  const keys = listed('SYNC_DATA_KEYS').concat(listed('WIKI_SYNC_KEYS'));
  assert.ok(keys.length >= 16);
  const missing = keys.filter(k => !apply.includes("localStorage.getItem('" + k + "')"));
  assert.deepEqual(missing, [], 'a tombstone list nothing reads can\'t stop a stale device resurrecting what it deleted');
});

test('every record type sent to the Graveyard can be labelled and restored in Dev Tools', () => {
  const cfg = DEV.slice(DEV.indexOf('const GRAVEYARD_TYPE_CONFIG'), DEV.indexOf('const GRAVEYARD_TYPE_TITLES'));
  const titles = DEV.slice(DEV.indexOf('const GRAVEYARD_TYPE_TITLES'), DEV.indexOf('function graveyardEntryLabel'));
  const types = new Set();
  for (const f of fs.readdirSync(TOOLS)) {
    if (!/\.(js|html)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(TOOLS, f), 'utf8');
    for (const m of src.matchAll(/thAddToGraveyard\('([a-zA-Z]+)'/g)) types.add(m[1]);
  }
  assert.ok(types.has('inventory') && types.has('job'));
  types.delete('prIssue'); // restored by its own branch in restoreFromGraveyard (it lives inside a unit)
  const noConfig = [...types].filter(t => !cfg.includes('\n    ' + t + ': { dataKey:'));
  const noTitle = [...types].filter(t => !new RegExp('\\b' + t + ": '").test(titles));
  assert.deepEqual(noConfig, [], 'without a config, Restore says "Unknown record type"');
  assert.deepEqual(noTitle, []);
});
