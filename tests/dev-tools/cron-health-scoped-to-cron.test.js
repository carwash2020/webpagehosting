// Bug (reported directly, with a screenshot on 2026-09-23): Cron
// Health showed a run of "HTTP call failed -- status 401" alerts that
// had nothing to do with any pg_cron job -- every actual cron job run
// in that window succeeded (cron.job_run_details), and the alerted
// timestamps didn't line up with any job's schedule. Root cause:
// check_cron_health() (add_cron_watchdog.sql) scanned ALL of
// net._http_response for a non-2xx row, but net.http_post is callable
// by more than pg_cron -- this project's own notify_* DB triggers
// call it too -- so anything else's net.http_post failure got
// misattributed to "cron." See fix_cron_health_false_positives.sql.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const fixSql = fs.readFileSync(repo('sql', 'infra', 'fix_cron_health_false_positives.sql'), 'utf8');

test('a tracking table maps a pg_net request id back to the pg_cron job that made it', () => {
  assert.match(fixSql, /create table cron_tracked_http_requests \(/);
  assert.match(fixSql, /request_id bigint primary key/);
  assert.match(fixSql, /jobid bigint not null/);
});

test('cron_tracked_http_requests has RLS enabled with no policies -- internal bookkeeping only, same reasoning as th_uptime_checks', () => {
  const tableBlockMatch = fixSql.match(/create table cron_tracked_http_requests \([\s\S]*?alter table cron_tracked_http_requests enable row level security;/);
  assert.ok(tableBlockMatch, 'expected to isolate the cron_tracked_http_requests table block');
  assert.doesNotMatch(fixSql, /create policy[\s\S]*cron_tracked_http_requests/);
});

test('cron_tracked_http_post records which job made the call before returning the request id', () => {
  const fnMatch = fixSql.match(/create or replace function cron_tracked_http_post\([\s\S]*?\$\$;/);
  assert.ok(fnMatch, 'expected to isolate cron_tracked_http_post()');
  assert.match(fnMatch[0], /req_id := net\.http_post\(/);
  assert.match(fnMatch[0], /insert into cron_tracked_http_requests \(request_id, jobid\) values \(req_id, jobid\);/);
  assert.match(fnMatch[0], /return req_id;/);
});

test('cron_tracked_http_post is locked down to postgres only -- not callable by anon or authenticated via RPC', () => {
  // A SECURITY DEFINER function that fires net.http_post to a
  // caller-controlled url/headers/body would be an open SSRF
  // primitive if reachable by anon/authenticated. Supabase grants
  // EXECUTE on every new public-schema function to those roles by
  // default, separate from (and not removed by) revoking from
  // PUBLIC -- so both an explicit revoke from PUBLIC and an explicit
  // revoke from anon/authenticated are required.
  assert.match(fixSql, /revoke all on function cron_tracked_http_post\([^)]*\) from public;/);
  assert.match(fixSql, /revoke execute on function cron_tracked_http_post\([^)]*\) from anon, authenticated;/);
  assert.doesNotMatch(fixSql, /grant execute on function cron_tracked_http_post\([^)]*\) to (anon|authenticated)/);
});

test('every net.http_post cron job is swapped to the tracked wrapper via cron.alter_job, passing its own jobid', () => {
  const jobNames = [
    'daily-reminder-check',
    'weekly-business-digest',
    'daily-stripe-reconciliation-check',
    'send-appointment-reminders-hourly',
    'send-payment-reminders-daily',
    'send-quote-followup-daily',
  ];
  for (const name of jobNames) {
    const alterMatch = fixSql.match(new RegExp(
      `select cron\\.alter_job\\(\\s*\\(select jobid from cron\\.job where jobname = '${name}'\\)`
    ));
    assert.ok(alterMatch, `expected cron.alter_job() for ${name}`);
    // Every alter_job block for these jobs must call the tracked
    // wrapper, not raw net.http_post, and must pass this exact job's
    // own jobid through -- not a hardcoded id or another job's name.
    const blockMatch = fixSql.match(new RegExp(
      `select cron\\.alter_job\\(\\s*\\(select jobid from cron\\.job where jobname = '${name}'\\)[\\s\\S]*?\\$cmd\\$\\s*\\);`
    ));
    assert.ok(blockMatch, `expected to isolate the alter_job block for ${name}`);
    assert.match(blockMatch[0], /select cron_tracked_http_post\(/);
    assert.match(blockMatch[0], new RegExp(`jobid := \\(select jobid from cron\\.job where jobname = '${name}'\\)`));
  }
});

test("check_cron_health()'s http_response_failed loop only reads responses joined against cron_tracked_http_requests, not raw net._http_response", () => {
  const fnMatch = fixSql.match(/create or replace function check_cron_health\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, 'expected to isolate the redefined check_cron_health()');
  assert.match(fnMatch[0], /from net\._http_response r\s*\n\s*join cron_tracked_http_requests t on t\.request_id = r\.id/);
  // The alert message now names which job failed, instead of a bare
  // "HTTP call failed" that gave no way to tell a real cron problem
  // apart from unrelated net.http_post traffic elsewhere.
  assert.match(fnMatch[0], /'Cron job #%s HTTP call failed at %s/);
  assert.match(fnMatch[0], /bad_response\.jobid,/);
});

test("check_cron_health()'s job_run_failed half (cron.job_run_details) is untouched -- this fix is scoped to the http_response side only", () => {
  const fnMatch = fixSql.match(/create or replace function check_cron_health\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /from cron\.job_run_details\s*\n\s*where runid > state\.last_job_run_id/);
  assert.match(fnMatch[0], /'Cron job #%s run failed at %s: %s \(%s\)'/);
});

test('stale false-positive alerts already in cron_alerts get acknowledged, not deleted -- the history stays, just marked resolved', () => {
  assert.match(fixSql, /update cron_alerts\s*\n\s*set acknowledged = true, acknowledged_at = now\(\), acknowledged_by = 'system \(false-positive cleanup, 2026-09-23\)'\s*\n\s*where not acknowledged\s*\n\s*and alert_type = 'http_response_failed';/);
});
