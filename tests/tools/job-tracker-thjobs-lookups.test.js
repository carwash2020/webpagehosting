// Item 1 Phase 2a follow-up: editJob() and downloadJobIcs() in
// tools/job-tracker.html now look a job up via thJobs.get(id) instead of
// loadJobs().find(j => j.id === id) -- a behavior-preserving 1:1 swap (same
// lookup, same result), the first real call sites in job-tracker.html
// routed through the seam. Confirms both still behave the same with a
// stubbed thJobs standing in for the real one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
const grab = (re) => { const m = SRC.match(re); assert.ok(m, 'found ' + re); return m[0]; };
const EDIT_JOB = grab(/  function editJob\(id\) \{[\s\S]*?\n  \}\n/);
const DOWNLOAD_ICS = grab(/  function downloadJobIcs\(jobId\) \{[\s\S]*?\n  \}\n/);
const CREATE_FROM_TEMPLATE = grab(/  function createJobFromTemplate\(id\) \{[\s\S]*?\n  \}\n/);
// downloadJobIcs() depends on these small helpers, defined elsewhere in the
// same file -- grabbed as-is rather than reimplemented, so this test exercises
// the real ICS formatting too.
const ICS_HELPERS = grab(/  function pad2\([\s\S]*?\n  \}\n/)
  + grab(/  function icsDateNoDash\(dateStr\) \{[\s\S]*?\n  \}\n/)
  + grab(/  function icsDatePlusOneDay\(dateStr\) \{[\s\S]*?\n  \}\n/)
  + grab(/  function icsEscape\([\s\S]*?\n  \}\n/);

const FORM_IDS = ['jobTitle', 'jobClient', 'jobPhone', 'jobAddress', 'jobClientEmail', 'jobPriority',
  'jobDate', 'jobStatus', 'jobNotes', 'jobReferredBy', 'jobHoursWorked', 'addJobBtn', 'cancelJobEditBtn', 'jobEditNote'];

function setup(jobsById) {
  const body = FORM_IDS.map((id) => `<input id="${id}">`).join('') +
    '<button id="addJobBtn"></button><button id="cancelJobEditBtn"></button><div id="jobEditNote"></div>';
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: 'outside-only', url: 'https://example.com/' });
  const w = dom.window;
  w.thJobs = { get: (id) => jobsById.get(id) || null };
  w.editingJobId = null;
  w.toggleFormSection = () => {};
  w.updateFirstTimeNudge = () => {};
  Object.values(w.document.querySelectorAll('input, button, div')).forEach(() => {}); // jsdom scrollIntoView is unimplemented
  w.document.getElementById('jobTitle').scrollIntoView = () => {};
  w.eval(ICS_HELPERS + EDIT_JOB + DOWNLOAD_ICS + '\nwindow.__t = { editJob, downloadJobIcs };');
  return { w, api: w.__t };
}

const JOB = {
  id: 7, title: 'Fix dryer', client: 'Sarah Miller', phone: '555-0100', address: '1 Main St',
  clientEmail: 'sarah@example.com', priority: 'high', date: '2026-10-20', status: 'in-progress',
  notes: 'Bring belt', referredBy: 'Dana', hoursWorked: '2',
};

test('editJob() populates the form from thJobs.get(id), same as the old loadJobs().find()', () => {
  const { w, api } = setup(new Map([[7, JOB]]));
  api.editJob(7);
  assert.equal(w.editingJobId, 7);
  assert.equal(w.document.getElementById('jobTitle').value, 'Fix dryer');
  assert.equal(w.document.getElementById('jobClient').value, 'Sarah Miller');
  assert.equal(w.document.getElementById('jobPriority').value, 'high');
  assert.equal(w.document.getElementById('jobStatus').value, 'in-progress');
  assert.equal(w.document.getElementById('addJobBtn').textContent, 'Update Job');
  assert.match(w.document.getElementById('jobEditNote').textContent, /Fix dryer/);
});

test('editJob() on an id thJobs.get() can\'t find does nothing (no job, no crash)', () => {
  const { w, api } = setup(new Map());
  api.editJob(999);
  assert.equal(w.editingJobId, null);
  assert.equal(w.document.getElementById('jobTitle').value, '');
});

test('downloadJobIcs() builds and triggers a download when thJobs.get() finds a dated job', () => {
  const { w, api } = setup(new Map([[7, JOB]]));
  const clicks = [];
  const realCreate = w.document.createElement.bind(w.document);
  w.document.createElement = (tag) => {
    const el = realCreate(tag);
    if (tag === 'a') el.click = () => clicks.push(el.href ? true : false, el.download);
    return el;
  };
  w.URL.createObjectURL = () => 'blob:fake';
  w.URL.revokeObjectURL = () => {};
  api.downloadJobIcs(7);
  assert.deepEqual(clicks, [true, 'TripleH-Fix-dryer.ics']);
});

test('downloadJobIcs() does nothing when thJobs.get() returns null', () => {
  const { w, api } = setup(new Map());
  let created = false;
  w.document.createElement = () => { created = true; return {}; };
  api.downloadJobIcs(999);
  assert.equal(created, false);
});

test('downloadJobIcs() does nothing for a job with no date, even if thJobs.get() finds it', () => {
  const { w, api } = setup(new Map([[7, { ...JOB, date: '' }]]));
  let created = false;
  w.document.createElement = () => { created = true; return {}; };
  api.downloadJobIcs(7);
  assert.equal(created, false);
});

// createJobFromTemplate() now creates the job via thJobs.create() (Item 1
// Phase 2a) instead of loadJobs()/jobs.push()/saveJobs() -- same end state
// (one new not-started job, today's date, from the template), just through
// the seam.
function setupTemplate(templates) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://example.com/' });
  const w = dom.window;
  const created = [];
  w.thJobs = { create: (row) => { created.push(row); return { id: 999, ...row }; } };
  w.loadTemplates = () => templates;
  w.saveTemplates = () => {};
  w.todayDateStrBusinessTz = () => '2026-10-13';
  w.renderJobs = () => {};
  w.renderTemplates = () => {};
  w.eval(CREATE_FROM_TEMPLATE + '\nwindow.__t = { createJobFromTemplate };');
  return { w, api: w.__t, created };
}

test('createJobFromTemplate() creates a not-started job today, carrying the template\'s title and client', () => {
  const { api, created } = setupTemplate([{ id: 1, title: 'Lawn mowing', client: 'Sarah Miller', lastCreatedDate: '2026-09-13' }]);
  api.createJobFromTemplate(1);
  assert.equal(created.length, 1);
  // JSON round-trip: created[0] is a plain object built inside the JSDOM
  // window realm, so its prototype differs from this file's own Object --
  // deepEqual treats that as non-equal even with identical own properties.
  assert.deepEqual(JSON.parse(JSON.stringify(created[0])), {
    title: 'Lawn mowing', client: 'Sarah Miller', phone: '', address: '',
    priority: 'medium', date: '2026-10-13', status: 'not-started',
    notes: 'Created from recurring template.',
  });
});

test('createJobFromTemplate() updates the template\'s lastCreatedDate', () => {
  const template = { id: 1, title: 'Lawn mowing', client: '', lastCreatedDate: '2026-09-13' };
  const { api } = setupTemplate([template]);
  api.createJobFromTemplate(1);
  assert.equal(template.lastCreatedDate, '2026-10-13');
});

test('createJobFromTemplate() on an id that doesn\'t exist creates nothing', () => {
  const { api, created } = setupTemplate([{ id: 1, title: 'Lawn mowing', client: '' }]);
  api.createJobFromTemplate(999);
  assert.equal(created.length, 0);
});

// P4 (2026-11-01): the Add a job form is client, date and job type; the rest is under More details.
test('Add a job: client, date and job type are in the short form, and everything else sits under More details', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(html).window.document;
  const more = doc.getElementById('jtMore');
  assert.ok(more && more.tagName === 'DETAILS' && /More details/.test(more.querySelector('summary').textContent));
  for (const id of ['jobClient', 'jobDate', 'jobTitle']) assert.ok(!more.contains(doc.getElementById(id)), id + ' is in the short form');
  for (const id of ['jobPhone', 'jobAddress', 'jobClientEmail', 'jobReferredBy', 'jobPriority', 'jobStatus', 'jobHoursWorked', 'jobNotes']) assert.ok(more.contains(doc.getElementById(id)), id + ' is under More details');
  assert.equal(more.open, false);
});

test('Job Tracker has no capital-letter labels: no text-transform: uppercase anywhere on the page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  assert.doesNotMatch(html, /text-transform:\s*uppercase/);
  assert.match(html, /body\.th-tool-page\[data-th-page="job-tracker"\] label,[\s\S]*?\.th-kicker,[\s\S]*?text-transform: none; letter-spacing: 0;/);
  assert.match(html, /<button class="tab-btn is-active" data-tab="jobs">Jobs<\/button>/);
});
