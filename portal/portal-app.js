// Client portal shared app-shell JavaScript (2026-09-04), paired
// with portal/portal-app.css. Currently just the skeleton-loading
// helpers, requested directly: "Skeleton loading states." A
// dedicated home for this rather than duplicating the same template
// string across five pages, and a natural place for other shared
// app-shell behavior (pull-to-refresh, an offline indicator) as
// those get built.

// A generic card shape (title bar + two lines of varying width),
// repeated `count` times. Not a bespoke skeleton per page -- this is
// a reasonable approximation of every real card class on the portal
// (invoice-card, job-card, quote-card, wo-card, set-card), and
// building a pixel-matched skeleton per page would be considerably
// more work for a perceptual improvement that doesn't need it.
function portalSkeletonCards(count) {
  const card =
    '<div class="skeleton-card">' +
    '<div class="skeleton-line is-title"></div>' +
    '<div class="skeleton-line is-wide"></div>' +
    '<div class="skeleton-line is-narrow"></div>' +
    '</div>';
  return card.repeat(count);
}

// A smaller variant for nested contexts, e.g. a message thread
// opening inside an already-visible work order card, where a
// full-sized card skeleton would be visually heavier than the space
// it sits in.
function portalSkeletonLines(count) {
  const line =
    '<div class="skeleton-mini">' +
    '<div class="skeleton-line is-medium"></div>' +
    '</div>';
  return line.repeat(count);
}

// Offline indicator (2026-09-04), requested directly. Checks
// navigator.onLine on init (in case a page loads while already
// offline, e.g. opened from the installed app with no signal) and
// listens for the browser's own online/offline events after that --
// no polling, since those events fire reliably on every platform
// this app targets.
function initOfflinePortalIndicator() {
  let banner = document.getElementById('offlinePortalBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlinePortalBanner';
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = "You're offline -- showing saved data";
    document.body.appendChild(banner);
  }

  function updateBanner() {
    banner.classList.toggle('is-visible', !navigator.onLine);
  }

  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);
  updateBanner();
}

// Self-initializing rather than requiring an explicit call on each
// page: this feature is fully generic (show a banner if offline,
// hide it if not) and doesn't depend on any page-specific state, so
// there's no reason to hunt down 8 differently-structured pages'
// own init patterns just to wire up the same call everywhere.
// Pull-to-refresh below stays an explicit per-page call, since it
// genuinely needs a page-specific refresh callback.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOfflinePortalIndicator);
} else {
  initOfflinePortalIndicator();
}

// Pull-to-refresh (2026-09-04), requested directly: "Make swiping
// feel good, but don't over do it." One restrained gesture, not a
// gesture library: pull down from the very top of the page, a small
// spinner grows in tracking the finger exactly (no lag, no CSS
// transition while dragging), release past REFRESH_THRESHOLD to
// trigger onRefresh, or below it and the indicator snaps back with
// the one deliberate animation this feature has.
//
// Only arms when window.scrollY is already 0 -- pulling down while
// mid-scroll should scroll the page normally, not hijack the
// gesture, which is the actual native convention this is copying.
function initPortalPullToRefresh(onRefresh) {
  const REFRESH_THRESHOLD = 70;
  const MAX_PULL = 100;

  let indicator = document.getElementById('ptrIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'ptrIndicator';
    indicator.className = 'ptr-indicator';
    indicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14.5-4.5M20 12a8 8 0 0 1-14.5 4.5"/><path d="M18.5 3v5h-5M5.5 21v-5h5"/></svg>';
    document.body.appendChild(indicator);
  }

  let startY = null;
  let pulling = false;
  let refreshing = false;

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0 || refreshing) return;
    startY = e.touches[0].clientY;
    pulling = true;
    indicator.classList.remove('is-snapping');
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling || startY === null) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) return;
    const pull = Math.min(delta * 0.5, MAX_PULL);
    indicator.style.transform = `translate(-50%, ${pull - 36}px)`;
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    const currentPull = indicator.style.transform;
    const match = currentPull.match(/,\s*(-?[\d.]+)px\)/);
    const pulledPast = match && parseFloat(match[1]) >= (REFRESH_THRESHOLD * 0.5 - 36);

    indicator.classList.add('is-snapping');
    if (pulledPast && !refreshing) {
      refreshing = true;
      indicator.classList.add('is-refreshing');
      indicator.style.transform = 'translate(-50%, 20px)';
      Promise.resolve(onRefresh()).finally(() => {
        refreshing = false;
        indicator.classList.remove('is-refreshing');
        indicator.style.transform = 'translate(-50%, -100%)';
      });
    } else {
      indicator.style.transform = 'translate(-50%, -100%)';
    }
    startY = null;
  });
}

// Biometric app lock (2026-09-05), requested directly: "biometric
// unlock." Deliberately NOT Supabase's own native passkey feature
// (released as a beta, experimental API this year) -- that would
// replace the actual sign-in mechanism, requires a Dashboard-level
// relying-party configuration this code can't set up on its own, and
// carries an explicit "may change without notice" warning from
// Supabase itself. This is a local-only pattern instead, the same
// one most banking apps actually use: the client already signs in
// normally with a password, and stays signed in via Supabase's own
// session persistence exactly as before. WebAuthn's platform
// authenticator (Face ID, Touch ID, Windows Hello, or a device PIN)
// is used purely as a LOCAL gate in front of that already-valid
// session -- nothing here is verified by, or even sent to, any
// server. Being honest about what this means: it's a convenience/UX
// gate, not a second server-verified authentication factor. A
// credential id is stored per-email in localStorage, since more than
// one portal account could plausibly sign in on the same shared
// device/browser.

function portalBiometricLockKey(email) {
  return 'th_portal_biometric_lock_' + email.toLowerCase();
}

function portalBiometricLockSupported() {
  return typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined';
}

function portalIsBiometricLockEnabled(email) {
  return !!localStorage.getItem(portalBiometricLockKey(email));
}

function portalDisableBiometricLock(email) {
  localStorage.removeItem(portalBiometricLockKey(email));
}

// Registers a new local credential, requested from Settings. The
// challenge only needs to be unguessable, not verified by a server
// (there is no server round-trip in this pattern at all) -- a fresh
// random value is sufficient.
async function portalRegisterBiometricLock(email) {
  if (!portalBiometricLockSupported()) {
    return { ok: false, error: "This device/browser doesn't support biometric unlock." };
  }
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Triple H Enterprises Portal' },
        user: { id: userId, name: email, displayName: email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    });
    if (!credential) return { ok: false, error: 'Setup was cancelled.' };
    const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
    localStorage.setItem(portalBiometricLockKey(email), credentialId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Could not set up biometric unlock on this device.' };
  }
}

// Prompts the actual unlock. Returns true only on a real, successful
// local verification -- any cancellation, timeout, or error is a
// clear false rather than something that could be misread as success.
async function portalPromptBiometricUnlock(email) {
  const stored = localStorage.getItem(portalBiometricLockKey(email));
  if (!stored) return false;
  try {
    const credentialId = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credentialId, type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch (e) {
    return false;
  }
}

// The actual per-page gate, called from each page's own init() right
// after a valid session is confirmed -- same explicit-per-page-call
// pattern already established for pull-to-refresh above, since this
// genuinely needs to know which email's lock setting to check, which
// only the page's own session lookup has. Resolves immediately if the
// lock isn't enabled for this email; otherwise blocks by showing a
// full-screen overlay until a real unlock succeeds, with a fallback
// to sign out and use a password instead for a lost/unavailable
// authenticator.
// Module-level, resets naturally on every real page load since this
// file itself is freshly loaded then -- tracks whether the gate has
// already resolved once for this page's lifetime. Several pages call
// their main render function more than once (pull-to-refresh, after
// an action, etc.), and each of those calls invokes this same gate;
// without this flag, the lock would re-prompt every single time
// instead of just once per page open.
let portalBiometricGatePassed = false;

function portalGuardWithBiometricLock(email, client) {
  if (portalBiometricGatePassed) return Promise.resolve();

  return new Promise((resolve) => {
    if (!portalIsBiometricLockEnabled(email)) { portalBiometricGatePassed = true; resolve(); return; }

    const overlay = document.createElement('div');
    overlay.className = 'biometric-lock-overlay';
    overlay.innerHTML =
      '<div class="biometric-lock-box">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="biometric-lock-icon"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
      '<div class="biometric-lock-title">Locked</div>' +
      '<div class="biometric-lock-sub">Unlock with Face ID, Touch ID, or your device PIN.</div>' +
      '<button class="btn blue" id="biometricUnlockBtn" style="width:100%; justify-content:center; margin-top:18px;">Unlock</button>' +
      '<button class="small-btn" id="biometricFallbackBtn" style="margin-top:12px;">Use password instead</button>' +
      '</div>';
    document.body.appendChild(overlay);

    async function attemptUnlock() {
      const btn = document.getElementById('biometricUnlockBtn');
      btn.disabled = true;
      btn.textContent = 'Unlocking...';
      const success = await portalPromptBiometricUnlock(email);
      if (success) {
        portalBiometricGatePassed = true;
        overlay.remove();
        resolve();
      } else {
        btn.disabled = false;
        btn.textContent = 'Unlock';
      }
    }

    document.getElementById('biometricUnlockBtn').addEventListener('click', attemptUnlock);
    document.getElementById('biometricFallbackBtn').addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.replace('/portal/login.html');
    });

    // Prompt automatically once on load -- most platforms allow this
    // without a prior user gesture for a conditional/direct
    // credential request, and it saves an extra tap on the common
    // path. The visible button above is the fallback for browsers
    // that require a gesture first, or a user who dismissed the
    // automatic prompt.
    attemptUnlock();
  });
}

// Automatic error capture (2026-09-05), requested directly: "future
// proof this... what other layers can we add." Internal tools
// already catch every JS error automatically (th_client_errors); the
// portal only ever had a client-INITIATED "Report a problem" button
// -- a silent bug could go unnoticed indefinitely unless a client
// happens to notice and bothers reporting it themselves.
//
// Deliberately self-contained rather than reading the page's own
// SUPABASE_URL/SUPABASE_ANON_KEY globals: this file loads in <head>,
// before those are defined further down each page, and an error can
// fire at any point including before that line runs. The anon key
// embedded here is the exact same PUBLIC key already hardcoded
// identically on every portal page -- not a new secret, just a
// second copy avoiding a real timing dependency.
const PORTAL_ERROR_LOG_SUPABASE_URL = 'https://csvfqdjuobylgafgolho.supabase.co';
const PORTAL_ERROR_LOG_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzdmZxZGp1b2J5bGdhZmdvbGhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNTQ3MjcsImV4cCI6MjEwMDkzMDcyN30.6GlvK-DfXf2lppS1kciZtsl4wHOpZz_yKtwsS1lyjrs';

// A small in-memory cap per page load, not a server-side rate limit:
// a genuine JS error inside a loop (or a repeated rejection) could
// otherwise fire hundreds of times in seconds, and there's no value
// in a hundred identical rows for the same single bug.
let portalErrorLogCount = 0;
const PORTAL_ERROR_LOG_MAX_PER_PAGE = 10;

function logPortalClientError(message, source, lineno, colno, stack) {
  try {
    if (portalErrorLogCount >= PORTAL_ERROR_LOG_MAX_PER_PAGE) return;
    portalErrorLogCount++;

    let clientEmail = null;
    // Best-effort only -- client may be signed out, mid-auth-check,
    // or this may be running before any client variable even exists
    // on this specific page. A missing email is fine (the whole
    // point of client_email being nullable); a thrown lookup here
    // must never prevent the actual error report from going out.
    try {
      if (typeof client !== 'undefined' && client.auth && client.auth.getSession) {
        client.auth.getSession().then((res) => {
          const email = res && res.data && res.data.session && res.data.session.user && res.data.session.user.email;
          sendPortalErrorReport(message, source, lineno, colno, stack, email || null);
        }).catch(() => sendPortalErrorReport(message, source, lineno, colno, stack, null));
        return;
      }
    } catch (e) { /* fall through to sending without an email below */ }
    sendPortalErrorReport(message, source, lineno, colno, stack, clientEmail);
  } catch (e) {
    // If even logging the error fails, give up silently rather than
    // risk looping back into another error.
  }
}

function sendPortalErrorReport(message, source, lineno, colno, stack, clientEmail) {
  try {
    fetch(`${PORTAL_ERROR_LOG_SUPABASE_URL}/rest/v1/portal_client_errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': PORTAL_ERROR_LOG_ANON_KEY,
        'Authorization': `Bearer ${PORTAL_ERROR_LOG_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        client_email: clientEmail,
        message: String(message == null ? 'Unknown error' : message).slice(0, 500),
        source: source ? String(source).slice(0, 300) : null,
        line: typeof lineno === 'number' ? lineno : null,
        col: typeof colno === 'number' ? colno : null,
        stack: stack ? String(stack).slice(0, 1000) : null,
        page_url: window.location.pathname,
        user_agent: navigator.userAgent ? navigator.userAgent.slice(0, 300) : null,
      }),
    }).catch(() => { /* best-effort; a failed report is not itself worth reporting */ });
  } catch (e) { /* same as above */ }
}

window.addEventListener('error', (event) => {
  logPortalClientError(event.message, event.filename, event.lineno, event.colno, event.error && event.error.stack);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason && reason.message ? reason.message : String(reason);
  const stack = reason && reason.stack ? reason.stack : '';
  logPortalClientError(message, 'unhandledrejection', null, null, stack);
});

