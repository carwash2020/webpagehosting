// Tests for adding rollback to uploadJobPhoto() on partial failure
// (audit item #13). Uploading a photo to Storage and inserting its
// th_job_photos metadata row are two separate requests with no
// transaction across them -- previously, if the file made it into
// Storage but the metadata insert then failed (a non-ok response OR a
// thrown network error, e.g. a timeout after the insert request was
// already sent), the object was left permanently orphaned: invisible
// to the app (nothing in th_job_photos points at it, so nothing in
// the UI ever lists it, views it, or lets it be deleted) but still
// taking up real storage space forever.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SYNC_JS = fs.readFileSync(path.join(repo('tools'), 'sync.js'), 'utf8');

test('sync.js: uploadJobPhoto rolls back (deletes from Storage) when the metadata insert fails', () => {
  const fnMatch = SYNC_JS.match(/async function uploadJobPhoto\(file, jobId, jobTitle, photoType\)[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to isolate uploadJobPhoto()');
  assert.match(fnMatch[0], /if \(!insertRes\.ok\) \{\s*\n\s*await rollbackUpload\(\);/);
});

function loadUploadJobPhoto() {
  const fnSrc = SYNC_JS.match(/async function uploadJobPhoto\(file, jobId, jobTitle, photoType\)[\s\S]*?\n\}/)[0];
  const sandbox = {
    isSyncConfigured: () => true,
    getAuthToken: () => 'fake-token',
    ensureFreshToken: undefined, // matches production: `typeof ensureFreshToken === 'function'` gates its use
    fetch: (...args) => global.fetch(...args),
  };
  const src = fnSrc + '\nsandbox.uploadJobPhoto = uploadJobPhoto;';
  // eslint-disable-next-line no-new-func
  new Function(
    'sandbox', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'JOB_PHOTOS_BUCKET', 'MAX_PHOTO_BYTES',
    'isSyncConfigured', 'getAuthToken', 'fetch',
    src
  )(
    sandbox, 'https://example-project.supabase.co', 'fake-anon-key', 'job-photos', 10 * 1024 * 1024,
    sandbox.isSyncConfigured, sandbox.getAuthToken, sandbox.fetch
  );
  return sandbox.uploadJobPhoto;
}

function fakeFile() {
  return { name: 'photo.jpg', type: 'image/jpeg', size: 1024 };
}

test('a successful upload and metadata insert never triggers a rollback delete', async () => {
  const uploadJobPhoto = loadUploadJobPhoto();
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (opts.method === 'POST' && url.includes('/storage/v1/object/')) return { ok: true };
    if (opts.method === 'POST' && url.includes('/rest/v1/th_job_photos')) {
      return { ok: true, json: async () => [{ id: 1, storage_path: 'job-42/1.jpg' }] };
    }
    throw new Error('unexpected fetch: ' + url);
  };

  const result = await uploadJobPhoto(fakeFile(), 42, 'Fix washer', 'photo');

  assert.equal(result.ok, true);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0, 'no rollback delete should happen on success');
});

test('a metadata insert HTTP failure after a successful upload deletes the just-uploaded file from Storage', async () => {
  const uploadJobPhoto = loadUploadJobPhoto();
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (opts.method === 'POST' && url.includes('/storage/v1/object/')) return { ok: true };
    if (opts.method === 'POST' && url.includes('/rest/v1/th_job_photos')) return { ok: false, status: 500 };
    if (opts.method === 'DELETE' && url.includes('/storage/v1/object/')) return { ok: true };
    throw new Error('unexpected fetch: ' + url);
  };

  const result = await uploadJobPhoto(fakeFile(), 42, 'Fix washer', 'photo');

  assert.equal(result.ok, false);
  assert.equal(result.error, 'metadata-http-500');
  const deleteCalls = calls.filter(c => c.method === 'DELETE');
  assert.equal(deleteCalls.length, 1, 'exactly one rollback delete should have been sent');
  assert.match(deleteCalls[0].url, /\/storage\/v1\/object\/job-photos\/job-42\//);
});

test('a thrown network error during the metadata insert (after a successful upload) also triggers rollback, not just a non-ok response', async () => {
  const uploadJobPhoto = loadUploadJobPhoto();
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (opts.method === 'POST' && url.includes('/storage/v1/object/')) return { ok: true };
    if (opts.method === 'POST' && url.includes('/rest/v1/th_job_photos')) throw new Error('network timeout');
    if (opts.method === 'DELETE' && url.includes('/storage/v1/object/')) return { ok: true };
    throw new Error('unexpected fetch: ' + url);
  };

  const result = await uploadJobPhoto(fakeFile(), 42, 'Fix washer', 'photo');

  assert.equal(result.ok, false);
  assert.equal(result.error, 'network');
  const deleteCalls = calls.filter(c => c.method === 'DELETE');
  assert.equal(deleteCalls.length, 1, 'a thrown error after a successful upload must still roll back the orphaned file');
});

test('an upload that itself fails never attempts a rollback delete (nothing was actually uploaded to clean up)', async () => {
  const uploadJobPhoto = loadUploadJobPhoto();
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (opts.method === 'POST' && url.includes('/storage/v1/object/')) return { ok: false, status: 507 };
    throw new Error('unexpected fetch: ' + url);
  };

  const result = await uploadJobPhoto(fakeFile(), 42, 'Fix washer', 'photo');

  assert.equal(result.ok, false);
  assert.equal(result.error, 'upload-http-507');
  assert.equal(calls.length, 1, 'only the upload attempt should have fired, no metadata insert or rollback delete');
});

test('a failed rollback delete does not mask the real metadata-insert error being reported', async () => {
  const uploadJobPhoto = loadUploadJobPhoto();
  global.fetch = async (url, opts) => {
    if (opts.method === 'POST' && url.includes('/storage/v1/object/')) return { ok: true };
    if (opts.method === 'POST' && url.includes('/rest/v1/th_job_photos')) return { ok: false, status: 500 };
    if (opts.method === 'DELETE' && url.includes('/storage/v1/object/')) throw new Error('rollback also failed');
    throw new Error('unexpected fetch: ' + url);
  };

  const result = await uploadJobPhoto(fakeFile(), 42, 'Fix washer', 'photo');

  assert.equal(result.ok, false);
  assert.equal(result.error, 'metadata-http-500', 'the original failure reason must still surface even if the best-effort rollback itself throws');
});
