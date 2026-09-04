// Tests for two Settings changes requested directly (2026-09-04):
// hiding the Add to Home Screen card once the app is already
// installed (rather than showing an empty section with just a
// message), and adding a Sign out button within Settings itself,
// not just the header.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'settings.html'), 'utf8');

test('the Add to Home Screen card is hidden entirely once already installed, not left visible with a message', () => {
  const fnMatch = html.match(/function renderAddToHomeScreen\(\)[\s\S]*?const isStandalone[\s\S]*?if \(isStandalone\) return;/);
  assert.ok(fnMatch, 'expected to isolate the standalone-detection block');
  assert.match(fnMatch[0], /card\.style\.display = isStandalone \? 'none' : 'block';/);
  assert.doesNotMatch(fnMatch[0], /You're using the installed app already/, 'the old message-based approach should be gone, not just supplemented');
});

test('the card re-checks and correctly re-shows if somehow not standalone, not just a one-way hide', () => {
  const fnMatch = html.match(/function renderAddToHomeScreen\(\)[\s\S]*?const isStandalone[\s\S]*?if \(isStandalone\) return;/);
  // The ternary sets 'block' for the non-standalone case explicitly,
  // rather than only ever setting 'none' and never restoring it.
  assert.match(fnMatch[0], /isStandalone \? 'none' : 'block'/);
});

test('no longer references the now-unused subtitle element or variable left behind by the old approach', () => {
  const fnMatch = html.match(/function renderAddToHomeScreen\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate the whole function');
  assert.doesNotMatch(fnMatch[0], /const sub = document\.getElementById/);
});

test('a real Sign out button exists within the Settings page body, not just the header', () => {
  assert.match(html, /<button class="secondary-btn" id="signOutBtnSettings"/);
});

test('both the header and in-body sign out buttons call the exact same real sign-out logic, not two separate implementations', () => {
  const signOutCalls = html.match(/\.addEventListener\('click', signOut\);/g);
  assert.ok(signOutCalls);
  assert.equal(signOutCalls.length, 2, 'expected both signOutBtn and signOutBtnSettings wired to the same shared function');
  const fnMatch = html.match(/async function signOut\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected a single shared signOut() function');
  assert.match(fnMatch[0], /await client\.auth\.signOut\(\);/);
  assert.match(fnMatch[0], /window\.location\.replace\('\/portal\/login\.html'\);/);
});
