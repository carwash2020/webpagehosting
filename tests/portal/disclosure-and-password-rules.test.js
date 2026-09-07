// Two fixes from the 2026-09-07 portal pass, both found by rendering the
// real pages rather than reading the CSS:
//
//   1. "View details" on the invoice and quote cards was a bare
//      <details>/<summary> with only an inline cursor/size/colour, so it
//      drew the browser's own disclosure triangle -- the one raw platform
//      widget left anywhere in the app, sitting a few hundred pixels from
//      Settings' custom chevron doing the identical job.
//   2. set-password.html never stated its 8-character rule until after a
//      failed submit, and checked mismatch before length, so a client who
//      typed a short password twice with a typo was told "those don't
//      match", fixed that, and only then learned it was also too short.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const POLISH = fs.readFileSync(repo('portal', 'portal-polish.css'), 'utf8');
const SET_PASSWORD = fs.readFileSync(repo('portal', 'set-password.html'), 'utf8');

// ---- 1. the disclosure chevron ----

test('the portal suppresses the browser default disclosure marker', () => {
  // Both are needed: list-style for the standards-track marker, the
  // ::-webkit-details-marker pseudo-element for older WebKit/Blink.
  const rule = POLISH.match(/body\.portal-page details > summary \{[^}]*\}/);
  assert.ok(rule, 'expected a scoped summary rule');
  assert.match(rule[0], /list-style: none/);
  assert.match(POLISH, /body\.portal-page details > summary::-webkit-details-marker \{ display: none; \}/);
});

test('it draws its own chevron that rotates on open', () => {
  const closed = POLISH.match(/body\.portal-page details > summary::before \{[^}]*\}/);
  const open = POLISH.match(/body\.portal-page details\[open\] > summary::before \{[^}]*\}/);
  assert.ok(closed && open, 'expected both chevron states');
  assert.match(closed[0], /transform: rotate\(-45deg\)/);
  assert.match(open[0], /transform: rotate\(45deg\)/);
});

test('the chevron respects reduced motion, like the Settings one it matches', () => {
  const block = POLISH.match(/@media \(prefers-reduced-motion: reduce\) \{\s*body\.portal-page details > summary::before \{ transition: none; \}\s*\}/);
  assert.ok(block, 'expected a reduced-motion opt-out for the chevron transition');
});

test('the rule is scoped to the portal so the public site is untouched', () => {
  // styles.css is shared with the marketing site; an unscoped
  // `details > summary` rule here would reach it.
  assert.ok(!/^details > summary/m.test(POLISH), 'summary rules must be scoped to body.portal-page');
});

test('both cards that use <details> are on portal pages carrying that class', () => {
  for (const page of ['dashboard.html', 'quotes.html']) {
    const html = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(html, /<details/, `${page} should still use <details>`);
    assert.match(html, /class="[^"]*portal-page/, `${page} needs body.portal-page for the chevron rule to apply`);
  }
});

// ---- 2. the password rule, stated up front ----

test('set-password states its length requirement on the field itself', () => {
  assert.match(SET_PASSWORD, /<label for="newPassword">New password<span class="login-hint">At least 8 characters<\/span><\/label>/);
});

test('the hint is covered by the nested-label-casing reset', () => {
  // It is a <span> inside a <label>, so without this it inherits the
  // uppercase + letter-spacing from styles.css -- and the bold weight.
  assert.match(POLISH, /label \.login-hint/);
  // ^ anchored: the multi-selector casing reset above also contains
  // ".login-hint {", and matching that one would test the wrong rule.
  const rule = POLISH.match(/^\.login-hint \{[^}]*\}/m);
  assert.ok(rule, 'expected a .login-hint rule');
  assert.match(rule[0], /font-weight: 400/);
});

test('the length check runs before the mismatch check', () => {
  const lengthAt = SET_PASSWORD.indexOf('Password needs to be at least 8 characters.');
  const mismatchAt = SET_PASSWORD.indexOf("Those passwords don't match.");
  assert.ok(lengthAt > 0 && mismatchAt > 0, 'expected both validation messages');
  assert.ok(
    lengthAt < mismatchAt,
    'length must be checked first: it depends only on the first field and is always the more actionable message',
  );
});

test('both validation rules still exist and still block submission', () => {
  assert.match(SET_PASSWORD, /if \(newPassword\.length < 8\) \{[\s\S]{0,140}?return;/);
  assert.match(SET_PASSWORD, /if \(newPassword !== confirmPassword\) \{[\s\S]{0,140}?return;/);
  // The browser-native guard stays too, so a short password is caught
  // before the handler ever runs.
  assert.match(SET_PASSWORD, /id="newPassword"[^>]*minlength="8"/);
});
