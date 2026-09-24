// sql/site-content/cms_faq_terms_safe_publish.sql, run for real in PGlite
// on top of site_faq / site_terms as they were live before it (see
// cms-db-harness.js).
//
// Headline: one save that edits, adds, deletes, and reorders FAQ items,
// then Undo -- and every row is back exactly: same ids, same text, same
// category, same order. Before this, "Save all" deleted and re-inserted
// every row, so ids changed on every save and no edit could be undone.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createCmsDb, closeAllCmsDbs, asUser, asAnon, rpc, OWNER_EMAIL, DEV_EMAIL, PORTAL_EMAIL, STAFF_NO_CMS_EMAIL, LIST_MIGRATION_PATH } = require('./cms-db-harness');

after(closeAllCmsDbs);

async function faqRows(db) {
  const r = await db.query('select id, question, answer, category, sort_order from public.site_faq order by sort_order, id');
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}
async function termsRows(db) {
  const r = await db.query('select id, heading, body, sort_order from public.site_terms order by sort_order, id');
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}
const itemsFrom = (rows) => rows.map(r => ({ id: r.id, question: r.question, answer: r.answer, category: r.category }));

test('the migration applies on the live shape, keeps every row, and is safe to re-run', async () => {
  const db = await createCmsDb();
  const before = await faqRows(db);
  assert.equal(before.length, 4);
  await db.exec(fs.readFileSync(LIST_MIGRATION_PATH, 'utf8'));
  assert.deepEqual(await faqRows(db), before);
  const def = await db.query("select condeferrable from pg_constraint where conname in ('site_faq_question_unique','site_terms_heading_unique')");
  assert.deepEqual(def.rows.map(r => r.condeferrable), [true, true]);
});

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

test('FAQ: edit + add + delete + reorder in one save, then UNDO restores every row exactly (ids, text, category, order)', async () => {
  const db = await createCmsDb();
  const original = await faqRows(db);
  const [a, b, c, d] = original;

  const desired = [
    { id: c.id, question: c.question, answer: c.answer, category: c.category },            // moved to the top
    { id: a.id, question: a.question, answer: 'Free within 15 miles; $25 beyond.', category: a.category }, // edited
    { question: 'Do you haul away old appliances?', answer: 'Yes, for a small fee.', category: 'Policies' }, // added
    { id: d.id, question: d.question, answer: d.answer, category: d.category },
    // b removed
  ];
  const pub = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: original, p_items: desired });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const batch = new Set(pub.body.map(h => h.batch_id));
  assert.equal(batch.size, 1, 'one save = one batch');
  const actions = pub.body.map(h => h.action).sort();
  assert.ok(actions.includes('delete') && actions.includes('insert') && actions.includes('update'));

  const afterPub = await faqRows(db);
  assert.deepEqual(afterPub.map(r => r.question), [c.question, a.question, 'Do you haul away old appliances?', d.question]);
  assert.equal(afterPub[1].id, a.id, 'an edited item keeps its id');
  assert.equal(afterPub[1].answer, 'Free within 15 miles; $25 beyond.');
  assert.deepEqual(afterPub.map(r => r.sort_order), [1, 2, 3, 4]);

  const undo = await rpc(db, OWNER_EMAIL, 'cms_undo_faq', { p_batch_id: [...batch][0] });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.ok(undo.body.every(h => h.undo_of !== null));
  assert.deepEqual(await faqRows(db), original, 'every row back exactly as it was');
});

test('Terms: edit + delete + add, then UNDO restores every section exactly', async () => {
  const db = await createCmsDb();
  const original = await termsRows(db);
  const [x, y, z] = original;
  const pub = await rpc(db, DEV_EMAIL, 'cms_publish_terms', {
    p_expected: original,
    p_items: [
      { id: x.id, heading: x.heading, body: x.body },
      { id: z.id, heading: '2. Payment terms', body: 'Payment is due when the work is done.' },
      { heading: '3. Warranty', body: '30-day labor warranty.' },
    ],
  });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const t = await termsRows(db);
  assert.deepEqual(t.map(r => r.heading), ['Business Information', '2. Payment terms', '3. Warranty']);
  assert.equal(t[1].id, z.id);
  assert.ok(!t.some(r => r.id === y.id));

  const undo = await rpc(db, DEV_EMAIL, 'cms_undo_terms', { p_batch_id: pub.body[0].batch_id });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.deepEqual(await termsRows(db), original);
});

test('two questions swapping wording in one save works (the unique constraint is deferred inside a publish)', async () => {
  const db = await createCmsDb();
  const original = await faqRows(db);
  const [a, b] = original;
  const items = itemsFrom(original);
  items[0] = { ...items[0], question: b.question };
  items[1] = { ...items[1], question: a.question };
  const pub = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: original, p_items: items });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const rows = await faqRows(db);
  assert.equal(rows[0].question, b.question);
  assert.equal(rows[1].question, a.question);
  // and a real duplicate is still refused
  const dup = itemsFrom(rows);
  dup[2] = { ...dup[2], question: dup[3].question };
  const bad = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: rows, p_items: dup });
  assert.equal(bad.status, 400);
  assert.deepEqual(await faqRows(db), rows);
});

test('publishing an unchanged list writes nothing', async () => {
  const db = await createCmsDb();
  const original = await faqRows(db);
  const pub = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: original, p_items: itemsFrom(original) });
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.body, []);
});

// ---------------------------------------------------------------------------
// Never clobbering a newer edit
// ---------------------------------------------------------------------------

test('a stale editor cannot overwrite a newer FAQ edit: publish with an out-of-date list is refused (409), nothing changes', async () => {
  const db = await createCmsDb();
  const loaded = await faqRows(db);
  // Someone else edits item 1 first.
  const other = itemsFrom(loaded);
  other[0] = { ...other[0], answer: 'Updated by Steve.' };
  assert.equal((await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: other })).status, 200);
  const newer = await faqRows(db);

  const mine = itemsFrom(loaded);
  mine[2] = { ...mine[2], answer: 'Edited in a stale tab.' };
  const stale = await rpc(db, DEV_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: mine });
  assert.equal(stale.status, 409);
  assert.deepEqual(await faqRows(db), newer);
});

test('undo is refused (409) if a row it would revert has changed since', async () => {
  const db = await createCmsDb();
  const loaded = await faqRows(db);
  const edit = itemsFrom(loaded);
  edit[0] = { ...edit[0], answer: 'First change.' };
  const first = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: edit });
  const mid = await faqRows(db);
  const edit2 = itemsFrom(mid);
  edit2[0] = { ...edit2[0], answer: 'Second change.' };
  await rpc(db, DEV_EMAIL, 'cms_publish_faq', { p_expected: mid, p_items: edit2 });
  const latest = await faqRows(db);

  const undo = await rpc(db, OWNER_EMAIL, 'cms_undo_faq', { p_batch_id: first.body[0].batch_id });
  assert.equal(undo.status, 409);
  assert.deepEqual(await faqRows(db), latest);
});

test('undoing the same save twice is refused rather than toggling', async () => {
  const db = await createCmsDb();
  const loaded = await faqRows(db);
  const edit = itemsFrom(loaded);
  edit[1] = { ...edit[1], answer: 'Changed.' };
  const pub = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: edit });
  assert.equal((await rpc(db, OWNER_EMAIL, 'cms_undo_faq', { p_batch_id: pub.body[0].batch_id })).status, 200);
  assert.equal((await rpc(db, OWNER_EMAIL, 'cms_undo_faq', { p_batch_id: pub.body[0].batch_id })).status, 409);
  assert.deepEqual(await faqRows(db), loaded);
});

// ---------------------------------------------------------------------------
// Bad input
// ---------------------------------------------------------------------------

const BAD_FAQ = [
  ['a blank answer (the old editor silently DELETED such an item)', (i) => ({ ...i, answer: '   ' })],
  ['a blank question', (i) => ({ ...i, question: '' })],
  ['a question with a line break', (i) => ({ ...i, question: 'Line one\nline two' })],
  ['a 301-character question', (i) => ({ ...i, question: 'x'.repeat(301) })],
  ['a 4001-character answer', (i) => ({ ...i, answer: 'x'.repeat(4001) })],
  ['an 81-character category', (i) => ({ ...i, category: 'x'.repeat(81) })],
];
for (const [label, mutate] of BAD_FAQ) {
  test(`the database refuses ${label}, and the whole save rolls back`, async () => {
    const db = await createCmsDb();
    const loaded = await faqRows(db);
    const items = itemsFrom(loaded);
    items[0] = { ...items[0], answer: 'A valid change in the same save.' };
    items[2] = mutate(items[2]);
    const res = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: items });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.deepEqual(await faqRows(db), loaded);
  });
}

test('an item id that doesn\'t exist, or the same id twice, is refused', async () => {
  const db = await createCmsDb();
  const loaded = await faqRows(db);
  const ghost = itemsFrom(loaded).concat([{ id: 999999, question: 'Ghost?', answer: 'Boo.', category: 'Policies' }]);
  assert.equal((await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: ghost })).status, 400);
  const twice = itemsFrom(loaded).concat([itemsFrom(loaded)[0]]);
  assert.equal((await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: twice })).status, 400);
  assert.deepEqual(await faqRows(db), loaded);
});

test('a blank category becomes "General", like the old editor did', async () => {
  const db = await createCmsDb();
  const loaded = await faqRows(db);
  const items = itemsFrom(loaded).concat([{ question: 'New?', answer: 'Yes.', category: '  ' }]);
  assert.equal((await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: items })).status, 200);
  assert.equal((await faqRows(db)).at(-1).category, 'General');
});

test('undo for history written before this migration (no row images) is refused, not guessed', async () => {
  const db = await createCmsDb();
  const res = await rpc(db, OWNER_EMAIL, 'cms_undo_faq', { p_batch_id: null });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Access and history
// ---------------------------------------------------------------------------

for (const [who, email] of [['a client portal account', PORTAL_EMAIL], ['staff without the Site content permission', STAFF_NO_CMS_EMAIL]]) {
  test(`${who} can neither publish nor undo the FAQ or Terms`, async () => {
    const db = await createCmsDb();
    const loaded = await faqRows(db);
    const items = itemsFrom(loaded);
    items[0] = { ...items[0], answer: 'Hijacked.' };
    assert.equal((await rpc(db, email, 'cms_publish_faq', { p_expected: loaded, p_items: items })).status, 403);
    const terms = await termsRows(db);
    assert.equal((await rpc(db, email, 'cms_publish_terms', { p_expected: terms, p_items: terms.map(t => ({ id: t.id, heading: t.heading, body: 'x' })) })).status, 403);
    const pub = await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: items });
    assert.equal((await rpc(db, email, 'cms_undo_faq', { p_batch_id: pub.body[0].batch_id })).status, 403);
  });
}

test('anon (the public site) still reads both lists but cannot call any of the four functions', async () => {
  const db = await createCmsDb();
  const faq = await asAnon(db, tx => tx.query('select question from public.site_faq order by sort_order'));
  assert.equal(faq.rows.length, 4);
  for (const call of [
    "select * from public.cms_publish_faq('[]'::jsonb, '[]'::jsonb)",
    "select * from public.cms_publish_terms('[]'::jsonb, '[]'::jsonb)",
    "select * from public.cms_undo_faq(gen_random_uuid())",
    "select * from public.cms_undo_terms(gen_random_uuid())",
  ]) {
    await assert.rejects(asAnon(db, tx => tx.query(call)), err => err.code === '42501', call);
  }
});

test('a direct write outside the functions is still logged with full row images and a batch', async () => {
  const db = await createCmsDb();
  await asUser(db, DEV_EMAIL, tx => tx.query("update public.site_faq set category = 'Policies' where sort_order = 1"));
  const h = await db.query("select action, batch_id, old_row, new_row from public.site_faq_history where action = 'update'");
  assert.equal(h.rows.length, 1, 'a category-only change is logged now (it wasn\'t before)');
  assert.ok(h.rows[0].batch_id);
  assert.equal(h.rows[0].old_row.category, 'Pricing & Payment');
  assert.equal(h.rows[0].new_row.category, 'Policies');
});
