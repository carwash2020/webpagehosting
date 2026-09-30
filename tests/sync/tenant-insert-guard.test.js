// Regression guard for the Tier 0 tenant_id bug (fixed by
// sql/multi-tenant/06 and 07; see docs/specialist-logs/bugfix.md,
// 2026-09-30).
//
// The bug class: a staff INSERT/ALL policy checks
// `tenant_id = current_tenant_id()`, but the table has neither a tenant_id
// default nor a `set_tenant_id` trigger. The app never sends tenant_id, so
// every insert, and every upsert of an existing row, fails with 42501. The
// relational mirror swallowed those errors, so nothing surfaced for weeks.
//
// This scans every .sql file in sql/ (the record of what's applied to
// production) and fails if any table with such a policy has no way to get
// its tenant_id. If you add a tenant-checked policy to a new table, give the
// table a `set_tenant_id` BEFORE INSERT trigger (the 06 pattern) or a
// tenant_id default (the 04 pattern) in the same change.
//
// It can only see SQL committed to the repo. A policy applied by hand in the
// SQL editor and never committed is invisible here. For that, run the
// read-only sql/infra/audit_tenant_insert_guard.sql against production; it
// must return zero rows.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SQL_DIR = path.join(__dirname, '..', '..', 'sql');

function sqlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sqlFiles(p);
    return e.name.endsWith('.sql') ? [p] : [];
  });
}

const stripComments = (s) => s.replace(/--[^\n]*/g, '');

// Tables with an INSERT or ALL policy that mentions current_tenant_id().
// `create policy` with no `for` clause is ALL. An `alter policy` doesn't
// restate its command, so any tenant check in its WITH CHECK counts
// (conservative: over-reporting is fine, under-reporting isn't).
function guardedTables(sources) {
  const out = new Map();
  const add = (table, where) => out.set(table, (out.get(table) || []).concat(where));
  for (const { name, sql } of sources) {
    const s = stripComments(sql);
    for (const m of s.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+(?:public\.)?"?(\w+)"?([^;]*);/gi)) {
      const cmd = ((m[3].match(/\bfor\s+(all|insert|select|update|delete)\b/i) || [])[1] || 'all').toLowerCase();
      if ((cmd === 'all' || cmd === 'insert') && /current_tenant_id/i.test(m[3])) add(m[2], `${name}: ${m[1]}`);
    }
    for (const m of s.matchAll(/alter\s+policy\s+("[^"]+"|\w+)\s+on\s+(?:public\.)?"?(\w+)"?([^;]*);/gi)) {
      const check = m[3].match(/with\s+check\s*\(([\s\S]*)$/i);
      if (check && /current_tenant_id/i.test(check[1])) add(m[2], `${name}: ${m[1]} (alter)`);
    }
  }
  return out;
}

// Tables that get tenant_id without the caller sending it: a set_tenant_id
// trigger (written directly, or in a DO block that loops over a table array
// like 06), or a tenant_id column default.
function coveredTables(sources) {
  const out = new Set();
  for (const { sql } of sources) {
    const s = stripComments(sql);
    for (const m of s.matchAll(/create\s+trigger\s+set_tenant_id\s+before\s+insert\s+on\s+(?:public\.)?"?(\w+)"?/gi)) {
      out.add(m[1]);
    }
    for (const block of s.matchAll(/do\s+(\$\w*\$)([\s\S]*?)\1/gi)) {
      if (!/create\s+trigger\s+set_tenant_id\s+before\s+insert\s+on\s+(?:public\.)?%I/i.test(block[2])) continue;
      for (const arr of block[2].matchAll(/array\s*\[([^\]]*)\]/gi)) {
        for (const t of arr[1].matchAll(/'(\w+)'/g)) out.add(t[1]);
      }
    }
    for (const m of s.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?\s+alter\s+column\s+tenant_id\s+set\s+default\b/gi)) {
      out.add(m[1]);
    }
    for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\);/gi)) {
      if (/\btenant_id\b[^,]*\bdefault\b/i.test(m[2])) out.add(m[1]);
    }
  }
  return out;
}

function unguarded(sources) {
  const guarded = guardedTables(sources);
  const covered = coveredTables(sources);
  return [...guarded.entries()]
    .filter(([t]) => !covered.has(t))
    .map(([t, where]) => `${t} (${where.join('; ')})`)
    .sort();
}

const repoSources = () => sqlFiles(SQL_DIR).map((f) => ({
  name: path.relative(SQL_DIR, f), sql: fs.readFileSync(f, 'utf8'),
}));

test('every table with a tenant-checked staff INSERT/ALL policy gets tenant_id from a trigger or default', () => {
  const missing = unguarded(repoSources());
  assert.deepEqual(missing, [],
    'These tables check tenant_id = current_tenant_id() on insert but nothing fills tenant_id, ' +
    'so every app insert and upsert will fail with 42501. Add a set_tenant_id trigger ' +
    '(sql/multi-tenant/06 pattern) or a tenant_id default:\n  ' + missing.join('\n  '));
});

test('the scan actually finds the known tenant-checked tables (guards against a parser that finds nothing)', () => {
  const sources = repoSources();
  const guarded = guardedTables(sources);
  const covered = coveredTables(sources);
  for (const t of ['jobs', 'invoices', 'quotes', 'contracts', 'referrals', 'th_job_photos', 'th_bookings',
    'push_subscriptions', 'notification_recipients', 'client_account_codes',
    'invoice_line_items', 'quote_line_items']) {
    assert.ok(guarded.has(t), `${t}: tenant-checked policy not found`);
    assert.ok(covered.has(t), `${t}: trigger/default not found`);
  }
});

test('would have caught the real bug: without batch 06, exactly the 10 broken tables are flagged', () => {
  const without06 = repoSources().filter((s) => !s.name.includes('06_tenant_id_from_session'));
  assert.deepEqual(unguarded(without06).map((s) => s.split(' ')[0]), [
    'client_account_codes', 'contracts', 'invoices', 'jobs', 'notification_recipients',
    'push_subscriptions', 'quotes', 'referrals', 'th_bookings', 'th_job_photos',
  ]);
});

// The parser against the exact shapes this repo uses, so a regex change
// can't quietly stop catching the bug.
const POLICY = (table, cmd = 'for all') => `
  create policy "staff" on public.${table} ${cmd} to authenticated
    using (tenant_id = (select public.current_tenant_id()))
    with check (tenant_id = (select public.current_tenant_id()));`;

test('flags a tenant-checked ALL, INSERT, or default-command policy with no trigger or default', () => {
  const sources = [
    { name: 'a.sql', sql: POLICY('widgets') },
    { name: 'b.sql', sql: POLICY('gadgets', 'for insert') },
    { name: 'c.sql', sql: POLICY('gizmos', '') },
  ];
  assert.deepEqual(unguarded(sources).map((s) => s.split(' ')[0]), ['gadgets', 'gizmos', 'widgets']);
});

test('flags a tenant check added by alter policy', () => {
  const sources = [{ name: 'a.sql', sql: `
    alter policy "staff" on public.widgets
      with check (tenant_id = (select public.current_tenant_id()));` }];
  assert.deepEqual(unguarded(sources).map((s) => s.split(' ')[0]), ['widgets']);
});

test('ignores SELECT/UPDATE/DELETE-only policies and commented-out SQL', () => {
  const sources = [
    { name: 'a.sql', sql: POLICY('widgets', 'for select') + POLICY('gadgets', 'for update') },
    { name: 'b.sql', sql: '-- create policy "x" on public.gizmos for all with check (tenant_id = current_tenant_id());' },
  ];
  assert.deepEqual(unguarded(sources), []);
});

test('accepts each coverage form: direct trigger, 06-style loop, alter default, create-table default', () => {
  const sources = [
    { name: 'policies.sql', sql: ['a', 'b', 'c', 'd'].map((t) => POLICY(t)).join('\n') },
    { name: 'direct.sql', sql: `create trigger set_tenant_id before insert on public.a
      for each row execute function public.set_tenant_id_from_session();` },
    { name: 'loop.sql', sql: `do $$ declare t text; begin
      foreach t in array array['b'] loop
        execute format('create trigger set_tenant_id before insert on public.%I '
          'for each row execute function public.set_tenant_id_from_session()', t);
      end loop; end; $$;` },
    { name: 'default.sql', sql: `alter table public.c
      alter column tenant_id set default public.default_tenant_id_triple_h();` },
    { name: 'create.sql', sql: `create table public.d (id bigint primary key,
      tenant_id uuid default public.default_tenant_id_triple_h());` },
  ];
  assert.deepEqual(unguarded(sources), []);
});

test('a trigger with a different name does not count (the convention is set_tenant_id)', () => {
  const sources = [
    { name: 'a.sql', sql: POLICY('widgets') },
    { name: 'b.sql', sql: 'create trigger fill_tenant before insert on public.widgets for each row execute function f();' },
  ];
  assert.deepEqual(unguarded(sources).map((s) => s.split(' ')[0]), ['widgets']);
});
