// Regression-recovery fix, round 2 (2026-09-08): a second measured
// audit found #schedule (543px), #contact (597px) and #closing (646px)
// as three consecutive full sections all asking for the same thing --
// 1,786px, 15.5% of the page -- and noted #contact's Call/Text and
// Email cards duplicated the phone/email already carried by the header,
// the sticky call button, the closing screen, and the footer. #schedule
// and #contact are now one section: the booking-grid is unchanged, and
// only the two things genuinely nowhere else on the page (Hours, the
// Service Area/map link) survive, in a compact strip. #contact stays a
// real, working anchor -- the nav and footer links to it are untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('there is exactly one #schedule section and no separate #contact section', () => {
  assert.equal((INDEX.match(/<section id="schedule">/g) || []).length, 1);
  assert.equal((INDEX.match(/<section id="contact">/g) || []).length, 0);
});

test('#contact is still a real anchor target inside the merged section', () => {
  assert.match(INDEX, /<div class="schedule-info-strip" id="contact">/);
  const scheduleStart = INDEX.indexOf('<section id="schedule">');
  const scheduleEnd = INDEX.indexOf('</section>', scheduleStart);
  const contactIdx = INDEX.indexOf('id="contact"');
  assert.ok(contactIdx > scheduleStart && contactIdx < scheduleEnd, '#contact should live inside #schedule now');
});

test('the merged strip keeps Hours and Service Area, not the Call/Text or Email cards', () => {
  const start = INDEX.indexOf('<div class="schedule-info-strip"');
  const end = INDEX.indexOf('</section>', start);
  const block = INDEX.slice(start, end);
  assert.match(block, /<h4>Hours<\/h4>/);
  assert.match(block, /<h4>Service Area<\/h4>/);
  assert.match(block, /View on Google Maps/);
  assert.doesNotMatch(block, /Call or Text/);
  assert.doesNotMatch(block, /class="contact-card"/);
});

test('the now-unreferenced copy-email button and its CSS are gone, not orphaned', () => {
  assert.doesNotMatch(INDEX, /copyEmailBtn/);
  assert.doesNotMatch(INDEX, /copyEmailLabel/);
  assert.doesNotMatch(STYLES, /\.copy-email-btn/);
  assert.doesNotMatch(STYLES, /\.email-row\{/);
});

test('.btn.blue is flat (no gradient), matching .btn.orange\'s treatment in the blue token', () => {
  const rule = STYLES.match(/\.btn\.blue\{([^}]*)\}/);
  assert.ok(rule, 'expected a .btn.blue rule');
  assert.doesNotMatch(rule[1], /gradient/);
  assert.match(rule[1], /background:var\(--blue\)/);
  assert.match(rule[1], /box-shadow:4px 4px 0 0 var\(--blue-dark\)/);
  assert.match(STYLES, /\.btn\.blue:hover\{box-shadow:6px 6px 0 0 var\(--blue-dark\)/);
});

test('the tools/portal service worker was bumped for this styles.css change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 108, `expected v108 or later, got v${version}`);
});
