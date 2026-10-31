// Cron Health false alarms: the */30 watchdog read cron.job_run_details
// at :00/:30 while jobs were still 'connecting'/'sending', alerted on
// them as failures, and moved its cursor past them. Runs the real
// migration (fix_cron_health_in_flight_runs.sql) in PGlite against
// stand-in cron/net/vault tables.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'infra', f), 'utf8');
const MIGRATION = read('fix_cron_health_in_flight_runs.sql');

const dbs = [];
after(async () => { for (const d of dbs) await d.close(); });

async function setup() {
  const db = new PGlite();
  dbs.push(db);
  await db.exec(`
    create schema cron; create schema net; create schema vault;
    create table cron.job_run_details (runid bigint primary key, jobid bigint, status text, return_message text, start_time timestamptz default now());
    create table net._http_response (id bigint primary key, status_code int, timed_out boolean, error_msg text, created timestamptz);
    create view vault.decrypted_secrets as select 'send_push_service_role_key'::text as name, 'k'::text as decrypted_secret;
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
    create table cron_tracked_http_requests (request_id bigint primary key, jobid bigint not null);
    create table cron_alerts (
      id bigint generated always as identity primary key, alert_type text not null, detail text not null,
      created_at timestamptz not null default now(), acknowledged boolean not null default false,
      acknowledged_at timestamptz, acknowledged_by text);
    create table cron_watchdog_state (id boolean primary key default true, last_http_response_id bigint not null default 0, last_job_run_id bigint not null default 0);
    insert into cron_watchdog_state (id) values (true);
  `);
  await db.exec(MIGRATION);
  return db;
}
const runs = (db, rows) => db.exec(rows.map(([id, job, status]) =>
  `insert into cron.job_run_details (runid, jobid, status, return_message) values (${id}, ${job}, '${status}', ${status === 'failed' ? "'boom'" : 'null'});`).join('\n'));
const cursor = async (db) => (await db.query('select last_job_run_id from cron_watchdog_state')).rows[0].last_job_run_id;
const alerts = async (db) => (await db.query("select detail from cron_alerts where alert_type='job_run_failed' order by id")).rows.map(r => r.detail);

test('runs still connecting/sending are not alerted, and the cursor stays behind them', async () => {
  const db = await setup();
  await runs(db, [[1, 3, 'succeeded'], [2, 10, 'sending'], [3, 11, 'connecting'], [4, 12, 'succeeded']]);
  await db.exec('select check_cron_health()');
  assert.deepEqual(await alerts(db), []);
  assert.equal(Number(await cursor(db)), 1, 'cursor stops just before the oldest unfinished run');
});

test('once the in-flight run finishes successfully it is still not an alert, and the cursor catches up', async () => {
  const db = await setup();
  await runs(db, [[1, 3, 'succeeded'], [2, 10, 'sending'], [3, 11, 'succeeded']]);
  await db.exec('select check_cron_health()');
  await db.exec("update cron.job_run_details set status = 'succeeded' where runid = 2");
  await db.exec('select check_cron_health()');
  assert.deepEqual(await alerts(db), []);
  assert.equal(Number(await cursor(db)), 3);
});

test('a run that was in flight and then really fails is alerted exactly once, even across several watchdog runs', async () => {
  const db = await setup();
  await runs(db, [[1, 3, 'sending'], [2, 11, 'failed']]);
  await db.exec('select check_cron_health()');
  assert.equal((await alerts(db)).length, 1, 'run 2 failed and is reported');
  await db.exec('select check_cron_health()');
  assert.equal((await alerts(db)).length, 1, 'cursor is still behind run 1, but run 2 is not reported twice');
  await db.exec("update cron.job_run_details set status = 'failed' where runid = 1");
  await db.exec('select check_cron_health()');
  const a = await alerts(db);
  assert.equal(a.length, 2);
  assert.match(a[1], /Cron job #3 run #1 failed/);
  assert.equal(Number(await cursor(db)), 2);
});

test('a run abandoned in an unfinished state for over an hour does not hold the cursor back forever', async () => {
  const db = await setup();
  await runs(db, [[1, 3, 'running'], [2, 11, 'succeeded']]);
  await db.exec("update cron.job_run_details set start_time = now() - interval '2 hours' where runid = 1");
  await db.exec('select check_cron_health()');
  assert.equal(Number(await cursor(db)), 2);
  assert.deepEqual(await alerts(db), []);
});

test('the one-time cleanup acknowledges only the in-flight false alarms, not real failures', async () => {
  const db = new PGlite();
  dbs.push(db);
  const cleanup = MIGRATION.slice(MIGRATION.indexOf('update cron_alerts'));
  await db.exec(`
    create table cron_alerts (id bigint generated always as identity primary key, alert_type text not null, detail text not null,
      acknowledged boolean not null default false, acknowledged_at timestamptz, acknowledged_by text);
    insert into cron_alerts (alert_type, detail) values
      ('job_run_failed', 'Cron job #3 run failed at 2026-10-30 00:00:00+00: sending (no message)'),
      ('job_run_failed', 'Cron job #13 run failed at 2026-10-30 00:30:00+00: connecting (no message)'),
      ('job_run_failed', 'Cron job #3 run failed at 2026-10-30 01:00:00+00: failed (permission denied)'),
      ('http_response_failed', 'Cron job #3 HTTP call failed at x -- status 500');
  `);
  await db.exec(cleanup);
  const r = await db.query('select detail, acknowledged from cron_alerts order by id');
  assert.deepEqual(r.rows.map(x => x.acknowledged), [true, true, false, false]);
});
