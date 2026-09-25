// 2026-09-23 backend audit, LOW (docs/ACTION-ITEMS.md manual item #17):
// the work-order-photos bucket's INSERT policy checked bucket_id alone, so
// any signed-in account could upload any file at any path there. Fixed
// 2026-09-25: portal/work-orders.html now uploads under
// submissions/<auth.uid()>/<submission folder>/, and the policy only
// accepts that shape for the caller's own id. The bucket also got the
// page's own limits (8 MB, images only).
//
// The live fix was verified directly against the database with
// rolled-back probes under simulated JWTs (write-up:
// docs/specialist-logs/security.md, 2026-09-25 entry). These tests pin the
// migration mirror and, more importantly, run the page's real upload code
// against a port of the policy, so the page and the policy can't drift
// apart and quietly break every client's photo upload.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');

const SQL = read('sql', 'security', 'scope_work_order_photo_uploads_to_own_folder.sql');
const STATEMENTS = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const PAGE = read('portal', 'work-orders.html');

const INSERT_POLICY = (() => {
  const m = STATEMENTS.match(/create policy "([^"]+)"\s+on storage\.objects for insert to (\w+)\s+with check \(([\s\S]*?)\);/);
  return m && { name: m[1], role: m[2], check: m[3] };
})();

// Port of the policy's WITH CHECK, using storage.foldername()'s real
// definition (read from the live project): split on "/", drop the last
// segment. 1-indexed in SQL, 0-indexed here.
function policyAllows(objectName, callerUid) {
  const folders = objectName.split('/').slice(0, -1);
  return folders.length === 3 && folders[0] === 'submissions' && folders[1] === String(callerUid);
}

// Runs the page's real uploadSelectedPhotos() in a sandbox with a fake
// session and fetch, and returns every object path it tried to write.
async function runUploadSelectedPhotos({ session, photos }) {
  const fnSrc = PAGE.match(/async function uploadSelectedPhotos\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnSrc, 'uploadSelectedPhotos() not found in portal/work-orders.html');
  const calls = [];
  const sandbox = {
    selectedPhotos: photos,
    client: { auth: { getSession: async () => ({ data: { session } }) } },
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; },
    Date, Math, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc[0] + '\nthis.__run = uploadSelectedPhotos;', sandbox);
  let result, error;
  try { result = await sandbox.__run(); } catch (e) { error = e; }
  const prefix = 'https://csvfqdjuobylgafgolho.supabase.co/storage/v1/object/work-order-photos/';
  const objectNames = calls.map((c) => {
    assert.ok(c.url.startsWith(prefix), `unexpected upload URL ${c.url}`);
    return c.url.slice(prefix.length);
  });
  return { calls, objectNames, result, error };
}

const CLIENT_A = '7553e1fc-3be2-43d2-8b9b-bd8615d99b6a';
const CLIENT_B = '4826b6db-951c-48ee-b1ec-889af3ff240e';
const fakeFile = (name, type = 'image/jpeg') => ({ name, type, size: 1000 });

// ---- the migration ----

test('the old bucket_id-only INSERT policy is dropped', () => {
  assert.ok(STATEMENTS.includes('drop policy if exists "authenticated clients can upload work order photos" on storage.objects;'));
});

test('the new INSERT policy requires submissions/<caller uid>/<one folder>/<file>', () => {
  assert.ok(INSERT_POLICY, 'expected one create policy ... for insert on storage.objects');
  assert.equal(INSERT_POLICY.role, 'authenticated');
  const check = INSERT_POLICY.check.replace(/\s+/g, ' ');
  assert.match(check, /bucket_id = 'work-order-photos'/);
  assert.match(check, /array_length\(storage\.foldername\(name\), 1\) = 3/);
  assert.match(check, /\(storage\.foldername\(name\)\)\[1\] = 'submissions'/);
  // (select auth.uid()) -- the initplan-wrapped form every policy here uses.
  assert.match(check, /\(storage\.foldername\(name\)\)\[2\] = \(select auth\.uid\(\)\)::text/);
  assert.doesNotMatch(check, /\btrue\b/i);
});

test('the migration adds no UPDATE or DELETE policy, so an object still cannot be overwritten or removed by a client', () => {
  assert.equal((STATEMENTS.match(/create policy/gi) || []).length, 1);
  assert.doesNotMatch(STATEMENTS, /for (update|delete|all)\b/i);
});

test('the bucket gets the page\'s own limits: 8 MB per file, images only', () => {
  const m = STATEMENTS.match(/update storage\.buckets\s+set file_size_limit = (\d+),\s+allowed_mime_types = array\['([^']+)'\]\s+where id = 'work-order-photos';/);
  assert.ok(m, 'expected the bucket update');
  const pageMax = PAGE.match(/const MAX_WO_PHOTO_BYTES = (\d+) \* (\d+) \* (\d+);/);
  assert.ok(pageMax);
  assert.equal(Number(m[1]), Number(pageMax[1]) * Number(pageMax[2]) * Number(pageMax[3]),
    'server limit must match the page limit, or a photo the page accepts gets rejected');
  assert.equal(m[2], 'image/*');
  assert.match(PAGE, /<input type="file" id="woPhotoInput" accept="image\/\*"/);
});

// ---- the page, run for real against the policy ----

test('every path the page uploads to passes the policy for the signed-in user', async () => {
  const { objectNames, result, error } = await runUploadSelectedPhotos({
    session: { access_token: 'tok-a', user: { id: CLIENT_A } },
    photos: [fakeFile('a.JPG'), fakeFile('b.png', 'image/png'), fakeFile('c.heic', '')],
  });
  assert.equal(error, undefined);
  assert.equal(objectNames.length, 3);
  for (const name of objectNames) {
    assert.ok(policyAllows(name, CLIENT_A), `${name} would be rejected for its own uploader`);
    assert.ok(!policyAllows(name, CLIENT_B), `${name} must not be writable by a different account`);
  }
  // One folder per submission, shared by all its photos.
  assert.equal(new Set(objectNames.map((n) => n.split('/').slice(0, 3).join('/'))).size, 1);
  // What gets stored on the work order still starts with the bucket name,
  // which is what tools/clients.html strips before signing a URL.
  assert.deepEqual(Array.from(result), objectNames.map((n) => 'work-order-photos/' + n));
  assert.match(read('tools', 'clients.html'), /const path = fullPath\.replace\(\/\^work-order-photos\\\/\/, ''\);/);
});

test('the page sends the session token and an image content type on each upload', async () => {
  const { calls } = await runUploadSelectedPhotos({
    session: { access_token: 'tok-a', user: { id: CLIENT_A } },
    photos: [fakeFile('a.jpg'), fakeFile('b.heic', '')],
  });
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok-a');
  assert.equal(calls[0].opts.headers['Content-Type'], 'image/jpeg');
  // A file the browser couldn't type still goes up as an image, so the
  // bucket's image/* restriction doesn't reject it.
  assert.equal(calls[1].opts.headers['Content-Type'], 'image/jpeg');
  assert.ok(!('x-upsert' in calls[0].opts.headers), 'uploads never overwrite -- there is no UPDATE policy to allow it');
});

test('with no session the page uploads nothing, rather than sending a path the policy would reject', async () => {
  const { calls, error } = await runUploadSelectedPhotos({ session: null, photos: [fakeFile('a.jpg')] });
  assert.ok(error);
  assert.equal(calls.length, 0);
});

test('the old, unscoped path shape is rejected by the policy port (sanity check on the port itself)', () => {
  assert.ok(!policyAllows('submissions/1788445193579-dcz176/0.jpg', CLIENT_A));
  assert.ok(!policyAllows('anything/evil.exe', CLIENT_A));
  assert.ok(!policyAllows(`submissions/${CLIENT_A}/0.jpg`, CLIENT_A));
  assert.ok(!policyAllows(`submissions/${CLIENT_A}/a/b/0.jpg`, CLIENT_A));
  assert.ok(policyAllows(`submissions/${CLIENT_A}/1790000000000-abc123/0.jpg`, CLIENT_A));
});

test('portal/work-orders.html is the only code in the repo that uploads to this bucket', () => {
  const uploaders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(repo(dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'tests', '.git', 'backups', 'docs', '.claude'].includes(entry.name)) continue;
        walk(rel);
      } else if (/\.(html|js|ts)$/.test(entry.name)) {
        const src = fs.readFileSync(repo(rel), 'utf8');
        // Upload endpoint = /object/<bucket>/..., not /object/sign/ or /object/list/.
        if (/storage\/v1\/object\/work-order-photos\//.test(src) || /from\(['"]work-order-photos['"]\)\s*\.upload/.test(src)) uploaders.push(rel);
      }
    }
  };
  walk('.');
  assert.deepEqual(uploaders, [path.join('portal', 'work-orders.html')],
    'a new uploader has to use submissions/<auth.uid()>/<folder>/ too, or the policy rejects it');
});
