// Direct-insert lockdown (2026-09-23). th_bookings' old "Anyone can
// submit a booking" policy (anon + authenticated, WITH CHECK (true)) let
// anyone holding the public anon key insert a booking with ANY column set
// -- already 'cancelled', linked to someone else's job/quote/check-up, or
// with reminder_sent_at stamped so no reminder ever goes out -- and skip
// every check create_booking() makes. restrict_direct_booking_inserts.sql
// replaces it with a staff-only INSERT policy; the public books through
// create_booking(). Verified live in a rolled-back block before applying
// (anon/client direct insert -> 42501, the RPC still works, staff and the
// service role can still insert).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const SQL = read('sql', 'booking', 'restrict_direct_booking_inserts.sql');
const code = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

test('the open INSERT policy is dropped and nothing re-creates it', () => {
  assert.match(code(SQL), /drop policy if exists "Anyone can submit a booking" on public\.th_bookings;/);
  assert.doesNotMatch(code(SQL), /create policy "Anyone can submit a booking"/, 'only the commented-out rollback may mention it');
  assert.doesNotMatch(code(SQL), /with check \(true\)/);
  assert.doesNotMatch(code(SQL), /\bto anon\b/);
});

test('staff can still insert directly (the Dev Tools booking test), checked the same way as th_bookings\' other policies', () => {
  const policy = code(SQL).match(/create policy "Staff can add bookings directly"[\s\S]*?;/)[0];
  assert.match(policy, /on public\.th_bookings for insert/);
  assert.match(policy, /to authenticated/);
  assert.match(policy, /\(select auth\.role\(\)\) = 'authenticated'/);
  assert.match(policy, /select 1 from public\.account_roles\s+where account_roles\.email = \(select auth\.email\(\)\)/);
});

test('the rollback note is there: dropping create_booking() must restore the old policy in the same change', () => {
  assert.match(SQL, /Rolling back: if create_booking\(\) is ever dropped, restore the original\s+-- policy in the same change/);
  assert.match(SQL, /-- create policy "Anyone can submit a booking"\n--   on public\.th_bookings for insert\n--   to anon, authenticated\n--   with check \(true\);/);
});

test('booking.html books through create_booking() first; its direct insert is only the 404 fallback', () => {
  const html = read('booking.html');
  const fn = html.match(/function submitBooking\(payload\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(fn.indexOf("/rest/v1/rpc/create_booking") < fn.indexOf("/rest/v1/th_bookings"), 'the RPC is tried first');
  assert.match(fn, /if \(res\.status === 404\) \{\s*return fetch\(SUPABASE_URL \+ '\/rest\/v1\/th_bookings'/);
  assert.match(html, /restrict_direct_booking_inserts\.sql/, 'the fallback comment points at the lockdown and its rollback');
});

// Every place that POSTs a row into th_bookings, and why it still works.
// A NEW public-key insert added later would fail with 42501 in
// production, so it has to be added here on purpose (and routed through
// create_booking() instead).
const ALLOWED_DIRECT_INSERTS = {
  'booking.html': 'the 404-only fallback, see the rollback note',
  'tools/dev-tools.html': 'staff session -- the staff INSERT policy',
  'edge-functions/schedule-checkup-visit-index.ts': 'service role, bypasses RLS',
  'edge-functions/schedule-quote-job-index.ts': 'service role, bypasses RLS',
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'backups'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(html|js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('no other file inserts straight into th_bookings', () => {
  const found = {};
  for (const file of walk(repo())) {
    const src = fs.readFileSync(file, 'utf8');
    // A bare collection URL (no ?filter, no /rpc/) followed by a POST.
    const re = /\/rest\/v1\/th_bookings['`"]\s*[,)][\s\S]{0,400}?method:\s*['"]POST['"]/g;
    if (re.test(src)) found[path.relative(repo(), file).split(path.sep).join('/')] = true;
  }
  assert.deepEqual(Object.keys(found).sort(), Object.keys(ALLOWED_DIRECT_INSERTS).sort());
});

test('the two portal edge functions insert with the service role, not the caller\'s token', () => {
  for (const f of ['schedule-checkup-visit-index.ts', 'schedule-quote-job-index.ts']) {
    const src = read('edge-functions', f);
    const call = src.slice(src.indexOf('fetch(`${SUPABASE_URL}/rest/v1/th_bookings`'), src.indexOf('fetch(`${SUPABASE_URL}/rest/v1/th_bookings`') + 300);
    assert.match(call, /apikey: SERVICE_ROLE_KEY,\s*Authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/, f);
  }
});
