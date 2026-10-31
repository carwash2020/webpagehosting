// Cross-surface consistency pass (2026-10-31), Connor's rule for Home:
// route and navigation live only in Job detail (Directions, one job) and
// Route Planner (the whole day). Round 1 took the Next Job card's Navigate
// cell and its Maps address link off Home; round 2 took Today's route
// (the day's timeline and its Route all Google Maps link) off too. This
// pins all three gone from Home and both surviving homes intact, so the
// capability can't go missing while the Home shortcut stays gone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const WORKSPACE = read('tools', 'workspace.html');
const JOB_DETAIL = read('tools', 'job-detail.html');
const ROUTE_PLANNER = read('tools', 'route-planner.html');
const NAV = read('tools', 'tools-nav-pwa.js');
const PALETTE = read('tools', 'tools-command-palette.js');

// Strip HTML/JS comments so the history notes that explain the removal
// don't count as the thing itself.
const code = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('Home has no map, route or navigation link of any kind', () => {
  const ws = code(WORKSPACE);
  assert.doesNotMatch(ws, /google\.com\/maps|maps\.google\.|maps\.apple\.com|geo:/, 'no Maps URL is built or linked on Home');
  assert.doesNotMatch(ws, /#icon-navigate|#icon-map"/, 'no navigate/map icon on Home');
  assert.doesNotMatch(ws, /id="todayRouteCard"|id="todayRoute"|id="todayRouteAll"|id="todayRouteCount"|class="today-route/, 'Today\'s route is gone');
  assert.doesNotMatch(ws, /\.today-route/, 'and so is its CSS');
  assert.doesNotMatch(ws, /function (todayRouteAddresses|buildTodayRouteUrl|renderTodayRoute)\(/, 'and its route builders');
  assert.doesNotMatch(ws, />\s*Navigate\s*</, 'no Navigate cell on Next Job');
  assert.doesNotMatch(ws, /Route all|Route today/);
  assert.doesNotMatch(ws, /href="\/tools\/route-planner\.html"/, 'no Home shortcut into Route Planner either');
});

test('the Next Job card shows the address as plain text, with On my way / Call / the clock and Open job', () => {
  assert.match(WORKSPACE, /'<span class="today-next-address">' \+ escapeHtml\(job\.address\) \+ '<\/span>'/);
  assert.match(WORKSPACE, /heroIcon\('phone'\) \+ 'Call<\/a>'/);
  assert.match(WORKSPACE, /Open job/);
});

test('Job detail keeps its own Directions (one job) untouched', () => {
  assert.match(JOB_DETAIL, /if \(j\.address\) quick\.push\(\['https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=' \+ encodeURIComponent\(j\.address\), 'navigate', 'Directions', true\]\);/);
});

test('Route Planner still routes the whole day, and is reachable from More and Search', () => {
  assert.match(ROUTE_PLANNER, /onclick="pullTodaysJobs\(\)">Pull today's jobs</);
  assert.match(ROUTE_PLANNER, /id="openRouteBtn"[^>]*>Open full route in Google Maps</);
  assert.match(NAV, /href: '\/tools\/route-planner\.html',\s+icon: 'map',\s+label: 'Route Planner', sidebar: false \}/, 'in the More drawer (sidebar: false only hides it from the desktop sidebar list)');
  assert.match(PALETTE, /title: 'Plan a route', meta: 'Route Planner', href: '\/tools\/route-planner\.html'/, 'and Ctrl+K "route"');
});

test('Home\'s help sends you to Job detail and Route Planner for driving, not to a Home button', () => {
  const help = WORKSPACE.match(/<div class="help-modal-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<script>/)[1];
  assert.doesNotMatch(help, /Today's route|Route all|Navigate/);
  assert.match(help, /directions are there/);
  assert.match(help, /Pull today's jobs<\/strong>, then <strong>Open full route in Google Maps/);
});
