// Sync check failure (2026-11-05): a Job Tracker note made on Nov 3 at
// 9:05pm and renamed seconds later ("Testing sync" / "Test test") was on the
// server only as "Untitled Note", and the device never sent the rename.
// Runs the real sync.js + data-layer.js against a fake server whose replies
// can be held, to reproduce what a slow phone connection does.
//
// Proved:
//   - two pushes never run at once: a push asked for during another one
//     runs after it, with the data as it is then, so an older payload can't
//     land on top of a newer one (the cause of the lost rename);
//   - an edit whose push never landed stays marked on the device; the next
//     load pushes it, and so does coming back to the page;
//   - each device makes one catch-up push for edits stranded before the
//     mark existed (the Nov 3 note), then never again unless marked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const SYNC = fs.readFileSync(path.join(TOOLS, 'sync.js'), 'utf8');
const DATA = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');

// server.row: the legacy row; server.hold: true makes each POST wait until release().
function load(server, seed = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/tools/job-tracker.html',
    beforeParse(w) {
      for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
      w.SUPABASE_URL = 'https://x.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon';
      w.getAuthToken = () => 'token';
      w.showToast = () => {};
      w.__posts = [];
      w.__held = [];
      w.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        if (/workspace_sync\?code=eq\./.test(url) && method === 'GET') {
          return { ok: true, status: 200, json: async () => (server.row ? [server.row] : []) };
        }
        if (/workspace_sync\?on_conflict=code/.test(url) && method === 'POST') {
          const body = JSON.parse(opts.body)[0];
          const land = () => { w.__posts.push(body); server.row = { data: body.data, updated_at: body.updated_at }; return { ok: true, status: 201, json: async () => ({}) }; };
          if (server.failPost) return { ok: false, status: 500, json: async () => ({}) };
          if (!server.hold) return land();
          return new Promise((resolve) => w.__held.push(() => resolve(land())));
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
const notesOnServer = (server) => JSON.parse(server.row.data.th_tracker_notes_v2);
const setNotes = (w, notes) => w.localStorage.setItem('th_tracker_notes_v2', JSON.stringify(notes));
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond) { for (let i = 0; i < 240 && !cond(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(cond(), 'timed out'); }

test('a rename made while the first push is still in flight is what the server ends up with (the Nov 3 note)', async () => {
  const server = { row: null, hold: true };
  const w = load(server);
  setNotes(w, [{ id: 1, title: 'Untitled Note', body: '' }]);
  const first = w.pushSync();
  await until(() => w.__held.length === 1);
  setNotes(w, [{ id: 1, title: 'Testing sync', body: 'Test test' }]);
  const second = w.pushSync();
  await tick(); await tick();
  assert.equal(w.__held.length, 1, 'the rename waits for the first push instead of racing it');
  w.__held[0]();
  await first;
  await until(() => w.__held.length === 2);
  w.__held[1]();
  assert.equal((await second).ok, true);
  assert.deepEqual(notesOnServer(server), [{ id: 1, title: 'Testing sync', body: 'Test test' }]);
  assert.equal(w.__posts.length, 2);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('th_sync_base')).th_tracker_notes_v2, [{ id: 1, title: 'Testing sync', body: 'Test test' }], 'the base is the newest push, not the older one');
});

test('any number of saves during one push become one more push, with the latest data', async () => {
  const server = { row: null, hold: true };
  const w = load(server);
  setNotes(w, [{ id: 1, title: 'a' }]);
  const p1 = w.pushSync();
  await until(() => w.__held.length === 1);
  setNotes(w, [{ id: 1, title: 'b' }]);
  const p2 = w.pushSync();
  setNotes(w, [{ id: 1, title: 'c' }]);
  const p3 = w.pushSync();
  assert.equal(p2, p3, 'one queued push shared by every caller');
  w.__held[0]();
  await p1;
  await until(() => w.__held.length === 2);
  w.__held[1]();
  await p3;
  assert.equal(w.__posts.length, 2);
  assert.deepEqual(notesOnServer(server), [{ id: 1, title: 'c' }]);
});

test('an edit whose push never landed stays marked, and the next load sends it', async () => {
  const server = { row: { data: { th_tracker_notes_v2: JSON.stringify([{ id: 1, title: 'Untitled Note' }]) }, updated_at: '2026-11-04T04:06:00Z' }, failPost: true };
  // A device that has synced before: its base matches the server.
  const w = load(server, { th_sync_catchup_2026_11_05: 'done', th_sync_base: JSON.stringify({ th_tracker_notes_v2: [{ id: 1, title: 'Untitled Note' }] }) });
  setNotes(w, [{ id: 1, title: 'Testing sync' }]);
  w.scheduleSync();
  assert.ok(w.localStorage.getItem('th_sync_unpushed_at'), 'marked the moment it is saved');
  await w.pushSync();
  assert.ok(w.localStorage.getItem('th_sync_unpushed_at'), 'a failed push keeps the mark');

  // The page is closed. Later, the same device opens it again.
  server.failPost = false;
  const keep = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); keep[k] = w.localStorage.getItem(k); }
  const again = load(server, keep);
  again.loadCurrentUserRole = async () => {};
  await again.initSyncOnLoad();
  await until(() => again.__posts.length === 1);
  assert.deepEqual(notesOnServer(server), [{ id: 1, title: 'Testing sync' }]);
  await until(() => !again.localStorage.getItem('th_sync_unpushed_at'));
});

test('coming back to the page sends a marked edit; nothing marked, nothing sent', async () => {
  const server = { row: null };
  const w = load(server, { th_sync_unpushed_at: String(Date.now() - 60000) });
  setNotes(w, [{ id: 1, title: 'from before' }]);
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'visible' });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 2700));
  assert.equal(w.__posts.length, 1);
  assert.equal(w.localStorage.getItem('th_sync_unpushed_at'), null);
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 2700));
  assert.equal(w.__posts.length, 1, 'no mark, no extra push');
});

test('one catch-up push per device for edits stranded before the mark existed, then none', async () => {
  const server = { row: { data: { th_tracker_notes_v2: JSON.stringify([{ id: 1, title: 'Untitled Note', body: '' }]) }, updated_at: '2026-11-04T04:06:00Z' } };
  // The device as it was: base and server say Untitled, the device has the rename, no mark.
  const w = load(server, {
    th_tracker_notes_v2: JSON.stringify([{ id: 1, title: 'Testing sync', body: 'Test test' }]),
    th_sync_base: JSON.stringify({ th_tracker_notes_v2: [{ id: 1, title: 'Untitled Note', body: '' }] }),
  });
  w.loadCurrentUserRole = async () => {};
  await w.initSyncOnLoad();
  await until(() => w.__posts.length === 1);
  assert.deepEqual(notesOnServer(server), [{ id: 1, title: 'Testing sync', body: 'Test test' }], 'the stranded rename reaches the server');
  assert.ok(w.localStorage.getItem('th_sync_catchup_2026_11_05'));
  await w.initSyncOnLoad();
  await new Promise((r) => setTimeout(r, 2700));
  assert.equal(w.__posts.length, 1, 'only once');
});

test('a pull saves what the server holds as the base, so a second merge keeps an edit the server lacks', async () => {
  const server = { row: { data: { th_tracker_notes_v2: JSON.stringify([{ id: 1, title: 'Untitled Note' }]) }, updated_at: '2026-11-04T04:06:00Z' } };
  const w = load(server, {
    th_sync_catchup_2026_11_05: 'done',
    th_tracker_notes_v2: JSON.stringify([{ id: 1, title: 'Testing sync' }]),
    th_sync_base: JSON.stringify({ th_tracker_notes_v2: [{ id: 1, title: 'Untitled Note' }] }),
  });
  await w.pullSync();
  await w.pullSync();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('th_tracker_notes_v2')), [{ id: 1, title: 'Testing sync' }], 'two pulls in a row never revert it');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('th_sync_base')).th_tracker_notes_v2, [{ id: 1, title: 'Untitled Note' }], 'the base is the server copy');
});
