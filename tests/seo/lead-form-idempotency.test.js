// Tests for adding a real Postgres-level idempotency guard to the
// contact-form lead insert (audit item #14). th_leads had no
// server-side uniqueness constraint at all against a duplicate
// submission: a slow/flaky connection retrying the same POST, or a
// visitor reloading the page and resubmitting before realizing their
// first attempt actually worked, both produced a second th_leads row
// -- and worse than a cosmetic duplicate, a database trigger fires an
// Edge Function that emails Steve and Connor on every single insert,
// so a duplicate submission meant a second, redundant "new lead"
// email and double follow-up work.
//
// The fix is a client-generated idempotency key (client_request_id),
// persisted in sessionStorage so it survives a same-tab reload, sent
// with every insert and enforced by a real Postgres partial unique
// index -- not a hash of the lead's own fields, since a real customer
// submitting two DIFFERENT leads with the same phone/email on the
// same day must never be blocked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'leads', 'add_th_leads_request_idempotency.sql'), 'utf8');

// ---- SQL migration ----

test('th_leads gets a client_request_id column', () => {
  assert.match(SQL, /alter table th_leads add column if not exists client_request_id uuid;/);
});

test('the unique index is partial (only rows that actually provide the id), so every historical lead row is unaffected', () => {
  assert.match(SQL, /create unique index if not exists th_leads_client_request_id_key\s*\n\s*on th_leads \(client_request_id\)\s*\n\s*where client_request_id is not null;/);
});

// ---- index.html: the idempotency key itself ----

test('getLeadRequestId() persists the id in sessionStorage, not an in-memory variable, so it survives a same-tab reload', () => {
  const fnMatch = INDEX.match(/function getLeadRequestId\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected to isolate getLeadRequestId()');
  assert.match(fnMatch[0], /sessionStorage\.getItem\(LEAD_REQUEST_ID_KEY\)/);
  assert.match(fnMatch[0], /sessionStorage\.setItem\(LEAD_REQUEST_ID_KEY, id\);/);
});

test('a fresh id is only generated when none exists yet, not on every call', () => {
  const fnMatch = INDEX.match(/function getLeadRequestId\(\) \{[\s\S]*?\n  \}/);
  assert.match(fnMatch[0], /if \(!id\) \{/);
});

test('the id is cleared after a successful submission, so a genuinely new lead later in the same tab session gets its own id', () => {
  const idx = INDEX.indexOf("status.textContent = \"Request sent! We'll follow up by phone or email shortly.\";");
  const resetIdx = INDEX.indexOf('form.reset();', idx);
  const clearIdx = INDEX.indexOf('sessionStorage.removeItem(LEAD_REQUEST_ID_KEY);', idx);
  assert.ok(idx !== -1 && resetIdx !== -1 && clearIdx !== -1);
  assert.ok(resetIdx < clearIdx, 'the id should be cleared only after the success path resets the form');
});

test('the id is NOT cleared on a failed submission, so a retry after a real failure reuses the same key rather than creating a fresh one', () => {
  const catchMatch = INDEX.match(/\.catch\(\(\) => \{[\s\S]*?submitBtn\.textContent = idleLabel \|\| 'Submit Request';\s*\n\s*\}\);/);
  assert.ok(catchMatch, 'expected to isolate the .catch() handler');
  assert.doesNotMatch(catchMatch[0], /sessionStorage\.removeItem/);
});

// ---- index.html: the insert itself ----

test('the th_leads insert uses on_conflict=client_request_id with ignore-duplicates, the same atomic pattern proven for the Stripe POS idempotency fix', () => {
  const fnMatch = INDEX.match(/fetch\(LEADS_SUPABASE_URL \+ '\/rest\/v1\/th_leads\?on_conflict=client_request_id', \{[\s\S]*?\n\s*\}\);/);
  assert.ok(fnMatch, 'expected to isolate the th_leads insert call');
  assert.match(fnMatch[0], /'Prefer': 'resolution=ignore-duplicates',/);
  assert.match(fnMatch[0], /client_request_id: getLeadRequestId\(\),/);
});

test('a duplicate submission still shows the same success message to the visitor, since ignore-duplicates resolves as a normal ok response', () => {
  // The .then() handler only branches on response.ok -- it has no
  // separate "this was a duplicate" case, which is the whole point:
  // PostgREST's ignore-duplicates makes a duplicate resolve as a
  // plain successful (if empty) response, not an error to handle.
  const thenMatch = INDEX.match(/\.then\(\(response\) => \{[\s\S]*?\n\s*\}\)/);
  assert.ok(thenMatch);
  assert.match(thenMatch[0], /if \(response\.ok\) \{/);
});
