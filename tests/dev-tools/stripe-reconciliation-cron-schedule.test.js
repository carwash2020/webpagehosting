// Tests for recording the daily-stripe-reconciliation-check cron
// schedule in sql/ (audit item #21). Every other pg_cron schedule in
// this project has a matching file in this directory --
// daily-reminder-check, weekly-business-digest, the notification/
// uptime/portal-error cleanup jobs, send-appointment-reminders-hourly,
// cron-watchdog -- but this one, which calls reconcile-stripe-payments
// (see that function's own header comment), was scheduled directly
// via the Supabase dashboard/MCP tools and never recorded here at all,
// found and confirmed live via a direct `select * from cron.job` query
// before this file was written.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SQL = fs.readFileSync(repo('sql', 'infra', 'add_stripe_reconciliation_cron.sql'), 'utf8');

test('the job name, schedule, and URL exactly match the real, currently-active cron.job row (confirmed live before writing this file)', () => {
  const scheduleMatch = SQL.match(/select cron\.schedule\(\s*'daily-stripe-reconciliation-check',\s*'0 6 \* \* \*',\s*\$cron\$([\s\S]*?)\$cron\$\s*\);/);
  assert.ok(scheduleMatch, 'expected to find the exact cron.schedule() call matching the live job');
  assert.match(scheduleMatch[1], /url := 'https:\/\/csvfqdjuobylgafgolho\.supabase\.co\/functions\/v1\/reconcile-stripe-payments',/);
});

test('the job authenticates the same way every other reconciliation/reminder cron job in this project does -- the send_push_service_role_key Vault secret, never a hardcoded key', () => {
  assert.match(SQL, /Bearer ' \|\| \(select decrypted_secret from vault\.decrypted_secrets where name = 'send_push_service_role_key' limit 1\)/);
});

test('the job has a real timeout, matching every other net.http_post-based cron job in this project (never left to hang indefinitely)', () => {
  assert.match(SQL, /timeout_milliseconds := 15000/);
});
