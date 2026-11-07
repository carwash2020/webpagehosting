// Fix plan Group 4, RP2 (2026-11-07): runs sql/infra/group4_insights_and_ga.sql
// in PGlite on top of the Phase 5 migration and the live table shapes
// (phase5-db-schema.js). Made-up people and amounts only.
//
// What is proved, against the database:
//   - the funnel nests (D17): jobs, invoices and money follow this period's
//     leads and bookings; a walk-in job or an old lead's job is not counted;
//   - one person who sent the lead form and booked counts once (RP2.22);
//   - "Google" typed into Who referred you? is not a referral (RP2.5);
//     (direct) and google/organic get the website card's names (RP2.11),
//     and the database and the Workspace label every case the same way;
//   - a refund after the sale reached Google queues a refund event; before,
//     it lowers or cancels the sale (RP2.8);
//   - a failed sale is queued again when the invoice is paid again (RP2.7);
//   - nothing is queued for $0 or a TEST client (RP2.19).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { JSDOM } = require('jsdom');
const { T, OWNER, TECH, SCHEMA } = require('./phase5-db-schema');

const sql = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', 'sql', ...p), 'utf8');
const PHASE5 = sql('infra', 'phase5_attribution_and_ga4.sql');
const G4 = sql('infra', 'group4_insights_and_ga.sql');

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(PHASE5);
    await d.exec(G4);
    await d.exec(G4); // re-runnable
    return d;
  })();
  return dbPromise;
}
after(async () => { if (dbPromise) await (await dbPromise).close(); });

async function as(email, fn) {
  const d = await db();
  return d.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email, role: 'authenticated' })]);
    return fn(tx);
  });
}
const q = (email, text, params) => as(email, (tx) => tx.query(text, params));
const admin = async (text, params) => (await db()).query(text, params);
const adminExec = async (text) => (await db()).exec(text);
const calls = async () => (await admin('select body from net.calls')).rows.map((r) => r.body);

const CASES = [
  // [source, utm_source, utm_medium, utm_campaign, referred_by, landing_referrer, referred_by_code] -> label
  [['Google Search'], 'Google search'],
  [[null, null, null, null, null, 'www.google.com'], 'Google search'],
  [[null, 'google', 'organic', 'gbp', null, 'www.google.com'], 'Google Business'],
  [['Google Search', 'google', 'cpc'], 'Google Ads'],
  [[null, 'facebook', 'paid', 'spring-tuneup'], 'spring-tuneup'],
  [['Referral (friend or family)'], 'Referral'],
  [[null, null, null, 'spring-tuneup', 'Pat Neighbor'], 'Referral'],
  [[null, null, null, null, null, 'm.facebook.com'], 'Social'],
  [['Yelp / Online Reviews'], 'Yelp / Online Reviews'],
  [[], 'Not known'],
  [[null, null, null, null, 'Google'], 'Not known'],
  [['Google Search', null, null, null, 'google  Search'], 'Google search'],
  [[null, 'facebook', 'paid', 'spring-tuneup', 'Facebook'], 'spring-tuneup'],
  [[null, null, null, null, 'Googleman Pat'], 'Referral'],
  [[null, null, null, null, 'Google', null, 'PAT123'], 'Referral'],
  [[null, '(direct)', '(none)'], 'Direct'],
  [[null, 'google', 'organic'], 'Google search'],
  [[null, 'google', 'organic', 'spring'], 'spring'],
  [[null, 'bing', 'organic'], 'bing'],
];

test('RP2.5 / RP2.11: the database and the Workspace label every case the same way', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/', runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'data-layer.js'), 'utf8') + ';window.L = thChannelLabel;');
  const keys = ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'referred_by', 'landing_referrer', 'referred_by_code'];
  for (const [args, want] of CASES) {
    const a = keys.map((_, i) => (args[i] === undefined ? null : args[i]));
    const got = (await admin('select public.insights_channel($1, $2, $3, $4, $5, $6, $7) as c', a)).rows[0].c;
    assert.equal(got, want, 'database: ' + JSON.stringify(args));
    const rec = Object.fromEntries(keys.map((k, i) => [k, a[i]]));
    assert.equal(dom.window.L(rec), want, 'Workspace: ' + JSON.stringify(args));
  }
  // The old 6-argument call still works (the funnel's job rows have no code).
  assert.equal((await admin("select public.insights_channel('Google Search', null, null, null, null, null) as c")).rows[0].c, 'Google search');
});

test('RP2.2 / RP2.22: the funnel nests, and one person counts once', async () => {
  await adminExec(`
    delete from public.invoices; delete from public.ga_conversions; delete from public.th_leads; delete from public.th_bookings; delete from public.jobs;
    insert into public.jobs (id, title, tenant_id) values (10, 'From Pat', '${T}'), (11, 'From the spring booking', '${T}'), (12, 'Walk-in', '${T}'), (13, 'From an old lead', '${T}');
    insert into public.th_leads (name, email, phone, source, created_at, tenant_id) values
      ('Pat', 'Pat@Example.com', '435-555-0101', 'Google Search', now() - interval '2 days', '${T}'),
      ('Lee', null, '(435) 555-0199', null, now() - interval '2 days', '${T}');
    insert into public.th_bookings (name, email, phone, source, job_id, tenant_id) values
      ('Pat again', 'pat@example.com', null, 'Social Media', 10, '${T}');
    insert into public.th_bookings (name, email, utm_campaign, job_id, tenant_id) values ('Sam', 'sam@example.com', 'spring-tuneup', 11, '${T}');
    insert into public.th_bookings (name, email, utm_campaign, status, tenant_id) values ('Cancelled', 'c@example.com', 'spring-tuneup', 'cancelled', '${T}');
    insert into public.th_leads (name, email, source, created_at, tenant_id) values ('Old', 'old@example.com', 'Google Search', now() - interval '200 days', '${T}');
    update public.th_leads set job_id = 13 where name = 'Old'; -- staff link it later (a visitor's insert can't)
    insert into public.invoices (id, total, paid, paid_amount, job_id, refunded_amount, tenant_id) values
      (1, 200, true, 200, 10, 0, '${T}'), (2, 300, false, 100, 11, 0, '${T}'), (3, 50, true, 50, 12, 0, '${T}'),
      (4, 80, true, 80, 13, 0, '${T}'), (5, 100, true, 100, 10, 30, '${T}');
  `);
  const rows = (await q(OWNER, "select * from public.insights_source_funnel(now() - interval '90 days')")).rows;
  const by = Object.fromEntries(rows.map((r) => [r.channel, [r.leads, r.jobs, r.invoiced, r.paid == null ? null : Number(r.paid)]]));
  assert.deepEqual(by, {
    'Google search': [1, 1, 2, 270],
    'spring-tuneup': [1, 1, 1, 100],
    'Not known': [1, 0, 0, 0],
  }, 'Pat (lead + booking) is one Google search person whose booking became job 10; the walk-in and the old lead\'s job are out');
  const tech = (await q(TECH, "select * from public.insights_source_funnel(now() - interval '90 days')")).rows;
  assert.ok(tech.length === 3 && tech.every((r) => r.paid === null), 'counts yes, money no');
});

async function saleFromVisit(jobId, invoiceId, extra = '') {
  await admin(`insert into public.jobs (id, title, tenant_id) values (${jobId}, 'From a visit', '${T}') on conflict do nothing`);
  await admin(`insert into public.th_leads (name, ga_client_id, tenant_id) values ('Visitor ${jobId}', '123.456', '${T}')`);
  await admin(`update public.th_leads set job_id = ${jobId} where name = 'Visitor ${jobId}'`);
  await q(OWNER, `insert into public.invoices (id, client_name, total, job_id${extra ? ', ' + extra.split('=')[0] : ''}) values (${invoiceId}, 'Pat Client', 120, ${jobId}${extra ? ', ' + extra.split('=')[1] : ''})`);
}

test('RP2.8: a refund after the sale reached Google queues a refund; before, it lowers or cancels the sale', async () => {
  await admin('delete from net.calls');
  await saleFromVisit(20, 6001);
  await q(OWNER, 'update public.invoices set paid = true, paid_amount = 120 where id = 6001');
  assert.deepEqual(await calls(), [{ invoice_id: 6001 }]);
  await admin("update public.ga_conversions set status = 'sent', sent_at = now() where invoice_id = 6001");
  await q(OWNER, 'update public.invoices set refunded_amount = 40 where id = 6001');
  assert.deepEqual((await calls())[1], { invoice_id: 6001, refund: true });
  let g = (await admin('select * from public.ga_conversions where invoice_id = 6001')).rows[0];
  assert.deepEqual([Number(g.value), Number(g.refund_value), g.refund_status], [120, 40, 'pending']);
  await q(OWNER, 'update public.invoices set total = 121 where id = 6001');
  assert.equal((await calls()).length, 2, 'other edits send nothing');

  // Not sent yet: the sale goes out at what was kept, or not at all.
  await saleFromVisit(21, 6002);
  await q(OWNER, 'update public.invoices set paid = true, paid_amount = 120 where id = 6002');
  await q(OWNER, 'update public.invoices set refunded_amount = 20 where id = 6002');
  g = (await admin('select * from public.ga_conversions where invoice_id = 6002')).rows[0];
  assert.deepEqual([Number(g.value), g.status, g.refund_status], [100, 'pending', null]);
  await q(OWNER, 'update public.invoices set refunded_amount = 120 where id = 6002');
  assert.equal((await admin('select status from public.ga_conversions where invoice_id = 6002')).rows[0].status, 'cancelled');
});

test('RP2.7: a sale Google never accepted is queued again when the invoice is marked paid again', async () => {
  await admin('delete from net.calls');
  await saleFromVisit(22, 6003);
  await q(OWNER, 'update public.invoices set paid = true, paid_amount = 120 where id = 6003');
  await admin("update public.ga_conversions set status = 'failed', attempts = 5, last_error = 'Google answered 500' where invoice_id = 6003");
  await q(OWNER, 'update public.invoices set paid = false where id = 6003');
  await q(OWNER, 'update public.invoices set paid = true where id = 6003');
  const g = (await admin('select * from public.ga_conversions where invoice_id = 6003')).rows[0];
  assert.deepEqual([g.status, g.attempts, g.last_error], ['pending', 0, null]);
  assert.equal((await calls()).length, 2);
  // A sale still pending (or sent) is never queued twice.
  await q(OWNER, 'update public.invoices set paid = false where id = 6003');
  await q(OWNER, 'update public.invoices set paid = true where id = 6003');
  assert.equal((await calls()).length, 2);
});

test('RP2.19: nothing goes to Google for $0, or for a TEST client', async () => {
  await admin('delete from net.calls');
  await saleFromVisit(23, 6004);
  await q(OWNER, 'update public.invoices set paid = true, paid_amount = 0, total = 0 where id = 6004');
  await saleFromVisit(24, 6005);
  await q(OWNER, "update public.invoices set client_name = 'TEST Client', paid = true, paid_amount = 120 where id = 6005");
  await saleFromVisit(25, 6006);
  await q(OWNER, "update public.invoices set client_name = 'Testa Family', paid = true, paid_amount = 120 where id = 6006");
  assert.deepEqual(await calls(), [{ invoice_id: 6006 }], 'only the real client (whose name just starts with Test)');
  assert.equal((await admin('select count(*)::int n from public.ga_conversions where invoice_id in (6004, 6005)')).rows[0].n, 0);
});

test('the trigger still runs only as a trigger, and the funnel only for signed-in accounts', async () => {
  const r = await admin("select has_function_privilege('anon', 'public.ga_queue_paid_invoice()', 'execute') a, has_function_privilege('authenticated', 'public.ga_queue_paid_invoice()', 'execute') b, has_function_privilege('anon', 'public.insights_source_funnel(timestamptz)', 'execute') c");
  assert.deepEqual([r.rows[0].a, r.rows[0].b, r.rows[0].c], [false, false, false]);
});
