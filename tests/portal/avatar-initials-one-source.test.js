// Portal avatar initials: one rule, one source (cross-surface pass,
// 2026-10-31). The header's round account button showed "KR" on Home and
// "KI" on Invoices/Visits/Estimates/Contracts/Requests for the same client:
// Home built the letters from client_profiles.display_name, every other
// page from the sign-in email's prefix. #553 cached Home's letters per
// device, which missed any device or session that hadn't opened Home
// first. Settings' profile card had a third, one-letter rule.
//
// These tests run the real portal-app.js helpers in jsdom with a stub
// Supabase client, and pin that every signed-in page uses them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'portal', 'portal-app.js'), 'utf8');
const read = (f) => fs.readFileSync(path.join(ROOT, 'portal', f), 'utf8');

function extractFn(src, name) {
  const start = src.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function page() {
  const dom = new JSDOM('<!DOCTYPE html><body><header class="portal-header"><a class="portal-icon-btn" aria-label="Settings" href="/portal/settings.html"></a></header></body>', {
    url: 'https://example.com/portal/dashboard.html', runScripts: 'outside-only',
  });
  const w = dom.window;
  w.eval(['portalInitialsFor', 'portalSetHeaderInitials', 'portalLoadHeaderInitials'].map((n) => extractFn(APP, n)).join('\n') +
    '\nwindow.__t = { portalInitialsFor, portalSetHeaderInitials, portalLoadHeaderInitials };');
  return { w, t: w.__t, avatar: () => (w.document.querySelector('.portal-avatar-initials') || {}).textContent };
}

function stubClient(answer, calls) {
  return {
    from(table) {
      const q = { table, filters: [] };
      calls.push(q);
      return {
        select(cols) { q.cols = cols; return this; },
        eq(col, val) { q.filters.push([col, val]); return this; },
        maybeSingle() { return typeof answer === 'function' ? answer() : Promise.resolve(answer); },
      };
    },
  };
}

test('one rule: the saved name wins, the email prefix is the fallback, never a blank', () => {
  const { t } = page();
  assert.equal(t.portalInitialsFor('Kim Reyes', 'kim@example.com'), 'KR');
  assert.equal(t.portalInitialsFor('', 'kim@example.com'), 'KI');
  assert.equal(t.portalInitialsFor('', 'kim.reyes@example.com'), 'KR');
  assert.equal(t.portalInitialsFor('Cher', 'x@example.com'), 'CH');
  assert.equal(t.portalInitialsFor('kim@example.com', 'kim@example.com'), 'KI', 'a "name" that is an email is not a name');
  assert.equal(t.portalInitialsFor('  ', ''), '');
});

test('a page without its own profile load reads the same display_name Home reads, and shows the same letters', async () => {
  const { t, avatar } = page();
  const calls = [];
  await t.portalLoadHeaderInitials(stubClient({ data: { display_name: 'Kim Reyes' }, error: null }, calls), 'kim@example.com');
  assert.equal(avatar(), 'KR', 'not KI from the email');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'client_profiles');
  assert.equal(calls[0].cols, 'display_name');
  assert.deepEqual(calls[0].filters, [['client_email', 'kim@example.com']], 'filtered by email, as Home does');

  // Home's own call, with the name it already loaded.
  const home = page();
  home.t.portalSetHeaderInitials('kim@example.com', 'Kim Reyes');
  assert.equal(home.avatar(), avatar());
});

test('a failed or empty profile read falls back to the email letters and never throws', async () => {
  for (const answer of [{ data: null, error: null }, { data: null, error: { message: 'boom' } }, () => Promise.reject(new Error('offline'))]) {
    const { t, avatar } = page();
    await t.portalLoadHeaderInitials(stubClient(answer, []), 'kim@example.com');
    assert.equal(avatar(), 'KI');
  }
});

test('no device-local cache: the letters come from the data, not from which page was opened first', () => {
  assert.doesNotMatch(APP, /th_portal_initials_/);
});

test('every signed-in page computes the avatar the same way', () => {
  for (const f of ['dashboard.html', 'jobs.html', 'quotes.html', 'contracts.html', 'work-orders.html']) {
    const html = read(f);
    assert.match(html, /portalLoadHeaderInitials\(client, session\.user\.email\)/, f);
    assert.doesNotMatch(html, /portalSetHeaderInitials\(session\.user\.email\)/, f + ' must not use the email-only form');
  }
  assert.match(read('home.html'), /portalSetHeaderInitials\(session\.user\.email, summary\.displayName\)/);
  // Settings has no header avatar (it is the page the avatar opens); its
  // profile card uses the shared rule.
  assert.match(extractFn(read('settings.html'), 'settingsInitials'), /portalInitialsFor\(name, email\)/);
});
