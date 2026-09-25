// Security audit (2026-09-23, LOW): three leftovers still treated the
// `authenticated` role as staff even though public signup is on --
// role_definitions and th_uptime_checks were readable by any signed-in
// account, and anon kept its own explicit EXECUTE on the four MFA
// recovery-code RPCs. Applied live and verified with simulated JWTs (a
// stranger now sees 0 of 3 roles and 0 of 227 uptime rows; both internal
// accounts still see all of them; anon is denied all four RPCs while
// authenticated keeps them). These tests pin the mirrored migration and
// the code-side facts it depends on.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');

const SQL = read('sql', 'security', 'tighten_role_definitions_uptime_and_recovery_code_grants.sql');
const STATEMENTS = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the open role_definitions read policy is replaced by an internal-accounts-only one', () => {
  assert.match(STATEMENTS, /drop policy if exists "Authenticated can view roles" on public\.role_definitions;/);
  assert.match(STATEMENTS,
    /create policy "Internal accounts can view roles"\s+on public\.role_definitions for select to authenticated\s+using \(\(select public\.current_user_has_any_role\(\)\)\);/);
});

test('th_uptime_checks reads now actually require staff, matching the policy name', () => {
  assert.match(STATEMENTS, /drop policy if exists "Staff can read uptime history" on public\.th_uptime_checks;/);
  assert.match(STATEMENTS,
    /create policy "Staff can read uptime history"\s+on public\.th_uptime_checks for select to authenticated\s+using \(\(select public\.current_user_has_any_role\(\)\)\);/);
});

test('role_definitions write policies are left alone (already gated on current_user_can_manage_roles)', () => {
  assert.doesNotMatch(STATEMENTS, /Only role managers can/);
  assert.doesNotMatch(STATEMENTS, /for (insert|update|delete)/i);
});

test('anon loses EXECUTE on all four recovery-code RPCs; authenticated is not touched', () => {
  for (const fn of [
    'generate_internal_recovery_codes(integer)',
    'verify_and_consume_internal_recovery_code(text)',
    'count_unused_internal_recovery_codes()',
    'delete_internal_recovery_codes()',
  ]) {
    // Plain substring check: no regex built from `fn`, so nothing in it
    // needs escaping.
    assert.ok(STATEMENTS.includes(`revoke execute on function public.${fn} from anon;`), `${fn}: anon EXECUTE revoked`);
  }
  assert.doesNotMatch(STATEMENTS, /from authenticated|from anon, authenticated/);
});

test('no policy here grants access with a bare true', () => {
  assert.doesNotMatch(STATEMENTS, /using \(\s*true\s*\)/i);
});

// ---- the legitimate readers still pass the new check ----

test('every browser read of role_definitions and th_uptime_checks is on an internal /tools/ page with the session token', () => {
  const readers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(repo(dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'tests', '.git', 'edge-functions', 'sql', 'backups', 'scripts', 'docs', '.claude', '.github'].includes(entry.name)) continue;
        walk(rel);
      } else if (/\.(html|js)$/.test(entry.name)) {
        const src = fs.readFileSync(repo(rel), 'utf8');
        const re = /\/rest\/v1\/(role_definitions|th_uptime_checks)[\s\S]{0,400}?\{ headers: \{([^}]*)\}/g;
        let m;
        while ((m = re.exec(src))) readers.push({ file: rel, table: m[1], headers: m[2] });
      }
    }
  };
  walk('.');
  assert.ok(readers.length >= 3, `expected the dev-tools readers to still exist, found ${readers.length}`);
  for (const r of readers) {
    assert.ok(r.file.startsWith('tools' + path.sep), `${r.file} reads ${r.table} but isn't an internal page`);
    assert.match(r.headers, /'Authorization': 'Bearer ' \+ getAuthToken\(\)/, `${r.file} must send the signed-in session, not the anon key`);
  }
});

test('the recovery-code RPCs are only ever called from tools/auth.js with the signed-in session', () => {
  const auth = read('tools', 'auth.js');
  for (const fn of ['generate_internal_recovery_codes', 'count_unused_internal_recovery_codes', 'delete_internal_recovery_codes']) {
    const idx = auth.indexOf(`/rest/v1/rpc/${fn}`);
    assert.ok(idx !== -1, `tools/auth.js should call ${fn}`);
    assert.match(auth.slice(idx, idx + 400), /'?Authorization'?: (`Bearer \$\{[^}]+\}`|'Bearer ' \+)/, `${fn} must be called with a bearer session token`);
  }
  // Signing in with a code (2026-09-25): redeemRecoveryCode() posts to the
  // new RPC, or the old name when the new one is missing, through one helper
  // that always sends the session it was given.
  const start = auth.indexOf('async function redeemRecoveryCode(accessToken, code)');
  const body = auth.slice(start, auth.indexOf('\n}\n', start));
  for (const fn of ['redeem_internal_recovery_code', 'verify_and_consume_internal_recovery_code']) {
    assert.ok(body.includes(`/rest/v1/rpc/${fn}`), `redeemRecoveryCode() should call ${fn}`);
  }
  assert.match(body, /'Authorization': `Bearer \$\{accessToken\}`/);
});
