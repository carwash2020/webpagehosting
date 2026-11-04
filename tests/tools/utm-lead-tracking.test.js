// UTM campaign-attribution tracking on leads and bookings, requested
// directly ("build utm tracking into leads"): GA4 already attributes
// traffic sources for pageviews, but that data lived only in GA4 -- no
// way to see "which campaign's leads actually turned into paid jobs"
// without cross-referencing two systems by hand. Adds a shared
// utm-tracking.js (captures utm_source/utm_medium/utm_campaign/
// utm_term/utm_content from the landing URL, first-touch, 90-day
// expiry), utm_* columns on th_leads/th_bookings, both forms sending
// them alongside the existing manual "source" field, and a Campaign
// Sources breakdown on the Dashboard.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const indexHtml = fs.readFileSync(repo('index.html'), 'utf8');
const bookingHtml = fs.readFileSync(repo('booking.html'), 'utf8');
const workspaceHtml = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const sqlMigration = fs.readFileSync(repo('sql', 'leads', 'add_utm_campaign_tracking.sql'), 'utf8');
const utmTrackingSrc = fs.readFileSync(repo('js/utm-tracking.js'), 'utf8');

test('the sql migration adds all 5 utm columns to both th_leads and th_bookings', () => {
  for (const col of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    assert.match(sqlMigration, new RegExp(`alter table th_leads add column if not exists ${col} text;`));
    assert.match(sqlMigration, new RegExp(`alter table th_bookings add column if not exists ${col} text;`));
  }
});

test('index.html and booking.html both load the shared utm-tracking.js', () => {
  assert.match(indexHtml, /<script src="\/js\/utm-tracking\.js\?v=[a-f0-9]+" defer><\/script>/);
  assert.match(bookingHtml, /<script src="\/js\/utm-tracking\.js\?v=[a-f0-9]+" defer><\/script>/);
});

test('index.html\'s lead insert sends the captured UTM params alongside the existing fields', () => {
  const fnMatch = indexHtml.match(/fetch\(LEADS_URL, \{[\s\S]*?\n\s*\.then\(\(response\)/);
  assert.ok(fnMatch, 'expected to isolate the th_leads insert body');
  assert.match(fnMatch[0], /window\.getStoredUtmParams/);
  // Still sends the manual, pre-existing source field too -- this is additive, not a replacement.
  assert.match(fnMatch[0], /source: formData\.get\('source'\) \|\| null,/);
});

test('booking.html\'s booking insert sends the captured UTM params alongside the existing fields', () => {
  // Updated 2026-09-22 (booking-flow pass, round 3): the payload is now
  // built once as bookingPayload and sent by submitBooking() (see
  // lead-source-tracking.test.js for the matching assertion that both of
  // submitBooking()'s paths send that same payload).
  const fnMatch = bookingHtml.match(/const bookingPayload = Object\.assign\(\{[\s\S]*?\n\s*submitBooking\(bookingPayload\)/);
  assert.ok(fnMatch, 'expected to isolate the booking payload build');
  assert.match(fnMatch[0], /window\.getStoredUtmParams/);
  assert.match(fnMatch[0], /source: formData\.get\('source'\) \|\| null,/);
});

test('utm-tracking.js captures utm params from the URL into localStorage', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.triplehenterprisesllc.biz/services/drywall-painting.html?utm_source=google&utm_medium=cpc&utm_campaign=fall-promo',
    runScripts: 'dangerously',
  });
  dom.window.eval(utmTrackingSrc);
  const stored = JSON.parse(dom.window.localStorage.getItem('th_utm_attribution'));
  assert.equal(stored.utm_source, 'google');
  assert.equal(stored.utm_medium, 'cpc');
  assert.equal(stored.utm_campaign, 'fall-promo');
  assert.equal(typeof stored.captured_at, 'number');
});

test('getStoredUtmParams() returns null when no UTM params were ever captured', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.triplehenterprisesllc.biz/',
    runScripts: 'dangerously',
  });
  dom.window.eval(utmTrackingSrc);
  assert.equal(dom.window.getStoredUtmParams(), null);
});

test('getStoredUtmParams() returns the captured values, with unset fields as null', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.triplehenterprisesllc.biz/?utm_source=facebook',
    runScripts: 'dangerously',
  });
  dom.window.eval(utmTrackingSrc);
  const result = dom.window.getStoredUtmParams();
  assert.equal(result.utm_source, 'facebook');
  assert.equal(result.utm_medium, null);
  assert.equal(result.utm_campaign, null);
  assert.equal(result.utm_term, null);
  assert.equal(result.utm_content, null);
});

test('a second visit with DIFFERENT utm params never overwrites the first-touch attribution', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.triplehenterprisesllc.biz/?utm_source=google&utm_campaign=spring',
    runScripts: 'dangerously',
  });
  dom.window.eval(utmTrackingSrc);
  // Simulate landing again later via a different campaign link, same tab/browser (localStorage persists).
  dom.window.history.pushState({}, '', '/?utm_source=facebook&utm_campaign=summer');
  dom.window.eval(utmTrackingSrc);
  const result = dom.window.getStoredUtmParams();
  assert.equal(result.utm_source, 'google', 'the original first-touch campaign should still win');
  assert.equal(result.utm_campaign, 'spring');
});

test('an attribution older than 90 days is treated as expired, not returned', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.triplehenterprisesllc.biz/',
    runScripts: 'dangerously',
  });
  const stale = { utm_source: 'google', captured_at: Date.now() - (91 * 24 * 60 * 60 * 1000) };
  dom.window.localStorage.setItem('th_utm_attribution', JSON.stringify(stale));
  dom.window.eval(utmTrackingSrc);
  assert.equal(dom.window.getStoredUtmParams(), null);
});

test('an expired attribution IS replaced by a fresh visit that carries real utm params', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.triplehenterprisesllc.biz/?utm_source=yelp',
    runScripts: 'dangerously',
  });
  const stale = { utm_source: 'google', captured_at: Date.now() - (91 * 24 * 60 * 60 * 1000) };
  dom.window.localStorage.setItem('th_utm_attribution', JSON.stringify(stale));
  dom.window.eval(utmTrackingSrc);
  assert.equal(dom.window.getStoredUtmParams().utm_source, 'yelp');
});

test('a visit with no utm params at all never touches an existing valid attribution', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.triplehenterprisesllc.biz/?utm_source=google',
    runScripts: 'dangerously',
  });
  dom.window.eval(utmTrackingSrc);
  dom.window.history.pushState({}, '', '/our-work.html');
  dom.window.eval(utmTrackingSrc);
  assert.equal(dom.window.getStoredUtmParams().utm_source, 'google');
});

// Phase 5 (2026-11-04): Campaign Sources gave way to Insights' By source
// table, where a UTM campaign is its own row (insights_channel()).
test('the old Campaign Sources list is replaced by the By source table', () => {
  assert.doesNotMatch(workspaceHtml, /Campaign Sources|id="utmSources"|function renderUtmSources/);
  assert.match(workspaceHtml, /id="insBySource"/);
});
