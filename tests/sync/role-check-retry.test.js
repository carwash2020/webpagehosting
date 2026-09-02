// Tests for the retry added to loadCurrentUserRole() (2026-09-02),
// and for the refreshSession() concurrency fix found while
// investigating the same real report.
//
// Real report this closes: a fully-permissioned Developer account
// (confirmed directly against account_roles at the time -- nothing
// was actually wrong with the account) got blocked from a
// permission-gated page. Two genuinely separate causes were found and
// fixed:
//
// 1. loadCurrentUserRole() makes exactly ONE network request to
//    confirm the caller's permissions and fails CLOSED by design (if
//    the role can't be confirmed, don't guess) -- so a single dropped
//    connection alone was enough to show "not available here" on a
//    fully-permissioned account. Fixed with a retry: up to 3 attempts
//    with a short backoff, mirroring the retry already used for
//    Realtime channel subscriptions elsewhere in this codebase.
//
// 2. requireAuth() fires refreshSession() UN-awaited at the top of
//    every protected page, and loadCurrentUserRole()'s own
//    ensureFreshToken() can trigger a second, independent call
//    moments later on the same page load. Supabase rotates refresh
//    tokens, so two concurrent calls sharing one stored refresh_token
//    is a genuine race -- whichever request loses gets rejected, and
//    the old code responded to that rejection by calling
//    clearStoredSession(), wiping out a session the FIRST call had
//    just successfully refreshed a moment earlier. Fixed by
//    de-duplicating concurrent calls into one shared in-flight
//    promise.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const AUTH_JS_PATH = path.join(__dirname, '..', '..', 'tools', 'auth.js');
const AUTH_JS_SRC = fs.readFileSync(AUTH_JS_PATH, 'utf8');

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// Loads auth.js into a fresh sandbox with a controllable fetch, rather
// than exercising a full page -- these functions' actual contracts
// are what matter here, not any particular page's rendering around
// them.
//
// Seeds a real session in storage rather than trying to override
// getCurrentUserEmail()/ensureFreshToken() by assigning
// window.xyz = ... before the source: auth.js declares those with the
// `function` keyword, and a hoisted function declaration in the SAME
// script body wins over an earlier plain assignment to a same-named
// window property -- confirmed directly the first time this file was
// written, when that approach silently left calls=0 (loadCurrentUserRole
// returned via the "no email" path every time, never reaching fetch at
// all). Seeding the actual storage shape hasValidSession()/
// getStoredSession() read is what makes the REAL functions behave the
// way each test needs, rather than fighting their scoping.
function loadAuth({ fetchImpl, session, exportNames }) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;
  window.fetch = fetchImpl;
  window.SUPABASE_URL = 'https://example.supabase.co';
  window.SUPABASE_ANON_KEY = 'anon-key';
  window.sessionStorage.setItem('th_auth_session', JSON.stringify(session));

  const fn = new Function('window', 'document', 'localStorage', 'sessionStorage', 'fetch',
    AUTH_JS_SRC + '\nreturn {' + exportNames.join(',') + '};');
  return fn(window, window.document, window.localStorage, window.sessionStorage, fetchImpl);
}

const VALID_SESSION = {
  email: 'connor@triplehenterprisesllc.biz',
  access_token: 'fake-access-token',
  refresh_token: 'fake-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour out -- comfortably "valid"
};

// Granular permission expansion (2026-09-02): loadCurrentUserRole()
// now queries account_roles directly for 9 booleans, no join to
// role_definitions, and can_manage_business_finances doesn't exist as
// a column at all anymore -- this mock response shape has to match
// the real query, or these tests would pass against a shape the
// actual code no longer requests.
const ROLE_ROW = [{
  role_name: 'Developer',
  can_manage_roles: true,
  can_access_dev_tools: true,
  can_access_dev_tools_full: true,
  can_manage_site_content: true,
  can_manage_invoices: true,
  can_manage_contracts: true,
  can_view_finance: true,
  can_view_runway: true,
  can_manage_reviews: true,
}];

const ROLE_EXPORTS = ['loadCurrentUserRole', 'canManageInvoices', 'hasDevToolsAccess'];

test('a single transient network failure no longer fails the whole role check', async () => {
  let calls = 0;
  const auth = loadAuth({
    session: VALID_SESSION,
    exportNames: ROLE_EXPORTS,
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
  assert.equal(auth.canManageInvoices(), true,
    'the exact class of permission check that blocked the real report should now pass');
});

test('a transient HTTP failure (not just a thrown error) is retried too', async () => {
  let calls = 0;
  const auth = loadAuth({
    session: VALID_SESSION,
    exportNames: ROLE_EXPORTS,
    fetchImpl: async () => {
      calls++;
      if (calls < 3) return jsonResponse(null, false, 503);
      return jsonResponse(ROLE_ROW);
    },
  });

  const role = await auth.loadCurrentUserRole();
  assert.equal(calls, 3);
  assert.ok(role);
  assert.equal(auth.canManageInvoices(), true);
});

test('a genuinely, persistently unreachable backend still fails closed after retrying', async () => {
  let calls = 0;
  const auth = loadAuth({
    session: VALID_SESSION,
    exportNames: ROLE_EXPORTS,
    fetchImpl: async () => {
      calls++;
      throw new Error('still down');
    },
  });

  const role = await auth.loadCurrentUserRole();
  assert.equal(calls, 3, 'should give up after 3 attempts, not retry forever');
  assert.equal(role, null);
  assert.equal(auth.canManageInvoices(), false,
    'a genuinely unconfirmable role must still block access -- retrying is for blips, not a bypass');
});

test('an account with no role assigned is NOT retried -- that answer is real, not a network failure', async () => {
  let calls = 0;
  const auth = loadAuth({
    session: VALID_SESSION,
    exportNames: ROLE_EXPORTS,
    fetchImpl: async () => {
      calls++;
      return jsonResponse([]); // no matching row -- a genuine "no role" answer
    },
  });

  const role = await auth.loadCurrentUserRole();
  assert.equal(calls, 1, 'an empty-but-successful response is a real answer, not a failure to retry');
  assert.equal(role, null);
});

// ---- refreshSession() de-duplication (2026-09-02) ----

const EXPIRED_SESSION = {
  email: 'connor@triplehenterprisesllc.biz',
  access_token: 'expired-access-token',
  refresh_token: 'refresh-token-abc',
  expires_at: Math.floor(Date.now() / 1000) - 10, // already expired
};
const REFRESH_EXPORTS = ['refreshSession', 'getStoredSession'];

test('concurrent refreshSession() calls share one in-flight request, not one each', async () => {
  let networkCalls = 0;
  const auth = loadAuth({
    session: EXPIRED_SESSION,
    exportNames: REFRESH_EXPORTS,
    fetchImpl: async () => {
      networkCalls++;
      // A real network round trip so the two calls below genuinely
      // overlap in time, the same way requireAuth() (fired un-awaited
      // at page load) and loadCurrentUserRole()'s ensureFreshToken()
      // (moments later) really do.
      await new Promise(r => setTimeout(r, 20));
      return jsonResponse({
        access_token: 'new-access-token',
        refresh_token: 'refresh-token-xyz',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { email: 'connor@triplehenterprisesllc.biz' },
      });
    },
  });

  // Two callers, both starting before either resolves -- exactly the
  // requireAuth()-then-ensureFreshToken() shape that caused the real
  // report, reproduced directly rather than assumed.
  const [resultA, resultB] = await Promise.all([auth.refreshSession(), auth.refreshSession()]);

  assert.equal(networkCalls, 1, 'only ONE real network refresh should ever fire for overlapping callers');
  assert.equal(resultA, true);
  assert.equal(resultB, true);
  assert.equal(auth.getStoredSession().access_token, 'new-access-token',
    'the session should end up with the real refreshed token, not wiped by a losing duplicate call');
});

test('a genuine refresh failure (bad/revoked token) still clears the session and reports false', async () => {
  const auth = loadAuth({
    session: EXPIRED_SESSION,
    exportNames: REFRESH_EXPORTS,
    fetchImpl: async () => jsonResponse({ error: 'invalid_grant' }, false, 400),
  });

  const result = await auth.refreshSession();
  assert.equal(result, false);
  assert.equal(auth.getStoredSession(), null,
    'a real failure (not a concurrency race) should still clear the session -- correct, existing behavior, untouched by the dedup fix');
});

test('refreshSession() can be called again after a completed refresh -- the dedup guard does not get stuck', async () => {
  let networkCalls = 0;
  const auth = loadAuth({
    session: EXPIRED_SESSION,
    exportNames: REFRESH_EXPORTS,
    fetchImpl: async () => {
      networkCalls++;
      return jsonResponse({
        access_token: 'token-' + networkCalls,
        refresh_token: 'refresh-' + networkCalls,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { email: 'connor@triplehenterprisesllc.biz' },
      });
    },
  });

  await auth.refreshSession();
  await auth.refreshSession();
  assert.equal(networkCalls, 2, 'a second, later refresh (a genuinely new expiry) should make its own real call');
});
