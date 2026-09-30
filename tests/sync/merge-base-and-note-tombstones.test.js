// Sync fixes (2026-09-30), run against the real sync.js + data-layer.js:
// 1. pushSync() now saves what it pushed as the merge base. Before, the
//    base was saved only while merging keys the server already had, so
//    the first push of a key (or a push after the pre-push fetch failed)
//    left no base, and this device's next edits to those records lost to
//    the server's older copy on the following pull.
// 2. Notes and "Flag this page" items have tombstones, so a stale device
//    can't bring a deleted one back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const SYNC = fs.readFileSync(path.join(TOOLS, 'sync.js'), 'utf8');
const DATA = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');

// server: { row: {data, updated_at} | null, failGet, failPost }
function load(server) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/tools/job-tracker.html',
    beforeParse(w) {
      w.SUPABASE_URL = 'https://x.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon';
      w.getAuthToken = () => 'token';
      w.showToast = () => {};
      w.__posts = [];
      w.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        if (/workspace_sync\?code=eq\./.test(url) && method === 'GET') {
          if (server.failGet) throw new Error('offline');
          return { ok: true, status: 200, json: async () => (server.row ? [server.row] : []) };
        }
        if (/workspace_sync\?on_conflict=code/.test(url) && method === 'POST') {
          if (server.failPost) return { ok: false, status: 500, json: async () => ({}) };
          const body = JSON.parse(opts.body)[0];
          w.__posts.push(body);
          server.row = { data: body.data, updated_at: body.updated_at };
          return { ok: true, status: 201, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => [] };
      };
    },
  });
  const w = dom.window;
  for (const src of [DATA, SYNC]) {
    const s = w.document.createElement('script');
    s.textContent = src;
    w.document.head.appendChild(s);
  }
  return w;
}
const get = (w, k) => JSON.parse(w.localStorage.getItem(k) || 'null');
const put = (w, k, v) => w.localStorage.setItem(k, JSON.stringify(v));

test('pushing a key the server never had saves it as the base, so the next pull keeps this device\'s later edit', async () => {
  const server = { row: null };
  const w = load(server);
  put(w, 'th_tracker_notes_v2', [{ id: 1, title: 'Parts to order', body: 'belt' }]);
  const r = await w.pushSync();
  assert.equal(r.ok, true);
  assert.deepEqual(get(w, 'th_sync_base').th_tracker_notes_v2, [{ id: 1, title: 'Parts to order', body: 'belt' }]);

  // Edited again before anything is pulled...
  put(w, 'th_tracker_notes_v2', [{ id: 1, title: 'Parts to order', body: 'belt + idler pulley' }]);
  // ...then a pull brings back this device's own first push.
  const p = await w.pullSync();
  assert.equal(p.ok, true);
  assert.deepEqual(get(w, 'th_tracker_notes_v2'), [{ id: 1, title: 'Parts to order', body: 'belt + idler pulley' }], 'the newer local edit survives');
  assert.deepEqual(get(w, 'th_sync_conflicts') || [], [], 'and it is not logged as a conflict');
});

test('a push whose pre-push fetch failed still leaves the right base behind', async () => {
  const server = { row: { data: { th_tracker_notes_v2: JSON.stringify([{ id: 1, title: 'old' }]) }, updated_at: '2026-09-29T00:00:00Z' } };
  const w = load(server);
  put(w, 'th_sync_base', { th_tracker_notes_v2: [{ id: 1, title: 'older still' }] });
  put(w, 'th_tracker_notes_v2', [{ id: 1, title: 'v1' }]);
  server.failGet = true;
  assert.equal((await w.pushSync()).ok, true);
  server.failGet = false;
  assert.deepEqual(get(w, 'th_sync_base').th_tracker_notes_v2, [{ id: 1, title: 'v1' }], 'base = what the server now holds');
  put(w, 'th_tracker_notes_v2', [{ id: 1, title: 'v2' }]);
  await w.pullSync();
  assert.deepEqual(get(w, 'th_tracker_notes_v2'), [{ id: 1, title: 'v2' }], 'no false conflict won by the server copy');
  assert.deepEqual(get(w, 'th_sync_conflicts') || [], []);
});

test('a failed push leaves the base alone', async () => {
  const server = { row: null, failPost: true };
  const w = load(server);
  put(w, 'th_sync_base', { th_tracker_notes_v2: [{ id: 1, title: 'server copy' }] });
  put(w, 'th_tracker_notes_v2', [{ id: 1, title: 'unsent' }]);
  assert.equal((await w.pushSync()).ok, false);
  assert.deepEqual(get(w, 'th_sync_base').th_tracker_notes_v2, [{ id: 1, title: 'server copy' }]);
});

test('the base is not saved for the four keys merged without one', async () => {
  const w = load({ row: null });
  put(w, 'th_graveyard', [{ graveyardId: 'g1', recordType: 'job', record: { id: 1 } }]);
  put(w, 'th_sync_conflicts', [{ id: 'c1' }]);
  put(w, 'th_invoices', [{ id: 5, total: 10 }]);
  await w.pushSync();
  const base = get(w, 'th_sync_base');
  assert.ok(!('th_graveyard' in base) && !('th_sync_conflicts' in base));
  assert.deepEqual(base.th_invoices, [{ id: 5, total: 10 }]);
  // The push path's skip list and applySyncData's inline one are the same four keys.
  const set = SYNC.match(/const SYNC_BASE_SKIPPED_KEYS = new Set\(\[([^\]]+)\]\);/)[1].match(/'[a-z_]+'/g).sort();
  const inline = SYNC.match(/if \(!\[([^\]]+)\]\.includes\(k\)\) \{\n\s+saveSyncBaseForKey\(k, finalArr\);/)[1].match(/'[a-z_]+'/g).sort();
  assert.deepEqual(set, inline);
});

test('a deleted note stays deleted when a stale device pushes its old copy back', async () => {
  const w = load({ row: null });
  put(w, 'th_tracker_notes_v2', [{ id: 1, title: 'keep' }, { id: 2, title: 'delete me' }]);
  w.thAddNoteTombstone(2);
  put(w, 'th_tracker_notes_v2', [{ id: 1, title: 'keep' }]);
  assert.deepEqual(get(w, 'th_note_tombstones').map((t) => t.id), [2]);
  // The stale device's copy still has note 2 (and no tombstone).
  w.applySyncData({ th_tracker_notes_v2: JSON.stringify([{ id: 1, title: 'keep' }, { id: 2, title: 'delete me' }]) });
  assert.deepEqual(get(w, 'th_tracker_notes_v2').map((n) => n.id), [1]);
  // A device that only receives the tombstone drops its own copy too.
  const other = load({ row: null });
  put(other, 'th_tracker_notes_v2', [{ id: 2, title: 'delete me' }]);
  other.applySyncData({ th_note_tombstones: JSON.stringify(get(w, 'th_note_tombstones')), th_tracker_notes_v2: JSON.stringify([]) });
  assert.deepEqual(get(other, 'th_tracker_notes_v2'), []);
});

test('a deleted flagged item stays deleted too, whichever delete button removed it', async () => {
  const w = load({ row: null });
  const a = w.thAddFlaggedItem('Finance', 'check totals');
  const b = w.thAddFlaggedItem('Clients', 'dup');
  const stale = JSON.stringify(get(w, 'th_flagged_items'));
  w.thDeleteFlaggedItem(b.id);
  assert.deepEqual(get(w, 'th_flagged_tombstones').map((t) => t.id), [b.id]);
  w.applySyncData({ th_flagged_items: stale });
  assert.deepEqual(get(w, 'th_flagged_items').map((f) => f.id), [a.id]);
  // Dev Tools' own delete and Job Tracker's note delete record tombstones as well.
  const DEV = fs.readFileSync(path.join(TOOLS, 'dev-tools.html'), 'utf8');
  const JT = fs.readFileSync(path.join(TOOLS, 'job-tracker.html'), 'utf8');
  assert.match(DEV, /function deleteFlaggedItem\(id\) \{\n\s+if \(typeof thAddFlaggedTombstone === 'function'\) thAddFlaggedTombstone\(id\);/);
  assert.match(JT, /animateRowExit\(row, \(\) => \{\n\s+if \(typeof thAddNoteTombstone === 'function'\) thAddNoteTombstone\(id\);/);
});

test('both tombstone lists sync, each just before its list', () => {
  const keys = SYNC.match(/const SYNC_DATA_KEYS = \[([\s\S]*?)\n\];/)[1].match(/'[a-z0-9_-]+'/g).map((k) => k.slice(1, -1));
  assert.equal(keys.indexOf('th_note_tombstones') + 1, keys.indexOf('th_tracker_notes_v2'));
  assert.equal(keys.indexOf('th_flagged_tombstones') + 1, keys.indexOf('th_flagged_items'));
  assert.match(SYNC, /th_note_tombstones: 'id',/);
  assert.match(SYNC, /th_flagged_tombstones: 'id',/);
});
