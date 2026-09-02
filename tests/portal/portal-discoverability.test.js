// Tests for portal discoverability and the send-to-any-email invite
// control (2026-09-02), both requested directly: "add a section to
// the other links portion at the bottom of the main website so people
// can find the portal easily and sign in" and "add a Section in Dev
// tools where i can Resend the email to Create a account."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const DEV_TOOLS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools.html'), 'utf8');

test('the homepage footer has a Client Portal column linking to the portal login', () => {
  assert.match(INDEX, /<h4>Client Portal<\/h4>/);
  // Every link in that column points at the login page -- a signed-out
  // visitor clicking "View & Pay Invoices" must land somewhere that
  // works, not at a portal page that would just bounce them.
  const colMatch = INDEX.match(/<h4>Client Portal<\/h4>[\s\S]*?<\/div>/);
  assert.ok(colMatch, 'expected to isolate the Client Portal footer column');
  const col = colMatch[0];
  assert.match(col, /href="\/portal\/login\.html">Sign In</);
  const portalLinks = col.match(/href="\/portal\/[^"]*"/g) || [];
  assert.ok(portalLinks.length >= 4, 'expected at least 4 portal links in the column');
  for (const link of portalLinks) {
    assert.match(link, /\/portal\/login\.html/,
      'every footer portal link should go to login, since a signed-out visitor cannot use a deeper page');
  }
});

test('the footer column states plainly that the portal is for existing clients', () => {
  // The portal has deliberately NO public self-signup -- accounts are
  // created by an invite triggered from a real invoice, quote, or
  // completed job. Saying so in the footer avoids a first-time
  // visitor bouncing off a login wall with no explanation.
  const colMatch = INDEX.match(/<h4>Client Portal<\/h4>[\s\S]*?<\/div>/);
  assert.match(colMatch[0], /[Ee]xisting clients only/);
});

test('Dev Tools can send an account invite to any email, not only to clients already in the list', () => {
  // The Portal accounts list is built from the portal tables, so it
  // can only ever show clients who ALREADY have an invoice, quote, or
  // job. This control covers everyone else.
  assert.match(DEV_TOOLS, /id="inviteAnyEmail"/);
  assert.match(DEV_TOOLS, /onclick="sendInviteToAnyEmail\(\)"/);
  const fnMatch = DEV_TOOLS.match(/async function sendInviteToAnyEmail\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate sendInviteToAnyEmail()');
  assert.match(fnMatch[0], /functions\/v1\/send-invite/);
});

test('sending an invite requires the dev password, like every other real action in Dev Tools', () => {
  const fnMatch = DEV_TOOLS.match(/async function sendInviteToAnyEmail\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /await confirmDevPassword\(\)/);
});

test('an already-registered email is reported as such, not as a sent invite', () => {
  // send-invite returns already_has_account:true for an existing
  // account -- a success, but no email was sent. Reporting that as
  // "Sent!" would leave a client waiting on an email that never
  // arrives when what they need is a password reset.
  const fnMatch = DEV_TOOLS.match(/async function sendInviteToAnyEmail\(\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /result\.already_has_account/);
  assert.match(body, /Forgot password/,
    'should point at the actual remedy for a client who already has an account');
});

test('a bad email is rejected before the dev password prompt, not after', () => {
  // Asking for a password and THEN rejecting the input would be a
  // pointless extra step.
  const fnMatch = DEV_TOOLS.match(/async function sendInviteToAnyEmail\(\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  const validationIdx = body.indexOf("includes('@')");
  const passwordIdx = body.indexOf('confirmDevPassword');
  assert.ok(validationIdx !== -1 && passwordIdx !== -1);
  assert.ok(validationIdx < passwordIdx,
    'email validation should come before the dev password prompt');
});
