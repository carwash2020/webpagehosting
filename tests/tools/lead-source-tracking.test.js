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
  const fnMatch = indexHtml.match(/fetch\(LEADS_SUPABASE_URL \+ '\/rest\/v1\/th_leads', \{[\s\S]*?\n\s*\.then\(\(response\)/);
  assert.ok(fnMatch, 'expected to isolate the th_leads insert body');
  assert.match(fnMatch[0], /source: formData\.get\('source'\) \|\| null,/);
});

test('booking.html\'s booking form has the same field, sent to th_bookings', () => {
  assert.match(bookingHtml, /<select id="bSource" name="source">/);
  const fnMatch = bookingHtml.match(/fetch\(SUPABASE_URL \+ '\/rest\/v1\/th_bookings', \{[\s\S]*?\n\s*\.then\(function \(res\)/);
  assert.ok(fnMatch, 'expected to isolate the th_bookings insert body');
  assert.match(fnMatch[0], /source: formData\.get\('source'\) \|\| null,/);
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

test('workspace.html has a Lead Sources breakdown, reusing the leads already fetched for the Leads Inbox rather than a second query', () => {
  assert.match(workspaceHtml, /<div class="analytics-subheading">Lead Sources/);
  assert.match(workspaceHtml, /<div id="leadSources"><\/div>/);
  const fnMatch = workspaceHtml.match(/async function loadAndRenderLeads\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate loadAndRenderLeads()');
  assert.match(fnMatch[0], /renderLeadSources\(visibleLeads\)/, 'expected renderLeadSources to be called with the already-fetched leads array');
  // Confirm no second fetchLeads()/th_leads call inside renderLeadSources itself.
  const renderFnMatch = workspaceHtml.match(/function renderLeadSources\(leads\) \{[\s\S]*?\n  \}\n/);
  assert.ok(renderFnMatch, 'expected to isolate renderLeadSources()');
  assert.doesNotMatch(renderFnMatch[0], /fetchLeads|th_leads/);
});

test('a lead with no source recorded is grouped as "Not specified", not silently dropped from the count', () => {
  const renderFnMatch = workspaceHtml.match(/function renderLeadSources\(leads\) \{[\s\S]*?\n  \}\n/);
  assert.ok(renderFnMatch);
  assert.match(renderFnMatch[0], /l\.source \|\| 'Not specified'/);
});
