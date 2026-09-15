// Cron fire-and-forget watchdog (closes a real audit gap): every
// pg_cron job that calls an Edge Function via net.http_post was
// fire-and-forget -- pg_net is asynchronous, so a cron job shows
// "succeeded" in cron.job_run_details the instant the HTTP request is
// successfully queued, regardless of whether the Edge Function it
// called actually returned 200. A periodic health check now scans both
// net._http_response (for real HTTP failures) and cron.job_run_details
// (for a job's own run genuinely failing), writing any real problem
// into a new cron_alerts table -- a direct-query pattern, same as
// client_portal_quotes/contracts elsewhere in this project, never a
// write into the workspace_sync JSON blob.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const sqlMigration = fs.readFileSync(repo('sql', 'infra', 'add_cron_watchdog.sql'), 'utf8');
const devToolsHtml = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');
const devToolsShared = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');
const sendPushSrc = fs.readFileSync(repo('edge-functions', 'send-push-index.ts'), 'utf8');

test('the migration creates cron_alerts with the fields Dev Tools actually reads', () => {
  assert.match(sqlMigration, /create table cron_alerts \(/);
  assert.match(sqlMigration, /alert_type text not null/);
  assert.match(sqlMigration, /detail text not null/);
  assert.match(sqlMigration, /acknowledged boolean not null default false/);
});

test('cron_alerts is internal-only -- no anon policy, same as th_uptime_checks/portal_client_errors', () => {
  const tableBlockMatch = sqlMigration.match(/create table cron_alerts \([\s\S]*?internal accounts can acknowledge cron alerts[\s\S]*?using \(exists \(select 1 from account_roles where email = \(select auth\.email\(\)\)\)\);/);
  assert.ok(tableBlockMatch, 'expected to isolate the cron_alerts table + policy block');
  assert.doesNotMatch(tableBlockMatch[0], /to anon/);
});

test('the watchdog uses a stateful cursor, so it never re-alerts on the same already-reported failure', () => {
  assert.match(sqlMigration, /create table cron_watchdog_state/);
  assert.match(sqlMigration, /where id > state\.last_http_response_id/);
  assert.match(sqlMigration, /where runid > state\.last_job_run_id/);
  assert.match(sqlMigration, /update cron_watchdog_state set last_http_response_id = max_http_id where id = true;/);
  assert.match(sqlMigration, /update cron_watchdog_state set last_job_run_id = max_run_id where id = true;/);
});

test('the cursor is seeded to the CURRENT max ids immediately after creation, so the first run never floods cron_alerts with old history', () => {
  const seedMatch = sqlMigration.match(/-- Seed the cursor[\s\S]*?where id = true;\s*$/);
  assert.ok(seedMatch, 'expected to find the seeding statement after cron.schedule()');
  assert.match(seedMatch[0], /last_http_response_id = coalesce\(\(select max\(id\) from net\._http_response\), 0\)/);
  assert.match(seedMatch[0], /last_job_run_id = coalesce\(\(select max\(runid\) from cron\.job_run_details\), 0\)/);
});

test('check_cron_health() is scheduled via cron.schedule as a plain SQL call, not another net.http_post -- so its own failure is directly visible in cron.job_run_details, no async blind spot of its own', () => {
  const scheduleMatch = sqlMigration.match(/select cron\.schedule\(\s*'cron-watchdog',\s*'\*\/30 \* \* \* \*',\s*\$\$select check_cron_health\(\);\$\$\s*\);/);
  assert.ok(scheduleMatch, 'expected cron-watchdog scheduled every 30 minutes calling check_cron_health() directly');
});

test('the watchdog function checks status codes AND timeouts, not just non-2xx', () => {
  const fnMatch = sqlMigration.match(/create or replace function check_cron_health\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch, 'expected to isolate check_cron_health()');
  assert.match(fnMatch[0], /status_code is null or status_code < 200 or status_code >= 300 or timed_out = true/);
});

test('a best-effort push alert only fires when there is an actual open, unacknowledged alert -- never unconditionally on every run', () => {
  const fnMatch = sqlMigration.match(/create or replace function check_cron_health\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /if exists \(select 1 from cron_alerts where created_at > now\(\) - interval '31 minutes' and not acknowledged\) then/);
});

test('send-push handles the cron-health-alert type, broadcasting to the whole internal team like uptime-alert does', () => {
  const fnMatch = sendPushSrc.match(/if \(payload\.type === "cron-health-alert"\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'expected to isolate the cron-health-alert branch');
  assert.match(fnMatch[0], /sendToAllSubscriptions/);
  assert.match(fnMatch[0], /\/tools\/dev-tools\.html/);
});

test('Dev Tools has a Cron Health panel, reading cron_alerts directly (not the workspace_sync blob)', () => {
  assert.match(devToolsHtml, /<h2>Cron health<\/h2>/);
  assert.match(devToolsHtml, /<div id="cronHealthResults"><\/div>/);
  const fnMatch = devToolsHtml.match(/async function fetchCronAlerts\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate fetchCronAlerts()');
  assert.match(fnMatch[0], /rest\/v1\/cron_alerts\?acknowledged=eq\.false/);
});

test('acknowledging an alert is a real PATCH against cron_alerts, then re-renders', () => {
  const fnMatch = devToolsHtml.match(/async function acknowledgeCronAlert\(id\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate acknowledgeCronAlert()');
  assert.match(fnMatch[0], /method: 'PATCH'/);
  assert.match(fnMatch[0], /acknowledged: true/);
  assert.match(fnMatch[0], /renderCronHealth\(\);/);
});

test('Cron Health is wired into both page-load init and the "Run full health check" aggregator', () => {
  assert.match(devToolsHtml, /renderCronHealth\(\);\s*\n\s*\/\/ Portal init calls removed/);
  const aggMatch = devToolsHtml.match(/async function runFullHealthCheck\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(aggMatch, 'expected to isolate runFullHealthCheck()');
  assert.match(aggMatch[0], /renderCronHealth/);
  assert.match(aggMatch[0], /#cronHealthResults \.dev-issue-row/);
});

test('the Cron Health info bubble has a real DEV_INFO entry, not a silently-missing key', () => {
  assert.match(devToolsShared, /cronhealth: \{/);
  assert.match(devToolsHtml, /onclick="openDevInfo\('cronhealth'\)"/);
});
