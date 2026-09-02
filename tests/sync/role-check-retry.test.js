// Tests for the retry added to loadCurrentUserRole() (2026-09-02).
//
// Real report this closes: a fully-permissioned Developer account
// (confirmed directly against account_roles/role_definitions at the
// time -- nothing was actually wrong with the account) got blocked
// from a role-gated page because the ONE network request this
// function makes happened to hit a dropped cellular connection. This
// function fails CLOSED by design -- if the role can't be confirmed,
// it doesn't guess -- so a single blip was enough to show "not
// available here" on an account with full access. The fix retries the
// fetch itself up to 3 attempts before giving up, mirroring the retry
// already used for Realtime channel subscriptions elsewhere in this
// codebase, which hit the exact same class of failure.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const AUTH_JS_PATH = path.join(__dirname, '..', '..', 'tools', 'auth.js');

// Loads auth.js into a fresh sandbox with a controllable fetch, rather
// than exercising a full page -- this function's contract (retry on
// failure, then either return the role or null) is what matters here,
// not any particular page's rendering around it.
//
// Seeds a real, valid session in storage rather than trying to
// override getCurrentUserEmail()/ensureFreshToken() by assigning
// window.xyz = ... before the source: auth.js declares those with the
// `function` keyword, and a hoisted function declaration in the SAME
// script body wins over an earlier plain assignment to a same-named
// window property -- confirmed directly the first time this file was
// written, when that approach silently left calls=0 (loadCurrentUserRole
// returned via the "no email" path every time, never reaching fetch at
// all). Seeding the actual storage shape hasValidSession()/
// getStoredSession() read is what makes the REAL functions behave the
// way the test needs, rather than fighting their scoping.
function loadAuth({ fetchImpl, email = 'connor@triplehenterprisesllc.biz' }) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;
  window.fetch = fetchImpl;
  window.SUPABASE_URL = 'https://example.supabase.co';
  window.SUPABASE_ANON_KEY = 'anon-key';
  window.sessionStorage.setItem('th_auth_session', JSON.stringify({
    email,
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour out -- comfortably "valid" to hasValidSession()
  }));

  const src = fs.readFileSync(AUTH_JS_PATH, 'utf8');
  const exportNames = ['loadCurrentUserRole', 'canManageBusinessFinances', 'hasDevToolsAccess'];
  const fn = new Function('window', 'document', 'localStorage', 'sessionStorage', 'fetch',
    src + '\nreturn {' + exportNames.join(',') + '};');
  return fn(window, window.document, window.localStorage, window.sessionStorage, fetchImpl);
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// Permission model redesign (2026-09-02): loadCurrentUserRole() now
// queries account_roles directly for its 4 booleans, no join to
// role_definitions -- this mock response shape has to match that
// real query, or these tests would pass against a shape the actual
// code no longer requests.
const ROLE_ROW = [{
  role_name: 'Developer',
  can_manage_roles: true,
  can_access_dev_tools: true,
  can_manage_site_content: true,
  can_manage_business_finances: true,
}];

test('a single transient network failure no longer fails the whole role check', async () => {
  let calls = 0;
  const auth = loadAuth({
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error('network blip -- dropped connection');
      return jsonResponse(ROLE_ROW);
    },
  });

  const role = await auth.loadCurrentUserRole();
  assert.equal(calls, 2, 'should have retried once after the first failure');
  assert.ok(role, 'should recover and return the real role on the second attempt');
  assert.equal(role.roleName, 'Developer');
  assert.equal(auth.canManageBusinessFinances(), true,
    'the exact permission check that blocked the real report should now pass');
});

test('a transient HTTP failure (not just a thrown error) is retried too', async () => {
  let calls = 0;
  const auth = loadAuth({
    fetchImpl: async () => {
      calls++;
      if (calls < 3) return jsonResponse(null, false, 503);
      return jsonResponse(ROLE_ROW);
    },
  });

  const role = await auth.loadCurrentUserRole();
  assert.equal(calls, 3);
  assert.ok(role);
  assert.equal(auth.canManageBusinessFinances(), true);
});

test('a genuinely, persistently unreachable backend still fails closed after retrying', () => {
  return (async () => {
    let calls = 0;
    const auth = loadAuth({
      fetchImpl: async () => {
        calls++;
        throw new Error('still down');
      },
    });

    const role = await auth.loadCurrentUserRole();
    assert.equal(calls, 3, 'should give up after 3 attempts, not retry forever');
    assert.equal(role, null);
    assert.equal(auth.canManageBusinessFinances(), false,
      'a genuinely unconfirmable role must still block access -- retrying is for blips, not a bypass');
  })();
});

test('an account with no role assigned is NOT retried -- that answer is real, not a network failure', async () => {
  let calls = 0;
  const auth = loadAuth({
    fetchImpl: async () => {
      calls++;
      return jsonResponse([]); // no matching row -- a genuine "no role" answer
    },
  });

  const role = await auth.loadCurrentUserRole();
  assert.equal(calls, 1, 'an empty-but-successful response is a real answer, not a failure to retry');
  assert.equal(role, null);
});
