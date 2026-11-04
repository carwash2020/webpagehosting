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

// Drop HTML/JS comments so the history notes that explain the removal
// don't count as the thing itself. A plain scan (not a regex replace):
// this only reads our own source files; it is not a sanitizer.
function dropBlocks(src, open, close) {
  let out = '';
  let i = 0;
  for (;;) {
    const a = src.indexOf(open, i);
    if (a < 0) return out + src.slice(i);
    out += src.slice(i, a);
    const b = src.indexOf(close, a + open.length);
    if (b < 0) return out;
    i = b + close.length;
  }
}
const code = (src) => dropBlocks(dropBlocks(src, '<!--', '-->'), '/*', '*/')
  .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

test('Home has no map, route or navigation link of any kind -- except the Route planner add-on\'s one button, hidden unless the add-on is on (2026-11-04, approved design)', () => {
  // The one exception: <a id="dashRouteBtn"> into Route Planner (#today).
  const btn = '<a href="/tools/route-planner.html#today" class="dash-route-btn" id="dashRouteBtn" hidden><svg class="th-icon" aria-hidden="true"><use href="#icon-map" xlink:href="#icon-map"></use></svg>Plan today&rsquo;s route</a>';
  assert.equal(WORKSPACE.split(btn).length, 2, 'exactly one Plan today\'s route button, hidden by default');
  assert.match(WORKSPACE, /routeBtn\.hidden = !\(todaysJobs\.length > 0 && typeof thAddonOn === 'function' && thAddonOn\('routePlanner'\)\);/);
  const ws = code(WORKSPACE.replace(btn, ''));
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

test('Route Planner still routes the whole day; since 2026-11-04 it is an add-on whose one way in is My Day\'s Plan today\'s route (not the nav, not Search)', () => {
  assert.match(ROUTE_PLANNER, /onclick="pullTodaysJobs\(\)">Pull today's jobs</);
  assert.match(ROUTE_PLANNER, /id="openRouteBtn"[^>]*>Open full route in Google Maps</);
  assert.match(ROUTE_PLANNER, /if \(window\.location\.hash === '#today'\) pullTodaysJobs\(\);/, '#today pulls the day straight away');
  assert.doesNotMatch(NAV, /href: '\/tools\/route-planner\.html'/, 'not in the nav or More');
  assert.doesNotMatch(PALETTE, /href: '\/tools\/route-planner\.html/, 'not in Search');
});

test('Home\'s help sends you to Job detail for one job\'s directions, and to the Route planner add-on for the whole day', () => {
  const help = WORKSPACE.match(/<div class="help-modal-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<script>/)[1];
  assert.doesNotMatch(help, /Today's route|Route all|Navigate/);
  assert.match(help, /directions are there/);
  assert.match(help, /turn on the <strong>Route planner<\/strong> add-on in Settings &gt; Add-ons: <strong>Plan today's route<\/strong> then shows under Next Job/);
});
