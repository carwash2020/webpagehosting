// ============================================================
// Triple H Workspace — Auth Guard
// ============================================================
// This is a SECURITY GATE, not a multi-user system. There's exactly one
// account (created manually in the Supabase dashboard, not signed up
// through this app), and the point is to keep someone who stumbles onto
// the sync code from being able to read or write real business data —
// not to support separate logins for separate people. If that ever
// becomes the actual need, this whole approach needs rethinking, not
// just extending.
//
// Uses raw fetch() against Supabase's Auth REST endpoints rather than
// the Supabase JS SDK, matching the existing pattern in sync.js rather
// than introducing a new dependency on every page.

const SUPABASE_URL = 'https://csvfqdjuobylgafgolho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzdmZxZGp1b2J5bGdhZmdvbGhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNTQ3MjcsImV4cCI6MjEwMDkzMDcyN30.6GlvK-DfXf2lppS1kciZtsl4wHOpZz_yKtwsS1lyjrs';

const AUTH_SESSION_KEY = 'th_auth_session';
const REMEMBER_DAYS = 30;

// "Remember me" controls two separate things: WHERE the session lives
// (localStorage survives closing the browser; sessionStorage doesn't),
// and a hard cutoff (remember_until) checked independently of whatever
// Supabase's own refresh token would otherwise allow -- Supabase itself
// doesn't expose a simple "expire this refresh token in exactly 30
// days" setting per login, so that cap is enforced here instead.
function getSessionStore(rememberMe) {
  return rememberMe ? localStorage : sessionStorage;
}
function findStoredSession() {
  // A remembered session should still work after sessionStorage would
  // have been cleared (a new tab, browser restart) -- so localStorage is
  // checked first, then sessionStorage for the current-session-only case.
  try {
    const fromLocal = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if (fromLocal) return { session: fromLocal, store: localStorage };
  } catch (e) { /* ignore */ }
  try {
    const fromSession = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if (fromSession) return { session: fromSession, store: sessionStorage };
  } catch (e) { /* ignore */ }
  return { session: null, store: null };
}
function getStoredSession() {
  return findStoredSession().session;
}
function storeSession(session, rememberMe) {
  // rememberMe is only passed explicitly at sign-in. On a silent
  // refresh, preserve whichever store the session already lived in
  // rather than assuming.
  let store;
  if (rememberMe !== undefined) {
    store = getSessionStore(rememberMe);
    if (rememberMe) session.remember_until = Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000;
  } else {
    const existing = findStoredSession();
    store = existing.store || sessionStorage;
    if (existing.session && existing.session.remember_until) session.remember_until = existing.session.remember_until;
  }
  // Clear from both first, in case remember-me status changed since the
  // last sign-in (e.g. re-logging in with the box unchecked this time).
  localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  store.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}
function clearStoredSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

// Returns true if there's a session, its access token hasn't expired yet
// (60-second safety buffer), AND -- for a remembered session -- the
// 30-day cap hasn't passed either.
function hasValidSession() {
  const s = getStoredSession();
  if (!s || !s.access_token || !s.expires_at) return false;
  if (s.remember_until && Date.now() > s.remember_until) { clearStoredSession(); return false; }
  return Date.now() < (s.expires_at * 1000) - 60000;
}

async function signIn(email, password, rememberMe) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error_description || data.msg || 'Sign in failed' };
    storeSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at, // unix seconds, comes directly from Supabase
      email: data.user && data.user.email, // captured for per-person attribution elsewhere (e.g. Appliance Wiki) -- Supabase already sends this back, previously just wasn't being kept
    }, !!rememberMe);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error -- check your connection and try again.' };
  }
}

// Sends Supabase's built-in password-recovery email. redirect_to tells
// Supabase where the link inside that email should land -- if this URL
// isn't in the project's Auth > URL Configuration > Redirect URLs
// allow-list, Supabase silently falls back to the project's default Site
// URL instead of erroring here, so the send itself still succeeds even
// if that one-time dashboard setup hasn't been done yet.
async function requestPasswordReset(email) {
  try {
    const redirectTo = window.location.origin + '/tools/reset-password.html';
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email }),
    });
    // Supabase returns 200 here regardless of whether the email address
    // actually has an account, by design (so this endpoint can't be used
    // to check which emails are registered). A non-2xx response means
    // something else went wrong (rate limit, malformed request, etc.).
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error_description || data.msg || 'Could not send reset email.' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error -- check your connection and try again.' };
  }
}

// Used only by reset-password.html, with the one-time recovery access
// token Supabase put in that page's URL -- not the normal stored
// session, since at this point the person isn't logged in yet.
async function updatePasswordWithRecoveryToken(recoveryAccessToken, newPassword) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${recoveryAccessToken}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error_description || data.msg || 'Could not update password.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error -- check your connection and try again.' };
  }
}

async function refreshSession() {
  const s = getStoredSession();
  if (!s || !s.refresh_token) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) { clearStoredSession(); return false; }
    const data = await res.json();
    storeSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      // A silent refresh also gets a user object back -- but fall back
      // to whatever email was already stored, just in case Supabase ever
      // omits it on this grant type, rather than let a real logged-in
      // person suddenly show up unattributed after a routine refresh.
      email: (data.user && data.user.email) || s.email,
    });
    return true;
  } catch (e) {
    return false;
  }
}

function signOut() {
  clearStoredSession();
  window.location.href = '/tools/login.html';
}

// Call this at the top of every protected page, before rendering
// anything sensitive. Redirects to login if there's no valid session,
// attempting a silent refresh first if the access token has expired but
// a refresh token is still on hand.
// Call this before any authenticated write (upload, push, delete) that
// might happen well after page load -- requireAuth() only ever checks
// once, right when the page opens, with nothing keeping the session
// fresh while the tab stays open afterward. Access tokens are typically
// only good for about an hour; leaving a tab open longer than that and
// then trying to upload something is a completely normal use pattern,
// not an edge case, and previously meant the request silently fell back
// to the anon key -- which then gets correctly rejected by any bucket
// policy requiring a real authenticated user, surfacing as a confusing
// upload-http-400 with no indication the real cause was an expired
// session rather than anything about the file itself.
async function ensureFreshToken() {
  if (hasValidSession()) return true;
  const s = getStoredSession();
  if (s && s.refresh_token) {
    return await refreshSession();
  }
  return false;
}

async function requireAuth() {
  if (hasValidSession()) return true;
  const s = getStoredSession();
  if (s && s.refresh_token) {
    const refreshed = await refreshSession();
    if (refreshed) return true;
  }
  const returnTo = encodeURIComponent(window.location.pathname);
  window.location.href = '/tools/login.html?return=' + returnTo;
  return false;
}

// The token sync.js (and anything else making authenticated requests)
// should actually send as the Authorization bearer -- the user's own
// access token once logged in, NOT the anon key, since RLS policies
// keyed on auth.uid() only resolve correctly with a real user token.
function getAuthToken() {
  const token = hasValidSession() ? getStoredSession().access_token : SUPABASE_ANON_KEY;
  // Defensive validation added 2026-08-16, after a real "Failed to
  // construct 'Request': ... is not a valid ByteString" error while
  // testing a new panel -- that specific browser error means a header
  // value contained a character outside the Latin1 range, which a
  // genuine JWT (base64url: only A-Z, a-z, 0-9, -, _) can never
  // actually contain. Static code review turned up nothing -- the
  // fetch call itself was byte-for-byte the same shape as an already-
  // working one elsewhere -- so the real cause has to be the STORED
  // token value itself being unexpectedly malformed on that specific
  // device/session, not the code building the request. Rather than
  // let that surface again as a cryptic browser error with no way to
  // trace it, this validates the token is actually a normal-looking
  // string before handing it back, and logs a real diagnostic message
  // if not -- falling back to the anon key, which will correctly get
  // rejected by RLS rather than crash the request outright.
  if (typeof token !== 'string' || !/^[\x00-\xFF]*$/.test(token)) {
    if (typeof logClientError === 'function') {
      logClientError(
        'getAuthToken() returned an invalid token (type: ' + typeof token + ', length: ' + (token && token.length) + ') -- falling back to anon key.',
        'auth.js', null, null, null
      );
    }
    return SUPABASE_ANON_KEY;
  }
  return token;
}

// Whoever is actually logged in on this device right now, or null if
// there's no valid session (or an old session predating this field --
// signing out and back in picks it up). For attributing things a real
// person did -- e.g. Appliance Wiki crediting who logged an issue --
// without needing a separate honor-system "type your name" field once
// each person has their own real account instead of a shared one.
function getCurrentUserEmail() {
  const s = hasValidSession() ? getStoredSession() : null;
  return (s && s.email) || null;
}

// Just the two of you right now, so a plain lookup table beats trying to
// derive a name generically from an email address. Falls back to the
// email itself if an unrecognized account ever logs in, rather than
// showing nothing.
const KNOWN_USER_NAMES = {
  'connor@triplehenterprisesllc.biz': 'Connor',
  'steve@triplehenterprisesllc.biz': 'Steve',
};
function getCurrentUserFirstName() {
  const email = getCurrentUserEmail();
  if (!email) return null;
  return KNOWN_USER_NAMES[email.toLowerCase()] || email;
}

// ---------------------------------------------------------------------------
// ACCOUNT ROLES -- added 2026-08-14. Replaces the old hardcoded
// "only connor@ gets dev tools" check with a real, database-backed role
// system (role_definitions + account_roles tables in Supabase). Steve's
// account now holds "Owner" and gets identical dev-tools access to
// Connor's "Developer" role -- Developer's only extra capability is
// managing the role system itself (creating new roles, reassigning
// accounts), tracked as can_manage_roles rather than hardcoded to a
// specific role name, so a future role could carry that too.
//
// loadCurrentUserRole() is called from initSyncOnLoad() in sync.js, so
// by the time any page's own load logic runs, the synchronous
// accessors below already have a real answer cached.
// ---------------------------------------------------------------------------

let _cachedRoleInfo = null; // { roleName, canManageRoles, description } once loaded, or null if unassigned/not loaded

// Called from initSyncOnLoad() before anything else touches the
// session, added 2026-08-16 after "sometimes I have to refresh for
// Dev Tools to show up" turned out to be a real, explainable race
// rather than something flaky: if the stored access token happened to
// be expired at the exact moment this ran, getCurrentUserEmail()
// returned null (bailing out immediately, below) and separately
// getAuthToken() would have silently fallen back to the public anon
// key -- which account_roles' RLS correctly rejects for anyone but a
// real authenticated user, coming back as zero rows rather than an
// error. Either path alone was enough to leave the role permanently
// null for that page load, even though a background session refresh
// (kicked off elsewhere, unawaited) would often finish a moment
// later -- too late to matter, since nothing re-ran the role check
// afterward. A second load (i.e. hitting refresh) worked because by
// then the earlier refresh had already completed and been stored.
// ensureFreshToken() is exactly the same guard already used
// defensively before other authenticated calls elsewhere in this
// codebase -- this closes the one place it was missing.
async function loadCurrentUserRole() {
  await ensureFreshToken();
  const email = getCurrentUserEmail();
  if (!email) { _cachedRoleInfo = null; return null; }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/account_roles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=role_name,role_definitions(can_manage_roles,can_access_dev_tools,can_manage_site_content,can_manage_business_finances,description)`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${getAuthToken()}`,
        },
      }
    );
    if (!res.ok) { _cachedRoleInfo = null; return null; }
    const rows = await res.json();
    if (!rows.length) { _cachedRoleInfo = null; return null; }
    const row = rows[0];
    const def = row.role_definitions || {};
    _cachedRoleInfo = {
      roleName: row.role_name,
      canManageRoles: !!def.can_manage_roles,
      // Added 2026-08-27, alongside the new Employee role -- before
      // this, hasDevToolsAccess() below just checked "does this
      // account have ANY role assigned at all," which would have
      // wrongly granted a restricted Employee role full Dev Tools
      // access too, the same as Owner or Developer. Defaults to true
      // if this column is ever missing from a response for some
      // reason (a role predating this change, or a query that didn't
      // select it) -- fails open to the pre-existing behavior rather
      // than silently locking out an account that used to have access.
      canAccessDevTools: def.can_access_dev_tools !== false,
      canManageSiteContent: def.can_manage_site_content !== false,
      canManageBusinessFinances: def.can_manage_business_finances !== false,
      description: def.description || '',
    };
    return _cachedRoleInfo;
  } catch (e) {
    _cachedRoleInfo = null;
    return null;
  }
}

// Synchronous accessor -- only meaningful once loadCurrentUserRole() has
// resolved (initSyncOnLoad() does this automatically). Returns null if
// not loaded yet, or if the logged-in account has no role assigned.
function getCurrentUserRole() {
  return _cachedRoleInfo;
}

// True only for a role with can_access_dev_tools set (Owner and
// Developer, by default -- NOT Employee, added 2026-08-27 specifically
// to be excluded here). Used to be "any account with a real assigned
// role at all," which was correct back when only Owner/Developer
// existed, but would have wrongly given a restricted Employee role
// full Dev Tools access the same as everyone else.
function hasDevToolsAccess() {
  return !!(_cachedRoleInfo && _cachedRoleInfo.canAccessDevTools);
}

// True only for a role with can_manage_roles set (Developer, by
// default) -- gates creating new roles or reassigning an account's role.
function canManageRoles() {
  return !!(_cachedRoleInfo && _cachedRoleInfo.canManageRoles);
}

// True for a role with can_manage_site_content set (Owner and
// Developer, by default). Added 2026-08-27, requested directly ("bump
// the owner role to be able to manage the main site through dev
// tools") -- previously, site-content.html gated on hasDevToolsAccess()
// alone, which happened to already include Owner, but wasn't an
// explicit, named permission the way this is. Gates site-content.html
// specifically, separate from Dev Tools access in general, so a
// future role could have one without the other.
function canManageSiteContent() {
  return !!(_cachedRoleInfo && _cachedRoleInfo.canManageSiteContent);
}

// True for a role with can_manage_business_finances set (Owner and
// Developer, by default -- NOT Employee). Added 2026-08-27 alongside
// the new Employee role. Gates finance.html, runway-dashboard.html,
// invoice-generator.html, contract-generator.html, and
// review-request.html -- pricing, billing, contracts, and the
// business's actual financial numbers, none of which a basic,
// job-focused Employee role needs to see or touch.
function canManageBusinessFinances() {
  return !!(_cachedRoleInfo && _cachedRoleInfo.canManageBusinessFinances);
}

// Superseded by hasDevToolsAccess() above -- kept as a thin wrapper
// since nothing needs to change at any existing call site.
function isDevAccount() {
  return hasDevToolsAccess();
}

// Decodes the JWT's payload to pull out the logged-in user's ID (the
// `sub` claim) without needing a network round-trip. Doesn't verify the
// token's signature -- that's the database's job via RLS, not this
// function's; this is only ever used to know WHICH row to write to.
function getCurrentUserId() {
  if (!hasValidSession()) return null;
  try {
    const token = getStoredSession().access_token;
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.sub || null;
  } catch (e) {
    return null;
  }
}
