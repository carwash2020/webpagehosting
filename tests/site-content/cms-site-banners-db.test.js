// sql/site-content/cms_site_banners.sql, run for real in PGlite on top of
// cms_safe_publish_and_undo.sql (see cms-db-harness.js).
//
// The banners became editable on 2026-09-23: each of the two slots has a
// mode (builtin / custom / off), the message it already had, and an
// optional link from a fixed list. The database refuses anything else on
// its own, so a banner can never show a made-up mode or link off the site,
// whatever writes the row. A save of all three undoes exactly.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  createCmsDb, closeAllCmsDbs, asUser, asAnon, rpc, readValue,
  OWNER_EMAIL, STAFF_NO_CMS_EMAIL, BANNER_MIGRATION_PATH,
} = require('./cms-db-harness');

after(closeAllCmsDbs);

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const BANNER_KEYS = ['banner1Mode', 'banner1', 'banner1Link', 'banner2Mode', 'banner2', 'banner2Link'];

async function bannerRows(db) {
  const r = await db.query('select key, value from public.site_content where key = any($1) order by key', [BANNER_KEYS]);
  return Object.fromEntries(r.rows.map(x => [x.key, x.value]));
}

async function directUpdate(db, key, value) {
  return asUser(db, OWNER_EMAIL, tx => tx.query('update public.site_content set value = $2 where key = $1', [key, value]));
}

test('seeds both modes as builtin (what the site shows today) and no links, as setup rows no one can "undo"', async () => {
  const db = await createCmsDb();
  assert.deepEqual(await bannerRows(db), {
    banner1: null, banner1Link: null, banner1Mode: 'builtin',
    banner2: null, banner2Link: null, banner2Mode: 'builtin',
  });
  const h = await db.query("select key, action, changed_by, new_value from public.site_content_history where key in ('banner1Mode','banner2Mode','banner1Link','banner2Link') order by key");
  assert.equal(h.rows.length, 4);
  for (const row of h.rows) {
    assert.equal(row.action, 'insert');
    assert.equal(row.changed_by, null, 'setup rows carry no person, so the editor never offers them as "your last save"');
  }
});

test('re-running the migration changes nothing and does not error', async () => {
  const db = await createCmsDb();
  await directUpdate(db, 'banner2Mode', 'off');
  await db.exec(fs.readFileSync(BANNER_MIGRATION_PATH, 'utf8'));
  assert.equal(await readValue(db, 'banner2Mode'), 'off', 'the seed never overwrites a saved choice');
});

test('every value already in the table still passes the updated check', async () => {
  const db = await createCmsDb();
  const bad = await db.query('select key from public.site_content where not public.site_content_value_is_valid(key, value)');
  assert.deepEqual(bad.rows, []);
});

test('the modes accept exactly builtin, custom, and off', async () => {
  const db = await createCmsDb();
  for (const key of ['banner1Mode', 'banner2Mode']) {
    for (const ok of ['builtin', 'custom', 'off', null]) {
      await directUpdate(db, key, ok);
      assert.equal(await readValue(db, key), ok);
    }
    for (const bad of ['Off', 'hidden', 'built-in', ' off', 'off ', 'custom\n', '']) {
      await assert.rejects(directUpdate(db, key, bad), (e) => e.code === '23514', `${key} = ${JSON.stringify(bad)} should be refused`);
    }
  }
});

test('the links accept only the three pages on the list -- never a typed URL', async () => {
  const db = await createCmsDb();
  for (const key of ['banner1Link', 'banner2Link']) {
    for (const ok of ['/booking.html', '/careers.html', '/our-work.html', null]) {
      await directUpdate(db, key, ok);
      assert.equal(await readValue(db, key), ok);
    }
    for (const bad of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/booking.html?x=1', '/careers', '/index.html', ' /booking.html', '']) {
      await assert.rejects(directUpdate(db, key, bad), (e) => e.code === '23514', `${key} = ${JSON.stringify(bad)} should be refused`);
    }
  }
});

test('the message keeps its old rules: one line, 200 characters at most', async () => {
  const db = await createCmsDb();
  await directUpdate(db, 'banner1', 'x'.repeat(200));
  await assert.rejects(directUpdate(db, 'banner1', 'x'.repeat(201)), (e) => e.code === '23514');
  await assert.rejects(directUpdate(db, 'banner1', 'two\nlines'), (e) => e.code === '23514');
});

test('SAVE then UNDO: turning a banner into a custom message with a link, then undoing, puts all three back exactly', async () => {
  const db = await createCmsDb();
  const before = await bannerRows(db);
  const saved = await rpc(db, OWNER_EMAIL, 'cms_publish_content', {
    p_changes: [
      { key: 'banner1Mode', expected: 'builtin', value: 'custom' },
      { key: 'banner1', expected: null, value: 'Closed Thanksgiving Day -- back Friday.' },
      { key: 'banner1Link', expected: null, value: '/booking.html' },
      { key: 'banner2Mode', expected: 'builtin', value: 'off' },
    ],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.length, 4);
  assert.equal(new Set(saved.body.map(r => r.batch_id)).size, 1, 'one save, one batch');
  assert.deepEqual(await bannerRows(db), {
    banner1: 'Closed Thanksgiving Day -- back Friday.', banner1Link: '/booking.html', banner1Mode: 'custom',
    banner2: null, banner2Link: null, banner2Mode: 'off',
  });

  const undone = await rpc(db, OWNER_EMAIL, 'cms_undo_content', { p_history_ids: saved.body.map(r => r.id) });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.deepEqual(await bannerRows(db), before);
});

test('a bad mode or link in a publish refuses the whole save, message included', async () => {
  const db = await createCmsDb();
  const res = await rpc(db, OWNER_EMAIL, 'cms_publish_content', {
    p_changes: [
      { key: 'banner1', expected: null, value: 'Fine message' },
      { key: 'banner1Link', expected: null, value: 'https://evil.example/' },
    ],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, '23514');
  assert.equal(await readValue(db, 'banner1'), null);
  assert.equal(await readValue(db, 'banner1Link'), null);
});

test('only site-content managers can change them; anyone can read them (the public pages do)', async () => {
  const db = await createCmsDb();
  const res = await rpc(db, STAFF_NO_CMS_EMAIL, 'cms_publish_content', {
    p_changes: [{ key: 'banner2Mode', expected: 'builtin', value: 'off' }],
  });
  assert.equal(res.status, 403);
  assert.equal(await readValue(db, 'banner2Mode'), 'builtin');
  const read = await asAnon(db, tx => tx.query("select key, value from public.site_content where key in ('banner1Mode', 'banner2Mode') order by key"));
  assert.deepEqual(read.rows, [{ key: 'banner1Mode', value: 'builtin' }, { key: 'banner2Mode', value: 'builtin' }]);
});

test('the link list is the same in the database, the public script, and the editor', () => {
  const sql = fs.readFileSync(BANNER_MIGRATION_PATH, 'utf8');
  const sqlLinks = sql.match(/p_key in \('banner1Link', 'banner2Link'\) then p_value in \(([^)]*)\)/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  const js = fs.readFileSync(repo('js/site-banners.js'), 'utf8');
  const jsLinks = [...js.match(/var LINKS = \{([\s\S]*?)\};/)[1].matchAll(/'(\/[^']+)':/g)].map(m => m[1]);
  const page = fs.readFileSync(repo('tools/site-content.html'), 'utf8');
  const pageLinks = [...page.match(/const BANNER_LINKS = \{([\s\S]*?)\};/)[1].matchAll(/'(\/[^']+)':/g)].map(m => m[1]);
  assert.deepEqual(sqlLinks, ['/booking.html', '/careers.html', '/our-work.html']);
  assert.deepEqual(jsLinks, sqlLinks);
  assert.deepEqual(pageLinks, sqlLinks);
  const sqlModes = sql.match(/p_key in \('banner1Mode', 'banner2Mode'\) then p_value in \(([^)]*)\)/)[1];
  assert.equal(sqlModes, "'builtin', 'custom', 'off'");
});
