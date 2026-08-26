const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

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

// --- Data layer basics ---------------------------------------------------

test('thAddToGraveyard records a full record snapshot, not just an id', () => {
  const window = loadDevTools();
  window.thAddToGraveyard('job', { id: 'j1', title: 'Test Job', client: 'Someone' });
  const entries = window.thLoadGraveyard();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].recordType, 'job');
  assert.equal(JSON.stringify(entries[0].record), JSON.stringify({ id: 'j1', title: 'Test Job', client: 'Someone' }));
  assert.ok(entries[0].graveyardId, 'should have its own id, separate from the record\'s own id');
  assert.ok(entries[0].deletedAt);
});

test('the graveyard caps at 200 entries locally, dropping the oldest first', () => {
  const window = loadDevTools();
  for (let i = 0; i < 205; i++) {
    window.thAddToGraveyard('job', { id: 'j' + i, title: 'Job ' + i });
  }
  const entries = window.thLoadGraveyard();
  assert.equal(entries.length, 200);
  assert.equal(entries[0].record.id, 'j5', 'the oldest 5 should have been dropped');
  assert.equal(entries[199].record.id, 'j204');
});

test('thRemoveFromGraveyard removes only the matching entry', () => {
  const window = loadDevTools();
  window.thAddToGraveyard('job', { id: 'j1', title: 'Keep' });
  window.thAddToGraveyard('job', { id: 'j2', title: 'Remove' });
  const toRemove = window.thLoadGraveyard().find(e => e.record.id === 'j2');
  window.thRemoveFromGraveyard(toRemove.graveyardId);
  const remaining = window.thLoadGraveyard();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].record.id, 'j1');
});

// --- Merge/recap behavior (matches mergeClientErrorLog's own fix) --------

test('mergeGraveyard re-caps at 200 after merging two devices\' independently-capped copies, keeping the most recent', () => {
  const window = loadDevTools();
  const syncJs = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  assert.match(syncJs, /function mergeGraveyard/, 'mergeGraveyard should exist');
  assert.match(syncJs, /th_graveyard['"]?\s*\n?\s*\?\s*mergeGraveyard/, 'applySyncData should route th_graveyard through mergeGraveyard');

  const localArr = [];
  const remoteArr = [];
  for (let i = 0; i < 150; i++) {
    localArr.push({ graveyardId: 'local_' + i, recordType: 'job', record: { id: 'j' + i }, deletedAt: new Date(2026, 0, 1, 0, 0, i).toISOString() });
  }
  for (let i = 0; i < 150; i++) {
    remoteArr.push({ graveyardId: 'remote_' + i, recordType: 'job', record: { id: 'k' + i }, deletedAt: new Date(2026, 0, 2, 0, 0, i).toISOString() });
  }
  const merged = window.mergeGraveyard(localArr, remoteArr);
  assert.equal(merged.length, 200, 'a plain union of 150+150 would be 300 -- must be re-capped to 200');
  // remoteArr is entirely newer than localArr, so the correct kept set
  // is all 150 remote entries plus the 50 newest local ones (the newest
  // 200 overall out of 300) -- not "100% remote", which undercounts
  // what a real re-cap should keep.
  const remoteCount = merged.filter(e => e.graveyardId.startsWith('remote_')).length;
  const localCount = merged.filter(e => e.graveyardId.startsWith('local_')).length;
  assert.equal(remoteCount, 150, 'all of the newer batch should survive');
  assert.equal(localCount, 50, 'the newest 50 of the older batch should survive');
  const keptLocalIndices = merged.filter(e => e.graveyardId.startsWith('local_')).map(e => parseInt(e.graveyardId.replace('local_', ''), 10));
  assert.ok(keptLocalIndices.every(i => i >= 100), 'the kept local entries should be the newest ones (indices 100-149), not the oldest');
});

// --- Every delete function actually calls thAddToGraveyard ---------------

test('every delete function that touches the graveyard actually calls thAddToGraveyard', () => {
  const checks = [
    { file: 'data-layer.js', fnPattern: /function thDeleteClient\(id\)[\s\S]*?\n\}/ },
    { file: 'dev-tools.html', fnPattern: /function deleteKnownIssue\(id\)[\s\S]*?\n  \}/ },
    { file: 'job-tracker.html', fnPattern: /async function deleteJob\(id\)[\s\S]*?\n  \}/ },
    { file: 'job-tracker.html', fnPattern: /async function bulkDeleteJobs\(\)[\s\S]*?\n  \}/ },
    { file: 'job-tracker.html', fnPattern: /async function deleteContact\(id\)[\s\S]*?\n  \}/ },
    { file: 'job-tracker.html', fnPattern: /async function deleteTemplate\(id\)[\s\S]*?\n  \}/ },
    { file: 'finance.html', fnPattern: /async function deleteExpense\(id\)[\s\S]*?\n  \}/ },
    { file: 'finance.html', fnPattern: /async function clearAllExpenses\(\)[\s\S]*?\n  \}/ },
    { file: 'finance.html', fnPattern: /async function deleteIncomeEntry\(id\)[\s\S]*?\n  \}/ },
    { file: 'finance.html', fnPattern: /async function clearAllIncome\(\)[\s\S]*?\n  \}/ },
    { file: 'finance.html', fnPattern: /function deletePriceReference\(id\)[\s\S]*?\n  \}/ },
    { file: 'contract-generator.html', fnPattern: /async function deleteContractLogEntry\(id\)[\s\S]*?\n  \}/ },
    { file: 'invoice-generator.html', fnPattern: /async function deleteInvoiceLogEntry\(id\)[\s\S]*?\n  \}/ },
    { file: 'invoice-generator.html', fnPattern: /async function deleteQuoteLogEntry\(id\)[\s\S]*?\n  \}/ },
    { file: 'parts-reference.html', fnPattern: /function deletePrUnitType\(unitId\)[\s\S]*?\n  \}/ },
    { file: 'parts-reference.html', fnPattern: /function deletePrIssue\(unitId, issueId\)[\s\S]*?\n  \}/ },
  ];
  for (const check of checks) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, check.file), 'utf8');
    const match = src.match(check.fnPattern);
    assert.ok(match, `pattern not found in ${check.file}: ${check.fnPattern}`);
    assert.match(match[0], /thAddToGraveyard\(/, `${check.file} delete function should call thAddToGraveyard`);
  }
});

test('bulkDeleteJobs now records a real tombstone per job -- a genuine pre-existing gap found while wiring in the graveyard, since it previously had zero tombstone protection at all', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  const match = src.match(/async function bulkDeleteJobs\(\)[\s\S]*?\n  \}/);
  assert.ok(match, 'bulkDeleteJobs not found');
  assert.match(match[0], /thAddJobTombstone\(/, 'bulkDeleteJobs should record a tombstone per deleted job, same as single-job delete');
});

// --- Full restore flow, flat case (job) -----------------------------------

test('restoring a job from the graveyard puts it back, removes the tombstone, and it survives a subsequent stale-device sync pull', () => {
  const window = loadDevTools();
  const jobRecord = { id: 'j1', title: 'Original Job', client: 'Test Client' };

  // Simulate the real deleteJob() sequence: remove from the live array,
  // then record the tombstone and graveyard snapshot.
  window.thWrite('th_tracker_jobs', [jobRecord]);
  window.thWrite('th_tracker_jobs', window.thRead('th_tracker_jobs', []).filter(j => j.id !== 'j1'));
  window.thAddJobTombstone('j1');
  window.thAddToGraveyard('job', jobRecord);

  assert.equal(window.thRead('th_tracker_jobs', []).length, 0);
  assert.equal(window.thRead('th_job_tombstones', []).length, 1);
  assert.equal(window.thLoadGraveyard().length, 1);

  const entry = window.thLoadGraveyard().find(e => e.recordType === 'job');
  window.restoreFromGraveyard(entry.graveyardId);

  assert.equal(JSON.stringify(window.thRead('th_tracker_jobs', [])), JSON.stringify([jobRecord]), 'job should be back');
  assert.equal(window.thRead('th_job_tombstones', []).length, 0, 'tombstone should be gone');
  assert.equal(window.thLoadGraveyard().length, 0, 'graveyard entry should be gone');

  // A stale device pushing back an empty jobs list must NOT re-delete
  // the just-restored job -- only holds if the tombstone is really gone.
  window.applySyncData({ th_tracker_jobs: JSON.stringify([]), th_job_tombstones: JSON.stringify([]) });
  assert.equal(JSON.stringify(window.thRead('th_tracker_jobs', [])), JSON.stringify([jobRecord]), 'restored job must survive a subsequent sync pull');
});

test('restoring does not create a duplicate if the record somehow already exists live', () => {
  const window = loadDevTools();
  const jobRecord = { id: 'j1', title: 'Already back' };
  window.thWrite('th_tracker_jobs', [jobRecord]); // already present
  window.thAddToGraveyard('job', jobRecord);

  const entry = window.thLoadGraveyard().find(e => e.recordType === 'job');
  window.restoreFromGraveyard(entry.graveyardId);

  assert.equal(window.thRead('th_tracker_jobs', []).length, 1, 'should not duplicate an already-present record');
});

// --- Special nested case: prIssue ----------------------------------------

test('restoring a prIssue puts it back into its parent unit\'s issues array and removes the composite-keyed tombstone', () => {
  const window = loadDevTools();
  const issue = { id: 555, symptom: 'Test symptom' };
  window.thWrite('th_parts_reference_units', [{ id: 'unitA', brand: 'GE', issues: [] }]);
  window.thAddPrIssueTombstone('unitA', 555);
  window.thAddToGraveyard('prIssue', { unitId: 'unitA', issue });

  const entry = window.thLoadGraveyard().find(e => e.recordType === 'prIssue');
  window.restoreFromGraveyard(entry.graveyardId);

  const units = window.thRead('th_parts_reference_units', []);
  assert.equal(JSON.stringify(units[0].issues), JSON.stringify([issue]));
  assert.equal(window.thRead('th_pr_issue_tombstones', []).length, 0);
  assert.equal(window.thLoadGraveyard().length, 0);
});

test('restoring a prIssue whose parent unit was also deleted refuses gracefully and does not lose the entry', async () => {
  const window = loadDevTools();
  window.thWrite('th_parts_reference_units', []); // the unit itself no longer exists
  window.thAddToGraveyard('prIssue', { unitId: 'unitGone', issue: { id: 999, symptom: 'Orphaned issue' } });

  const entry = window.thLoadGraveyard().find(e => e.recordType === 'prIssue');
  await window.restoreFromGraveyard(entry.graveyardId);

  assert.match(window._lastAlert || '', /also deleted/i, 'should explain why it could not restore');
  assert.equal(window.thLoadGraveyard().length, 1, 'the graveyard entry must NOT be lost just because restore was refused');
});

// --- Permanent deletion ---------------------------------------------------

test('permanentlyDeleteFromGraveyard removes the entry without touching the live data or tombstones', async () => {
  const window = loadDevTools();
  window.thAddJobTombstone('j1');
  window.thAddToGraveyard('job', { id: 'j1', title: 'Gone for good' });
  const entry = window.thLoadGraveyard().find(e => e.recordType === 'job');

  await window.permanentlyDeleteFromGraveyard(entry.graveyardId);

  assert.equal(window.thLoadGraveyard().length, 0);
  assert.equal(window.thRead('th_job_tombstones', []).length, 1, 'tombstone should be untouched -- permanent deletion is not the same as restoring');
});
