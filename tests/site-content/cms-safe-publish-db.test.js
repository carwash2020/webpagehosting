// sql/site-content/cms_safe_publish_and_undo.sql, run for real in PGlite
// (see cms-db-harness.js for why real Postgres rather than a fake).
//
// The headline test is the one the safety design exists for: save a value
// through the same RPC the editor uses, undo it, and confirm the original
// is back exactly. Around it: the database refuses bad values on its own,
// a stale editor can't clobber a newer edit, an undo can't clobber a newer
// edit either, and only accounts with can_manage_site_content can write.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const {
  createCmsDb, closeAllCmsDbs, asUser, asAnon, rpc, readValue,
  OWNER_EMAIL, DEV_EMAIL, PORTAL_EMAIL, STAFF_NO_CMS_EMAIL, MIGRATION_PATH,
} = require('./cms-db-harness');

after(closeAllCmsDbs);

async function history(db, key) {
  const r = await db.query('select * from public.site_content_history where key = $1 order by id', [key]);
  return r.rows;
}

// ---------------------------------------------------------------------------
// Migration shape
// ---------------------------------------------------------------------------

test('the migration applies cleanly on top of the live schema and live rows, and is safe to re-run', async () => {
  const db = await createCmsDb();
  // Live Sunday value predates the constraint and must still pass it.
  assert.equal(await readValue(db, 'hoursSunday'), '2:00 pm - 8:00 pm');
  // Re-running must not error or duplicate the seed rows.
  await db.exec(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  const seeds = await db.query("select key, value from public.site_content where key in ('googleRating','googleReviewCount') order by key");
  assert.deepEqual(seeds.rows, [
    { key: 'googleRating', value: '5.0' },
    { key: 'googleReviewCount', value: '7' },
  ]);
});

test('seeds the review fields with the values hardcoded on the public site today (5.0 from 7)', async () => {
  const db = await createCmsDb();
  assert.equal(await readValue(db, 'googleRating'), '5.0');
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
  const h = await history(db, 'googleReviewCount');
  assert.equal(h.length, 1);
  assert.equal(h[0].action, 'insert');
  assert.equal(h[0].new_value, '7');
});

// ---------------------------------------------------------------------------
// The headline test: save, undo, original back exactly
// ---------------------------------------------------------------------------

test('SAVE then UNDO restores the original value exactly (review count 7 -> 8 -> 7)', async () => {
  const db = await createCmsDb();
  assert.equal(await readValue(db, 'googleReviewCount'), '7');

  const saved = await rpc(db, OWNER_EMAIL, 'cms_publish_content', {
    p_changes: [{ key: 'googleReviewCount', expected: '7', value: '8' }],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.length, 1);
  assert.equal(saved.body[0].old_value, '7');
  assert.equal(saved.body[0].new_value, '8');
  assert.equal(saved.body[0].changed_by, OWNER_EMAIL);
  assert.equal(await readValue(db, 'googleReviewCount'), '8');

  const undone = await rpc(db, OWNER_EMAIL, 'cms_undo_content', { p_history_ids: [saved.body[0].id] });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.length, 1);
  assert.equal(undone.body[0].undo_of, saved.body[0].id);
  assert.equal(undone.body[0].old_value, '8');
  assert.equal(undone.body[0].new_value, '7');

  const back = await readValue(db, 'googleReviewCount');
  assert.equal(back, '7');
  assert.equal(typeof back, 'string');
});

test('undoing a save that changed several fields reverts all of them together, including a blank one', async () => {
  const db = await createCmsDb();
  const saved = await rpc(db, OWNER_EMAIL, 'cms_publish_content', {
    p_changes: [
      { key: 'googleRating', expected: '5.0', value: '4.9' },
      { key: 'googleReviewCount', expected: '7', value: '12' },
      { key: 'banner1', expected: null, value: 'Closed Thanksgiving Day' },
    ],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.length, 3);
  const batchIds = new Set(saved.body.map(r => r.batch_id));
  assert.equal(batchIds.size, 1, 'one save = one batch');

  const undone = await rpc(db, DEV_EMAIL, 'cms_undo_content', { p_history_ids: saved.body.map(r => r.id) });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(await readValue(db, 'googleRating'), '5.0');
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
  assert.equal(await readValue(db, 'banner1'), null, 'a banner that was blank goes back to blank (NULL), not ""');
});

test('undoing twice is refused rather than toggling the value back', async () => {
  const db = await createCmsDb();
  const saved = await rpc(db, OWNER_EMAIL, 'cms_publish_content', {
    p_changes: [{ key: 'googleReviewCount', expected: '7', value: '8' }],
  });
  const first = await rpc(db, OWNER_EMAIL, 'cms_undo_content', { p_history_ids: [saved.body[0].id] });
  assert.equal(first.status, 200);
  const second = await rpc(db, OWNER_EMAIL, 'cms_undo_content', { p_history_ids: [saved.body[0].id] });
  assert.equal(second.status, 409);
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
});

// ---------------------------------------------------------------------------
// Compare-and-swap: no silent clobbering
// ---------------------------------------------------------------------------

test('a stale editor cannot overwrite a newer edit: publish with the wrong "expected" is refused (409) and changes nothing', async () => {
  const db = await createCmsDb();
  // Steve updates the count on his phone...
  await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'googleReviewCount', expected: '7', value: '8' }] });
  // ...while Connor's tab still shows 7 and he edits the rating plus the count.
  const stale = await rpc(db, DEV_EMAIL, 'cms_publish_content', {
    p_changes: [
      { key: 'googleRating', expected: '5.0', value: '4.9' },
      { key: 'googleReviewCount', expected: '7', value: '9' },
    ],
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.details, 'googleReviewCount');
  assert.equal(await readValue(db, 'googleReviewCount'), '8', "Steve's newer edit survives");
  assert.equal(await readValue(db, 'googleRating'), '5.0', 'all-or-nothing: the valid rating change in the same save was rolled back too');
});

test('an undo cannot clobber a newer edit: if the field changed again since, the undo is refused (409)', async () => {
  const db = await createCmsDb();
  const first = await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'googleReviewCount', expected: '7', value: '8' }] });
  await rpc(db, DEV_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'googleReviewCount', expected: '8', value: '9' }] });
  const undo = await rpc(db, OWNER_EMAIL, 'cms_undo_content', { p_history_ids: [first.body[0].id] });
  assert.equal(undo.status, 409);
  assert.equal(await readValue(db, 'googleReviewCount'), '9');
});

test('publishing an unchanged value writes nothing and logs nothing', async () => {
  const db = await createCmsDb();
  const before = (await history(db, 'googleRating')).length;
  const res = await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'googleRating', expected: '5.0', value: '5.0' }] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
  assert.equal((await history(db, 'googleRating')).length, before);
});

test('an unknown field is refused -- new fields ship with a migration, never from the browser', async () => {
  const db = await createCmsDb();
  const res = await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'heroHeadline', expected: null, value: 'Hi' }] });
  assert.equal(res.status, 400);
  assert.equal(await readValue(db, 'heroHeadline'), undefined);
});

test('the same field listed twice in one publish is refused', async () => {
  const db = await createCmsDb();
  const res = await rpc(db, OWNER_EMAIL, 'cms_publish_content', {
    p_changes: [
      { key: 'googleReviewCount', expected: '7', value: '8' },
      { key: 'googleReviewCount', expected: '8', value: '9' },
    ],
  });
  assert.equal(res.status, 400);
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
});

// ---------------------------------------------------------------------------
// The database refuses bad values on its own
// ---------------------------------------------------------------------------

const REJECTED = [
  ['googleRating', '5.1'], ['googleRating', '6.0'], ['googleRating', '0.5'], ['googleRating', '-1'],
  ['googleRating', '5'], ['googleRating', '4.85'], ['googleRating', 'five stars!!'], ['googleRating', ' 5.0'],
  ['googleReviewCount', '-1'], ['googleReviewCount', '0'], ['googleReviewCount', '7.5'],
  ['googleReviewCount', 'seven'], ['googleReviewCount', '123456'], ['googleReviewCount', '07'],
  ['phone', 'call me'], ['phone', '435-414-1667'], ['phone', '(435) 414-166'], ['phone', '(035) 414-1667'],
  ['email', 'steve at triplehenterprisesllc.biz'], ['email', 'steve@'], ['email', '@triplehenterprisesllc.biz'],
  ['banner1', 'x'.repeat(201)], ['banner2', 'line one\nline two'],
  ['hoursMonday', 'x'.repeat(61)],
];

for (const [key, value] of REJECTED) {
  test(`the database refuses ${key} = ${JSON.stringify(value).slice(0, 40)} even when the page is bypassed`, async () => {
    const db = await createCmsDb();
    const before = await readValue(db, key);
    // Straight UPDATE as a permitted account -- no RPC, no page validation.
    await assert.rejects(
      asUser(db, OWNER_EMAIL, tx => tx.query('update public.site_content set value = $1 where key = $2', [value, key])),
      err => err.code === '23514',
    );
    assert.equal(await readValue(db, key), before);
  });
}

const ACCEPTED = [
  ['googleRating', '1.0'], ['googleRating', '4.9'], ['googleRating', '5.0'],
  ['googleReviewCount', '1'], ['googleReviewCount', '8'], ['googleReviewCount', '99999'],
  ['phone', '(435) 414-1667'], ['email', 'steve@triplehenterprisesllc.biz'],
  ['hoursMonday', '2:00 PM – 10:00 PM'], ['hoursSaturday', 'Closed'],
  ['banner1', 'Now booking weekends in October'], ['banner2', null],
];

test('the database accepts every well-formed value the editor can produce', async () => {
  const db = await createCmsDb();
  for (const [key, value] of ACCEPTED) {
    await asUser(db, OWNER_EMAIL, tx => tx.query('update public.site_content set value = $1 where key = $2', [value, key]));
    assert.equal(await readValue(db, key), value, key);
  }
});

test('an invalid value inside a multi-field publish rolls back the whole publish', async () => {
  const db = await createCmsDb();
  const res = await rpc(db, OWNER_EMAIL, 'cms_publish_content', {
    p_changes: [
      { key: 'googleReviewCount', expected: '7', value: '8' },
      { key: 'googleRating', expected: '5.0', value: '6.0' },
    ],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, '23514');
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
  assert.equal(await readValue(db, 'googleRating'), '5.0');
});

// ---------------------------------------------------------------------------
// Access: same gate as the page (can_manage_site_content), enforced here too
// ---------------------------------------------------------------------------

for (const [who, email] of [['a client portal account', PORTAL_EMAIL], ['a staff account without the Site content permission', STAFF_NO_CMS_EMAIL]]) {
  test(`${who} can neither publish nor undo`, async () => {
    const db = await createCmsDb();
    const pub = await rpc(db, email, 'cms_publish_content', { p_changes: [{ key: 'phone', expected: null, value: '(555) 555-0100' }] });
    assert.equal(pub.status, 403);
    const saved = await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'googleReviewCount', expected: '7', value: '8' }] });
    const undo = await rpc(db, email, 'cms_undo_content', { p_history_ids: [saved.body[0].id] });
    assert.equal(undo.status, 403);
    assert.equal(await readValue(db, 'phone'), null);
    assert.equal(await readValue(db, 'googleReviewCount'), '8');
  });
}

test('anon (the public site) can still read every field but cannot call either function', async () => {
  const db = await createCmsDb();
  const rows = await asAnon(db, tx => tx.query("select key, value from public.site_content where key in ('googleRating','googleReviewCount') order by key"));
  assert.deepEqual(rows.rows, [{ key: 'googleRating', value: '5.0' }, { key: 'googleReviewCount', value: '7' }]);
  await assert.rejects(
    asAnon(db, tx => tx.query("select * from public.cms_publish_content('[{\"key\":\"phone\",\"expected\":null,\"value\":\"(555) 555-0100\"}]'::jsonb)")),
    err => err.code === '42501',
  );
  await assert.rejects(asAnon(db, tx => tx.query('select * from public.cms_undo_content(array[1]::bigint[])')), err => err.code === '42501');
});

// ---------------------------------------------------------------------------
// History is complete, whatever wrote the change
// ---------------------------------------------------------------------------

test('a direct write outside the RPC (SQL editor, an old cached page) is still logged, one batch per transaction', async () => {
  const db = await createCmsDb();
  await asUser(db, DEV_EMAIL, async tx => {
    await tx.query("update public.site_content set value = '(435) 414-1667' where key = 'phone'");
    await tx.query("update public.site_content set value = 'steve@triplehenterprisesllc.biz' where key = 'email'");
  });
  const r = await db.query("select key, action, batch_id, changed_by from public.site_content_history where key in ('phone','email') order by id");
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows[0].batch_id);
  assert.equal(r.rows[0].batch_id, r.rows[1].batch_id);
  assert.equal(r.rows[0].changed_by, DEV_EMAIL);
});

test('deletes are logged now too (previously only updates were)', async () => {
  const db = await createCmsDb();
  await db.query("delete from public.site_content where key = 'hoursLine1'");
  const h = await history(db, 'hoursLine1');
  assert.equal(h.length, 1);
  assert.equal(h[0].action, 'delete');
});
