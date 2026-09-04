// Tests for viewing past signed authorizations on Settings
// (2026-09-03), requested directly: "View past signed
// authorizations" -- the same transparency reasoning behind showing
// a receipt for every charge.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

test('the settings page shows a Signed Authorizations section and loads it on init', () => {
  assert.match(SETTINGS, /<div class="set-card-title">Signed Authorizations<\/div>/);
  assert.match(SETTINGS, /loadAuthorizations\(\);/);
});

test('authorizations are read directly via the Supabase client, scoped to the caller\'s own email -- no edge function needed for a plain RLS-protected read', () => {
  const fnMatch = SETTINGS.match(/async function loadAuthorizations\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate loadAuthorizations()');
  const body = fnMatch[0];
  assert.match(body, /\.from\('card_authorizations'\)/);
  assert.match(body, /\.eq\('client_email', session\.user\.email\)/);
});

test('authorizations are ordered most-recent first', () => {
  const fnMatch = SETTINGS.match(/async function loadAuthorizations\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /\.order\('created_at', \{ ascending: false \}\)/);
});

test('the displayed text is the exact authorization_text stored at the time, escaped for safe display', () => {
  const fnMatch = SETTINGS.match(/async function loadAuthorizations\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /escapeHtml\(a\.authorization_text\)/);
});

// ---- regression test for the real bug found and fixed this turn ----

test('loadSavedCards is a real, complete function declaration -- not an orphaned body missing its own opening line', () => {
  // Real bug found and fixed (2026-09-03): an earlier edit inserting
  // loadAuthorizations() dropped the "async function loadSavedCards()
  // {" line and its comment, leaving that function's body floating
  // with no enclosing declaration at all -- calls to loadSavedCards()
  // elsewhere in the file would have thrown ReferenceError. Caught by
  // checking the actual file rather than trusting the edit succeeded,
  // and confirmed fixed here with an explicit structural check.
  const declarationMatches = SETTINGS.match(/async function loadSavedCards\(\)/g);
  assert.ok(declarationMatches, 'expected a real loadSavedCards() declaration to exist');
  assert.equal(declarationMatches.length, 1, 'expected exactly one declaration, not zero (orphaned body) or several (duplicated)');

  const fnMatch = SETTINGS.match(/async function loadSavedCards\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate a complete, well-formed loadSavedCards() function body');
  assert.match(fnMatch[0], /getElementById\('savedCardsBody'\)/);
});

test('loadSavedCards is called from both init() and after a successful card removal', () => {
  const callSites = SETTINGS.match(/loadSavedCards\(\);/g);
  assert.ok(callSites);
  assert.equal(callSites.length, 2, 'expected exactly two call sites: init() and after removeSavedCard succeeds');
});
