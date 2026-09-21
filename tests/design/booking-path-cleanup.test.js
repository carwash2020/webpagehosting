// Booking conversion-path cleanup (2026-09-17), after the sticky Call+Book
// bar in #265: Schedule/Book CTAs that only jumped to a mid-page
// #schedule section now go to /booking.html, where the real calendar
// lives. The sticky bar layout is unchanged -- only href targets and
// the #schedule card hierarchy (Book Instantly primary, Email quiet).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const MARKETING_PAGES = [
  'index.html',
  'services/assembly-installation.html',
  'services/drywall-painting.html',
  'services/plumbing-repairs.html',
  'services/washer-dryer-repair.html',
  'services/washer-dryer-repair-st-george-ut.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/dishwasher-repair-st-george-ut.html',
  'services/handyman-repairs.html',
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-st-george-ut.html',
  'handyman-washington-city-ut.html',
  'our-work.html',
  'about.html',
  'blog/index.html',
  'terms.html',
  'privacy.html',
];

const SCHEDULE_PAGES = MARKETING_PAGES.filter((f) => {
  const src = fs.readFileSync(repo(f), 'utf8');
  return src.includes('<section id="schedule">');
});

function scheduleBlock(src) {
  const start = src.indexOf('<section id="schedule">');
  if (start < 0) return '';
  const end = src.indexOf('</section>', start);
  return src.slice(start, end);
}

test('Schedule/Book CTAs that used to stop at #schedule now go to /booking.html', () => {
  for (const file of MARKETING_PAGES) {
    const src = fs.readFileSync(repo(file), 'utf8');
    assert.doesNotMatch(src, /href="#schedule"/, `${file} still has a #schedule href`);
    assert.doesNotMatch(src, /href="\/#schedule"/, `${file} still has a /#schedule href`);
    assert.match(src, /href="\/booking\.html"/, `${file} should link to /booking.html`);
  }
});

test('header, mobile, and footer Schedule links on city/service pages go to /booking.html', () => {
  const cityAndService = [
    'services/assembly-installation.html',
    'services/drywall-painting.html',
    'services/plumbing-repairs.html',
    'services/washer-dryer-repair.html',
    'services/washer-dryer-repair-st-george-ut.html',
    'services/refrigerator-repair-st-george-ut.html',
    'services/dishwasher-repair-st-george-ut.html',
    'services/handyman-repairs.html',
    'handyman-cedar-city-ut.html',
    'handyman-hurricane-ut.html',
    'handyman-la-verkin-ut.html',
    'handyman-leeds-ut.html',
    'handyman-mesquite-nv.html',
    'handyman-santa-clara-ivins-ut.html',
    'handyman-st-george-ut.html',
    'handyman-washington-city-ut.html',
  ];
  for (const file of cityAndService) {
    const src = fs.readFileSync(repo(file), 'utf8');
    assert.match(src, /<a href="\/booking\.html" class="nav-schedule-btn nav-phone-desktop">Schedule<\/a>/, `${file} header Schedule`);
    const mobileAt = src.indexOf('class="mobile-menu"');
    const mobile = src.slice(mobileAt, mobileAt + 2500);
    assert.match(mobile, /<a href="\/booking\.html">Schedule<\/a>/, `${file} mobile Schedule`);
    assert.match(src, /<li><a href="\/booking\.html">Schedule<\/a><\/li>/, `${file} footer/nav Schedule`);
  }
});

test('#schedule sections make Book Instantly the orange primary', () => {
  for (const file of SCHEDULE_PAGES) {
    const block = scheduleBlock(fs.readFileSync(repo(file), 'utf8'));
    assert.match(block, /Book Instantly/, `${file} missing Book Instantly`);
    assert.match(block, /<a class="btn orange" href="\/booking\.html">/, `${file} Book Instantly should be the orange primary`);
    assert.doesNotMatch(block, /class="btn blue"/, `${file} #schedule should not keep a blue Book Instantly`);
  }
});

test('homepage #schedule keeps Email as a quiet secondary, not a second filled button', () => {
  const block = scheduleBlock(fs.readFileSync(repo('index.html'), 'utf8'));
  assert.match(block, /class="cta-quiet-link" id="openEmailModal"/);
  assert.match(block, /Send Email/);
  assert.doesNotMatch(block, /class="btn orange" id="openEmailModal"/);
});

test('city and service #schedule sections keep Call as the outline secondary', () => {
  for (const file of SCHEDULE_PAGES) {
    if (file === 'index.html') continue;
    const block = scheduleBlock(fs.readFileSync(repo(file), 'utf8'));
    assert.match(block, /class="btn outline js-phone-link" href="tel:\+14354141667"/, `${file} Call should be outline`);
    assert.doesNotMatch(block, /class="btn orange js-phone-link"/, `${file} #schedule Call should not compete as a filled primary`);
  }
});

test('booking.html has a canonical URL matching the live site domain used elsewhere', () => {
  const html = fs.readFileSync(repo('booking.html'), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.triplehenterprisesllc\.biz\/booking\.html">/);
});

test('booking.html step 1 states the FAQ facts: no deposit, trip fee beyond 15 miles, emergency = call', () => {
  const html = fs.readFileSync(repo('booking.html'), 'utf8');
  const start = html.indexOf('id="stepService"');
  const end = html.indexOf('id="stepDateTime"');
  assert.ok(start > 0 && end > start, 'expected step 1 and step 2 markers');
  const step1 = html.slice(start, end);
  assert.match(step1, /No deposit/);
  assert.match(step1, /\$25 trip fee/);
  assert.match(step1, /15 miles/);
  assert.match(step1, /emergency/i);
  assert.match(step1, /call/i);
  assert.doesNotMatch(step1, /next available/i);
  assert.doesNotMatch(step1, /same-day fee|after-hours fee|diagnostic fee/i);
});

test('Contact nav still points at #contact; the schedule section itself is still on the page', () => {
  const index = fs.readFileSync(repo('index.html'), 'utf8');
  assert.match(index, /<section id="schedule">/);
  assert.match(index, /<li><a href="#contact">Contact<\/a><\/li>/);
});
