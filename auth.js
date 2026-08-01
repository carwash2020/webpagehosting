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

function getStoredSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null'); }
  catch (e) { return null; }
}
function storeSession(session) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}
function clearStoredSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

// Returns true if there's a session and its access token hasn't expired
// yet (with a 60-second safety buffer).
function hasValidSession() {
  const s = getStoredSession();
  if (!s || !s.access_token || !s.expires_at) return false;
  return Date.now() < (s.expires_at * 1000) - 60000;
}

async function signIn(email, password) {
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
    });
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
