// Fix plan Group 5 (2026-11-07): the public forms explain the database's new
// limits (RP3.3, RP3.4) instead of a generic error, and the Workspace bits
// that follow the new access rules (RP3.33, RP4.8). RP3.6 (Finance-only
// documents) waits for Connor's decision.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

test('RP3.3: the booking form says why when the email is wrong or too many bookings came from here', () => {
  const b = read('booking.html');
  assert.match(b, /const badEmail = body\.indexOf\('invalid-email'\) !== -1;/);
  assert.match(b, /const tooMany = res\.status === 429 \|\| body\.indexOf\('too-many'\) !== -1;/);
  assert.match(b, /That email address doesn\\'t look right/);
  assert.match(b, /several bookings from here in the last hour/);
});

test('RP3.4: the lead and careers forms turn a 429 into "call or text us", not "something went wrong"', () => {
  for (const [file, word] of [['index.html', 'requests'], ['careers.html', 'applications']]) {
    const s = read(file);
    assert.match(s, /throw new Error\(response\.status === 429 \? 'rate-limited' : /, file);
    assert.match(s, /if \(err && err\.message === 'rate-limited'\) \{/, file);
    assert.match(s, new RegExp("We've had several " + word + ' from here in the last hour'), file);
  }
});

test('RP3.33 (D30): the Clients page asks which portal emails are staff instead of reading every staff email', () => {
  const c = read('tools', 'clients.html');
  assert.match(c, /\/rest\/v1\/rpc\/internal_emails_among/);
  assert.match(c, /await loadInternalEmails\(accounts\.map\(a => a\.email\)\)/);
  assert.doesNotMatch(c, /account_roles\?select=email'/);
});

test('RP4.8: closing a work request offers an optional note for the client', () => {
  const ws = read('tools', 'workspace.html');
  const fn = ws.slice(ws.indexOf('  async function advanceWorkRequest(id, newStatus) {'), ws.indexOf('  async function loadAndRenderApplicants() {'));
  assert.match(fn, /showPromptForm\('Close this request'/);
  assert.match(fn, /Note for the client \(optional\)/);
  assert.match(fn, /if \(!values\) return;/, 'cancelling the prompt leaves the request open');
});
