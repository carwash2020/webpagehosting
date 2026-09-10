// 2026-09-10: about.html, our-work.html, terms.html, the blog index, and
// all 6 blog posts were missing the site's blueprint-grid background +
// orange/blue ambient glow (.has-blueprint-bg on <body> + a following
// <div class="bg-blueprint">) that every other public marketing page
// (index.html, the 5 city pages, the 3 service pages) already carries.
// Locks in that every public marketing page matches, so a future new
// page doesn't quietly skip this treatment the same way these did.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const PAGES = [
  'index.html',
  'handyman-hurricane-ut.html', 'handyman-washington-city-ut.html',
  'handyman-santa-clara-ivins-ut.html', 'handyman-cedar-city-ut.html',
  'handyman-mesquite-nv.html',
  'washer-dryer-repair.html', 'plumbing-repairs.html', 'drywall-painting.html',
  'handyman-repairs.html', 'assembly-installation.html',
  'about.html', 'our-work.html', 'terms.html',
  'blog/index.html', 'blog/dryer-not-heating.html', 'blog/handyman-to-do-list.html',
  'blog/appliance-repair-or-replace.html', 'blog/washer-wont-drain.html',
  'blog/dishwasher-not-cleaning.html', 'blog/fridge-not-cooling.html',
];

test('every public marketing page carries the blueprint background (has-blueprint-bg on <body> + a following .bg-blueprint div)', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.match(html, /<body class="has-blueprint-bg">/, `${page} should have <body class="has-blueprint-bg">`);
    assert.match(
      html,
      /<body class="has-blueprint-bg">\s*<div class="bg-blueprint" aria-hidden="true"><\/div>/,
      `${page} should have the .bg-blueprint div immediately after <body>`
    );
  }
});

test('booking.html and manage-booking.html are deliberately excluded (their own standalone dark theme, not this template)', () => {
  const booking = fs.readFileSync(repo('booking.html'), 'utf8');
  assert.doesNotMatch(booking, /has-blueprint-bg/);
});
