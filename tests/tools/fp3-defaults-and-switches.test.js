// Fix plan FP3.2, FP3.4, FP3.5 + the FP3.3 invite copy (2026-11-06, D3:
// Clients ON). Checks the shipped pages; the database half is in
// tests/security/fp3-invite-defaults-db.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'tools', f), 'utf8');
const JT = read('job-tracker.html');
const DEV = read('dev-tools.html');
const TEAM = read('team.html');
const HELP = read('dev-tools-shared.js');

test('FP3.2: More details is open when the add-job form first shows', () => {
  const doc = new JSDOM(JT).window.document;
  const more = doc.getElementById('jobMore');
  assert.ok(more.hasAttribute('open'));
  for (const id of ['jobPhone', 'jobAddress', 'jobClientEmail', 'jobReferredBy', 'jobNotes', 'jobPriority', 'jobStatus']) {
    assert.ok(more.querySelector('#' + id), id + ' sits inside More details');
  }
});

test('FP3.4: the account panel and the Starting templates table cover the two Phase 4 switches, plus the always-on base row', () => {
  assert.match(DEV, /\{ key: 'work', label: 'Work', fields: \[\s*\{ field: 'can_manage_clients', label: 'Clients' \},\s*\{ field: 'can_manage_others_jobs', label: 'Manage jobs for others' \},\s*\] \}/);
  assert.match(DEV, /account_roles\?select=[^']*can_manage_clients,can_manage_others_jobs&order=email/);
  assert.match(DEV, /role_definitions\?select=[^']*can_manage_clients,can_manage_others_jobs&order=name/);
  assert.match(DEV, /Own assigned jobs: log hours and parts, mark done \(always\)/);
  assert.match(HELP, /Each of the 11 permissions/);
});

test('FP3.5: Add account writes both switches -- from the template, or Clients on with no template (D3)', () => {
  const start = DEV.indexOf('    const body = {', DEV.indexOf('async function addAccount()'));
  const body = DEV.slice(start, DEV.indexOf('};', start));
  assert.match(body, /can_manage_clients: preset \? !!preset\.can_manage_clients : true,/);
  assert.match(body, /can_manage_others_jobs: preset \? !!preset\.can_manage_others_jobs : false,/);
  assert.match(DEV, /<option value="">None -- own jobs and Clients only<\/option>/);
  assert.doesNotMatch(DEV, /start with everything unchecked/);
});

test('FP3.3: the invite sheet says a new person starts with Clients', () => {
  assert.match(TEAM, /They start with their own assigned jobs and <strong>Clients<\/strong> \(look up a client's phone and address\)\. Turn on Money and the rest from their row once they've joined\./);
});
