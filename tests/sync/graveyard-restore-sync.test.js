// Graveyard Restore survives sync (bug fix, 2026-09-23). Restore used to
// delete the record's tombstone and drop the Graveyard entry locally. Both
// lists merge as a union, so the next pull brought both back from the
// server's copy: the tombstone deleted the just-restored record again, and
// the entry reappeared in the Graveyard. Now Restore marks the tombstone
// restoredAt (thLiftTombstone) and the entry removedAt, marks that merge
// like any other edit. These tests run two devices against one server copy
// the way pushSync does it: pull and merge first, then push the result.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const DL = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(TOOLS, 'sync.js'), 'utf8');
const DEV = fs.readFileSync(path.join(TOOLS, 'dev-tools.html'), 'utf8');
const RESTORE = DEV.match(/const GRAVEYARD_TYPE_CONFIG[\s\S]*?async function permanentlyDeleteFromGraveyard[\s\S]*?\n  \}/)[0];

function device() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="graveyardList"></div></body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.showToast = () => {};
      w.showAlert = async () => {};
      w.showConfirm = async () => true;
      w.escapeHtml = (s) => String(s == null ? '' : s);
    },
  });
  const w = dom.window;
  for (const src of [DL, SYNC, RESTORE]) { const s = w.document.createElement('script'); s.textContent = src; w.document.head.appendChild(s); }
  w.scheduleSync = () => {}; // pushes are driven by hand below
  return w;
}
let server = null;
const push = (d) => { if (server) d.applySyncData(server); server = d.collectSyncData(); };
const pull = (d) => { d.applySyncData(server); };
const jobs = (d) => JSON.parse(d.localStorage.getItem('th_tracker_jobs') || '[]').map(j => j.id);

function deleteJob(d, id) {
  const list = d.thRead('th_tracker_jobs', []);
  const job = list.find(j => j.id === id);
  d.thWrite('th_tracker_jobs', list.filter(j => j.id !== id));
  d.thAddJobTombstone(id);
  d.thAddToGraveyard('job', job);
}

test('the bug: a restored job stays restored through the next sync, and reaches the other device', () => {
  server = null;
  const a = device(), b = device();
  a.thWrite('th_tracker_jobs', [{ id: 'j1', title: 'Sink leak' }, { id: 'j2', title: 'Fence' }]);
  push(a);
  pull(b);
  assert.deepEqual(jobs(b), ['j1', 'j2']);

  deleteJob(a, 'j1');
  push(a);
  pull(b);
  assert.deepEqual(jobs(b), ['j2'], 'the delete reaches the other device');

  a.restoreFromGraveyard(a.thLoadGraveyard()[0].graveyardId);
  assert.deepEqual(jobs(a), ['j2', 'j1']);
  push(a); // pulls the server's copy first -- tombstone and all -- then pushes
  assert.deepEqual(jobs(a), ['j2', 'j1'], 'still restored after the pull that used to delete it again');
  pull(a);
  assert.deepEqual(jobs(a), ['j2', 'j1']);

  pull(b);
  assert.deepEqual(jobs(b).sort(), ['j1', 'j2'], 'the other device gets it back too');
  assert.equal(b.thLoadGraveyard().length, 0, 'and its Graveyard no longer lists it');
});

test('a stale device that never saw the restore can\'t delete it again', () => {
  server = null;
  const a = device(), stale = device();
  a.thWrite('th_tracker_jobs', [{ id: 'j1', title: 'Sink leak' }]);
  push(a);
  pull(stale);
  deleteJob(a, 'j1');
  push(a);
  pull(stale); // the stale device has the tombstone, and nothing else since
  a.restoreFromGraveyard(a.thLoadGraveyard()[0].graveyardId);
  push(a);
  stale.localStorage.setItem('th_tracker_jobs', '[]');
  push(stale); // pushes its old, unmarked view of the tombstone
  pull(a);
  assert.deepEqual(jobs(a), ['j1']);
  pull(stale);
  assert.deepEqual(jobs(stale), ['j1']);
});

test('deleted again after a restore: the new delete sticks everywhere', () => {
  server = null;
  const a = device(), b = device();
  a.thWrite('th_tracker_jobs', [{ id: 'j1', title: 'Sink leak' }]);
  push(a);
  pull(b);
  deleteJob(a, 'j1');
  push(a);
  a.restoreFromGraveyard(a.thLoadGraveyard()[0].graveyardId);
  push(a);
  pull(b);
  assert.deepEqual(jobs(b), ['j1']);

  deleteJob(b, 'j1');
  push(b);
  pull(a);
  assert.deepEqual(jobs(a), [], 'a delete newer than the restore counts');
  pull(b);
  assert.deepEqual(jobs(b), []);
});

test('Restore and Delete permanently both stick in the Graveyard: the entry doesn\'t come back from the server', async () => {
  server = null;
  const a = device();
  a.thWrite('th_tracker_jobs', [{ id: 'j1', title: 'Sink leak' }, { id: 'j2', title: 'Fence' }]);
  deleteJob(a, 'j1');
  deleteJob(a, 'j2');
  push(a);
  assert.equal(a.thLoadGraveyard().length, 2);
  const [first, second] = a.thLoadGraveyard();
  a.restoreFromGraveyard(first.graveyardId);
  await a.permanentlyDeleteFromGraveyard(second.graveyardId);
  assert.equal(a.thLoadGraveyard().length, 0);
  a.applySyncData(server); // the server's copy still lists both, unmarked
  assert.equal(a.thLoadGraveyard().length, 0, 'neither comes back');
  const raw = a.thLoadGraveyardRaw();
  assert.equal(raw.length, 2, 'both kept, marked, so the marks can travel');
  assert.ok(raw.every(g => g.removedAt));
});

test('the Appliance Wiki\'s own sync: a restored unit stays restored', () => {
  const a = device();
  a.thWriteWiki('th_parts_reference_units', []);
  a.thAddPrUnitTombstone('u1');
  a.thAddToGraveyard('prUnit', { id: 'u1', brand: 'GE', type: 'Dryer', issues: [] });
  const serverWiki = a.collectWikiSyncData();
  a.restoreFromGraveyard(a.thLoadGraveyard()[0].graveyardId);
  assert.ok(a.thRead('th_pr_unit_tombstones', [])[0].restoredAt);
  a.applySyncData(serverWiki, ['th_pr_unit_tombstones', 'th_pr_issue_tombstones', 'th_parts_reference_units']); // WIKI_SYNC_KEYS
  assert.deepEqual(JSON.parse(a.localStorage.getItem('th_parts_reference_units')).map(u => u.id), ['u1']);
});

test('which tombstones count: none restored, restored after the delete, deleted again after the restore', () => {
  const d = device();
  const t0 = '2026-09-20T10:00:00.000Z', t1 = '2026-09-21T10:00:00.000Z', t2 = '2026-09-22T10:00:00.000Z';
  d.localStorage.setItem('th_tracker_jobs', JSON.stringify([]));
  const apply = (tombs) => {
    d.localStorage.setItem('th_tracker_jobs', '[]');
    d.localStorage.setItem('th_job_tombstones', '[]');
    d.localStorage.removeItem('th_sync_base');
    d.applySyncData({ th_job_tombstones: JSON.stringify(tombs), th_tracker_jobs: JSON.stringify([{ id: 'j1' }]) });
    return jobs(d);
  };
  assert.deepEqual(apply([{ id: 'j1', deletedAt: t0 }]), [], 'a plain tombstone counts');
  assert.deepEqual(apply([{ id: 'j1', deletedAt: t0, restoredAt: t1 }]), ['j1'], 'restored after the delete: it doesn\'t');
  assert.deepEqual(apply([{ id: 'j1', deletedAt: t2, restoredAt: t1 }]), [], 'deleted after the restore: it does');
  assert.deepEqual(apply([{ id: 'j1', deletedAt: t0, restoredAt: 'garbage' }]), [], 'an unreadable restoredAt: it still counts');
});

test('every tombstone read in applySyncData goes through the same rule', () => {
  const apply = SYNC.slice(SYNC.indexOf('function applySyncData('), SYNC.indexOf('const SYNC_HISTORY_KEY'));
  const reads = apply.match(/localStorage\.getItem\('th_[a-z_]+_tombstones'\) \|\| '\[\]'\)[^;]*/g) || [];
  assert.ok(reads.length >= 16);
  assert.deepEqual(reads.filter(r => !r.includes('.filter(tombstoneCounts)')), []);
});
