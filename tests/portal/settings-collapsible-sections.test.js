// Tests for collapsible Settings sections (2026-09-05), requested
// directly: "we need to revamp the settings it still looks a little
// much." Every section starts collapsed, showing just its title --
// the most direct way to cut down the scroll length, while still
// reaching anything in one tap.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'settings.html'), 'utf8');

const COLLAPSIBLE_TITLES = [
  'Your Details', 'Saved Cards', 'Signed Authorizations', 'Add to Home Screen',
  'Change Password', 'Notifications', 'Security',
];

for (const title of COLLAPSIBLE_TITLES) {
  test(`"${title}" is a real collapsible section: starts collapsed, has an accessible header button, and wraps its content in a body`, () => {
    const idx = HTML.indexOf(`<span class="set-card-title">${title}</span>`);
    assert.ok(idx !== -1, `expected to find the ${title} header`);
    const context = HTML.slice(Math.max(0, idx - 250), idx + 50);
    assert.match(context, /class="set-card is-collapsed"/, `${title}: expected the card to start collapsed`);
    assert.match(context, /<button type="button" class="set-card-header" onclick="toggleSettingsCard\(this\)" aria-expanded="false">/, `${title}: expected an accessible header button`);
    const afterIdx = HTML.indexOf('<div class="set-card-body">', idx);
    assert.ok(afterIdx !== -1 && afterIdx < idx + 300, `${title}: expected a set-card-body wrapper shortly after the title`);
  });
}

test('the Sign Out card is deliberately NOT collapsible -- it is a single action with nothing to hide', () => {
  const idx = HTML.indexOf('id="signOutBtnSettings"');
  assert.ok(idx !== -1, 'expected to find the sign out button');
  const context = HTML.slice(Math.max(0, idx - 200), idx);
  assert.doesNotMatch(context, /set-card-header/, 'the sign out card should not have an accordion header');
});

test('toggleSettingsCard toggles only the ONE card it belongs to, via closest(), not every card on the page', () => {
  const fnMatch = HTML.match(/function toggleSettingsCard\(headerBtn\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate toggleSettingsCard()');
  assert.match(fnMatch[0], /headerBtn\.closest\('\.set-card'\)/);
  assert.doesNotMatch(fnMatch[0], /querySelectorAll/);
});

test('toggleSettingsCard keeps aria-expanded in sync with the real collapsed state, not left stale', () => {
  const fnMatch = HTML.match(/function toggleSettingsCard\(headerBtn\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /headerBtn\.setAttribute\('aria-expanded', collapsed \? 'false' : 'true'\)/);
});

test('the Add to Home Screen card keeps its own id, since existing JS shows/hides the whole card by it independently of the new collapse state', () => {
  assert.match(HTML, /<div class="set-card is-collapsed" id="addHomeScreenCard">/);
  assert.match(HTML, /const card = document\.getElementById\('addHomeScreenCard'\);/);
});

test('every pre-existing field id survived the restructure unchanged -- the accordion wrapping should never have touched these', () => {
  for (const id of [
    'detailName', 'detailPhone', 'detailEmailVal', 'saveDetailsBtn', 'detailsMsg',
    'savedCardsBody', 'addCardBtn', 'addCardArea',
    'authorizationsBody',
    'addHomeScreenSub', 'addHomeScreenBody',
    'newPassword', 'confirmPassword', 'savePasswordBtn', 'passwordMsg',
    'notifyInvoiceQuote', 'notifyWorkOrder', 'notifyMessages', 'notifyMsg',
    'pushToggleBtn', 'pushMsg',
    'biometricToggleBtn', 'biometricMsg',
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"`), `expected id="${id}" to still exist`);
  }
});

test('the collapse CSS actually hides the body and rotates the chevron, and respects reduced motion', () => {
  assert.match(HTML, /\.set-card\.is-collapsed \.set-card-body \{ display: none; \}/);
  assert.match(HTML, /\.set-card\.is-collapsed \.set-card-chevron \{ transform: rotate\(-90deg\); \}/);
  const reducedBlock = HTML.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.set-card-chevron[\s\S]*?\}/);
  assert.ok(reducedBlock, 'expected the chevron rotation transition to be disabled under reduced motion');
});

test('the HTML is well-formed -- opening and closing divs balance exactly after the restructure', () => {
  const opens = (HTML.match(/<div\b/g) || []).length;
  const closes = (HTML.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, `expected balanced divs, got ${opens} opening vs ${closes} closing`);
});
