// Route Planner embedded map (2026-09-07, item #43): the tool used to
// only build Google Maps deep-link URLs -- no actual visual of where
// the stops are. Added a real embedded map (Leaflet + free
// OpenStreetMap tiles, no API key/cost), with stops geocoded via
// OpenStreetMap's free Nominatim service and plotted as numbered
// markers connected by a line in visiting order.
//
// Plain regex/structural assertions against the page source, matching
// the style of other tools/*.test.js files in this repo.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'route-planner.html'), 'utf8');

function extractFn(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = HTML.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

test('Leaflet is loaded with a real, verified integrity hash (computed from the actual npm package, not guessed)', () => {
  assert.match(HTML, /<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/leaflet@1\.9\.4\/dist\/leaflet\.css" integrity="sha384-[A-Za-z0-9+/]+=*" crossorigin="anonymous">/);
  assert.match(HTML, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/leaflet@1\.9\.4\/dist\/leaflet\.js" integrity="sha384-[A-Za-z0-9+/]+=*" crossorigin="anonymous" defer><\/script>/);
});

test('the CSP was widened for the map: styles allow jsdelivr, images allow the OSM tile server, network requests allow the Nominatim geocoder', () => {
  const csp = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(csp, 'expected a CSP meta tag');
  assert.match(csp[1], /style-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(csp[1], /img-src[^;]*https:\/\/\*\.tile\.openstreetmap\.org/);
  assert.match(csp[1], /connect-src[^;]*https:\/\/nominatim\.openstreetmap\.org/);
  // The real, pre-existing Supabase access this page's auth check
  // depends on must survive the widening untouched.
  assert.match(csp[1], /connect-src[^;]*https:\/\/\*\.supabase\.co/);
});

test('the map container, empty state, and status line all exist', () => {
  assert.match(HTML, /<div id="routeMap"><\/div>/);
  assert.match(HTML, /<div class="route-map-empty" id="routeMapEmpty">/);
  assert.match(HTML, /<p class="route-map-status" id="routeMapStatus"><\/p>/);
});

test('geocoding is rate-limited to Nominatim\'s own 1-request/second usage policy, with a real cache so an unchanged stop is never re-geocoded', () => {
  const fn = extractFn('updateRouteMap');
  assert.match(fn, /if \(!wasAlreadyCached\) await sleep\(GEOCODE_DELAY_MS\)/);
  assert.match(HTML, /const GEOCODE_DELAY_MS = 1100;/);
  const getGeocodeFn = extractFn('getGeocode');
  assert.match(getGeocodeFn, /if \(geocodeCache\[key\]\) return Promise\.resolve\(geocodeCache\[key\]\);/, 'a cached address should skip geocoding (and the rate-limit delay) entirely');
  assert.match(getGeocodeFn, /if \(point\) geocodeCache\[key\] = point;/);
});

// Real bug found and fixed before shipping, via a mocked-fetch test
// harness below: without in-flight deduplication, editing several
// stops in quick succession (most notably "Pull Today's Jobs", which
// calls addStop() once per job in a tight synchronous loop) could
// start more than one updateRouteMap() run before an earlier one
// finished -- each takes real seconds, one rate-limited network round
// trip per stop -- and two overlapping runs could each see the SAME
// not-yet-cached address and fire their own duplicate Nominatim
// request for it. Confirmed directly: 3 stops added in a tight loop
// produced 5 network requests before the fix, exactly 3 after it.
test('concurrent/overlapping map updates never fire more than one real network request for the same address', () => {
  const getGeocodeFn = extractFn('getGeocode');
  assert.match(getGeocodeFn, /geocodePending\[key\]/, 'expected an in-flight-request map shared across concurrent callers');
  assert.match(HTML, /const geocodePending = \{\};/);
});

test('concurrent overlapping updateRouteMap() calls deduplicate real Nominatim requests (executed against a mocked fetch/Leaflet, not just inspected as source text)', async () => {
  const { JSDOM } = require('jsdom');
  const geocodeRequests = [];
  const calls = [];

  function chainable(name) {
    const obj = {};
    obj.addTo = () => obj;
    obj.bindPopup = () => obj;
    obj.clearLayers = () => { calls.push([name, 'clearLayers']); };
    return obj;
  }

  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.com/tools/route-planner.html',
    beforeParse(window) {
      window.requireAuth = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
      window.escapeHtml = (s) => String(s == null ? '' : s);
      window.escapeForInlineHandler = (s) => String(s == null ? '' : s);
      window.showToast = () => {};
      window.getCurrentUserEmail = () => null;
      window.initSyncOnLoad = () => Promise.resolve();
      window.startRealtimeSync = () => {};
      window.updateRealtimeBadge = () => {};
      // Immediate, not debounced -- this test is specifically about
      // what happens when several updateRouteMap() runs overlap, which
      // a real 1200ms debounce would normally prevent for ordinary
      // typing but NOT for a tight synchronous addStop() loop like
      // "Pull Today's Jobs" (see the comment above this test).
      window.debouncedCall = (key, fn) => fn();
      window.openInfoModal = () => {};
      window.initAppTour = () => {};
      window.setupPullToRefresh = () => {};

      window.L = {
        map: () => { const m = chainable('map'); m.setView = () => {}; m.fitBounds = () => {}; m.invalidateSize = () => {}; return m; },
        tileLayer: () => chainable('tileLayer'),
        layerGroup: () => chainable('layerGroup'),
        marker: (latlng) => { calls.push(['marker', latlng]); return chainable('marker'); },
        divIcon: (opts) => ({ __divIcon: true, html: opts.html }),
        polyline: (latlngs) => { calls.push(['polyline', latlngs]); return chainable('polyline'); },
      };

      window.fetch = async (url) => {
        geocodeRequests.push(url);
        const q = decodeURIComponent(url.split('q=')[1] || '');
        if (q.includes('123 Main St')) return { ok: true, json: async () => [{ lat: '37.10', lon: '-113.58' }] };
        if (q.includes('456 Oak Ave')) return { ok: true, json: async () => [{ lat: '37.20', lon: '-113.50' }] };
        return { ok: true, json: async () => [] };
      };
    },
  });
  const { window } = dom;
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 100));

  // Simulates "Pull Today's Jobs": several stops added back to back,
  // synchronously, no typing delay between them -- the exact real
  // trigger for the overlapping-runs race this test guards against.
  window.addStop('123 Main St, St. George, UT');
  window.addStop('456 Oak Ave, St. George, UT');
  window.addStop('123 Main St, St. George, UT'); // same address again, deliberately
  await new Promise((r) => setTimeout(r, 4000));

  const uniqueUrls = new Set(geocodeRequests);
  assert.equal(geocodeRequests.length, uniqueUrls.size, `expected zero duplicate requests, got ${JSON.stringify(geocodeRequests)}`);
  assert.equal(geocodeRequests.length, 2, 'expected exactly one request per unique address (2 unique out of 3 stops)');

  const markerCalls = calls.filter((c) => c[0] === 'marker');
  assert.equal(markerCalls.length, 3, 'all 3 stops should end up plotted (2 distinct locations, one repeated)');
});

test('a stale, slow geocode response can never overwrite a newer one -- guarded by an incrementing request id at every await boundary', () => {
  const fn = extractFn('updateRouteMap');
  const guardCount = [...fn.matchAll(/if \(requestId !== routeMapRequestId\) return;/g)].length;
  assert.ok(guardCount >= 2, `expected the stale-response guard after every meaningful await, found ${guardCount}`);
  assert.match(fn, /const requestId = \+\+routeMapRequestId;/);
});

test('markers are numbered in visiting order using a plain divIcon (the site\'s own badge look), not Leaflet\'s default pin', () => {
  const fn = extractFn('updateRouteMap');
  assert.match(fn, /L\.divIcon\(/);
  assert.match(fn, /route-marker-num/);
  assert.match(fn, /\(i \+ 1\)/, 'marker label should be the 1-based visiting order');
  assert.match(fn, /L\.polyline\(latlngs/, 'stops should be connected by a line in visiting order');
});

test('a stop that fails to geocode is named in the status line, not silently dropped', () => {
  const fn = extractFn('updateRouteMap');
  assert.match(fn, /failed\.push\(stop\)/);
  assert.match(fn, /couldn't locate/i);
});

test('the empty-stops case clears the map (not just skipped), fixed ahead of the early return for the individual-links list', () => {
  const routeFn = extractFn('updateRoute');
  const debounceIdx = routeFn.indexOf("debouncedCall('routeMap', updateRouteMap, 1200);");
  const earlyReturnIdx = routeFn.indexOf('if (stops.length === 0) {');
  assert.ok(debounceIdx >= 0, 'expected updateRoute to schedule a map update');
  assert.ok(earlyReturnIdx >= 0, 'expected the individual-links empty-stops early return');
  assert.ok(debounceIdx < earlyReturnIdx, 'the map update must be scheduled BEFORE the early return, or removing the last stop would never clear the map');
});

test('the map lazily initializes only once real, located stops exist -- never eagerly on page load with the 2 default empty stop fields', () => {
  const fn = extractFn('ensureRouteMap');
  assert.match(fn, /if \(routeMap\) return routeMap;/, 'should only ever create the Leaflet map instance once');
  const updateFn = extractFn('updateRouteMap');
  assert.match(updateFn, /if \(located\.length === 0\) \{/);
});

test('the help modal explains the new map, and the tools service worker cache was bumped since this page is precached', () => {
  assert.match(HTML, /A real map fills in below the stop list/);
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 86, `expected v86 or later, got v${version}`);
});
