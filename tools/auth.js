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
  window.location.href = '/login.html';
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
  window.location.href = '/login.html?return=' + returnTo;
  return false;
}

// The token sync.js (and anything else making authenticated requests)
// should actually send as the Authorization bearer -- the user's own
// access token once logged in, NOT the anon key, since RLS policies
// keyed on auth.uid() only resolve correctly with a real user token.
function getAuthToken() {
  return hasValidSession() ? getStoredSession().access_token : SUPABASE_ANON_KEY;
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
