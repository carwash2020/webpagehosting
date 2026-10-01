// Dev Tools' Full Backup / Restore covers every synced key (2026-10-01).
// It used to keep its own hand-written list of 17 keys, which had drifted
// from the 49 that sync: a backup left out the client registry, every
// tombstone, review requests, the shift log, Runway's data and the whole
// Appliance Wiki, so a restore could lose them or bring deleted records
// back. The list now comes from sync.js's SYNC_DATA_KEYS + WIKI_SYNC_KEYS.
//
// Runs the real backup code from tools/dev-tools.html against the real
// key lists from tools/sync.js in jsdom.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const DEV_TOOLS = fs.readFileSync(path.join(TOOLS, 'dev-tools.html'), 'utf8');
const SYNC = fs.readFileSync(path.join(TOOLS, 'sync.js'), 'utf8');

const BACKUP_JS = DEV_TOOLS.match(/  const BACKUP_FORMAT = 2;[\s\S]*?\n  function restoreBackup\(event\) \{[\s\S]*?\n    reader\.readAsText\(file\);\n  \}\n/)[0];
const KEY_LISTS = ['WIKI_SYNC_KEYS', 'SYNC_DATA_KEYS']
  .map((name) => SYNC.match(new RegExp('const ' + name + ' = \\[[\\s\\S]*?\\n\\];'))[0]).join('\n');

function keysOf(name) {
  const body = SYNC.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n\\];'))[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
const SYNC_KEYS = keysOf('SYNC_DATA_KEYS');
const WIKI_KEYS = keysOf('WIKI_SYNC_KEYS');

// The 17 keys the old list had, for "an older backup still restores".
const OLD_17 = ['th_tracker_jobs', 'th_tracker_contacts', 'th_tracker_notes_v2', 'th_expense_log', 'th_income_log',
  'th_mileage_rate', 'th_price_reference', 'th_invoices', 'th_quotes', 'th_tax_rate', 'th_tax_labor', 'th_tax_parts',
  'th_compliance', 'th_job_templates', 'th_contracts', 'th_setaside_rate', 'th_inventory'];

function setup({ withSync = true, store = {}, confirm = true } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/dev-tools.html', runScripts: 'outside-only' });
  const w = dom.window;
  Object.entries(store).forEach(([k, v]) => w.localStorage.setItem(k, v));
  const out = { toasts: [], alerts: [], confirms: [], blobs: [], syncs: 0, wikiSyncs: 0, writes: [] };
  w.showToast = (msg, opts) => out.toasts.push({ msg, type: opts && opts.type });
  w.showAlert = async (msg) => { out.alerts.push(msg); };
  w.showConfirm = async (msg) => { out.confirms.push(msg); return confirm; };
  w.scheduleSync = () => { out.syncs++; };
  w.scheduleWikiSync = () => { out.wikiSyncs++; };
  w.Blob = function (parts) { out.blobs.push(JSON.parse(parts.join(''))); };
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  // Assigning setItem on the storage object would just store an item named
  // "setItem"; record writes on the prototype instead.
  const realSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (k, v) { out.writes.push(k); return realSet.call(this, k, v); };
  w.eval((withSync ? KEY_LISTS : '') + '\n' + BACKUP_JS.replace(/\n  const /g, '\n  var ') +
    '\nwindow.__b = { fullBackupKeys, downloadBackup, restoreBackup };');
  out.restore = (json) => new Promise((resolve) => {
    // FileReader stand-in: hand the JSON straight to onload, then wait for the async handler.
    w.FileReader = function () {
      this.readAsText = () => { this.result = json; Promise.resolve(this.onload()).then(() => setTimeout(resolve, 0)); };
    };
    w.__b.restoreBackup({ target: { files: [{}], value: 'x' } });
  });
  return { w, api: w.__b, out };
}

test('the backup covers every key sync.js syncs, including the wiki, in sync order', () => {
  const { api } = setup();
  const keys = Array.from(api.fullBackupKeys());
  assert.equal(SYNC_KEYS.length, 49, 'sanity: the sync list this test reads');
  assert.deepEqual(keys, SYNC_KEYS.concat(WIKI_KEYS));
  for (const k of ['th_clients', 'th_client_tombstones', 'th_job_tombstones', 'th_review_requests_log', 'th_shift_log',
    'rd_debts', 'th_parts_reference_units', 'th_pr_unit_tombstones']) {
    assert.ok(keys.includes(k), k + ' is backed up');
  }
  for (const k of OLD_17) assert.ok(keys.includes(k), 'still backs up ' + k);
  // Tombstones come before the list they protect, as in sync.
  assert.ok(keys.indexOf('th_client_tombstones') < keys.indexOf('th_clients'));
  assert.ok(keys.indexOf('th_job_tombstones') < keys.indexOf('th_tracker_jobs'));
});

test('Download writes every key with a format marker', () => {
  const store = { th_clients: '[{"id":"c_1"}]', th_client_tombstones: '[{"id":"c_old"}]', th_parts_reference_units: '[]' };
  const { api, out } = setup({ store });
  api.downloadBackup();
  assert.equal(out.blobs.length, 1);
  const file = out.blobs[0];
  assert.equal(file._backup.format, 2);
  assert.equal(file._backup.keys, SYNC_KEYS.length + WIKI_KEYS.length);
  assert.equal(file.th_clients, '[{"id":"c_1"}]');
  assert.equal(file.th_client_tombstones, '[{"id":"c_old"}]');
  assert.equal(file.th_parts_reference_units, '[]');
  for (const k of SYNC_KEYS.concat(WIKI_KEYS)) assert.ok(k in file, k + ' is in the file, even when empty on this device');
  assert.match(out.toasts[0].msg, /Backup downloaded \(52 kinds of data\)/);
});

test("if sync.js hasn't loaded, Download refuses instead of saving a partial backup", () => {
  const { api, out } = setup({ withSync: false });
  api.downloadBackup();
  assert.equal(out.blobs.length, 0);
  assert.equal(out.toasts[0].type, 'error');
  assert.match(out.toasts[0].msg, /full backup is not possible/);
});

test('a full backup restores every key, tombstones before their lists, and syncs both the main data and the wiki', async () => {
  const backup = { _backup: { format: 2 } };
  SYNC_KEYS.concat(WIKI_KEYS).forEach((k) => { backup[k] = '"' + k + '"'; });
  const { w, out } = setup({ store: { th_clients: '"device copy"' } });
  await out.restore(JSON.stringify(backup));
  assert.equal(out.confirms.length, 1);
  assert.match(out.confirms[0], /This will REPLACE all current data/);
  assert.doesNotMatch(out.confirms[0], /older backup/);
  assert.equal(w.localStorage.getItem('th_clients'), '"th_clients"');
  assert.equal(w.localStorage.getItem('th_parts_reference_units'), '"th_parts_reference_units"');
  assert.equal(out.writes.length, 52);
  assert.ok(out.writes.indexOf('th_client_tombstones') < out.writes.indexOf('th_clients'));
  assert.equal(out.syncs, 1);
  assert.equal(out.wikiSyncs, 1);
  assert.match(out.alerts[0], /Backup restored \(52 kinds of data\)/);
});

test('an older 17-key backup still restores, says so, and leaves the client list it never had alone', async () => {
  const old = {};
  OLD_17.forEach((k) => { old[k] = '"old ' + k + '"'; });
  const { w, out } = setup({ store: { th_clients: '"keep me"', th_client_tombstones: '"keep tombstones"' } });
  await out.restore(JSON.stringify(old));
  assert.match(out.confirms[0], /older backup: it holds 17 kinds of data/);
  assert.equal(w.localStorage.getItem('th_tracker_jobs'), '"old th_tracker_jobs"');
  assert.equal(w.localStorage.getItem('th_clients'), '"keep me"');
  assert.equal(w.localStorage.getItem('th_client_tombstones'), '"keep tombstones"');
  assert.equal(out.wikiSyncs, 0, 'no wiki data in it, so no wiki push');
});

test('cancelling the restore confirm writes nothing', async () => {
  const { out } = setup({ confirm: false });
  await out.restore(JSON.stringify({ th_tracker_jobs: '[]' }));
  assert.equal(out.writes.length, 0);
  assert.equal(out.syncs, 0);
});

test('a file that is not JSON is refused before anything is written', async () => {
  const { out } = setup();
  await out.restore('not json');
  assert.match(out.alerts[0], /not valid backup JSON/);
  assert.equal(out.writes.length, 0);
});
