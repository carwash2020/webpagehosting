// Tests for editable name/phone on Settings (2026-09-03), requested
// directly after being offered the choice: "Let them edit phone/name
// directly." A genuinely new concept, not a relaxation of the prior
// design -- name previously came read-only from whatever invoice/
// quote was on file, specifically so it would never drift from what
// those documents actually said. That reasoning still holds for old
// documents; client_profiles is the separate, current profile a
// client maintains going forward.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

test('email stays read-only while name and phone are real editable inputs', () => {
  assert.match(SETTINGS, /id="detailEmailVal"/);
  assert.doesNotMatch(SETTINGS, /<input[^>]*id="detailEmail"/, 'email must not be an editable input');
  assert.match(SETTINGS, /<input type="text" id="detailName"/);
  assert.match(SETTINGS, /<input type="tel" id="detailPhone"/);
});

test('saving upserts to client_profiles keyed by the caller\'s own session email, never a client-supplied value', () => {
  const fnMatch = SETTINGS.match(/async function saveClientProfile\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate saveClientProfile()');
  const body = fnMatch[0];
  assert.match(body, /client\.from\('client_profiles'\)\.upsert\(\{/);
  assert.match(body, /client_email: session\.user\.email,/);
});

test('an unauthenticated save attempt redirects to login rather than silently failing', () => {
  const fnMatch = SETTINGS.match(/async function saveClientProfile\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /window\.location\.replace\('\/portal\/login\.html'\)/);
});

test('loading a first-time client with no saved profile falls back to the old invoice/quote name lookup as a pre-fill only, not a value that gets written back', () => {
  const fnMatch = SETTINGS.match(/async function init\(\)[\s\S]*?renderAddToHomeScreen\(\);\s*\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate init()');
  const body = fnMatch[0];
  assert.match(body, /if \(!hasProfile\) \{[\s\S]*?client_portal_invoices/);
  // The fallback only ever sets local variables that get assigned to
  // the input's .value -- it must never itself call .upsert() or
  // .update() on client_profiles.
  const fallbackBlock = body.match(/if \(!hasProfile\) \{[\s\S]*?\n    \}\n/);
  assert.ok(fallbackBlock);
  assert.doesNotMatch(fallbackBlock[0], /\.upsert\(|\.update\(/);
});

test('a client with an existing saved profile uses it directly, skipping the invoice/quote fallback entirely', () => {
  const fnMatch = SETTINGS.match(/async function init\(\)[\s\S]*?renderAddToHomeScreen\(\);\s*\n  \}\n/);
  const body = fnMatch[0];
  const profileLookupIdx = body.indexOf("from('client_profiles')");
  const hasProfileSetIdx = body.indexOf('hasProfile = true;');
  const fallbackIdx = body.indexOf('if (!hasProfile) {');
  assert.ok(profileLookupIdx !== -1 && hasProfileSetIdx !== -1 && fallbackIdx !== -1);
  assert.ok(profileLookupIdx < hasProfileSetIdx && hasProfileSetIdx < fallbackIdx);
});

test('no innerHTML is used for the email display or the name/phone values -- textContent and .value are XSS-safe by construction', () => {
  const fnMatch = SETTINGS.match(/async function init\(\)[\s\S]*?renderAddToHomeScreen\(\);\s*\n  \}\n/);
  const body = fnMatch[0];
  assert.doesNotMatch(body, /\.innerHTML/);
  assert.match(body, /document\.getElementById\('detailEmailVal'\)\.textContent = email;/);
  assert.match(body, /document\.getElementById\('detailName'\)\.value = name;/);
});
