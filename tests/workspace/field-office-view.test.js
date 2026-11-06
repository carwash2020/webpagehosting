// Field view / Office view and the job assignee (Phase 4, 2026-11-04;
// approved design; Connor's call: a screen filter, not access control).
// Runs the real data-layer.js helpers and the real view switch from
// tools-nav-pwa.js in jsdom. Made-up people and jobs only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const NAV = read('tools-nav-pwa.js');
const JT = read('job-tracker.html');
const WS = read('workspace.html');
const SWITCH = NAV.slice(NAV.indexOf('function thMountViewSwitch(afterEl) {'));

const ME = 'tech@example.com';
const JOBS = [
  { id: 1, title: 'Mine (assigned)', assignee: ME },
  { id: 2, title: 'Mine (made it, never assigned)', createdBy: ME },
  { id: 3, title: 'Someone else', assignee: 'owner@example.com', createdBy: ME },
  { id: 4, title: 'Unassigned, made by someone else', createdBy: 'owner@example.com' },
];

function env({ roleLoaded = true, others = false, saved = null } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body><div class="hub-header"></div><main></main></body>', { runScripts: 'outside-only', url: 'https://example.com/tools/job-tracker.html' });
  const w = dom.window;
  if (saved) w.localStorage.setItem('th_view_mode', saved);
  w.isRoleLoaded = () => roleLoaded;
  w.canManageOthersJobs = () => others;
  w.getCurrentUserEmail = () => ME;
  w.eval(DL + '\n' + SWITCH + ';Object.assign(window, { thViewMode, thSetViewMode, thJobInView, thJobOwner, thCanUseOfficeView, thPersonName, thTeamMembers, thMountViewSwitch });');
  return w;
}
const titles = (w, mode) => JOBS.filter((j) => w.thJobInView(j, mode)).map((j) => j.id);

test('without "Manage jobs for others" it is always Field view: your jobs only (assigned to you, or never assigned and made by you)', () => {
  const w = env({ others: false, saved: 'office' });
  assert.equal(w.thCanUseOfficeView(), false);
  assert.equal(w.thViewMode(), 'field', 'a saved Office choice means nothing without the capability');
  assert.deepEqual(titles(w), [1, 2]);
});

test('with it, Office view is the default and shows every job; Field view narrows to yours; the choice is kept on this device', () => {
  const w = env({ others: true });
  assert.equal(w.thViewMode(), 'office');
  assert.deepEqual(titles(w), [1, 2, 3, 4]);
  let changed = 0;
  w.addEventListener('th-view-changed', () => changed++);
  w.thSetViewMode('field');
  assert.equal(w.localStorage.getItem('th_view_mode'), 'field');
  assert.equal(changed, 1);
  assert.equal(w.thViewMode(), 'field');
  assert.deepEqual(titles(w), [1, 2]);
});

// Fix plan FP2.3 (2026-11-06): fail-closed. Before the permissions load (or
// if they couldn't) it is Field view -- your own jobs, never anyone else's.
test('before the account\'s permissions have loaded (or if they couldn\'t), it is Field view: your jobs only, never someone else\'s', () => {
  const w = env({ roleLoaded: false, others: false, saved: 'office' });
  assert.equal(w.thViewMode(), 'field');
  assert.deepEqual(titles(w), [1, 2]);
});

test('the Field / Office switch exists only for accounts with the capability, and flips the view', () => {
  const no = env({ others: false });
  no.thMountViewSwitch(no.document.querySelector('.hub-header'));
  assert.equal(no.document.getElementById('thViewSwitch'), null, 'no switch at all, not just hidden');

  const yes = env({ others: true });
  yes.thMountViewSwitch(yes.document.querySelector('.hub-header'));
  const sw = yes.document.getElementById('thViewSwitch');
  assert.ok(sw);
  assert.equal(sw.getAttribute('role'), 'group');
  assert.equal(sw.previousElementSibling.className, 'hub-header', 'right under the header');
  assert.deepEqual([...sw.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['Field', 'false'], ['Office', 'true']]);
  sw.querySelector('[data-view="field"]').click();
  assert.equal(yes.thViewMode(), 'field');
  assert.deepEqual([...yes.document.querySelectorAll('#thViewSwitch button')].map((b) => b.getAttribute('aria-pressed')), ['true', 'false']);
});

test('names come from the cached team list (deactivated people left out); an unknown email reads as its first part', () => {
  const w = env({ others: true });
  w.localStorage.setItem('th_team_roster_cache', JSON.stringify([{ email: 'owner@example.com', display_name: 'Pat Owner', status: 'active' }, { email: 'gone@example.com', display_name: 'Gone', status: 'deactivated' }]));
  assert.equal(w.thPersonName('Owner@Example.com'), 'Pat Owner');
  assert.equal(w.thPersonName('tech@example.com'), 'Tech');
  assert.deepEqual(Array.from(w.thTeamMembers(), (p) => p.email), ['owner@example.com']);
});

test('Jobs: Assigned to appears only in Office view; a Field-view job is yours; an edit in Field view never moves it', () => {
  assert.match(JT, /<div class="form-field" id="jobAssigneeField" hidden>\s*<label for="jobAssignee">Assigned to<\/label>\s*<select id="jobAssignee"><\/select>/);
  const add = JT.slice(JT.indexOf('  async function addJob() {'), JT.indexOf('thJobs.replaceAll(jobs);', JT.indexOf('  async function addJob() {')));
  assert.match(add, /const assigneeEmail = typeof jtAssigneeFromForm === 'function' \? jtAssigneeFromForm\(\) : undefined;\s*if \(assigneeEmail !== undefined\) fields\.assignee = assigneeEmail;\s*else if \(!wasEditing\) fields\.assignee = \(typeof thMyEmail === 'function' && thMyEmail\(\)\) \|\| null;/);
  assert.match(JT, /function jtAssigneeFromForm\(\) \{[\s\S]*?if \(!field \|\| field\.hidden \|\| !sel\) return undefined;/);
  assert.match(JT, /function jtFillAssigneePicker\(selected\) \{[\s\S]*?if \(!jtOffice\(\)\) \{ field\.hidden = true; sel\.innerHTML = ''; return; \}/);
});

test('Jobs and My Day both apply the view; Jobs shows whose-job chips and an assignee on each card in Office view only', () => {
  assert.match(JT, /if \(typeof thJobInView === 'function'\) allJobs = allJobs\.filter\(j => thJobInView\(j\)\);/);
  assert.match(JT, /function jtAssigneeChip\(job\) \{\s*if \(!jtOffice\(\)\) return '';/);
  assert.match(JT, /function jtRenderAssigneeFilter\(\) \{[\s\S]*?if \(!jtOffice\(\)\) \{ el\.hidden = true;/);
  assert.match(JT, /\[\['all', 'Everyone'\]\]\.concat\(people\.map\(p => \[p\.email, thPersonName\(p\.email\)\]\), \[\['unassigned', 'Unassigned'\]\]\)/);
  assert.match(WS, /const todaysJobs = jobs\.filter\(j => j\.date === todayKey && j\.status !== 'done' && \(typeof thJobInView !== 'function' \|\| thJobInView\(j\)\)\);/);
  for (const src of [JT, WS]) assert.match(src, /thMountViewSwitch\(document\.querySelector\('\.hub-header'\)\)/);
});
