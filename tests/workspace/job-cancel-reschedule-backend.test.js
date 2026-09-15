// Backend (SQL + edge function) tests for job cancel/reschedule links
// (2026-09-11), direct follow-up: "do the reschedule/cancel link."
// Frontend (manage-job.html) behavior is covered separately in
// tests/booking/manage-job.test.js -- these are static-source checks
// on the SQL migration and the two edge functions, matching the style
// already used for the reminder/confirmation-email guard columns
// (no local Postgres to run these functions against directly).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const MIGRATION = fs.readFileSync(repo('sql', 'infra', 'add_job_cancel_reschedule.sql'), 'utf8');
const HARDEN_MIGRATION = fs.readFileSync(repo('sql', 'infra', 'harden_job_cancel_reschedule.sql'), 'utf8');
const CONFIRMATION_FN = fs.readFileSync(repo('edge-functions', 'send-job-confirmation-email-index.ts'), 'utf8');
const STATUS_CHANGE_FN = fs.readFileSync(repo('edge-functions', 'send-job-status-change-email-index.ts'), 'utf8');

test('jobs gains a cancel_token (unique) and the three status columns, same nullable-guard shape as th_bookings', () => {
  assert.match(MIGRATION, /alter table public\.jobs add column if not exists cancel_token uuid not null default gen_random_uuid\(\);/);
  assert.match(MIGRATION, /create unique index if not exists jobs_cancel_token_idx on public\.jobs \(cancel_token\);/);
  assert.match(MIGRATION, /alter table public\.jobs add column if not exists cancelled_at timestamptz;/);
  assert.match(MIGRATION, /alter table public\.jobs add column if not exists reschedule_requested_date text;/);
  assert.match(MIGRATION, /alter table public\.jobs add column if not exists reschedule_requested_at timestamptz;/);
});

test('get_job_by_cancel_token never returns sensitive fields (phone, client_email, notes, client_id)', () => {
  const fnMatch = MIGRATION.match(/create or replace function public\.get_job_by_cancel_token\(p_token uuid\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, 'expected to isolate get_job_by_cancel_token()');
  assert.match(fnMatch[0], /security definer/);
  for (const sensitive of ['phone', 'client_email', 'notes', 'client_id']) {
    assert.doesNotMatch(fnMatch[0], new RegExp(`\\b${sensitive}\\b`), `${sensitive} should never be returned by this public lookup`);
  }
});

test('cancel_job_by_token no-ops (rather than erroring) for an unknown token or one already cancelled', () => {
  const fnMatch = MIGRATION.match(/create or replace function public\.cancel_job_by_token\(p_token uuid\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /return query select false, 'not-found'::text;/);
  assert.match(fnMatch[0], /return query select false, 'already-cancelled'::text;/);
  assert.match(fnMatch[0], /update public\.jobs set cancelled_at = now\(\) where cancel_token = p_token;/);
});

test('request_job_reschedule_by_token never writes job_date -- only the separate request columns', () => {
  const fnMatch = MIGRATION.match(/create or replace function public\.request_job_reschedule_by_token\(p_token uuid, p_new_date text\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /set reschedule_requested_date = p_new_date, reschedule_requested_at = now\(\)/);
  assert.doesNotMatch(fnMatch[0], /set job_date/, 'reschedule must stay request-only -- see the file header comment for why an instant move is unsafe here');
});

test('notify_job_status_change only fires its http_post on the two real customer-initiated transitions', () => {
  const fnMatch = MIGRATION.match(/create or replace function public\.notify_job_status_change\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /is_cancellation := \(OLD\.cancelled_at is null and NEW\.cancelled_at is not null\);/);
  assert.match(fnMatch[0], /is_reschedule_request := \(OLD\.reschedule_requested_at is null and NEW\.reschedule_requested_at is not null\);/);
  assert.match(fnMatch[0], /if not \(is_cancellation or is_reschedule_request\) then\s*\n\s*return NEW;/);
  assert.match(fnMatch[0], /send-job-status-change-email/);
});

test('send-job-confirmation-email links to manage-job.html with the job\'s own cancel_token, in both the HTML and plain-text email bodies', () => {
  assert.match(CONFIRMATION_FN, /manage-job\.html\?token=\$\{escapeHtml\(job\.cancel_token\)\}/);
  assert.match(CONFIRMATION_FN, /manage-job\.html\?token=\$\{job\.cancel_token\}/);
});

test('send-job-status-change-email re-derives the transition from old_record/record itself, not just trusting the caller', () => {
  assert.match(STATUS_CHANGE_FN, /const isCancellation = !oldJob\.cancelled_at && !!job\.cancelled_at;/);
  assert.match(STATUS_CHANGE_FN, /const isRescheduleRequest = !oldJob\.reschedule_requested_at && !!job\.reschedule_requested_at;/);
});

test('send-job-status-change-email is staff-facing only -- no guest email address is ever used', () => {
  assert.doesNotMatch(STATUS_CHANGE_FN, /client_email/);
  assert.match(STATUS_CHANGE_FN, /to: LEAD_EMAIL_TO,/);
});

test('send-job-status-change-email\'s reschedule-request email is explicit that nothing was applied automatically', () => {
  const sendCallMatch = STATUS_CHANGE_FN.match(/Reschedule requested:[\s\S]*?\);\n    \}/);
  assert.ok(sendCallMatch);
  assert.match(sendCallMatch[0], /NOT been applied automatically/);
});

// harden_job_cancel_reschedule.sql (2026-09-15) -- both RPCs previously
// never checked jobs.status, so a stale manage-job.html link for an
// already-'done' (completed, likely invoiced) job could still cancel or
// request a reschedule on it. This also added the first server-side
// date validation on request_job_reschedule_by_token.

test('cancel_job_by_token rejects an already-completed job instead of cancelling it', () => {
  const fnMatch = HARDEN_MIGRATION.match(/create or replace function public\.cancel_job_by_token\(p_token uuid\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, 'expected to isolate the hardened cancel_job_by_token()');
  assert.match(fnMatch[0], /select cancelled_at, status into v_cancelled_at, v_status from public\.jobs where cancel_token = p_token;/);
  assert.match(fnMatch[0], /if v_status = 'done' then\s*\n\s*return query select false, 'already-completed'::text;/);
});

test('request_job_reschedule_by_token rejects an already-completed job, an invalid date, and a past date', () => {
  const fnMatch = HARDEN_MIGRATION.match(/create or replace function public\.request_job_reschedule_by_token\(p_token uuid, p_new_date text\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, 'expected to isolate the hardened request_job_reschedule_by_token()');
  assert.match(fnMatch[0], /if v_status = 'done' then\s*\n\s*return query select false, 'already-completed'::text;/);
  assert.match(fnMatch[0], /exception when others then\s*\n\s*return query select false, 'invalid-date'::text;/);
  assert.match(fnMatch[0], /if v_new_date < \(now\(\) at time zone 'America\/Denver'\)::date then\s*\n\s*return query select false, 'in-the-past'::text;/);
});
