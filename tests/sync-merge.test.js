// Tests for the record-merge logic in tools/sync.js -- the system that
// keeps an entry added on one device from silently vanishing when
// another device pushes its own (older) snapshot afterward.
//
// These extract just the pure merge functions out of sync.js rather than
// loading the whole file, since the rest of it talks to a real Supabase
// project and isn't something a test should be hitting over the network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SYNC_JS_PATH = path.join(__dirname, '..', 'tools', 'sync.js');

function loadMergeFunctions() {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const mergeRecordArraysSrc = src.match(/function mergeRecordArrays[\s\S]*?\n}\n/);
  const mergePartsSrc = src.match(/function mergePartsReferenceUnits[\s\S]*?\n}\n/);
  assert.ok(mergeRecordArraysSrc, 'mergeRecordArrays not found in sync.js -- did it get renamed or removed?');
  assert.ok(mergePartsSrc, 'mergePartsReferenceUnits not found in sync.js -- did it get renamed or removed?');
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('sandbox', mergeRecordArraysSrc[0] + mergePartsSrc[0] +
    'sandbox.mergeRecordArrays = mergeRecordArrays; sandbox.mergePartsReferenceUnits = mergePartsReferenceUnits;'
  )(sandbox);
  return sandbox;
}

test('th_parts_reference_units is registered as a synced key', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  assert.match(src, /'th_parts_reference_units'/, 'Appliance Wiki data key missing from SYNC_DATA_KEYS');
  assert.match(src, /th_parts_reference_units:\s*'id'/, 'Appliance Wiki data key missing from MERGE_KEY_FIELD');
});

test('mergeRecordArrays: an add on either side survives, no duplicates for shared ids', () => {
  const { mergeRecordArrays } = loadMergeFunctions();
  const local = [{ id: 1, name: 'a' }, { id: 2, name: 'local-only' }];
  const remote = [{ id: 1, name: 'a' }, { id: 3, name: 'remote-only' }];
  const result = mergeRecordArrays(local, remote, 'id');
  const ids = result.map(r => r.id).sort();
  assert.deepEqual(ids, [1, 2, 3]);
});

test('mergePartsReferenceUnits: two different NEW issues added to the SAME unit on different devices both survive', () => {
  const { mergePartsReferenceUnits } = loadMergeFunctions();
  const local = [{
    id: 100, brand: 'GE', type: 'Dryer', model: 'PTD60EBSR0WS',
    issues: [{ id: 1, symptom: 'shared' }, { id: 2, symptom: 'added locally' }],
  }];
  const remote = [{
    id: 100, brand: 'GE', type: 'Dryer', model: 'PTD60EBSR0WS',
    issues: [{ id: 1, symptom: 'shared' }, { id: 3, symptom: 'added remotely' }],
  }];
  const result = mergePartsReferenceUnits(local, remote);
  assert.equal(result.length, 1, 'expected the same unit, not duplicated');
  const issueIds = result[0].issues.map(i => i.id).sort();
  assert.deepEqual(issueIds, [1, 2, 3], 'an issue added on one side did not survive the merge');
});

test('mergePartsReferenceUnits: a brand-new unit added on either side survives', () => {
  const { mergePartsReferenceUnits } = loadMergeFunctions();
  const local = [{ id: 200, brand: 'Whirlpool', type: 'Washer', model: 'ABC', issues: [] }];
  const remote = [{ id: 201, brand: 'Samsung', type: 'Range', model: 'XYZ', issues: [] }];
  const result = mergePartsReferenceUnits(local, remote);
  const ids = result.map(u => u.id).sort();
  assert.deepEqual(ids, [200, 201]);
});
