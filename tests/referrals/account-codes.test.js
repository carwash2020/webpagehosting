// Tests for client account codes (direct request, 2026-09-20):
// "unique IDs connected to accounts" for the referral promo, created
// automatically the moment a portal account is genuinely created --
// see sql/infra/create_client_account_codes.sql for the schema and
// edge-functions/send-invite-index.ts / resolve-referral-code-index.ts
// for the generate/resolve logic. Same value doubles as a general
// per-account tracking ID, not just a referral code.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const SCHEMA = fs.readFileSync(repo('sql', 'infra', 'create_client_account_codes.sql'), 'utf8');
const RLS_MERGE = fs.readFileSync(repo('sql', 'infra', 'merge_client_account_codes_select_policies.sql'), 'utf8');
const SEND_INVITE = fs.readFileSync(repo('edge-functions', 'send-invite-index.ts'), 'utf8');
const RESOLVE = fs.readFileSync(repo('edge-functions', 'resolve-referral-code-index.ts'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const CLIENT_DETAIL = fs.readFileSync(repo('tools', 'client-detail.html'), 'utf8');
const PORTAL_SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

test('client_account_codes is keyed by email (not a local client_id), so a code survives a future portal signup', () => {
  assert.match(SCHEMA, /create table if not exists public\.client_account_codes/);
  assert.match(SCHEMA, /email text not null unique/);
  assert.match(SCHEMA, /code text not null unique/);
});

test('internal accounts can manage every code; a portal client can only SELECT their own row; there is no anon policy at all', () => {
  // The original two policies (one FOR ALL for staff, one FOR SELECT
  // for a client's own row) both matched role=authenticated,
  // action=SELECT -- a real "multiple_permissive_policies" perf
  // finding from Supabase's own advisor, fixed by
  // merge_client_account_codes_select_policies.sql, which drops both
  // and replaces them with a single merged SELECT policy plus three
  // single-action write policies for staff.
  assert.match(SCHEMA, /internal accounts can manage client account codes/);
  assert.match(SCHEMA, /portal clients can view their own account code/);
  assert.match(RLS_MERGE, /drop policy if exists "internal accounts can manage client account codes"/);
  assert.match(RLS_MERGE, /drop policy if exists "portal clients can view their own account code"/);
  assert.match(RLS_MERGE, /for select[\s\S]*?using \(\s*exists \(select 1 from public\.account_roles where account_roles\.email = \(select auth\.email\(\)\)\)\s*or email = \(select auth\.email\(\)\)\s*\)/);
  for (const action of ['insert', 'update', 'delete']) {
    assert.match(RLS_MERGE, new RegExp('for ' + action + '\\s*\\n\\s*to authenticated'));
  }
  // Deliberately no "to anon" policy anywhere in either file -- public
  // resolution goes through resolve-referral-code instead.
  assert.doesNotMatch(SCHEMA, /to anon/);
  assert.doesNotMatch(RLS_MERGE, /to anon/);
});

test('referred_by_code is added alongside the existing referred_by free-text column on both capture tables', () => {
  assert.match(SCHEMA, /alter table public\.th_leads add column if not exists referred_by_code text/);
  assert.match(SCHEMA, /alter table public\.th_bookings add column if not exists referred_by_code text/);
});

test('send-invite generates an account code only on a genuine first invite, never on a resend', () => {
  assert.match(SEND_INVITE, /if \(!isResend\) await ensureAccountCode\(targetEmail, displayName\)/);
});

test("ensureAccountCode is idempotent -- it checks for an existing row before ever inserting one", () => {
  const fnBody = SEND_INVITE.slice(SEND_INVITE.indexOf('async function ensureAccountCode'));
  assert.match(fnBody, /existingRes\.ok && \(await existingRes\.json\(\)\)\.length > 0\) return/);
});

test('the account code alphabet excludes 0/O/1/I/L to avoid misread codes', () => {
  const match = SEND_INVITE.match(/ACCOUNT_CODE_CHARS = "([^"]+)"/);
  assert.ok(match, 'ACCOUNT_CODE_CHARS not found');
  for (const bad of ['0', 'O', '1', 'I', 'L']) {
    assert.ok(!match[1].includes(bad), bad + ' should be excluded from the account code alphabet');
  }
});

test('resolve-referral-code returns only a display name, never email/phone/id, and rejects a non-code param before querying', () => {
  assert.match(RESOLVE, /select=display_name/);
  assert.doesNotMatch(RESOLVE, /select=.*email/);
  assert.match(RESOLVE, /\/\^\[A-Z2-9\]\{4,12\}\$\//);
});

test('resolve-referral-code has no anon-blocking role check -- an anonymous booking visitor must be able to call it', () => {
  assert.doesNotMatch(RESOLVE, /role !== "authenticated"/);
});

test('booking.html resolves ?ref= as a code first, falling back to the raw param as a literal name if it does not resolve', () => {
  assert.match(BOOKING, /functions\/v1\/resolve-referral-code\?code=/);
  assert.match(BOOKING, /referredByField\.value = refParam\.slice\(0, 200\)/);
  assert.match(BOOKING, /referred_by_code: referredByCode/);
});

test("booking.html's referral prefill never overwrites a value the visitor already typed, even after the resolve fetch resolves later", () => {
  const fnBody = BOOKING.slice(BOOKING.indexOf('(function prefillReferredBy'), BOOKING.indexOf('(function prefillReferredBy') + 1600);
  assert.match(fnBody, /if \(referredByField\.value\) return; \/\/ someone already typed/);
});

test("index.html's homepage form mirrors booking.html's referral code resolution and payload field", () => {
  assert.match(INDEX, /functions\/v1\/resolve-referral-code\?code=/);
  assert.match(INDEX, /referred_by_code: window\.referredByCode \|\| null/);
});

test('client-detail.html lets staff generate a referral link for a client with an email on file, and refuses to when there is none', () => {
  assert.match(CLIENT_DETAIL, /function loadReferralLink/);
  assert.match(CLIENT_DETAIL, /Add an email address for this client to generate a referral link/);
  assert.match(CLIENT_DETAIL, /booking\.html\?ref=/);
});

test('client-detail.html escapes the client email/name for the inline onclick handler instead of using JSON.stringify (a real XSS gap flagged by check-consistency.js)', () => {
  assert.doesNotMatch(CLIENT_DETAIL, /onclick="createReferralLink\(' \+ JSON\.stringify/);
  assert.match(CLIENT_DETAIL, /escapeForInlineHandler\(client\.email\)/);
  assert.match(CLIENT_DETAIL, /escapeForInlineHandler\(client\.name\)/);
});

test('client-detail.html retries a code generation attempt on a collision, matching ensureAccountCode\'s own retry in send-invite', () => {
  assert.match(CLIENT_DETAIL, /for \(let attempt = 0; attempt < 5; attempt\+\+\)/);
});

test('client-detail.html computes and shows a usage count, and a "Text to [client]" SMS link when a phone is on file (2026-09-21 refinement)', () => {
  assert.match(CLIENT_DETAIL, /Prefer: 'count=exact'/);
  assert.match(CLIENT_DETAIL, /Used to book ' \+ usageCount/);
  const smsBlock = CLIENT_DETAIL.slice(CLIENT_DETAIL.indexOf('function renderReferralLinkBlock'));
  assert.match(smsBlock, /const smsTarget = client\.phone/);
  assert.match(smsBlock, /'<a href="sms:' \+ escapeAttr\(smsTarget\)/);
});

test('client-detail.html threads the client phone through createReferralLink so the SMS link renders right after a fresh code is created, not only on next page load', () => {
  assert.match(CLIENT_DETAIL, /async function createReferralLink\(email, name, phone\)/);
  assert.match(CLIENT_DETAIL, /renderReferralLinkBlock\(\{ email: email, name: name, phone: phone \}, code, 0\)/);
  assert.match(CLIENT_DETAIL, /loadReferralLink\(\{ email: email, name: name, phone: phone \}\)/);
});

test('portal settings.html shows a referral link panel, self-serve via ensure-my-referral-code (2026-09-21 refinement) rather than only displaying a pre-existing row', () => {
  assert.match(PORTAL_SETTINGS, /Refer a friend/i);
  assert.match(PORTAL_SETTINGS, /functions\/v1\/ensure-my-referral-code/);
  assert.match(PORTAL_SETTINGS, /Authorization': 'Bearer ' \+ session\.access_token/);
});

test('portal settings.html falls back to a phone-us message if the edge function call fails, rather than showing a broken/empty panel', () => {
  const fnBody = PORTAL_SETTINGS.slice(PORTAL_SETTINGS.indexOf('async function loadReferralLink'));
  const catchBlock = fnBody.slice(fnBody.indexOf('} catch'), fnBody.indexOf('} catch') + 400);
  assert.match(catchBlock, /Could not load your referral link right now/);
  assert.match(catchBlock, /tel:\+14354141667/);
});

test('portal settings.html shows a usage count and share options (copy + SMS) once a code is loaded', () => {
  const fnBody = PORTAL_SETTINGS.slice(PORTAL_SETTINGS.indexOf('async function loadReferralLink'));
  const tryBlock = fnBody.slice(0, fnBody.indexOf('} catch'));
  assert.match(tryBlock, /usage_count/);
  assert.match(tryBlock, /Copy Link/);
  assert.match(tryBlock, /sms:\?body=/);
});
