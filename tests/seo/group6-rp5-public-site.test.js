// Fix plan Group 6, RP5 (2026-11-07): the public site says what the
// business does, when it is open, and what a visitor can book.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

test('RP5.1: the homepage footer says clients create their own portal account, never "set up automatically"', () => {
  const s = read('index.html');
  assert.doesNotMatch(s, /set up automatically/);
  assert.doesNotMatch(s, /Existing clients only/);
  assert.match(s, /Got an invoice or estimate from us\? <a href="\/portal\/login\.html">Create your account<\/a> with the email it was sent to\./);
});

test('RP5.2: every Preferred Time window sits inside real business hours', () => {
  const doc = new JSDOM(read('index.html')).window.document;
  const opts = [...doc.querySelectorAll('#time option')].map((o) => o.textContent.trim()).filter((t) => t !== 'Choose one');
  assert.deepEqual(opts, [
    'Afternoon (2PM to 5PM)',
    'Evening (5PM to 8PM)',
    'Late (8PM to 10PM, not Sunday)',
    'Saturday morning (7AM to 11AM)',
    "I'm flexible",
  ]);
  // business-hours.js: open 2PM every day but Saturday (7AM); close 10PM, Sunday 8PM.
  const hours = read('js', 'business-hours.js');
  assert.match(hours, /0: \[14, 20\], 1: \[14, 22\], 2: \[14, 22\], 3: \[14, 22\], 4: \[14, 22\], 5: \[14, 22\], 6: \[7, 22\]/);
});

test('RP5.3: Preferred Date cannot be in the past, on the input and on submit', () => {
  const s = read('index.html');
  assert.match(s, /<input id="date" name="date" type="date" data-min-today>/);
  assert.match(s, /function leadTodayIso\(\)/);
  assert.match(s, /document\.querySelectorAll\('input\[data-min-today\]'\)\.forEach\(\(el\) => \{ el\.min = leadTodayIso\(\); \}\);/);
  const fn = s.slice(s.indexOf('  function submitLeadFromForm('), s.indexOf('  function submitLeadFromForm(') + 4000);
  assert.match(fn, /const pickedDate = String\(formData\.get\('date'\) \|\| ''\);/);
  assert.match(fn, /if \(pickedDate && pickedDate < leadTodayIso\(\)\) \{/);
  assert.match(fn, /That date has passed\. Pick today or later/);
});

test('RP5.4: the sitemap ships no lastmod rather than a wrong one', () => {
  const s = read('sitemap.xml');
  assert.doesNotMatch(s, /<lastmod>/);
  assert.ok((s.match(/<loc>/g) || []).length >= 39, 'every URL is still listed');
});

test('RP5.5 (D25): the booking and lead-form service lists are the same union', () => {
  const doc = new JSDOM(read('index.html')).window.document;
  const lead = [...doc.querySelectorAll('#service option')].map((o) => o.textContent.trim()).filter((t) => t !== 'Choose one');
  const booking = read('booking.html');
  const labels = [...booking.slice(booking.indexOf('  const SERVICES = ['), booking.indexOf('  ];', booking.indexOf('  const SERVICES = ['))).matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  const union = ['In-person Estimate', 'Inspection', 'Plumbing Fixes & Leaks', 'Appliance Repair', 'General Handyman Repairs', 'Assembly & Installation', 'Drywall & Painting', 'Emergency Calls', 'Something Else'];
  assert.deepEqual([...lead].sort(), [...union].sort(), 'lead form');
  assert.deepEqual([...labels].sort(), [...union].sort(), 'booking');
  // Emergency on the booking page points at the phone first.
  assert.match(booking, /key: 'emergency', label: 'Emergency Calls'[^\n]*call or text \(435\) 414-1667/);
  // manage-booking draws an icon for every label booking can store.
  const manage = read('manage-booking.html');
  for (const l of union) assert.ok(manage.includes(`'${l}':`), `manage-booking icon for ${l}`);
});

test('RP5.6: the careers JobPosting carries a future validThrough', () => {
  const s = read('careers.html');
  const m = s.match(/"validThrough": "(\d{4}-\d{2}-\d{2})"/);
  assert.ok(m, 'validThrough missing');
  assert.ok(m[1] > '2026-11-07', 'validThrough must be in the future');
  JSON.parse(s.slice(s.indexOf('{', s.indexOf('application/ld+json')), s.indexOf('</script>', s.indexOf('application/ld+json'))));
});

test('RP5.7: booking, manage-booking and manage-job have a skip link to their <main>', () => {
  for (const p of ['booking.html', 'manage-booking.html', 'manage-job.html']) {
    const html = read(p);
    const m = html.match(/<a href="#main" class="skip-link">Skip to main content<\/a>/);
    assert.ok(m, p + ': skip link');
    assert.ok(html.indexOf(m[0]) < html.search(/<header[\s>]/), p + ': before <header>');
    assert.match(html, /<main [^>]*id="main"/, p + ': <main id="main">');
    assert.match(html, /\.skip-link\{[^}]*position:absolute; top:-60px;/, p + ': the skip-link style (these pages do not load styles.css)');
  }
});
