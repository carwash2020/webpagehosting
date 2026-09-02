// Tests for retryRoleCheck() (2026-09-02), added after a real report
// where the actual cause of a blocked screen turned out to be a
// transient network failure ("Failed to fetch" on all 3 attempts
// inside loadCurrentUserRole(), confirmed via the new diagnostic
// logging) -- not a real permission problem at all. Previously the
// ONLY way to recover from the blocked screen was a full manual page
// reload, with zero feedback about whether trying again would help.
//
// reloadFn is retryRoleCheck()'s third, optional parameter --
// injected directly here as a plain function, rather than trying to
// intercept a real window.location.reload() call (jsdom's Location
// object doesn't allow that reliably). Every real call site in the
// gated pages omits it, so production always gets the genuine reload.
//
// loadCurrentUserRole() itself is NOT mocked here -- auth.js declares
// it (and every other function under test) with the `function`
// keyword, and a hoisted declaration in the same evaluated script
// body wins over an earlier plain assignment to a same-named window
// property (confirmed the hard way building
// tests/sync/role-check-retry.test.js). With no session seeded, the
// real loadCurrentUserRole() harmlessly resolves via its own "no
// email found" path -- fine here, since retryRoleCheck()'s reload
// decision depends only on checkFn's return value, which every test
// below supplies directly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const AUTH_JS_PATH = path.join(__dirname, '..', '..', 'tools', 'auth.js');
const AUTH_JS_SRC = fs.readFileSync(AUTH_JS_PATH, 'utf8');

function loadRetryHelper() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;
  const fn = new Function('window', 'document', 'localStorage', 'sessionStorage', 'fetch',
    AUTH_JS_SRC + '\nreturn { retryRoleCheck };');
  const api = fn(window, window.document, window.localStorage, window.sessionStorage, () => {});
  return { retryRoleCheck: api.retryRoleCheck, document: window.document };
}

function makeButton(doc, text) {
  const wrapper = doc.createElement('div');
  const button = doc.createElement('button');
  button.textContent = text;
  wrapper.appendChild(button);
  doc.body.appendChild(wrapper);
  return button;
}

test('retryRoleCheck() reloads once the permission check actually passes', async () => {
  let reloaded = false;
  const { retryRoleCheck, document } = loadRetryHelper();
  const button = makeButton(document, 'Try again');

  await retryRoleCheck(button, () => true, () => { reloaded = true; });

  assert.equal(reloaded, true, 'should reload once the check passes');
});

test('retryRoleCheck() never reloads and shows a specific message when the check still fails', async () => {
  let reloaded = false;
  const { retryRoleCheck, document } = loadRetryHelper();
  const button = makeButton(document, 'Try again');

  await retryRoleCheck(button, () => false, () => { reloaded = true; });

  assert.equal(reloaded, false, 'should never reload when the check still fails');
  assert.equal(button.disabled, false, 'button should be usable again, not stuck on "Checking..."');
  assert.equal(button.textContent, 'Try again', 'button text should be restored');
  const note = button.parentElement.querySelector('.role-blocked-retry-note');
  assert.ok(note, 'expected a note explaining the retry still failed');
  assert.match(note.textContent, /check your internet connection/i);
});

test('retryRoleCheck() disables the button and shows a checking state while in flight', async () => {
  const { retryRoleCheck, document } = loadRetryHelper();
  const button = makeButton(document, 'Try again');

  // checkFn itself is the hook used to observe mid-flight state --
  // by the time it's called, loadCurrentUserRole() has already
  // resolved and the button should already be showing "Checking...".
  let capturedDuringCheck = null;
  const checkFn = () => {
    capturedDuringCheck = { disabled: button.disabled, text: button.textContent };
    return true;
  };

  await retryRoleCheck(button, checkFn, () => {});

  assert.ok(capturedDuringCheck, 'checkFn should have been called');
  assert.equal(capturedDuringCheck.disabled, true, 'button should be disabled while checking');
  assert.equal(capturedDuringCheck.text, 'Checking...', 'button should show a checking state, not silently do nothing');
});

test('a previous failure note is cleared on a fresh retry attempt, never stacking', async () => {
  const { retryRoleCheck, document } = loadRetryHelper();
  const button = makeButton(document, 'Try again');

  await retryRoleCheck(button, () => false, () => {});
  assert.ok(button.parentElement.querySelector('.role-blocked-retry-note'), 'expected the first failure note');

  await retryRoleCheck(button, () => false, () => {});
  const notes = button.parentElement.querySelectorAll('.role-blocked-retry-note');
  assert.equal(notes.length, 1, 'should not stack multiple notes across repeated retries');
});

test('every real call site omits reloadFn, so production always gets a genuine reload', () => {
  const cases = [
    { file: 'review-request.html', checkFn: 'canManageReviews' },
    { file: 'contract-generator.html', checkFn: 'canManageContracts' },
    { file: 'finance.html', checkFn: 'canViewFinance' },
    { file: 'invoice-generator.html', checkFn: 'canManageInvoices' },
    { file: 'runway-dashboard.html', checkFn: 'canViewRunway' },
  ];
  for (const c of cases) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', c.file), 'utf8');
    assert.match(
      src,
      new RegExp(`onclick="retryRoleCheck\\(this, ${c.checkFn}\\)"`),
      `${c.file} should wire its Try again button to ${c.checkFn}, with no third argument`
    );
  }
});
