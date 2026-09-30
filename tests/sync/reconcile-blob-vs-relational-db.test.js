// sql/infra/reconcile_blob_vs_relational.sql (Item 1 Phase 0e, 2026-09-30).
// Read-only drift report between the workspace_sync blob and the
// relational tables. Runs the real file in PGlite against a seeded blob
// with one of each discrepancy the Phase 0d audit found or expects.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'infra', 'reconcile_blob_vs_relational.sql'), 'utf8');
const T = 'aaaaaaaa-0000-4000-8000-000000000001';

let db;
after(async () => { if (db) await db.close(); });

async function build() {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  await db.exec(`
    create table public.workspace_sync (code text primary key, data jsonb);
    create table public.jobs (id bigint primary key, title text, status text, job_date text, client text, tenant_id uuid);
    create table public.invoices (id bigint primary key, invoice_number text, total numeric, paid boolean, paid_amount numeric, invoice_date text, tenant_id uuid);
    create table public.quotes (id bigint primary key, quote_number text, total numeric, status text, tenant_id uuid);
    create table public.contracts (id bigint primary key, contract_type text, tenant_id uuid);
  `);
  return db;
}

async function report(blob, seedSql) {
  const d = db || await build();
  await d.exec('begin');
  try {
    await d.query('insert into public.workspace_sync values ($1, $2)', ['tripleh-workspace-2026', blob]);
    if (seedSql) await d.exec(seedSql);
    return (await d.query(SQL)).rows.map(r => [r.entity, r.kind, r.id === null ? null : Number(r.id), r.detail]);
  } finally {
    await d.exec('rollback');
  }
}

const str = (v) => JSON.stringify(v);

test('empty result when blob and tables match, including float totals that round to the same cent', async () => {
  const rows = await report({
    th_tracker_jobs: str([{ id: 1, title: 'A', status: 'done', date: '2026-09-01', client: 'X' }]),
    th_invoices: str([{ id: 10, invoiceNumber: 'INV-1', total: 100.004, paidAmount: 100, date: '2026-09-02' }]),
    th_quotes: '[]', th_contracts: '[]',
  }, `
    insert into public.jobs values (1, 'A', 'done', '2026-09-01', 'X', '${T}');
    insert into public.invoices values (10, 'INV-1', 100, true, 100, '2026-09-02', '${T}');
  `);
  assert.deepEqual(rows, []);
});

test('reports a missing row, a stale edit, a failed delete, a null tenant, and the money gap', async () => {
  const rows = await report({
    th_tracker_jobs: str([
      { id: 1, title: 'A', status: 'done', date: '2026-09-01', client: 'X' },
      { id: 2, title: 'B', status: 'not-started', date: '', client: 'Y' },
    ]),
    th_invoices: str([
      { id: 10, invoiceNumber: 'INV-1', total: 100, paidAmount: 100, date: '2026-09-02' },
      { id: 11, invoiceNumber: 'INV-2', total: 50, paid: true, date: '2026-09-26' },
    ]),
    th_quotes: '[]', th_contracts: '[]',
  }, `
    insert into public.jobs values (1, 'A', 'in-progress', '2026-09-01', 'X', '${T}'), (3, 'gone', 'done', '', null, null);
    insert into public.invoices values (10, 'INV-1', 100, false, 0, '2026-09-02', '${T}');
  `);
  assert.deepEqual(rows, [
    ['invoices', 'field_diff', 10, 'INV-1: paid_amount 0.00 -> 100.00'],
    ['invoices', 'money_total', null, 'blob total 150.00 vs relational 100.00; blob paid 150.00 vs relational 0.00'],
    ['invoices', 'only_in_blob', 11, 'INV-2 (2026-09-26)'],
    ['jobs', 'field_diff', 1, 'status: in-progress -> done'],
    ['jobs', 'only_in_blob', 2, 'B'],
    ['jobs', 'only_in_relational', 3, 'gone'],
    ['jobs', 'tenant_null', 3, null],
  ]);
});

test('legacy invoices with only `paid` (no paidAmount) compare as paid-in-full, matching deriveInvoicePaid()', async () => {
  const rows = await report({
    th_tracker_jobs: '[]', th_quotes: '[]', th_contracts: '[]',
    th_invoices: str([{ id: 12, invoiceNumber: 'INV-3', total: 80, paid: true, date: '2026-08-01' }]),
  }, `insert into public.invoices values (12, 'INV-3', 80, true, null, '2026-08-01', '${T}');`);
  assert.deepEqual(rows, []);
});

test('the script is read-only', () => {
  const body = SQL.replace(/--.*$/gm, '');
  assert.doesNotMatch(body, /\b(insert|update|delete|truncate|alter|drop|create)\b/i);
});
