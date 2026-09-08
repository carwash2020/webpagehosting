// W20/M04 fix (Master Audit, 2026-09-08): a user-supplied before/after
// audit found the page fading straight from the contact cards into the
// plain footer, with no deliberate final moment -- "the close" was one
// of the three flat spots it named. Adds one lit, full-height screen
// right before the footer: the real mission statement in large type,
// one Call button (matching U01's single-primary-action rule), and the
// same live open/closed status + next-opening line the hero already
// computes -- generalized from a single getElementById to every
// matching element on the page so there's no second, driftable copy of
// that logic.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const TRIAGE_JS = fs.readFileSync(repo('triage.js'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('the closing section exists right before the footer, not appended after it', () => {
  const closingIdx = INDEX.indexOf('<section id="closing"');
  const mainCloseIdx = INDEX.indexOf('</main>');
  const footerIdx = INDEX.indexOf('<footer>');
  assert.ok(closingIdx > 0, 'expected a #closing section');
  assert.ok(closingIdx < mainCloseIdx, 'the closing section should be inside <main>');
  assert.ok(mainCloseIdx < footerIdx, '</main> should still close before <footer>');
});

test('the closing section states the real mission statement and exactly one primary Call button', () => {
  const start = INDEX.indexOf('<section id="closing"');
  const end = INDEX.indexOf('</section>', start);
  const section = INDEX.slice(start, end);
  assert.match(section, /Leaving customers better than they were found/);
  const btnMatches = [...section.matchAll(/class="btn orange/g)];
  assert.equal(btnMatches.length, 1, 'expected exactly one primary .btn.orange in the closing section');
  assert.match(section, /href="tel:\+14354141667"/);
});

test('the closing section reuses the hero\'s own live-status classes, not a second copy of that markup', () => {
  const start = INDEX.indexOf('<section id="closing"');
  const end = INDEX.indexOf('</section>', start);
  const section = INDEX.slice(start, end);
  assert.match(section, /class="open-status closing-open-status" hidden/);
  assert.match(section, /class="open-status-text"/);
  assert.match(section, /class="next-opening closing-next-opening" hidden/);
});

test('triage.js populates every .open-status and .next-opening on the page from one computed result, not a single getElementById target', () => {
  assert.match(TRIAGE_JS, /document\.querySelectorAll\('\.open-status'\)/);
  assert.match(TRIAGE_JS, /document\.querySelectorAll\('\.next-opening'\)/);
  assert.doesNotMatch(TRIAGE_JS, /getElementById\('openStatus'\)/);
  assert.doesNotMatch(TRIAGE_JS, /getElementById\('nextOpening'\)/);
});

test('the closing section has its own dedicated override classes rather than a compound descendant selector on the shared pill class (an existing test locates the real .open-status rule by its exact selector text)', () => {
  assert.match(STYLES, /\.closing-open-status\{/);
  assert.match(STYLES, /\.closing-next-opening\{/);
  const literalMatches = [...STYLES.matchAll(/\.open-status\{/g)];
  assert.equal(literalMatches.length, 1, 'expected exactly one literal ".open-status{" rule in the whole stylesheet');
});

test('the closing section has its own ambient glow, same convention as .hero and .teardown', () => {
  const rule = STYLES.match(/\.closing::before\{([^}]*)\}/);
  assert.ok(rule, 'expected a .closing::before rule');
  assert.match(rule[1], /radial-gradient\(/);
  assert.match(rule[1], /rgba\(255,128,0,/);
});

test('the tools/portal service workers were bumped for this styles.css change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 105, `expected v105 or later, got v${version}`);
});
