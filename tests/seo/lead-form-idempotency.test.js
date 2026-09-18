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
// with every insert and enforced by a real Postgres unique index --
// not a hash of the lead's own fields, since a real customer
// submitting two DIFFERENT leads with the same phone/email on the
// same day must never be blocked.
//
// Follow-up (2026-09-18, sql/leads/fix_th_leads_conflict_index.sql):
// the index above was originally created PARTIAL (only rows with a
// non-null client_request_id), on the mistaken assumption that was
// needed to leave historical null-id rows alone -- a plain unique
// index already allows any number of nulls. The partial predicate
// broke Postgres's ON CONFLICT (client_request_id) matching outright
// (42P10, no matching index), so every single insert through this
// path silently failed and rolled back -- th_leads had zero rows,
// ever, confirmed directly against the live project. The index is now
// non-partial, and index.html no longer uses on_conflict at all (see
// below) since ON CONFLICT itself requires SELECT access under RLS
// that anon deliberately does not have on this table.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'leads', 'add_th_leads_request_idempotency.sql'), 'utf8');
const CONFLICT_FIX_SQL = fs.readFileSync(repo('sql', 'leads', 'fix_th_leads_conflict_index.sql'), 'utf8');

// ---- SQL migration ----

test('th_leads gets a client_request_id column', () => {
  assert.match(SQL, /alter table th_leads add column if not exists client_request_id uuid;/);
});

test('the unique index is non-partial, so ON CONFLICT (client_request_id) can match it -- a plain unique index already permits any number of null rows on its own', () => {
  assert.match(CONFLICT_FIX_SQL, /drop index if exists th_leads_client_request_id_key;/);
  assert.match(CONFLICT_FIX_SQL, /create unique index if not exists th_leads_client_request_id_key\s*\n\s*on th_leads \(client_request_id\);/);
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

test('the th_leads insert is a plain POST -- no on_conflict, no Prefer: resolution=ignore-duplicates -- since ON CONFLICT requires SELECT access anon does not have', () => {
  const fnMatch = INDEX.match(/fetch\(LEADS_SUPABASE_URL \+ '\/rest\/v1\/th_leads', \{[\s\S]*?\n\s*\}\);/);
  assert.ok(fnMatch, 'expected to isolate the th_leads insert call');
  assert.doesNotMatch(fnMatch[0], /on_conflict/);
  assert.doesNotMatch(fnMatch[0], /resolution=ignore-duplicates/);
  assert.match(fnMatch[0], /client_request_id: getLeadRequestId\(\),/);
});

test('a duplicate submission (HTTP 409, the unique index rejecting a repeat client_request_id) still shows the same success message to the visitor', () => {
  const thenMatch = INDEX.match(/\.then\(\(response\) => \{[\s\S]*?\n\s*\}\)/);
  assert.ok(thenMatch);
  assert.match(thenMatch[0], /if \(response\.ok \|\| response\.status === 409\) \{/);
});
