// Graveyard restore, every record type (2026-09-23). Follow-up to #393,
// which fixed Restore being undone by the next sync (restoredAt + a by-time
// tombstone merge; see tests/sync/graveyard-restore-sync.test.js for its
// own tests). These add:
//   - the bug's repro for EVERY type in GRAVEYARD_TYPE_CONFIG (read from
//     the page, so a type added later is covered) plus the Wiki issue path;
//   - a restore on a device that holds no tombstone for the record at all
//     (thLiftTombstone now adds one already lifted -- before, nothing was
//     marked and the server's tombstone deleted the record again);
//   - pushWikiSync() merging the server's Wiki row before it posts, so a
//     device that hadn't pulled a restore (or a new entry) can't wipe it;
//   - thBackfillClients ignoring a lifted client tombstone.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');

function loadDevTools() {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'dev-tools.html'), 'utf8');
  const dataLayerSrc = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  const syncSrc = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  const restoreMatch = html.match(/const GRAVEYARD_TYPE_CONFIG[\s\S]*?async function permanentlyDeleteFromGraveyard[\s\S]*?\n  \}/);
  if (!restoreMatch) throw new Error('Could not extract graveyard restore functions from dev-tools.html');
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="graveyardList"></div></body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.showToast = () => {};
      w.showAlert = async (msg) => { w._lastAlert = msg; };
      w.showConfirm = async () => true;
      w.escapeHtml = (s) => String(s == null ? '' : s);
      w.money = (v) => '$' + (v || 0).toFixed(2);
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon';
    },
  });
  const { window } = dom;
  [dataLayerSrc, syncSrc, restoreMatch[0]].forEach(src => {
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  });
  return window;
}

const MINUTE = 60 * 1000;
const ago = (min) => new Date(Date.now() - min * MINUTE).toISOString();
const later = (min) => new Date(Date.now() + min * MINUTE).toISOString();
const read = (w, key) => JSON.parse(w.localStorage.getItem(key) || '[]');
const put = (w, key, value) => w.localStorage.setItem(key, JSON.stringify(value));

// Every record type the Graveyard can restore, read from the page itself so
// a type added later is covered automatically.
const TYPES = Object.entries(loadDevTools().eval('GRAVEYARD_TYPE_CONFIG'))
  .map(([recordType, cfg]) => ({ recordType, dataKey: cfg.dataKey, tombstoneKey: cfg.tombstoneKey }));

function syncKeysFor(w, dataKey) {
  const wikiKeys = w.eval('WIKI_SYNC_KEYS');
  return wikiKeys.includes(dataKey) ? wikiKeys : undefined; // undefined -> applySyncData's default SYNC_DATA_KEYS
}

// Puts a device in the state "this record was deleted and that deletion has
// synced": record gone, tombstone present, Graveyard snapshot present.
function deleteLocally(w, t, record) {
  put(w, t.dataKey, []);
  put(w, t.tombstoneKey, [{ id: record.id, deletedAt: ago(5) }]);
  w.thAddToGraveyard(t.recordType, record);
}

test('every Graveyard type is covered (14 flat types and the Wiki unit, plus the Wiki issue below)', () => {
  assert.ok(TYPES.length >= 14, 'found ' + TYPES.length);
  assert.ok(TYPES.some(t => t.recordType === 'prUnit'));
});

// ---------------------------------------------------------------------------
// The reported repro, for every type
// ---------------------------------------------------------------------------

for (const t of TYPES) {
  test(`${t.recordType}: a restore survives the merge pushSync does first, against a server that still holds the tombstone`, () => {
    const w = loadDevTools();
    const record = { id: 'r-' + t.recordType, title: 'Original', name: 'Original' };
    deleteLocally(w, t, record);
    const serverTombstones = w.localStorage.getItem(t.tombstoneKey); // what the server holds after the delete synced

    w.restoreFromGraveyard(w.thLoadGraveyard()[0].graveyardId);
    assert.equal(read(w, t.dataKey).length, 1, 'restored locally');

    w.applySyncData({ [t.dataKey]: '[]', [t.tombstoneKey]: serverTombstones }, syncKeysFor(w, t.dataKey));
    assert.deepEqual(read(w, t.dataKey).map(r => r.id), [record.id], 'the restored record must still be here after merging the server row');

    const merged = read(w, t.tombstoneKey);
    assert.equal(merged.length, 1);
    assert.ok(merged[0].restoredAt, 'the merged tombstone carries restoredAt, so the push that follows sends the restore to the server');
  });
}

test('prIssue (a Wiki issue): a restore survives the same merge', () => {
  const w = loadDevTools();
  const unit = { id: 'u1', brand: 'GE', issues: [] };
  const issue = { id: 'i1', symptom: 'Thumping' };
  w.thWriteWiki('th_parts_reference_units', [unit]);
  w.thWriteWiki('th_pr_issue_tombstones', [{ id: 'u1::i1', unitId: 'u1', issueId: 'i1', deletedAt: ago(5) }]);
  w.thAddToGraveyard('prIssue', { unitId: 'u1', issue });
  const serverTombstones = w.localStorage.getItem('th_pr_issue_tombstones');
  const serverUnits = JSON.stringify([unit]); // the server's unit still has no issue

  w.restoreFromGraveyard(w.thLoadGraveyard()[0].graveyardId);
  w.applySyncData({ th_parts_reference_units: serverUnits, th_pr_issue_tombstones: serverTombstones }, w.eval('WIKI_SYNC_KEYS'));
  const units = read(w, 'th_parts_reference_units');
  assert.deepEqual(units[0].issues.map(i => i.id), ['i1']);
});

// ---------------------------------------------------------------------------
// A tombstone still wins where it should
// ---------------------------------------------------------------------------

test('a stale device that never saw the restore picks it up on its next pull', () => {
  const t = TYPES.find(x => x.recordType === 'job');
  const record = { id: 'j1', title: 'Original' };
  // Device A deletes and restores; its merged state is what the server gets.
  const a = loadDevTools();
  deleteLocally(a, t, record);
  a.restoreFromGraveyard(a.thLoadGraveyard()[0].graveyardId);
  const server = { th_tracker_jobs: a.localStorage.getItem('th_tracker_jobs'), th_job_tombstones: a.localStorage.getItem('th_job_tombstones') };

  // Device B only ever saw the delete.
  const b = loadDevTools();
  put(b, 'th_tracker_jobs', []);
  put(b, 'th_job_tombstones', [{ id: 'j1', deletedAt: read(a, 'th_job_tombstones')[0].deletedAt }]);
  b.applySyncData(server);
  assert.deepEqual(read(b, 'th_tracker_jobs').map(j => j.id), ['j1']);
});

test('a stale device that never saw the delete still loses the record (the tombstone still works)', () => {
  const c = loadDevTools();
  put(c, 'th_tracker_jobs', [{ id: 'j1', title: 'Original' }]);
  c.applySyncData({ th_tracker_jobs: JSON.stringify([{ id: 'j1', title: 'Original' }]), th_job_tombstones: JSON.stringify([{ id: 'j1', deletedAt: ago(1) }]) });
  assert.deepEqual(read(c, 'th_tracker_jobs'), []);
});

test('deleting again after a restore wins over the earlier restore, on this device and after merging', () => {
  const w = loadDevTools();
  const t = TYPES.find(x => x.recordType === 'job');
  deleteLocally(w, t, { id: 'j1', title: 'Original' });
  w.restoreFromGraveyard(w.thLoadGraveyard()[0].graveyardId);
  const serverAfterRestore = w.localStorage.getItem('th_job_tombstones');

  // Deleted again later (a newer deletedAt than the restore).
  put(w, 'th_tracker_jobs', []);
  put(w, 'th_job_tombstones', read(w, 'th_job_tombstones').concat([{ id: 'j1', deletedAt: later(1) }]));
  w.applySyncData({ th_tracker_jobs: JSON.stringify([{ id: 'j1', title: 'Original' }]), th_job_tombstones: serverAfterRestore });
  assert.deepEqual(read(w, 'th_tracker_jobs'), [], 'the newer deletion beats the older restore');
  const merged = read(w, 'th_job_tombstones');
  assert.equal(merged.length, 1, 'duplicate ids collapse to one tombstone');
});

test('restoring on a device that has no tombstone at all still beats the server copy', () => {
  const w = loadDevTools();
  put(w, 'th_tracker_jobs', []);
  put(w, 'th_job_tombstones', []); // pruned, or this device never synced the delete
  w.thAddToGraveyard('job', { id: 'j1', title: 'Original' });
  w.restoreFromGraveyard(w.thLoadGraveyard()[0].graveyardId);
  w.applySyncData({ th_tracker_jobs: '[]', th_job_tombstones: JSON.stringify([{ id: 'j1', deletedAt: ago(5) }]) });
  assert.deepEqual(read(w, 'th_tracker_jobs').map(j => j.id), ['j1']);
});




// ---------------------------------------------------------------------------
// The Wiki push merges before it posts
// ---------------------------------------------------------------------------

test('pushWikiSync merges the server Wiki row in before posting, so it no longer wipes another device\'s restore or new entry', async () => {
  const w = loadDevTools();
  w.eval('isSyncConfigured = () => true; getSyncCode = () => "test-code";');
  w.getAuthToken = () => 'token';

  // This device: only unit u1.
  put(w, 'th_parts_reference_units', [{ id: 'u1', brand: 'GE', issues: [] }]);
  put(w, 'th_pr_unit_tombstones', [{ id: 'u2', deletedAt: ago(10) }]); // it saw u2 deleted, not restored
  // Server: another device restored u2 and added u3.
  const serverData = {
    th_parts_reference_units: JSON.stringify([{ id: 'u1', brand: 'GE', issues: [] }, { id: 'u2', brand: 'LG', issues: [] }, { id: 'u3', brand: 'Whirlpool', issues: [] }]),
    th_pr_unit_tombstones: JSON.stringify([{ id: 'u2', deletedAt: ago(10), restoredAt: ago(2) }]),
    th_pr_issue_tombstones: '[]',
  };
  let posted = null;
  w.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => [{ data: serverData, updated_at: ago(1) }] };
    posted = JSON.parse(opts.body)[0].data;
    return { ok: true, status: 201, json: async () => [] };
  };
  const result = await w.pushWikiSync();
  assert.equal(result.ok, true, JSON.stringify(result));
  const units = JSON.parse(posted.th_parts_reference_units).map(u => u.id).sort();
  assert.deepEqual(units, ['u1', 'u2', 'u3']);
  assert.ok(JSON.parse(posted.th_pr_unit_tombstones)[0].restoredAt, 'the restore is not overwritten');
});

test('thBackfillClients only honors client tombstones that still count (a lifted one no longer blocks the name)', () => {
  const w = loadDevTools();
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  assert.match(src, /thLoadClientTombstones\(\)\s*\n\s*\.filter\(t => !t\.restoredAt \|\| new Date\(t\.deletedAt\)\.getTime\(\) > new Date\(t\.restoredAt\)\.getTime\(\)\)/);
  assert.ok(w);
});
