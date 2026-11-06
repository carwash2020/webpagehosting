// Fix plan FP2.4 + RP6.7 (2026-11-06): the first-run tour is role-aware. A
// step about Invoices or Money shows only to an account that can open them
// (the same auth.js checks the nav uses), so the tour never walks anyone
// into an access-denied screen. A tour page waits for the role before it
// picks steps; a role that couldn't be confirmed counts as no permissions.
// "Invoice from the job" highlights the job list when no job is waiting
// for an invoice yet. Runs the real tools-tour.js in jsdom.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOUR = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'tools-tour.js'), 'utf8');

function tourOn(page, { perms = {}, role = { roleName: 'x' }, roleState, body = '' } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body' + (roleState ? ' data-role-state="' + roleState + '"' : '') + '>' + body + '</body></html>', { url: 'https://example.com' + page, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.getCurrentUserEmail = () => 'tech@example.com';
  w.__role = role;
  w.getCurrentUserRole = () => w.__role;
  w.loadCurrentUserRole = () => {};
  w.__perms = perms;
  w.canManageInvoices = () => !!w.__perms.canManageInvoices;
  w.canViewFinance = () => !!w.__perms.canViewFinance;
  const s = w.document.createElement('script');
  s.textContent = TOUR;
  w.document.head.appendChild(s);
  return w;
}
const titles = (w) => [...w.appTourSteps()].map((s) => s.title);
const OWNER = { canManageInvoices: true, canViewFinance: true };

test('FP2.4: an owner gets all six steps; a field-only account gets Add a job, Track it, Help -- and never a page it can\'t open', () => {
  assert.deepEqual(titles(tourOn('/tools/workspace.html', { perms: OWNER })), ['Add a job', 'Track it', 'Invoice from the job', 'Get paid', 'Money owed', 'Help lives here']);
  const field = tourOn('/tools/workspace.html', { perms: {} });
  assert.deepEqual(titles(field), ['Add a job', 'Track it', 'Help lives here']);
  assert.ok(!field.appTourSteps().some((s) => s.page === '/tools/invoice-generator.html'));
});

test('FP2.4: Money owed shows with either money permission, the invoice steps only with Invoices', () => {
  assert.deepEqual(titles(tourOn('/tools/workspace.html', { perms: { canViewFinance: true } })), ['Add a job', 'Track it', 'Money owed', 'Help lives here']);
  assert.deepEqual(titles(tourOn('/tools/workspace.html', { perms: { canManageInvoices: true } })), ['Add a job', 'Track it', 'Invoice from the job', 'Get paid', 'Money owed', 'Help lives here']);
});

test('FP2.4: the field-only tour counts its own steps and its last step says Done', () => {
  const w = tourOn('/tools/workspace.html', { perms: {} });
  w.renderAppTourStep(2);
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Help lives here');
  assert.equal(w.document.querySelector('.onboarding-count').textContent, '3 OF 3');
  assert.equal(w.document.querySelector('.onboarding-next').textContent, 'Done');
});

test('FP2.4: from Track it, a field-only account goes straight to Help on Home, never to Invoices', () => {
  const w = tourOn('/tools/job-tracker.html', { perms: {} });
  w.localStorage.setItem('th_app_tour_step', '1');
  w.localStorage.setItem('th_app_tour_step_started_at', String(Date.now()));
  w.initAppTour();
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Track it');
  assert.equal(w.appTourSteps()[2].title, 'Help lives here');
  assert.equal(w.appTourSteps()[2].page, '/tools/workspace.html');
});

test('FP2.4: a tour page waits for the role before choosing steps, then shows the owner\'s step', () => {
  const w = tourOn('/tools/invoice-generator.html', { role: null, perms: {}, body: '<button onclick="toggleInvoicePaid(1)">Mark paid</button>' });
  w.localStorage.setItem('th_app_tour_step', '3');
  w.localStorage.setItem('th_app_tour_step_started_at', String(Date.now()));
  w.initAppTour();
  assert.equal(w.document.querySelector('#appTourCard'), null, 'nothing yet: the role is still on its way');
  w.__role = { roleName: 'Owner' };
  w.__perms = OWNER;
  w.dispatchEvent(new w.Event('th-role-loaded'));
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Get paid');
});

test('FP2.4: a role that couldn\'t be confirmed counts as no permissions (fail-closed)', () => {
  const w = tourOn('/tools/workspace.html', { role: null, roleState: 'none', perms: OWNER });
  // The checks themselves say no without a role in the real auth.js; here
  // only the role is missing, and the money steps still aren't chosen
  // once the checks fail.
  w.__perms = {};
  w.initAppTour();
  assert.deepEqual(titles(w), ['Add a job', 'Track it', 'Help lives here']);
  assert.ok(w.document.querySelector('#appTourCard'), 'the tour runs rather than waiting forever');
});

test('RP6.7: with no job waiting for an invoice, "Invoice from the job" highlights the job list instead of nothing', () => {
  const w = tourOn('/tools/job-tracker.html', { perms: OWNER, body: '<div id="jobsList"><div class="job-card">A job</div></div>' });
  w.renderAppTourStep(2);
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Invoice from the job');
  assert.ok(w.document.getElementById('jobsList').classList.contains('th-tour-highlight'));
  const withLink = tourOn('/tools/job-tracker.html', { perms: OWNER, body: '<div id="jobsList"><a href="/tools/invoice-generator.html?jobRef=7">Invoice</a></div>' });
  withLink.renderAppTourStep(2);
  assert.ok(withLink.document.querySelector('a[href*="jobRef"]').classList.contains('th-tour-highlight'), 'the real Invoice link wins when there is one');
  assert.ok(!withLink.document.getElementById('jobsList').classList.contains('th-tour-highlight'));
});
