// High-Impact Upgrades U01 (7 September 2026) -- "Retire the glass
// buttons and pick one primary action." Both hero buttons used a
// glossy vertical gradient with a colour glow at equal weight, so
// visitors had to choose between two co-equal CTAs before reading
// anything. Fixed: one flat orange primary button with a solid offset
// shadow; the paired second action is quieter.
//
// Conversion UX (2026-09-17): a later audit flipped WHICH action is
// primary in the hero. Schedule/Book is now the filled orange button;
// Call is the outline secondary (phone number still visible). Triage
// results and the service modal keep the original Call-primary +
// cta-quiet-link Schedule pairing -- those fire after a visitor has
// already named a specific problem. Standalone .btn.blue links that
// aren't paired against a Call button (the "Book Instantly" vs
// "Send Email"/"Call or Text" parallel-option cards) are untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const LANDING_PAGES = [
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-st-george-ut.html',
  'handyman-washington-city-ut.html',
];

test('U01: .btn.orange is a flat fill with a solid offset shadow, not a gradient+glow', () => {
  const rule = STYLES.match(/\.btn\.orange\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /linear-gradient/);
  assert.match(rule, /background:var\(--orange\)/);
  assert.match(rule, /box-shadow:4px 4px 0 0 var\(--orange-dark\)/);
});

test('U01: .cta-quiet-link resets button chrome so it renders identically on <a> and <button>', () => {
  const rule = STYLES.match(/\.cta-quiet-link\{([^}]*)\}/)[1];
  assert.match(rule, /background:none/);
  assert.match(rule, /border:none/);
  assert.match(rule, /text-decoration:underline/);
});

test('U01: the hero-specific quiet link gets a hardcoded light color, not var(--text-dim), since the hero photo backdrop never flips with theme', () => {
  assert.match(STYLES, /\.hero \.cta-quiet-link\{color:#c9c5bc;\}/);
});

test('U01: index.html triage/service-modal Call-Schedule pairs still use cta-quiet-link; hero Call is outline, not the filled primary', () => {
  const src = fs.readFileSync(repo('index.html'), 'utf8');
  assert.doesNotMatch(src, /class="btn blue nav-phone-desktop"/);
  const ctaQuietCount = [...src.matchAll(/class="cta-quiet-link/g)].length;
  assert.ok(ctaQuietCount >= 2, `expected at least 2 cta-quiet-link usages (triage, service modal), found ${ctaQuietCount}`);
  // The two intentionally-untouched "parallel option card" links stay as .btn.blue.
  assert.match(src, /<a class="btn blue" href="\/booking\.html">/);
  assert.match(src, /id="formSubmitBtn"/);
});

// Regression-recovery fix (2026-09-08): the persistent header nav's own
// "Schedule" was ALSO converted to cta-quiet-link by the change the two
// tests above lock in, which was one demotion too many -- a user-supplied
// audit measured this leaving both the hero's secondary path and the
// header's only booking link quiet at the same time. Restored as a real,
// findable button (.nav-schedule-btn: flat, orange-tinted, not the old
// blue gloss) -- header-only, every other cta-quiet-link usage untouched.
test('regression recovery: the header nav Schedule link is a real button again, not the quiet link', () => {
  const src = fs.readFileSync(repo('index.html'), 'utf8');
  assert.doesNotMatch(src, /class="cta-quiet-link nav-phone-desktop"/);
  assert.match(src, /class="nav-schedule-btn nav-phone-desktop"/);
  const rule = STYLES.match(/\.nav-schedule-btn\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /linear-gradient/, 'should not be the old blue-gloss button');
  assert.match(rule, /border:1\.5px solid var\(--orange-tint-border\)/);
});

test('U01: landing-page triage still uses cta-quiet-link; hero Book is primary and Call is outline', () => {
  for (const file of LANDING_PAGES) {
    const src = fs.readFileSync(repo(file), 'utf8');
    assert.doesNotMatch(src, /class="btn blue nav-phone-desktop"/, `${file} header not converted`);
    const ctaQuietCount = [...src.matchAll(/class="cta-quiet-link/g)].length;
    assert.ok(ctaQuietCount >= 1, `${file}: expected at least 1 cta-quiet-link usage (triage), found ${ctaQuietCount}`);
    // Schedule/Book leads in the hero; Call stays visible as the outline secondary.
    assert.match(src, /class="btn orange" href="\/booking\.html">[\s\S]{0,1200}class="btn outline js-phone-link" href="tel:\+14354141667">/, `${file}: hero should list Schedule before the outline Call button`);
    // The untouched booking-section "Book Instantly" vs "Call or Text" parallel cards remain .btn.blue/.btn.orange.
    assert.match(src, /<a class="btn blue" href="\/booking\.html">/, `${file}: booking-section card should stay untouched`);
  }
});

test('regression recovery: every landing page also restores the header Schedule as a real button', () => {
  for (const file of LANDING_PAGES) {
    const src = fs.readFileSync(repo(file), 'utf8');
    assert.doesNotMatch(src, /class="cta-quiet-link nav-phone-desktop"/, `${file} header should not be the quiet link`);
    assert.match(src, /class="nav-schedule-btn nav-phone-desktop"/, `${file} header missing the restored button`);
  }
});
