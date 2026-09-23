// Settings reworked (2026-09-22), requested directly: "i want the
// settings reworked and less packed full of things." Eleven stacked
// (collapsed) cards became a six-row menu with a live status line under
// each row; a row opens just that section.
//   - Phone: the menu is the page; a section replaces it, with a back
//     link, and the browser's back button closes it.
//   - Desktop (1024px+): menu left, the chosen section right, opening
//     on Profile.
// Replaces tests/portal/settings-collapsible-sections.test.js, which
// pinned the old accordion. The id-survival and div-balance checks
// from that file carry over below.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'settings.html'), 'utf8');
const SECTIONS = ['profile', 'payment', 'notifications', 'security', 'referral', 'app'];

function between(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `expected to find ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `expected to find ${endMarker} after ${startMarker}`);
  return src.slice(start, end);
}
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const SHELL = between(HTML, '<div class="settings-shell">', '\n<script>');
const ROUTING = between(HTML, '  const SETTINGS_SECTIONS', '  function countNotificationEmailsOn()');

// A page with the real Settings markup and the real routing/summary
// code, at a phone or desktop width.
function settingsPage({ desktop = false, hash = '' } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body class="portal-page">' + SHELL + '</body>', {
    url: 'https://example.com/portal/settings.html' + hash,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: desktop, addEventListener() {} });
  window.scrollTo = () => {};
  window.eval(ROUTING + '\n' + extractFn(HTML, 'cardExpirationStatus') + '\n' + extractFn(HTML, 'renderPaymentSummary') +
    '\nwindow.__t = { settingsStatus, renderNotificationsSummary, renderSecuritySummary, settingsInitials, renderSettingsProfile, renderPaymentSummary, setSettingsSummary };');
  return window;
}
const visiblePanes = (w) => Array.from(w.document.querySelectorAll('.settings-pane')).filter((p) => !p.hidden).map((p) => p.dataset.section);
const tick = () => new Promise((r) => setTimeout(r, 30));

// ---- structure ----

test('one menu row, one status line and one section per area -- six places, not eleven cards', () => {
  const links = HTML.match(/<a class="settings-link[^"]*" href="#(\w+)" data-section="\1">/g) || [];
  assert.deepEqual(links.map((l) => l.match(/data-section="(\w+)"/)[1]), SECTIONS);
  for (const key of SECTIONS) {
    assert.match(HTML, new RegExp(`<span class="settings-link-summary" id="summary-${key}">[^<]+</span>`), `${key}: needs a fallback status line`);
    assert.match(HTML, new RegExp(`<div class="settings-pane" id="pane-${key}" data-section="${key}" role="region" aria-labelledby="pane-${key}-title" hidden>`));
    assert.match(HTML, new RegExp(`<h2 class="settings-pane-title" id="pane-${key}-title" tabindex="-1">`), `${key}: focusable title`);
  }
  const backs = HTML.match(/<button type="button" class="settings-back" onclick="openSettingsSection\(null\)">/g) || [];
  assert.equal(backs.length, SECTIONS.length, 'every section has a back link to the menu');
});

test('the accordion is gone -- no collapsed cards, header buttons or toggle function left behind', () => {
  assert.doesNotMatch(HTML, /is-collapsed/);
  assert.doesNotMatch(HTML, /set-card-header/);
  assert.doesNotMatch(HTML, /toggleSettingsCard/);
});

test('each old card landed in the section it belongs to', () => {
  const pane = (key) => between(HTML, `id="pane-${key}"`, key === 'app' ? '<script>' : '<div class="settings-pane"');
  assert.match(pane('profile'), /id="detailName"/);
  assert.match(pane('payment'), /<span class="set-card-title">Saved Cards<\/span>/);
  assert.match(pane('payment'), /<details class="set-card set-disclosure">[\s\S]*Signed Authorizations[\s\S]*id="authorizationsBody"/);
  assert.match(pane('notifications'), /id="notifyInvoiceQuote"[\s\S]*id="pushToggleBtn"/);
  assert.match(pane('security'), /id="newPassword"[\s\S]*id="mfaToggleBtn"[\s\S]*id="biometricToggleBtn"/);
  assert.match(pane('referral'), /id="referralLinkBody"/);
  assert.match(pane('app'), /id="addHomeScreenCard"[\s\S]*id="updateAppBtn"/);
});

test('Sign out sits once at the foot of the menu; the header copy is hidden here but still wired', () => {
  const index = between(HTML, '<div class="settings-index">', '<div class="settings-panes">');
  assert.match(index, /<button class="secondary-btn" id="signOutBtnSettings" type="button">Sign out<\/button>/);
  assert.match(HTML, /\.portal-header #signOutBtn \{ display: none; \}/);
  assert.match(HTML, /document\.getElementById\('signOutBtn'\)\.addEventListener\('click', signOut\);/);
});

test('every pre-existing field id survived the rework unchanged', () => {
  for (const id of [
    'detailName', 'detailPhone', 'detailEmailVal', 'saveDetailsBtn', 'detailsMsg',
    'savedCardsBody', 'addCardBtn', 'addCardArea',
    'authorizationsBody',
    'addHomeScreenCard', 'addHomeScreenSub', 'addHomeScreenBody',
    'newPassword', 'confirmPassword', 'savePasswordBtn', 'passwordMsg',
    'notifyInvoiceQuote', 'notifyWorkOrder', 'notifyMessages', 'notifyMsg',
    'pushToggleBtn', 'pushMsg',
    'biometricToggleBtn', 'biometricMsg',
    'mfaToggleBtn', 'mfaEnrollArea', 'mfaQrImg', 'mfaCodeInput', 'mfaEnrollCancelBtn', 'mfaEnrollVerifyBtn', 'mfaMsg',
    'referralLinkBody', 'updateAppBtn', 'updateAppMsg', 'signOutBtnSettings',
  ]) {
    assert.equal((HTML.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `expected exactly one id="${id}"`);
  }
});

test('CSS: hidden sections really hide, the phone shows menu OR section, desktop shows both', () => {
  assert.match(HTML, /\.settings-pane\[hidden\] \{ display: none !important; \}/);
  const phone = between(HTML, '@media not all and (min-width: 1024px) {', '}\n  /* Desktop');
  assert.match(phone, /body\[data-settings-view="pane"\] \.settings-index \{ display: none; \}/);
  assert.match(phone, /body\[data-settings-view="index"\] \.settings-panes \{ display: none; \}/);
  assert.match(HTML, /\.settings-shell \{\s*display: grid; grid-template-columns: 300px minmax\(0, 1fr\);/);
});

test('the HTML is well-formed -- opening and closing divs balance exactly', () => {
  const opens = (HTML.match(/<div\b/g) || []).length;
  const closes = (HTML.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, `expected balanced divs, got ${opens} opening vs ${closes} closing`);
});

// ---- behaviour: phone ----

test('phone: with no section in the URL, the menu is the page and every section is hidden', () => {
  const w = settingsPage();
  assert.equal(w.document.body.dataset.settingsView, 'index');
  assert.deepEqual(visiblePanes(w), []);
});

test('phone: tapping a row opens just that section, as a real history entry, and focuses its title', () => {
  const w = settingsPage();
  const before = w.history.length;
  w.document.querySelector('.settings-link[data-section="payment"]').click();
  assert.equal(w.location.hash, '#payment');
  assert.equal(w.history.length, before + 1, 'Back should close the section');
  assert.equal(w.document.body.dataset.settingsView, 'pane');
  assert.deepEqual(visiblePanes(w), ['payment']);
  assert.equal(w.document.activeElement.id, 'pane-payment-title');
});

test('phone: the back link returns to the menu and puts focus back on the row that was open', async () => {
  const w = settingsPage();
  w.document.querySelector('.settings-link[data-section="security"]').click();
  w.openSettingsSection(null);
  await tick();
  assert.equal(w.location.hash, '');
  assert.equal(w.document.body.dataset.settingsView, 'index');
  assert.deepEqual(visiblePanes(w), []);
  assert.equal(w.document.activeElement.dataset.section, 'security');
});

test('phone: a deep link opens that section directly, and its back link just clears the hash', () => {
  const w = settingsPage({ hash: '#notifications' });
  assert.deepEqual(visiblePanes(w), ['notifications']);
  w.openSettingsSection(null);
  assert.equal(w.location.hash, '');
  assert.equal(w.document.body.dataset.settingsView, 'index');
});

test('an unknown hash is ignored rather than showing an empty page', () => {
  const w = settingsPage({ hash: '#not-a-section' });
  assert.equal(w.document.body.dataset.settingsView, 'index');
  assert.deepEqual(visiblePanes(w), []);
});

// ---- behaviour: desktop ----

test('desktop: opens on Profile, marked as the current row', () => {
  const w = settingsPage({ desktop: true });
  assert.deepEqual(visiblePanes(w), ['profile']);
  const current = w.document.querySelectorAll('.settings-link.is-current');
  assert.equal(current.length, 1);
  assert.equal(current[0].dataset.section, 'profile');
  assert.equal(current[0].getAttribute('aria-current'), 'true');
});

test('desktop: switching sections is a tab switch -- it replaces the history entry instead of stacking one', () => {
  const w = settingsPage({ desktop: true });
  const before = w.history.length;
  w.document.querySelector('.settings-link[data-section="app"]').click();
  assert.equal(w.history.length, before);
  assert.equal(w.location.hash, '#app');
  assert.deepEqual(visiblePanes(w), ['app']);
  assert.equal(w.document.querySelector('.settings-link[data-section="profile"]').getAttribute('aria-current'), null);
});

// ---- live status lines ----

test('the status lines say what a client would open the section to check', () => {
  const w = settingsPage();
  const t = w.__t;
  const text = (key) => w.document.getElementById('summary-' + key).textContent;

  t.settingsStatus.emailsOn = 3; t.renderNotificationsSummary();
  assert.equal(text('notifications'), 'All emails on');
  t.settingsStatus.emailsOn = 1; t.settingsStatus.pushOn = true; t.renderNotificationsSummary();
  assert.equal(text('notifications'), '1 of 3 emails on · push on');
  t.settingsStatus.emailsOn = 0; t.settingsStatus.pushOn = false; t.renderNotificationsSummary();
  assert.equal(text('notifications'), 'Emails off');

  t.settingsStatus.mfaOn = false; t.renderSecuritySummary();
  assert.equal(text('security'), 'Password only');
  t.settingsStatus.mfaOn = true; t.settingsStatus.biometricOn = true; t.renderSecuritySummary();
  assert.equal(text('security'), 'Two-factor on · Face ID on');
  assert.ok(w.document.getElementById('summary-security').classList.contains('is-good'));
});

test('a status line keeps its plain description until the real state is known', () => {
  const w = settingsPage();
  const fallback = w.document.getElementById('summary-security').textContent;
  w.__t.renderSecuritySummary(); // mfaOn still null -- listFactors hasn't answered
  assert.equal(w.document.getElementById('summary-security').textContent, fallback);
  w.__t.setSettingsSummary('payment', '');
  assert.equal(w.document.getElementById('summary-payment').textContent, 'Saved cards & authorizations');
});

test('Payment names the card a charge would use, and flags one that has expired', () => {
  const w = settingsPage();
  const el = w.document.getElementById('summary-payment');
  w.__t.renderPaymentSummary([]);
  assert.equal(el.textContent, 'No card saved');
  w.__t.renderPaymentSummary([
    { brand: 'mastercard', last4: '1111', exp_month: 1, exp_year: 2099, is_active: false },
    { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2099, is_active: true },
  ]);
  assert.equal(el.textContent, '2 cards · Visa ending 4242');
  assert.ok(!el.classList.contains('is-warning'));
  w.__t.renderPaymentSummary([{ brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2001, is_active: true }]);
  assert.equal(el.textContent, 'Visa ending 4242 · expired');
  assert.ok(el.classList.contains('is-warning'));
});

test('the profile row shows initials and the name, falling back to the email -- never a blank avatar', () => {
  const w = settingsPage();
  const { settingsInitials, renderSettingsProfile } = w.__t;
  assert.equal(settingsInitials('Jane Q. Client', 'x@y.com'), 'JC');
  assert.equal(settingsInitials('Cher', 'x@y.com'), 'C');
  assert.equal(settingsInitials('', 'bob@example.com'), 'B');
  renderSettingsProfile('', 'bob@example.com');
  assert.equal(w.document.getElementById('settingsAvatar').textContent, 'B');
  assert.equal(w.document.getElementById('settingsProfileName').textContent, 'Your profile');
  assert.equal(w.document.getElementById('summary-profile').textContent, 'bob@example.com');
});

test('each status line is fed from the load that already knows the answer', () => {
  assert.match(extractFn(HTML, 'loadNotificationPreferences'), /settingsStatus\.emailsOn = countNotificationEmailsOn\(\);\s*renderNotificationsSummary\(\);/);
  assert.match(extractFn(HTML, 'saveNotificationPreference'), /renderNotificationsSummary\(\);/);
  assert.match(extractFn(HTML, 'renderPushToggle'), /settingsStatus\.pushOn = !!enabled;/);
  assert.match(extractFn(HTML, 'renderMfaToggle'), /settingsStatus\.mfaOn = !!verified;/);
  assert.match(extractFn(HTML, 'renderBiometricToggle'), /settingsStatus\.biometricOn = !!enabled;/);
  assert.match(extractFn(HTML, 'renderSavedCards'), /renderPaymentSummary\(cards\);/);
  assert.match(extractFn(HTML, 'saveClientProfile'), /renderSettingsProfile\(name, session\.user\.email\);/);
  assert.match(HTML, /if \(result\.usage_count > 0\) setSettingsSummary\('referral'/);
  assert.match(extractFn(HTML, 'init'), /renderSettingsProfile\(name, email\);/);
});

test('the push toggle no longer points "above" -- Add to Home Screen lives in the App section now', () => {
  const fn = extractFn(HTML, 'renderPushToggle');
  assert.doesNotMatch(fn, /see above/);
  assert.match(fn, /Add to Home Screen first \(Settings \\u203a App\)/);
});
