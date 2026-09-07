// The tools workspace hub (2026-09-07) previously went straight from the
// header into the collapsible section list -- no "first thing you see"
// moment. Added a greeting banner: a real time-of-day greeting plus
// today's real job count, read from the same th_tracker_jobs data
// renderTodayJobs() already uses (not a separate/invented figure).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('service-worker.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

// Real DOM coerces any assigned textContent to a string; this mock needs
// to match that, or a real Number assignment (e.g. the job count) would
// wrongly fail a strict string-equality assertion below.
function makeEl() {
  let value = '';
  return {
    get textContent() { return value; },
    set textContent(v) { value = String(v); },
  };
}

function runGreetingBanner({ hour, jobs, firstName }) {
  const fnSrc = extractFn(WORKSPACE, 'renderGreetingBanner');
  const els = {
    greetingBanner: {},
    greetingBannerGreeting: makeEl(),
    greetingBannerDate: makeEl(),
    greetingBannerNumber: makeEl(),
    greetingBannerLabel: makeEl(),
  };
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(2026, 8, 7, hour, 0, 0);
      else super(...args);
    }
    getHours() { return hour; }
  }
  const ctx = {
    console,
    Date: FixedDate,
    localStorage: { getItem: (k) => (k === 'th_tracker_jobs' ? JSON.stringify(jobs) : null) },
    getCurrentUserFirstName: firstName === undefined ? undefined : (() => firstName),
    document: { getElementById: (id) => els[id] },
  };
  vm.createContext(ctx);
  vm.runInContext(`${fnSrc}\nrenderGreetingBanner();`, ctx);
  return els;
}

test('the banner sits right after the search box and before the Today section', () => {
  const searchAt = WORKSPACE.indexOf('class="global-search-block"');
  const bannerAt = WORKSPACE.indexOf('id="greetingBanner"');
  const todayAt = WORKSPACE.indexOf('id="section-today"');
  assert.ok(searchAt > 0 && bannerAt > 0 && todayAt > 0);
  assert.ok(searchAt < bannerAt && bannerAt < todayAt);
});

test('renderDashboard renders the greeting banner before today\'s job list, every render', () => {
  const dashboardFn = extractFn(WORKSPACE, 'renderDashboard');
  const greetingAt = dashboardFn.indexOf('renderGreetingBanner()');
  const todayAt = dashboardFn.indexOf('renderTodayJobs()');
  assert.ok(greetingAt >= 0 && todayAt >= 0 && greetingAt < todayAt);
});

test('greeting text changes with the real time of day', () => {
  assert.match(runGreetingBanner({ hour: 8, jobs: [] }).greetingBannerGreeting.textContent, /^Good morning/);
  assert.match(runGreetingBanner({ hour: 14, jobs: [] }).greetingBannerGreeting.textContent, /^Good afternoon/);
  assert.match(runGreetingBanner({ hour: 20, jobs: [] }).greetingBannerGreeting.textContent, /^Good evening/);
});

test('the greeting includes the signed-in user\'s first name when available, and degrades gracefully without one', () => {
  assert.equal(runGreetingBanner({ hour: 9, jobs: [], firstName: 'Steve' }).greetingBannerGreeting.textContent, 'Good morning, Steve.');
  assert.equal(runGreetingBanner({ hour: 9, jobs: [], firstName: undefined }).greetingBannerGreeting.textContent, 'Good morning.');
});

test('the job count is read from the same th_tracker_jobs data renderTodayJobs() uses, filtered the same way (today, not done)', () => {
  const jobs = [
    { date: '2026-09-07', status: 'scheduled' },
    { date: '2026-09-07', status: 'in-progress' },
    { date: '2026-09-07', status: 'done' },       // done -- should not count
    { date: '2026-09-06', status: 'scheduled' },   // wrong day -- should not count
  ];
  const els = runGreetingBanner({ hour: 9, jobs });
  assert.equal(els.greetingBannerNumber.textContent, '2');
  assert.equal(els.greetingBannerLabel.textContent, 'jobs today');
});

test('the label is singular for exactly one job', () => {
  const els = runGreetingBanner({ hour: 9, jobs: [{ date: '2026-09-07', status: 'scheduled' }] });
  assert.equal(els.greetingBannerNumber.textContent, '1');
  assert.equal(els.greetingBannerLabel.textContent, 'job today');
});

test('zero jobs today renders a real 0, not a hidden or missing state', () => {
  const els = runGreetingBanner({ hour: 9, jobs: [] });
  assert.equal(els.greetingBannerNumber.textContent, '0');
  assert.equal(els.greetingBannerLabel.textContent, 'jobs today');
});

test('malformed localStorage data fails safe to zero rather than throwing', () => {
  const fnSrc = extractFn(WORKSPACE, 'renderGreetingBanner');
  const els = { greetingBanner: {}, greetingBannerGreeting: makeEl(), greetingBannerDate: makeEl(), greetingBannerNumber: makeEl(), greetingBannerLabel: makeEl() };
  const ctx = {
    console,
    localStorage: { getItem: () => 'not valid json' },
    document: { getElementById: (id) => els[id] },
  };
  vm.createContext(ctx);
  assert.doesNotThrow(() => vm.runInContext(`${fnSrc}\nrenderGreetingBanner();`, ctx));
  assert.equal(els.greetingBannerNumber.textContent, '0');
});

test('the banner is a visually distinct band, not plain text', () => {
  const rule = WORKSPACE.match(/\.greeting-banner \{[^}]*\}/)[0];
  assert.match(rule, /background:/);
  assert.match(rule, /border-left:/);
  const numberRule = WORKSPACE.match(/\.greeting-banner-number \{[^}]*\}/)[0];
  assert.match(numberRule, /font-family: var\(--font-display\)/);
});

test('the banner stacks on narrow screens', () => {
  assert.match(WORKSPACE, /@media \(max-width: 560px\) \{[\s\S]{0,120}?\.greeting-banner \{ flex-direction: column/);
});

test('the tools service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-workspace-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 74, `expected v74 or later, got v${versionMatch[1]}`);
});
