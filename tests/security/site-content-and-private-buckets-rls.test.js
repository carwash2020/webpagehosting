// CRITICAL audit finding (2026-09-23): public signup is enabled on this
// Supabase project, so any stranger can get an `authenticated` session.
// site_content/site_faq/site_terms (every public page's phone, email,
// hours, banners, FAQ, Terms) accepted writes from ANY authenticated
// session, and the `receipts` and `secure-documents` Storage buckets
// (business-formation, insurance, and tax documents) accepted reads,
// uploads, and deletes from any authenticated session too.
//
// The live fix was applied and verified directly against the database
// (a simulated stranger and an invited portal client were denied; Steve's
// and Connor's accounts kept full access; anonymous public reads were
// unchanged). These tests pin the migration file that mirrors it, and the
// code-side facts the fix depends on, so a future edit can't quietly
// reopen the hole or break the legitimate staff path.
// Full write-up: docs/specialist-logs/security.md, 2026-09-23 entry.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');

const SQL = read('sql', 'security', 'restrict_site_content_and_private_buckets_to_internal_accounts.sql');
// Comments quote the old policy names on purpose; parse statements only.
const STATEMENTS = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function createdPolicies() {
  const re = /create policy "([^"]+)"\s+on\s+([\w.]+)\s+for\s+(select|insert|update|delete|all)\s+to\s+(\w+)([\s\S]*?);/gi;
  const out = [];
  let m;
  while ((m = re.exec(STATEMENTS))) {
    out.push({ name: m[1], table: m[2], cmd: m[3].toLowerCase(), role: m[4], body: m[5] });
  }
  return out;
}

const POLICIES = createdPolicies();
const CMS_TABLES = ['public.site_content', 'public.site_faq', 'public.site_terms'];
const HISTORY_TABLES = ['public.site_content_history', 'public.site_faq_history', 'public.site_terms_history'];

test('every old any-authenticated policy on these tables and buckets is dropped', () => {
  const oldPolicies = [
    ['Only logged-in can edit site content', 'public.site_content'],
    ['Only logged-in can update site content', 'public.site_content'],
    ['Only logged-in can delete site content', 'public.site_content'],
    ['Only logged-in can edit FAQ', 'public.site_faq'],
    ['Only logged-in can update FAQ', 'public.site_faq'],
    ['Only logged-in can delete FAQ', 'public.site_faq'],
    ['Only logged-in can edit terms', 'public.site_terms'],
    ['Only logged-in can update terms', 'public.site_terms'],
    ['Only logged-in can delete terms', 'public.site_terms'],
    ['Only logged-in can read history', 'public.site_content_history'],
    ['Only logged-in can read FAQ history', 'public.site_faq_history'],
    ['Only logged-in can read terms history', 'public.site_terms_history'],
    ['Allow authenticated downloads from receipts', 'storage.objects'],
    ['Authenticated can view receipts', 'storage.objects'],
    ['Allow authenticated uploads to receipts', 'storage.objects'],
    ['Allow authenticated deletes from receipts', 'storage.objects'],
    ['Allow authenticated downloads from secure-documents', 'storage.objects'],
    ['Allow authenticated uploads to secure-documents', 'storage.objects'],
    ['Allow authenticated deletes from secure-documents', 'storage.objects'],
  ];
  for (const [name, table] of oldPolicies) {
    assert.ok(
      STATEMENTS.includes(`drop policy if exists "${name}" on ${table};`),
      `expected the old open policy "${name}" on ${table} to be dropped`
    );
  }
});

test('the public read policies are NOT dropped (anonymous visitors still see the CMS content)', () => {
  for (const name of ['Anyone can read site content', 'Anyone can read FAQ', 'Anyone can read terms']) {
    assert.ok(!STATEMENTS.includes(`"${name}"`), `"${name}" must stay untouched -- every public page reads it as anon`);
  }
});

test('no policy created here grants access with a bare `true`', () => {
  for (const p of POLICIES) {
    assert.doesNotMatch(p.body, /\(\s*true\s*\)/i, `${p.name} must not use a bare true predicate`);
  }
});

test('CMS writes (insert, update, delete) all require can_manage_site_content', () => {
  for (const table of CMS_TABLES) {
    for (const cmd of ['insert', 'update', 'delete']) {
      const matches = POLICIES.filter((p) => p.table === table && p.cmd === cmd);
      assert.equal(matches.length, 1, `expected exactly one ${cmd} policy on ${table}`);
      const p = matches[0];
      assert.equal(p.role, 'authenticated');
      assert.match(p.body, /account_roles ar\s+where ar\.email = \(select auth\.email\(\)\) and ar\.can_manage_site_content/,
        `${p.name} must check account_roles.can_manage_site_content for the caller`);
      if (cmd === 'update') {
        assert.match(p.body, /using \(/, `${p.name} needs a USING clause`);
        assert.match(p.body, /with check \(/, `${p.name} needs a WITH CHECK clause too, or a row could be rewritten into anything`);
      }
    }
  }
});

test('history tables are readable by internal accounts only', () => {
  for (const table of HISTORY_TABLES) {
    const matches = POLICIES.filter((p) => p.table === table);
    assert.equal(matches.length, 1, `expected exactly one policy on ${table}`);
    assert.equal(matches[0].cmd, 'select');
    assert.match(matches[0].body, /current_user_has_any_role\(\)/);
  }
});

test('receipts and secure-documents: select, insert, delete all require an internal account', () => {
  for (const bucket of ['receipts', 'secure-documents']) {
    for (const cmd of ['select', 'insert', 'delete']) {
      const matches = POLICIES.filter((p) => p.table === 'storage.objects' && p.cmd === cmd && p.body.includes(`'${bucket}'`));
      assert.equal(matches.length, 1, `expected exactly one ${cmd} policy for the ${bucket} bucket`);
      assert.match(matches[0].body, new RegExp(`bucket_id = '${bucket}' and public\\.current_user_has_any_role\\(\\)`));
    }
    // No UPDATE policy existed before for either bucket and none is added
    // here -- uploads don't use x-upsert, so none is needed.
    assert.equal(POLICIES.filter((p) => p.table === 'storage.objects' && p.cmd === 'update' && p.body.includes(`'${bucket}'`)).length, 0);
  }
});

// ---------------------------------------------------------------------------
// The legitimate path: the one staff UI that writes the CMS asks for the same
// permission the database now enforces, so anyone the UI lets in is allowed.
// ---------------------------------------------------------------------------

test('tools/site-content.html gates its editors on canManageSiteContent(), which reads the same column RLS checks', () => {
  const page = read('tools', 'site-content.html');
  const auth = read('tools', 'auth.js');
  assert.match(page, /const allowed = typeof canManageSiteContent === 'function' && canManageSiteContent\(\);/);
  assert.match(auth, /canManageSiteContent: !!row\.can_manage_site_content,/);
});

test('site-content.html writes with the signed-in session token, never the anon key alone', () => {
  const page = read('tools', 'site-content.html');
  const writes = page.match(/\/rest\/v1\/site_(content|faq|terms)[^'"]*['"][^)]*?method:\s*'(POST|PATCH|DELETE)'/g) || [];
  // Upsert of site_content (twice: save + restore), FAQ delete+insert, terms delete+insert.
  assert.ok(writes.length >= 4, `expected the CMS write call sites to still exist, found ${writes.length}`);
  assert.match(page, /'Authorization': 'Bearer ' \+ getAuthToken\(\)/);
});

test('no portal page or public page writes to the CMS tables or touches the private buckets', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(repo(dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'tests', 'tools', '.git', 'edge-functions', 'sql', 'backups', 'scripts', 'docs', '.claude', '.github'].includes(entry.name)) continue;
        walk(rel);
      } else if (/\.(html|js)$/.test(entry.name)) {
        const src = fs.readFileSync(repo(rel), 'utf8');
        if (/storage\/v1\/object[^'"`]*(receipts|secure-documents)/.test(src)) offenders.push(`${rel}: storage call to a private bucket`);
        const cmsWrite = /\/rest\/v1\/site_(content|faq|terms)[\s\S]{0,300}?method:\s*['"](POST|PATCH|PUT|DELETE)['"]/;
        if (cmsWrite.test(src)) offenders.push(`${rel}: writes to a CMS table`);
      }
    }
  };
  walk('.');
  assert.deepEqual(offenders, [], 'only internal /tools/ pages may do this -- the tightened policies would break anything else');
});
