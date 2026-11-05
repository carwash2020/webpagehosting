// Marketing-source-of-lead tracking (closes a real audit gap): the
// referral program already tracks ONE specific source (a friend/family
// referral, tied to the $25 reward ledger), but there was no way to see
// how a customer found the business more generally. Adds an optional
// "How did you hear about us?" field to both lead-capture forms (the
// homepage contact form and the booking flow), a `source` column on
// th_leads/th_bookings, and a breakdown on the internal Dashboard.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const indexHtml = fs.readFileSync(repo('index.html'), 'utf8');
const bookingHtml = fs.readFileSync(repo('booking.html'), 'utf8');
const workspaceHtml = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const sqlMigration = fs.readFileSync(repo('sql', 'leads', 'add_lead_source_tracking.sql'), 'utf8');

test('the sql migration adds source to both th_leads and th_bookings', () => {
  assert.match(sqlMigration, /alter table th_leads add column if not exists source text;/);
  assert.match(sqlMigration, /alter table th_bookings add column if not exists source text;/);
});

test('index.html\'s lead form has a "How did you hear about us?" field, sent to th_leads', () => {
  assert.match(indexHtml, /<select id="source" name="source">/);
  const fnMatch = indexHtml.match(/fetch\(LEADS_URL, \{[\s\S]*?\n\s*\.then\(\(response\)/);
  assert.ok(fnMatch, 'expected to isolate the th_leads insert body');
  assert.match(fnMatch[0], /source: formData\.get\('source'\) \|\| null,/);
});

test('booking.html\'s booking form has the same field, sent to th_bookings', () => {
  assert.match(bookingHtml, /<select id="bSource" name="source">/);
  // Updated 2026-09-22 (booking-flow pass, round 3): the payload is now
  // built once as bookingPayload and handed to submitBooking(), which
  // sends it to create_booking() (falling back to the same direct
  // th_bookings insert on a 404) -- so the field is asserted where the
  // payload is built, and submitBooking() is asserted to send that exact
  // payload down both paths.
  const fnMatch = bookingHtml.match(/const bookingPayload = Object\.assign\(\{[\s\S]*?\n\s*submitBooking\(bookingPayload\)/);
  assert.ok(fnMatch, 'expected to isolate the booking payload build');
  assert.match(fnMatch[0], /source: formData\.get\('source'\) \|\| null,/);
  const submitFn = bookingHtml.match(/function submitBooking\(payload\) \{[\s\S]*?\n  \}\n/);
  assert.ok(submitFn, 'expected to isolate submitBooking()');
  assert.match(submitFn[0], /JSON\.stringify\(\{ p_booking: payload \}\)/);
  assert.match(submitFn[0], /fetch\(SUPABASE_URL \+ '\/rest\/v1\/th_bookings', \{[\s\S]*?body: JSON\.stringify\(payload\)/);
});

test('both forms offer the same source options, so the Dashboard breakdown never has to reconcile two different vocabularies', () => {
  const OPTIONS = ['Google Search', 'Yelp / Online Reviews', 'Referral (friend or family)', 'Repeat Customer', 'Saw Our Vehicle or Sign', 'Social Media', 'Other'];
  for (const opt of OPTIONS) {
    assert.ok(indexHtml.includes('<option>' + opt + '</option>'), `index.html missing source option: ${opt}`);
    assert.ok(bookingHtml.includes('<option>' + opt + '</option>'), `booking.html missing source option: ${opt}`);
  }
});

test('the source field is genuinely optional -- no required attribute, unlike name/phone', () => {
  assert.doesNotMatch(indexHtml, /<select id="source" name="source" required>/);
  assert.doesNotMatch(bookingHtml, /<select id="bSource" name="source" required>/);
});

// Phase 5 (2026-11-04, Connor's call: "replace the lead/UTM lists with GA
// data and the source -> paid funnel"): the most-recent-50 Lead Sources list
// gave way to Insights' By source table, which counts every lead in the
// period server-side (insights_source_funnel). A lead with no source still
// counts, as "Not known" (tests/security/phase5-attribution-db.test.js).
test('the old Lead Sources list is replaced by the By source table, which reads the whole period from the database', () => {
  assert.doesNotMatch(workspaceHtml, /Lead Sources|id="leadSources"|function renderLeadSources/);
  assert.match(workspaceHtml, /id="insBySource"/);
  assert.match(workspaceHtml, /fetchInsightsFunnel\(since\)/);
});
