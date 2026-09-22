// Unread-message tracking + the shared chat thread (2026-09-22).
//
// Neither message table recorded whether a client had seen a reply, so
// a client couldn't tell Triple H had answered without opening every
// thread, and Home showed a vague "Reply" item for every open request.
// Now: client_portal_thread_reads + get_portal_unread_counts() /
// mark_portal_thread_read() (sql/portal/create_client_portal_thread_reads.sql),
// badges on the Messages toggles and the bottom nav, a precise Home
// item, and one shared thread renderer in portal-app.js (which also
// fixes portal/jobs.html's "Invalid Date" under every message).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SQL = fs.readFileSync(repo('sql', 'portal', 'create_client_portal_thread_reads.sql'), 'utf8');
const POLICY_SQL = fs.readFileSync(repo('sql', 'portal', 'let_internal_accounts_read_portal_jobs_and_invoices.sql'), 'utf8');
const PORTAL_APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const PORTAL_CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const HOME = fs.readFileSync(repo('portal', 'home.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const isAsync = src.slice(Math.max(0, start - 6), start) === 'async ';
  return (isAsync ? 'async ' : '') + src.slice(start, i);
}

// ---- schema ----

test('one reads table keyed by (client_email, thread_type, thread_id), only the two real thread types', () => {
  assert.match(SQL, /constraint client_portal_thread_reads_pkey primary key \(client_email, thread_type, thread_id\)/);
  assert.match(SQL, /check \(thread_type in \('work_order', 'job'\)\)/);
});

test('RLS is on, every policy is to authenticated with a wrapped auth.email(), and there is no delete policy', () => {
  assert.match(SQL, /alter table public\.client_portal_thread_reads enable row level security;/);
  const policies = [...SQL.matchAll(/create policy [\s\S]*?;\n/g)].map(m => m[0]);
  assert.equal(policies.length, 3);
  for (const p of policies) {
    assert.match(p, /to authenticated/);
    assert.doesNotMatch(p.replace(/\(select auth\.email\(\)\)/g, ''), /auth\.email\(\)/, 'every auth.email() in a policy should be wrapped in (select ...)');
  }
  assert.doesNotMatch(SQL, /for delete/);
});

test('a client can only mark their OWN work order or job read, never with a future watermark', () => {
  const insert = SQL.match(/create policy "clients mark their own threads read"[\s\S]*?;\n/)[0];
  assert.match(insert, /from public\.client_portal_work_orders wo[\s\S]*wo\.client_email = \(select auth\.email\(\)\)/);
  assert.match(insert, /from public\.client_portal_jobs j[\s\S]*j\.client_email = \(select auth\.email\(\)\)/);
  assert.match(insert, /last_read_at <= now\(\)/);
});

test('grants: nothing for anon, and only the watermark column is updatable', () => {
  assert.match(SQL, /revoke all on table public\.client_portal_thread_reads from public, anon, authenticated;/);
  assert.match(SQL, /grant select, insert on table public\.client_portal_thread_reads to authenticated;/);
  assert.match(SQL, /grant update \(last_read_at\) on table public\.client_portal_thread_reads to authenticated;/);
  assert.doesNotMatch(SQL, /grant update on table public\.client_portal_thread_reads/);
});

test('the counts RPC is SECURITY INVOKER, counts only Triple H messages after the watermark, and filters to the caller explicitly', () => {
  const fn = SQL.match(/create or replace function public\.get_portal_unread_counts\(\)[\s\S]*?\$\$;/)[0];
  assert.match(fn, /security invoker/);
  assert.match(fn, /set search_path = public/);
  assert.equal((fn.match(/m\.sender_type = 'internal'/g) || []).length, 2);
  assert.match(fn, /w\.client_email = \(select auth\.email\(\)\)/);
  assert.match(fn, /j\.client_email = \(select auth\.email\(\)\)/);
  assert.equal((fn.match(/r\.last_read_at is null or m\.created_at > r\.last_read_at/g) || []).length, 2);
});

test('mark-read upserts on the primary key, caps at server now(), and never moves backwards', () => {
  const fn = SQL.match(/create or replace function public\.mark_portal_thread_read\([\s\S]*?\$\$;/)[0];
  assert.match(fn, /security invoker/);
  assert.match(fn, /least\(coalesce\(p_seen_through, now\(\)\), now\(\)\)/);
  assert.match(fn, /on conflict \(client_email, thread_type, thread_id\)/);
  assert.match(fn, /greatest\(r\.last_read_at, excluded\.last_read_at\)/);
});

test('both RPCs are revoked from public AND anon (Supabase grants anon separately)', () => {
  assert.match(SQL, /revoke execute on function public\.get_portal_unread_counts\(\) from public, anon;/);
  assert.match(SQL, /grant execute on function public\.get_portal_unread_counts\(\) to authenticated;/);
  assert.match(SQL, /revoke execute on function public\.mark_portal_thread_read\(text, bigint, timestamptz\) from public, anon;/);
  assert.match(SQL, /grant execute on function public\.mark_portal_thread_read\(text, bigint, timestamptz\) to authenticated;/);
});

test('the message tables and their notification triggers are left untouched', () => {
  assert.doesNotMatch(SQL, /alter table (public\.)?client_portal_(work_order|job)_messages/);
  assert.doesNotMatch(SQL, /create trigger/);
  assert.doesNotMatch(SQL, /notify_(work_order|job)_message_email/);
});

test('staff can now read portal jobs and invoices (tools/clients.html depends on it) through ONE merged policy each', () => {
  for (const table of ['client_portal_jobs', 'client_portal_invoices']) {
    const re = new RegExp(`create policy "[^"]+"\\s+on public\\.${table} for select\\s+to authenticated\\s+using \\(\\(select auth\\.email\\(\\)\\) = client_email or public\\.current_user_has_any_role\\(\\)\\);`);
    assert.match(POLICY_SQL, re, `${table} should have one merged clients-or-internal SELECT policy`);
  }
  assert.match(POLICY_SQL, /drop policy if exists "clients can only view their own jobs"/);
  assert.match(POLICY_SQL, /drop policy if exists "clients can only view their own invoices"/);
  assert.doesNotMatch(POLICY_SQL, /for (insert|update|delete)/);
});

// ---- shared helpers ----

test('portalLoadUnreadCounts / portalMarkThreadRead never throw', async () => {
  const ctx = { console: { warn() {} } };
  vm.createContext(ctx);
  vm.runInContext(extractFn(PORTAL_APP, 'portalLoadUnreadCounts') + '\n' + extractFn(PORTAL_APP, 'portalMarkThreadRead') +
    '\nthis.load = portalLoadUnreadCounts; this.mark = portalMarkThreadRead;', ctx);
  const erroring = { rpc: async () => ({ data: null, error: { message: 'missing function' } }) };
  const throwing = { rpc: async () => { throw new Error('offline'); } };
  assert.equal((await ctx.load(erroring)).length, 0);
  assert.equal((await ctx.load(throwing)).length, 0);
  assert.equal(await ctx.mark(erroring, 'job', 1, null), false);
  assert.equal(await ctx.mark(throwing, 'job', 1, null), false);
});

test('mark-read passes the RPC exactly the raw created_at it was given (no Date round-trip)', async () => {
  let args = null;
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(extractFn(PORTAL_APP, 'portalMarkThreadRead') + '\nthis.mark = portalMarkThreadRead;', ctx);
  await ctx.mark({ rpc: async (name, a) => { args = { name, a }; return { error: null }; } }, 'work_order', 7, '2026-09-22T19:00:00.123456+00:00');
  assert.equal(args.name, 'mark_portal_thread_read');
  assert.equal(args.a.p_seen_through, '2026-09-22T19:00:00.123456+00:00');
  assert.equal(args.a.p_thread_type, 'work_order');
  assert.equal(args.a.p_thread_id, 7);
});

function navDom() {
  const nav = WORK_ORDERS.match(/<nav class="portal-nav"[\s\S]*?<\/nav>/)[0];
  const dom = new JSDOM('<!DOCTYPE html><body>' + nav + '</body>');
  const ctx = { document: dom.window.document, Number, String };
  vm.createContext(ctx);
  vm.runInContext(PORTAL_APP.match(/const PORTAL_NAV_UNREAD_TABS = [\s\S]*?\];\n/)[0] +
    extractFn(PORTAL_APP, 'portalApplyNavUnreadBadges') + '\nthis.apply = portalApplyNavUnreadBadges;', ctx);
  return { dom, apply: ctx.apply };
}

test('nav badges sum per tab, cap at 9+, set an accessible label, and clear at zero', () => {
  const { dom, apply } = navDom();
  const doc = dom.window.document;
  apply([
    { thread_type: 'work_order', thread_id: 1, unread_count: 2 },
    { thread_type: 'work_order', thread_id: 2, unread_count: 1 },
    { thread_type: 'job', thread_id: 5, unread_count: 12 },
  ]);
  const req = doc.querySelector('a[href="/portal/work-orders.html"]');
  const jobs = doc.querySelector('a[href="/portal/jobs.html"]');
  assert.equal(req.querySelector('.portal-nav-badge').textContent, '3');
  assert.equal(req.getAttribute('aria-label'), 'Request, 3 new messages');
  assert.equal(jobs.querySelector('.portal-nav-badge').textContent, '9+');
  assert.equal(doc.querySelectorAll('.portal-nav a[href]').length, 5, 'still exactly five tabs');

  apply([{ thread_type: 'job', thread_id: 5, unread_count: 1 }]);
  assert.equal(req.querySelector('.portal-nav-badge'), null);
  assert.equal(req.getAttribute('aria-label'), null);
  assert.equal(jobs.querySelector('.portal-nav-badge').textContent, '1');
  assert.equal(jobs.getAttribute('aria-label'), 'Jobs, 1 new message');
  assert.equal(jobs.querySelectorAll('.portal-nav-badge').length, 1, 'updates the existing badge, never stacks a second');
});

// ---- shared thread renderer ----

function renderThread(messages, options) {
  const ctx = { Intl, Date, Number, Math, Array, String };
  vm.createContext(ctx);
  vm.runInContext(['portalMessageTime', 'portalMessageDayLabel', 'portalThreadEscape', 'portalMessageThreadHtml']
    .map(n => extractFn(PORTAL_APP, n)).join('\n') + '\nthis.render = portalMessageThreadHtml;', ctx);
  return ctx.render(messages, options);
}

test('every bubble gets a real time -- never "Invalid Date" from a full timestamptz', () => {
  const html = renderThread([
    { sender_type: 'client', message: 'Hi', created_at: '2026-09-16T18:22:01.123456+00:00' },
    { sender_type: 'internal', message: 'Hello', created_at: '2026-09-16T18:40:00+00:00' },
  ], { now: new Date('2026-09-22T12:00:00Z') });
  assert.doesNotMatch(html, /Invalid Date/);
  assert.equal((html.match(/class="portal-msg-time"/g) || []).length, 2);
});

test('a day divider appears when the day changes, and the sender is named only when it changes', () => {
  const html = renderThread([
    { sender_type: 'client', message: 'a', created_at: '2026-09-10T15:00:00Z' },
    { sender_type: 'client', message: 'b', created_at: '2026-09-10T15:05:00Z' },
    { sender_type: 'internal', message: 'c', created_at: '2026-09-12T15:00:00Z' },
  ], { now: new Date('2026-09-22T12:00:00Z') });
  assert.equal((html.match(/class="portal-thread-day"/g) || []).length, 2);
  assert.equal((html.match(/class="portal-msg-sender">You</g) || []).length, 1);
  assert.equal((html.match(/class="portal-msg-sender">Triple H</g) || []).length, 1);
});

test('the "New" divider sits right above the first unread Triple H reply', () => {
  const html = renderThread([
    { sender_type: 'internal', message: 'old reply', created_at: '2026-09-20T15:00:00Z' },
    { sender_type: 'client', message: 'thanks', created_at: '2026-09-20T16:00:00Z' },
    { sender_type: 'internal', message: 'NEW ONE', created_at: '2026-09-21T15:00:00Z' },
    { sender_type: 'internal', message: 'NEW TWO', created_at: '2026-09-21T15:10:00Z' },
  ], { unreadCount: 2, now: new Date('2026-09-22T12:00:00Z') });
  const newAt = html.indexOf('portal-thread-new');
  assert.ok(newAt > html.indexOf('thanks') && newAt < html.indexOf('NEW ONE'));
  assert.equal((html.match(/portal-thread-new/g) || []).length, 1);
});

test('message text is escaped, and an empty thread shows its empty text', () => {
  const html = renderThread([{ sender_type: 'client', message: '<img src=x onerror=alert(1)>', created_at: '2026-09-20T15:00:00Z' }]);
  assert.doesNotMatch(html, /<img/);
  assert.match(renderThread([], { emptyText: 'Nothing here' }), /Nothing here/);
});

// ---- pages ----

for (const [name, src, loadFn, sendFn, type, counts] of [
  ['work-orders', WORK_ORDERS, 'loadAndRenderThread', 'sendMessage', 'work_order', 'woUnreadCounts'],
  ['jobs', JOBS, 'loadAndRenderJobThread', 'sendJobMessage', 'job', 'jobUnreadCounts'],
]) {
  test(`${name}: unread counts load in the same Promise.all as the list itself`, () => {
    const listFn = extractFn(src, name === 'jobs' ? 'renderJobs' : 'renderMyRequests');
    assert.match(listFn, /Promise\.all\(\[[\s\S]*portalLoadUnreadCounts\(client\),\s*\]\)/);
    assert.match(listFn, /portalApplyNavUnreadBadges\(unreadRows\)/);
  });

  test(`${name}: opening a thread marks it read AFTER rendering, only when Triple H has written, watermarked at the raw created_at`, () => {
    const fn = extractFn(src, loadFn);
    const renderAt = fn.indexOf('portalMessageThreadHtml(messages');
    const markAt = fn.indexOf(`portalMarkThreadRead(client, '${type}'`);
    assert.ok(fn.indexOf('if (error)') < renderAt && renderAt < markAt, 'render first, then mark read');
    assert.match(fn, /\.some\(m => m\.sender_type === 'internal'\)/);
    assert.match(fn, /messages\[messages\.length - 1\]\.created_at\);/);
    assert.doesNotMatch(fn.slice(markAt - 200), /toISOString|new Date\(/);
    assert.match(fn, new RegExp(`unreadCount: ${counts}\\[`));
  });

  test(`${name}: the composer locks while sending and unlocks only on failure`, () => {
    const fn = extractFn(src, sendFn);
    assert.match(fn, /const restore = portalSetComposerSending\(/);
    assert.match(fn, /if \(error\) \{\s*restore\(\);/);
  });

  test(`${name}: the old hand-copied bubble/form markup is gone in favour of the shared renderer`, () => {
    assert.doesNotMatch(src, /class="(wo|job)-message-(bubble|form)/);
    assert.doesNotMatch(src, /\.(wo|job)-message-(bubble|form) \{/);
    assert.match(src, /portalComposerHtml\(/);
  });
}

test('the Messages toggles show an unread pill and announce their expanded state', () => {
  assert.match(WORK_ORDERS, /onclick="toggleMessages\(\$\{wo\.id\}, this\)" aria-expanded="false" aria-controls="woMessages-\$\{wo\.id\}">\$\{THREAD_ICON\}Messages\$\{woUnreadBadgeHtml\(wo\.id\)\}/);
  assert.match(JOBS, /onclick="toggleJobMessages\(\$\{j\.id\}, this\)" aria-expanded="false" aria-controls="jobMessages-\$\{j\.id\}">\$\{JOB_THREAD_ICON\}Messages\$\{jobUnreadBadgeHtml\(j\.id\)\}/);
  assert.match(extractFn(WORK_ORDERS, 'toggleMessages'), /setAttribute\('aria-expanded', 'true'\)/);
  assert.match(extractFn(JOBS, 'toggleJobMessages'), /setAttribute\('aria-expanded', 'true'\)/);
});

test('jobs cards have a deep-link id, and both pages auto-open the thread Home linked to', () => {
  assert.match(JOBS, /<div class="job-card" id="job-card-\$\{j\.id\}">/);
  assert.match(extractFn(JOBS, 'renderJobs'), /portalScrollToHash\(\);[\s\S]*#job-card-/);
  assert.match(extractFn(WORK_ORDERS, 'renderMyRequests'), /#wo-card-[\s\S]*toggleMessages\(Number\(hashMatch\[1\]\), btn\)/);
});

test('every portal page with the bottom nav refreshes its unread badges', () => {
  for (const page of ['quotes', 'dashboard', 'contracts', 'settings']) {
    const src = fs.readFileSync(repo('portal', page + '.html'), 'utf8');
    assert.match(src, /portalLoadUnreadCounts\(client\)\.then\(portalApplyNavUnreadBadges\);/, `${page}.html`);
  }
  assert.match(HOME, /portalApplyNavUnreadBadges\(summary\.unread\);/);
});

// ---- Home ----

function runAttention(summary) {
  const el = { innerHTML: '' };
  const ctx = {
    console, Intl, Date, Number,
    document: { getElementById: (id) => (id === 'attentionArea' ? el : null) },
    escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  vm.createContext(ctx);
  vm.runInContext([extractFn(HOME, 'money'), extractFn(HOME, 'formatInvoiceDate'), extractFn(HOME, 'renderAttention')].join('\n') +
    '\nthis.renderAttention = renderAttention;', ctx);
  ctx.renderAttention(Object.assign({ invoices: [], quotes: [], requests: [], contracts: [], jobs: [] }, summary));
  return el.innerHTML;
}

test('an open request with nothing new is no longer a "Reply" to-do', () => {
  const html = runAttention({ requests: [{ id: 4, status: 'reviewing', title: 'Leak' }], unread: [] });
  assert.equal(html, '');
  assert.doesNotMatch(HOME, /'We may have a question, or an update waiting'/, 'the old guessing copy should no longer be rendered');
});

test('one unread reply on a request names it and opens that thread', () => {
  const html = runAttention({
    requests: [{ id: 4, status: 'reviewing', title: 'Leaky faucet' }],
    unread: [{ thread_type: 'work_order', thread_id: 4, unread_count: 1, latest_unread_at: '2026-09-21T10:00:00Z' }],
  });
  assert.match(html, /New message from Triple H/);
  assert.match(html, /About: Leaky faucet/);
  assert.match(html, /href="\/portal\/work-orders\.html#wo-card-4"/);
});

test('an unread reply on a completed job links to that job card', () => {
  const html = runAttention({
    jobs: [{ id: 7, title: 'Water heater' }],
    unread: [{ thread_type: 'job', thread_id: 7, unread_count: 2, latest_unread_at: '2026-09-21T10:00:00Z' }],
  });
  assert.match(html, /2 new messages from Triple H/);
  assert.match(html, /About: Water heater/);
  assert.match(html, /href="\/portal\/jobs\.html#job-card-7"/);
});

test('several unread threads sum up and link to the newest one', () => {
  const html = runAttention({
    unread: [
      { thread_type: 'work_order', thread_id: 4, unread_count: 1, latest_unread_at: '2026-09-20T10:00:00Z' },
      { thread_type: 'job', thread_id: 7, unread_count: 2, latest_unread_at: '2026-09-21T10:00:00Z' },
    ],
  });
  assert.match(html, /3 new messages from Triple H/);
  assert.match(html, /Across 2 conversations/);
  assert.match(html, /href="\/portal\/jobs\.html#job-card-7"/);
});

test('a missing unread list never throws', () => {
  assert.equal(runAttention({}), '');
});

test('Home loads unread counts with the rest of the summary and job titles for the message item', () => {
  const fn = extractFn(HOME, 'loadSummary');
  assert.match(fn, /portalLoadUnreadCounts\(client\),/);
  assert.match(fn, /from\('client_portal_jobs'\)\.select\('id,title'\)/);
  assert.match(fn, /\n      unread,\n/);
});

test('the shared thread and badge styles live in portal-app.css, with a reduced-motion fallback', () => {
  for (const sel of ['.portal-nav-badge', '.portal-thread-toggle', '.portal-thread {', '.portal-msg-bubble', '.portal-composer', '.portal-thread-new']) {
    assert.ok(PORTAL_CSS.includes(sel), `expected ${sel} in portal-app.css`);
  }
  assert.match(PORTAL_CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\.portal-nav-badge, \.portal-composer-send\.is-sending svg \{ animation: none; \}/);
});
