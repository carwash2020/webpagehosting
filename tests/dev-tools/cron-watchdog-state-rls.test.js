// Test for a critical security gap found via mcp__Supabase__get_advisors
// while working an unrelated item in this same audit pass:
// cron_watchdog_state (added in add_cron_watchdog.sql) was created
// without RLS enabled at all -- fully exposed to the anon and
// authenticated roles, so anyone holding this project's public anon
// key could read or overwrite its cursor. Nothing client-side ever
// needs to touch this table; only check_cron_health() (SECURITY
// DEFINER) and the service-role-authenticated edge function path
// touch it, both of which bypass RLS regardless.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SQL = fs.readFileSync(repo('sql', 'infra', 'enable_rls_cron_watchdog_state.sql'), 'utf8');

test('cron_watchdog_state has row level security enabled', () => {
  assert.match(SQL, /alter table cron_watchdog_state enable row level security;/);
});

test('no policy is granted to anon/authenticated -- deny-all is the intended, correct state for this internal-only cursor', () => {
  assert.doesNotMatch(SQL, /create policy/);
});
