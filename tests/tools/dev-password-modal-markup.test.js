// Regression test for a real bug (2026-09-02): dev-tools.html called
// confirmDevPassword() from many places (Account permissions toggles,
// Add account, the Push and Booking notification test buttons) via
// dev-tools-shared.js, but never had the #devPasswordOverlay /
// #devPasswordInput modal markup that function's own
// showDevPasswordPrompt() needs -- only site-content.html did.
//
// Confirmed via a real stack trace pulled directly from the live
// Client Errors log:
//   TypeError: Cannot set properties of null (setting 'value')
//     at showDevPasswordPrompt (dev-tools-shared.js:174:19)
//     at confirmDevPassword (dev-tools-shared.js:194:27)
//     at runPushNotificationTest / runBookingNotificationTest
//
// Why it stayed hidden: confirmDevPassword() has a
// sessionStorage-cached "already confirmed" fast path
// (`th_dev_password_confirmed`) that skips the modal entirely once
// used once in a browser session. So it only threw the FIRST time a
// genuinely fresh session needed to show the prompt -- which is
// exactly why earlier actions in the same reported session (e.g.
// toggling a permission checkbox) worked fine while these two test
// buttons, tried later, failed: whichever call happened to need the
// real modal first was the one that broke.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');

function toolPages() {
  return fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
}

test('every page that calls confirmDevPassword() has the modal markup it depends on', () => {
  const offenders = [];
  for (const file of toolPages()) {
    const html = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
    if (!/confirmDevPassword\s*\(/.test(html)) continue;
    if (!/id="devPasswordOverlay"/.test(html) || !/id="devPasswordInput"/.test(html)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [],
    'these pages call confirmDevPassword() but are missing the #devPasswordOverlay/#devPasswordInput markup it needs, ' +
    'which throws "Cannot set properties of null" the first time a session genuinely needs to show the prompt: ' + offenders.join(', '));
});

test('dev-tools.html specifically has the modal -- the exact page missing it when this bug was found', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'dev-tools.html'), 'utf8');
  assert.match(html, /id="devPasswordOverlay"/);
  assert.match(html, /id="devPasswordInput"/);
  assert.match(html, /function devPasswordSubmit\(\)|onclick="devPasswordSubmit\(\)"/);
  assert.match(html, /onclick="devPasswordCancel\(\)"/);
});
