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
  // The "Forgot password" guidance itself now lives in send-invite's
  // own response message (so every caller gets it, not just this UI),
  // and the frontend renders that message -- asserted directly in the
  // edge-function tests further down this file.
  assert.match(body, /escapeHtml\(result\.error/,
    'should render the explanatory message the server returns');
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

// ---- internal accounts are not portal clients (2026-09-02) ----
//
// Requested directly after a real confusing outcome: an invite sent to
// connor@ appeared to do nothing. Cause: that address already had an
// account -- an INTERNAL one -- and send-invite's already-registered
// branch quietly returned ok:true with no message, which the UI showed
// as a soft note that read like nothing had happened. Nothing had.

const SEND_INVITE = fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'send-invite-index.ts'), 'utf8');

test('send-invite refuses an internal tool account outright, server-side', () => {
  // Enforced in the edge function, NOT only in the Dev Tools UI, so
  // the rule holds for every caller -- including
  // sync-invoice-to-portal and the quote/job sync functions, which
  // fire send-invite automatically for any new client email.
  assert.match(SEND_INVITE, /account_roles\?email=eq\.\$\{encodeURIComponent\(targetEmail\)\}/);
  assert.match(SEND_INVITE, /is_internal_account: true/);
  assert.match(SEND_INVITE, /is an internal tool account, not a client/);
  // 409 Conflict, not 200 -- this is a refusal, not a soft success.
  const guardMatch = SEND_INVITE.match(/if \(internalRows\.length\) \{[\s\S]*?\}, 409\);/);
  assert.ok(guardMatch, 'the internal-account guard should return 409');
});

test('the internal-account check runs BEFORE the invite link is generated', () => {
  // Order matters: generateLink() creates the auth user as a side
  // effect, so checking afterward would already have done the thing
  // we are trying to prevent.
  const internalIdx = SEND_INVITE.indexOf('is_internal_account');
  // Matches the real CALL, not the mention of generateLink() in this
  // file's own header comment -- a bare indexOf('admin.generateLink')
  // finds that comment on line 11 and makes this test meaningless.
  const generateIdx = SEND_INVITE.indexOf('await adminClient.auth.admin.generateLink');
  assert.ok(internalIdx !== -1, 'expected the internal-account guard');
  assert.ok(generateIdx !== -1, 'expected the real generateLink call');
  assert.ok(internalIdx < generateIdx,
    'the internal-account guard must run before generateLink creates a user');
});

test('an existing portal account now returns an explanatory message, not a bare success', () => {
  const branchMatch = SEND_INVITE.match(/already_has_account: true,[\s\S]*?\}\);/);
  assert.ok(branchMatch, 'expected the already_has_account branch');
  assert.match(branchMatch[0], /no new invite was sent/);
  assert.match(branchMatch[0], /Forgot password/,
    'should point at the actual remedy rather than leaving them waiting');
});

test('already_has_account stays ok:true so automatic callers are not broken', () => {
  // sync-invoice-to-portal fires send-invite for any client email it
  // has not seen; re-invoicing an existing client is completely
  // normal and must not surface as a failure there.
  const branchMatch = SEND_INVITE.match(/if \(linkError\.message\?\.includes\("already been registered"\)[\s\S]*?\}\n/);
  assert.ok(branchMatch);
  assert.match(branchMatch[0], /ok: true/);
});

test('Dev Tools shows internal-account and already-a-client as warnings, not as sent', () => {
  const fnMatch = DEV_TOOLS.match(/async function sendInviteToAnyEmail\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  const body = fnMatch[0];
  assert.match(body, /result\.is_internal_account/);
  // Both non-send outcomes must use the warning style -- the original
  // bug was that "already has an account" looked like a success.
  const internalBranch = body.match(/if \(result\.is_internal_account\) \{[\s\S]*?\} else if/);
  assert.match(internalBranch[0], /is-warning/);
  const existingBranch = body.match(/else if \(result\.already_has_account\) \{[\s\S]*?\} else if/);
  assert.match(existingBranch[0], /is-warning/);
});

test('an internal account appearing in the portal client list is flagged, not hidden', () => {
  // Flagged rather than filtered: a staff address with real client
  // invoices on file is legitimate but unusual, and hiding it would
  // make the list silently disagree with the actual data.
  assert.match(DEV_TOOLS, /INTERNAL ACCOUNT/);
  assert.match(DEV_TOOLS, /async function loadInternalEmails\(\)/);
});
