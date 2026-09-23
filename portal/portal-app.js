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
// Fixed 2026-09-05, reported directly: "with Face Id enabled on
// settings, it requires it between every tab switch... it's
// inconvenient having to put in the password just to switch between
// pages." The original module-level boolean flag reset to false on
// EVERY page load, since this is a multi-page app -- each navigation
// is a fresh document, a fresh JS execution context, and a fresh
// copy of this file. That's exactly why it re-prompted on every tab
// switch: it wasn't tracking "unlocked this app session," it was
// only ever tracking "unlocked since this specific page loaded,"
// which reset every single time.
//
// sessionStorage is the right mechanism instead: it persists across
// every navigation within the same browser tab/session, but is
// cleared the moment the tab or app is actually closed -- matching
// "not again unless the app is cleared again" exactly. Keyed by
// email (not global), matching the same per-email keying the lock's
// own enabled-state already uses -- a different account signing in
// on the same shared device gets its own, separately-tracked
// unlocked state, defaulting to locked.
function portalBiometricUnlockedSessionKey(email) {
  return 'th_portal_biometric_unlocked_' + email.toLowerCase();
}

function portalGuardWithBiometricLock(email, client) {
  // A second step still owed comes first (2026-09-23): Face ID standing
  // in for the 2FA code is itself the unlock, so it never asks twice.
  return portalRequireSecondStep(email, client).then((stoodIn) => {
    if (stoodIn) return undefined;
    return portalBiometricLockGate(email, client);
  });
}

function portalBiometricLockGate(email, client) {
  if (sessionStorage.getItem(portalBiometricUnlockedSessionKey(email))) return Promise.resolve();

  return new Promise((resolve) => {
    if (!portalIsBiometricLockEnabled(email)) {
      sessionStorage.setItem(portalBiometricUnlockedSessionKey(email), '1');
      resolve();
      return;
    }

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
        sessionStorage.setItem(portalBiometricUnlockedSessionKey(email), '1');
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

// Face ID instead of the 2FA code (2026-09-23), requested directly:
// "facial recognition AND two factor is way too much. Make it pick
// facial over two factor... also make two factor optional." Two-factor
// stays optional (off unless the client turns it on in Settings). For an
// account that has it on, the second step after the password is now one
// thing, not two:
//   - on a device where this account has Face ID set up, Face ID (or
//     Touch ID / the device PIN) stands in for the authenticator code;
//   - anywhere else -- a new device, a browser without Face ID set up,
//     or Face ID failing -- it's the code, exactly as before.
// And right after a fresh sign-in the Face ID lock doesn't ask again.
//
// What this is and isn't, honestly: Face ID here is still the local-only
// WebAuthn check described above, so a session it lets through stays at
// Supabase's aal1 (password only) as far as the server is concerned. No
// portal RLS policy has ever required aal2, so that changes nothing
// server-side. What it does change: before this, the code was only
// asked for by login.html's own pop-up -- refreshing the page after a
// correct password skipped it entirely. Every page now checks whether
// the session still owes its second step and asks for it (Face ID here,
// or back to login.html for the code). The key below records, for this
// tab only, that Face ID already stood in, so the step isn't re-asked on
// every page.
function portalSecondStepKey(email) {
  return 'th_portal_second_step_' + email.toLowerCase();
}

// True when this session proved only the password on an account with
// two-factor on, and Face ID hasn't stood in for the code yet in this tab.
// getAuthenticatorAssuranceLevel() reads the current session, not the
// network; any error reads as "nothing owed", the behavior before this.
async function portalSecondStepOwed(email, client) {
  if (sessionStorage.getItem(portalSecondStepKey(email))) return false;
  try {
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    return !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
  } catch (e) {
    return false;
  }
}

// A fresh sign-in just proved who this is: no Face ID lock right after.
function portalMarkSignedIn(email) {
  sessionStorage.setItem(portalBiometricUnlockedSessionKey(email), '1');
}

// The second step, by Face ID. Resolves once Face ID succeeds (marking
// both the step and the lock done for this tab). "Use my 2FA code
// instead" hands off to onUseCode and leaves this promise pending, so a
// caller awaiting it never carries on as if Face ID had passed.
function portalFaceIdInsteadOfCode(email, onUseCode) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'biometric-lock-overlay';
    overlay.innerHTML =
      '<div class="biometric-lock-box" role="dialog" aria-modal="true" aria-labelledby="faceIdStepTitle">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="biometric-lock-icon"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
      '<div class="biometric-lock-title" id="faceIdStepTitle">Confirm it’s you</div>' +
      '<div class="biometric-lock-sub">On this device, Face ID, Touch ID, or your device PIN stands in for your 2FA code.</div>' +
      '<button class="btn blue" id="faceIdStepBtn" style="width:100%; justify-content:center; margin-top:18px;">Continue with Face ID</button>' +
      '<button class="small-btn" id="faceIdStepCodeBtn" style="margin-top:12px;">Use my 2FA code instead</button>' +
      '</div>';
    document.body.appendChild(overlay);

    async function attempt() {
      const btn = document.getElementById('faceIdStepBtn');
      btn.disabled = true;
      btn.textContent = 'Checking...';
      const ok = await portalPromptBiometricUnlock(email);
      if (ok) {
        sessionStorage.setItem(portalSecondStepKey(email), '1');
        sessionStorage.setItem(portalBiometricUnlockedSessionKey(email), '1');
        overlay.remove();
        resolve();
      } else {
        btn.disabled = false;
        btn.textContent = 'Continue with Face ID';
      }
    }
    document.getElementById('faceIdStepBtn').addEventListener('click', attempt);
    document.getElementById('faceIdStepCodeBtn').addEventListener('click', () => {
      overlay.remove();
      onUseCode();
    });
    // Same once-on-load attempt as the lock overlay; the button covers a
    // browser that wants a tap first.
    attempt();
  });
}

// Every signed-in page's check that the second step isn't still owed.
// Resolves true when Face ID just stood in for the code, false when
// nothing was owed; with no Face ID on this device it goes to login.html
// for the code and never resolves, so the page never renders.
// One place that leaves the page, so a test can see where it would go.
function portalGo(url) {
  window.location.replace(url);
}

async function portalRequireSecondStep(email, client) {
  if (!(await portalSecondStepOwed(email, client))) return false;
  const toCode = () => portalGo('/portal/login.html?step=code');
  if (!portalIsBiometricLockEnabled(email)) {
    toCode();
    return new Promise(() => {});
  }
  await portalFaceIdInsteadOfCode(email, toCode);
  return true;
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

// Basic focus containment for modals/overlays (2026-09-07), found
// missing from every one of them on the portal: the confirm modal
// below, the pre-existing report-a-problem modal (every page) and
// payment modal (dashboard.html), and the job-photo lightbox
// (jobs.html). Tab could silently move keyboard focus onto background
// page content -- an invoice row, a nav link -- while any of them was
// visually covering the screen. Returns a release() function that
// removes the trap and restores focus to whatever was focused before
// the modal opened, matching standard dialog behavior.
function trapFocusWithin(container, initialFocusEl) {
  var FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var previouslyFocused = document.activeElement;

  function focusableEls() {
    return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(function (el) { return el.offsetParent !== null; });
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    var els = focusableEls();
    if (!els.length) return;
    var first = els[0];
    var last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeydown);
  var toFocus = initialFocusEl || focusableEls()[0];
  if (toFocus) toFocus.focus();

  return function release() {
    document.removeEventListener('keydown', onKeydown);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
  };
}

// Themed replacement for window.confirm() (2026-09-07), found sitting
// next to the app's own fully-themed modal patterns (the payment
// modal, the report-a-problem modal) -- the one raw platform dialog
// left in front of a client, on exactly the two actions where it
// matters most (declining a quote, removing a saved card). Builds its
// own overlay/modal in the DOM on first use rather than requiring
// every calling page to add static markup for it, since this file is
// already loaded on every portal page -- one shared implementation
// covers every future confirmation too, not just these two.
//
// Returns a Promise<boolean> rather than blocking like window.confirm
// did; callers already awaited an async function before this (the
// Supabase call that follows), so `if (!(await portalConfirm(...)))
// return;` is a drop-in replacement for `if (!window.confirm(...))
// return;`.
function portalConfirm(message, options) {
  options = options || {};
  const confirmLabel = options.confirmLabel || 'Confirm';
  const cancelLabel = options.cancelLabel || 'Cancel';
  const isDanger = options.danger !== false; // most confirms guard a destructive/hard-to-undo action

  return new Promise((resolve) => {
    let overlay = document.getElementById('portalConfirmOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'portalConfirmOverlay';
      overlay.className = 'portal-confirm-overlay';
      overlay.innerHTML =
        '<div class="portal-confirm-modal">' +
        '<p class="portal-confirm-message" id="portalConfirmMessage"></p>' +
        '<div class="portal-confirm-actions">' +
        '<button type="button" class="btn secondary-btn" id="portalConfirmCancel"></button>' +
        '<button type="button" class="btn" id="portalConfirmOk"></button>' +
        '</div></div>';
      document.body.appendChild(overlay);
    }

    const messageEl = document.getElementById('portalConfirmMessage');
    const okBtn = document.getElementById('portalConfirmOk');
    const cancelBtn = document.getElementById('portalConfirmCancel');
    messageEl.textContent = message;
    okBtn.textContent = confirmLabel;
    okBtn.className = 'btn ' + (isDanger ? 'orange' : 'blue');
    cancelBtn.textContent = cancelLabel;

    let releaseFocusTrap = null;
    function cleanup(result) {
      overlay.classList.remove('is-visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      if (releaseFocusTrap) releaseFocusTrap();
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlayClick(e) { if (e.target === overlay) cleanup(false); }
    function onKeydown(e) { if (e.key === 'Escape') cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);

    overlay.classList.add('is-visible');
    releaseFocusTrap = trapFocusWithin(overlay, okBtn);
  });
}

// Optional-reason variant of portalConfirm() (2026-09-19), requested
// directly: declining a quote used to be a plain yes/no confirm with
// no way to say why -- Steve never learned what changed a client's
// mind. Reuses the exact same overlay/modal styling and focus-trap
// pattern as portalConfirm() (a second, separate overlay element,
// since both could in principle be triggered from the same page).
// Resolves with the trimmed textarea value (possibly '') on confirm,
// or null if cancelled -- same null-vs-empty-string distinction
// tools/tools-dialogs.js's showFlagDialog() already uses for the
// internal tools suite's equivalent optional-note dialog.
function portalPromptTextarea(message, options) {
  options = options || {};
  const confirmLabel = options.confirmLabel || 'Confirm';
  const cancelLabel = options.cancelLabel || 'Cancel';

  return new Promise((resolve) => {
    let overlay = document.getElementById('portalPromptOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'portalPromptOverlay';
      overlay.className = 'portal-confirm-overlay';
      overlay.innerHTML =
        '<div class="portal-confirm-modal">' +
        '<p class="portal-confirm-message" id="portalPromptMessage"></p>' +
        '<textarea class="portal-prompt-textarea" id="portalPromptTextarea" rows="3"></textarea>' +
        '<div class="portal-confirm-actions">' +
        '<button type="button" class="btn secondary-btn" id="portalPromptCancel"></button>' +
        '<button type="button" class="btn orange" id="portalPromptOk"></button>' +
        '</div></div>';
      document.body.appendChild(overlay);
    }

    const messageEl = document.getElementById('portalPromptMessage');
    const textarea = document.getElementById('portalPromptTextarea');
    const okBtn = document.getElementById('portalPromptOk');
    const cancelBtn = document.getElementById('portalPromptCancel');
    messageEl.textContent = message;
    textarea.value = '';
    textarea.placeholder = options.placeholder || '';
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;

    let releaseFocusTrap = null;
    function cleanup(result) {
      overlay.classList.remove('is-visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      if (releaseFocusTrap) releaseFocusTrap();
      resolve(result);
    }
    function onOk() { cleanup(textarea.value.trim()); }
    function onCancel() { cleanup(null); }
    function onOverlayClick(e) { if (e.target === overlay) cleanup(null); }
    function onKeydown(e) { if (e.key === 'Escape') cleanup(null); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);

    overlay.classList.add('is-visible');
    releaseFocusTrap = trapFocusWithin(overlay, textarea);
  });
}

// Themed replacement for window.alert() on the error/validation paths
// still using it across dashboard.html, quotes.html and settings.html
// (2026-09-15). Mirrors the internal tool suite's own showToast()
// convention exactly (tools/tools-dialogs.js's ensureToastContainerExists()
// + tools/tools-media-sharing.js's showToast()/dismissToast()) -- same
// function name and options shape ({ type: 'error', duration }), same
// class names (.th-toast/.th-toast-container/.is-error/.is-shown), same
// auto-dismiss-plus-tap-to-dismiss behavior -- so this is one convention
// learned once, not two. The one difference: the tool suite's version
// references icons from a shared <symbol> sprite injected by
// tools-nav-pwa.js, which the portal does not load (that file also
// drives the internal tools' own PWA/bottom-nav wiring, which has no
// portal equivalent) -- so this version draws the same two glyphs
// (check / warning) as small inline SVGs instead of `<use>` references.
//
//   showToast('Job updated.');
//   showToast('Could not reach the server.', { type: 'error' });
function ensurePortalToastContainerExists() {
  if (document.getElementById('thToastContainer')) return document.getElementById('thToastContainer');
  const container = document.createElement('div');
  container.id = 'thToastContainer';
  container.className = 'th-toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('role', 'status');
  document.body.appendChild(container);
  return container;
}

function showToast(message, options) {
  options = options || {};
  const duration = options.duration || 2600;
  const isError = options.type === 'error';
  const container = ensurePortalToastContainerExists();

  const toast = document.createElement('div');
  toast.className = 'th-toast' + (isError ? ' is-error' : '');
  toast.innerHTML =
    (isError
      ? '<svg class="th-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9.5 16.5H2.5z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/></svg>'
      : '<svg class="th-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.5 2.5 5.5-5.6"/></svg>') +
    '<span></span>';
  toast.querySelector('span').textContent = message; // textContent, not innerHTML -- message may contain user data
  toast.addEventListener('click', () => dismissToast(toast));
  container.appendChild(toast);

  // Letting the element paint in its resting state before adding
  // .is-shown means the CSS transition actually animates in, instead of
  // starting already-visible.
  requestAnimationFrame(() => toast.classList.add('is-shown'));

  const timer = setTimeout(() => dismissToast(toast), duration);
  toast._thTimer = timer;
}

function dismissToast(toast) {
  if (!toast || toast._thDismissed) return;
  toast._thDismissed = true;
  clearTimeout(toast._thTimer);
  toast.classList.remove('is-shown');
  setTimeout(() => toast.remove(), 200);
}

// ---------- Your visits (2026-09-22) ----------
// Every self-scheduling path in the portal (an approved quote, a
// check-up reminder) and the public booking.html flow write a real
// th_bookings row, but th_bookings is internal-only under RLS -- so
// until this, a client lost sight of an appointment the moment they
// booked it. get_my_portal_visits() (sql/portal/add_get_my_portal_visits.sql)
// is a SECURITY DEFINER read scoped to the caller's own session email,
// returning only client-safe columns. Shared here because Home, Quotes
// and Jobs all need the same list.
//
// Resolves { visits, error } rather than throwing: every caller treats
// a failed lookup as "nothing extra to show" and keeps rendering the
// data it already has, instead of failing a whole page over an
// enhancement.
async function portalFetchMyVisits(supabaseClient) {
  try {
    const { data, error } = await supabaseClient.rpc('get_my_portal_visits');
    if (error) return { visits: [], error };
    return { visits: Array.isArray(data) ? data : [], error: null };
  } catch (e) {
    return { visits: [], error: e };
  }
}

// The business's own timezone, not the viewer's -- the same fixed zone
// every confirmation/reminder email and booking.html already use, so a
// time never reads differently here than in the email about it.
function portalFormatVisitWhen(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

// Month / day / weekday for a calendar-style date tile, in the same
// business timezone as portalFormatVisitWhen() so the tile and the
// sentence beside it can never disagree about which day it is.
function portalVisitDateParts(iso) {
  const d = new Date(iso);
  const part = (opts) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'America/Denver' }, opts)).format(d);
  return { month: part({ month: 'short' }).toUpperCase(), day: part({ day: 'numeric' }), weekday: part({ weekday: 'short' }) };
}

function portalFormatVisitTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

// manage-booking.html is the existing guest reschedule/cancel page the
// confirmation and reminder emails already link to with this exact
// token. The RPC only returns a token while the booking is confirmed.
function portalManageVisitUrl(visit) {
  return visit && visit.manage_token
    ? '/manage-booking.html?token=' + encodeURIComponent(visit.manage_token)
    : '';
}

// Only confirmed visits that haven't ended yet, soonest first. Returns
// a new array; never mutates what the RPC handed back.
function portalUpcomingConfirmedVisits(visits, now) {
  const nowMs = (now || new Date()).getTime();
  return (visits || [])
    .filter(v => v && v.status === 'confirmed' && v.start_at && new Date(v.end_at || v.start_at).getTime() > nowMs)
    .slice()
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
}

// ---------- Add to calendar (.ics) ----------
// Same Blob-download approach tools/job-tracker.html's "Add to Phone"
// already uses, but a timed event (DTSTART/DTEND in UTC) rather than
// an all-day one, since every visit here has a real start time.
// RFC 5545 details handled here that the internal version skips:
// TEXT escaping (backslash, semicolon, comma, newline) and folding
// lines longer than 75 octets -- a long street address plus the manage
// link in DESCRIPTION can easily pass that.
function portalIcsEscape(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function portalIcsFold(line) {
  // Folds on character boundaries at <=73 chars per physical line (a
  // conservative stand-in for 75 octets that stays safe for the
  // mostly-ASCII text this ever carries), continuation lines starting
  // with a single space as the spec requires.
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length) {
    parts.push(' ' + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  return parts.join('\r\n');
}

function portalIcsUtc(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// visit: { uid, title, start, end?, address?, manageUrl? }. A visit
// with no known end (a scheduled work request only stores a start)
// gets the same 2-hour default every portal scheduling flow already
// books with.
function portalBuildVisitIcs(visit, now) {
  const start = new Date(visit.start);
  const end = visit.end ? new Date(visit.end) : new Date(start.getTime() + 120 * 60 * 1000);
  const descParts = ['Questions, or running late? Call or text Triple H at (435) 414-1667.'];
  if (visit.manageUrl) descParts.push('Reschedule or cancel: https://www.triplehenterprisesllc.biz' + visit.manageUrl);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Triple H Enterprises//Client Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + portalIcsEscape(visit.uid) + '@triplehenterprisesllc.biz',
    'DTSTAMP:' + portalIcsUtc(now || new Date()),
    'DTSTART:' + portalIcsUtc(start),
    'DTEND:' + portalIcsUtc(end),
    'SUMMARY:' + portalIcsEscape('Triple H Enterprises: ' + (visit.title || 'Service visit')),
    visit.address ? 'LOCATION:' + portalIcsEscape(visit.address) : '',
    'DESCRIPTION:' + portalIcsEscape(descParts.join('\n')),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + portalIcsEscape('Triple H visit in 2 hours'),
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(portalIcsFold).join('\r\n') + '\r\n';
}

function portalDownloadVisitIcs(visit) {
  const ics = portalBuildVisitIcs(visit);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Triple-H-visit-' + String(visit.title || 'appointment').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('Calendar file downloaded. Open it to add the visit.');
}

// ---------- Unread messages (2026-09-22) ----------
// Neither message table records whether a client has seen a reply, so
// a client had no way to know Triple H answered without opening every
// thread. client_portal_thread_reads + get_portal_unread_counts() /
// mark_portal_thread_read() (sql/portal/create_client_portal_thread_reads.sql)
// keep a per-thread "read through" watermark on the server, so it
// follows the client across devices.
//
// Both helpers resolve (never throw) -- an unread badge is an
// enhancement; a failed lookup just means no badges, never a broken page.
// opts.nullOnError: return null (not []) when the lookup fails, so a
// background refresh can tell "couldn't check" from "nothing unread"
// and leave the badges alone instead of wiping them on a blip.
async function portalLoadUnreadCounts(supabaseClient, opts) {
  const failed = opts && opts.nullOnError ? null : [];
  try {
    const { data, error } = await supabaseClient.rpc('get_portal_unread_counts');
    if (error) { console.warn('Unread counts unavailable:', error.message || error); return failed; }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Unread counts unavailable:', e && e.message ? e.message : e);
    return failed;
  }
}

// seenThrough must be the RAW created_at string of the newest message
// actually rendered -- never passed through new Date()/toISOString(),
// which truncates Postgres's microseconds to milliseconds and would
// leave that newest message permanently "unread". The server caps it
// at now() and never moves a watermark backwards.
async function portalMarkThreadRead(supabaseClient, threadType, threadId, seenThrough) {
  try {
    const { error } = await supabaseClient.rpc('mark_portal_thread_read', {
      p_thread_type: threadType,
      p_thread_id: threadId,
      p_seen_through: seenThrough || null,
    });
    if (error) { console.warn('Could not mark thread read:', error.message || error); return false; }
    return true;
  } catch (e) {
    console.warn('Could not mark thread read:', e && e.message ? e.message : e);
    return false;
  }
}

// Sums unread counts per tab and badges the bottom nav's Request
// (work orders) and Jobs tabs. A real element, not a pseudo-element, so
// it never collides with the active tab's ::after dot. The label keeps
// the count for screen readers since the badge itself is aria-hidden.
const PORTAL_NAV_UNREAD_TABS = [
  { type: 'work_order', href: '/portal/work-orders.html', label: 'Request' },
  { type: 'job', href: '/portal/jobs.html', label: 'Jobs' },
];
function portalApplyNavUnreadBadges(rows) {
  const totals = {};
  (rows || []).forEach(r => {
    if (!r || !(Number(r.unread_count) > 0)) return;
    totals[r.thread_type] = (totals[r.thread_type] || 0) + Number(r.unread_count);
  });
  PORTAL_NAV_UNREAD_TABS.forEach(tab => {
    const link = document.querySelector('.portal-nav a[href="' + tab.href + '"]');
    if (!link) return;
    const n = totals[tab.type] || 0;
    let badge = link.querySelector('.portal-nav-badge');
    if (!n) {
      if (badge) badge.remove();
      link.removeAttribute('aria-label');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'portal-nav-badge';
      badge.setAttribute('aria-hidden', 'true');
      link.appendChild(badge);
    }
    badge.textContent = n > 9 ? '9+' : String(n);
    link.setAttribute('aria-label', tab.label + ', ' + n + ' new message' + (n === 1 ? '' : 's'));
  });
}

// ---------- Never miss a reply (2026-09-22) ----------
// Unread counts used to be read once, on page load. A client who had
// the portal open in a tab (or came back to it from the email saying
// Triple H replied) saw stale badges until they reloaded, and a reply
// landing in a thread they had open never appeared at all.
//
// portalWatchUnread() re-checks get_portal_unread_counts() when the tab
// comes back into view, and on a timer while it's visible: every 20s
// while a conversation is open (so it behaves like a chat), otherwise
// every 90s. onChange only runs when something actually changed, and a
// failed check changes nothing. One small RPC, only while the page is
// being looked at -- no realtime subscription to keep alive.
function portalUnreadSignature(rows) {
  return (rows || [])
    .filter(r => r && Number(r.unread_count) > 0)
    .map(r => r.thread_type + ':' + r.thread_id + ':' + Number(r.unread_count) + ':' + (r.latest_unread_at || ''))
    .sort()
    .join('|');
}

const PORTAL_UNREAD_ACTIVE_MS = 20000;
const PORTAL_UNREAD_IDLE_MS = 90000;
function portalWatchUnread(supabaseClient, onChange, opts) {
  opts = opts || {};
  let lastSig = portalUnreadSignature(opts.baseline || []);
  let lastCheck = Date.now();
  let busy = false;
  const isActive = typeof opts.isActive === 'function' ? opts.isActive : () => false;

  async function check(force) {
    if (busy || document.visibilityState === 'hidden') return;
    const gap = isActive() ? PORTAL_UNREAD_ACTIVE_MS : PORTAL_UNREAD_IDLE_MS;
    if (!force && Date.now() - lastCheck < gap) return;
    busy = true;
    lastCheck = Date.now();
    try {
      const rows = await portalLoadUnreadCounts(supabaseClient, { nullOnError: true });
      if (!rows) return;
      const sig = portalUnreadSignature(rows);
      if (sig === lastSig) return;
      lastSig = sig;
      onChange(rows);
    } finally {
      busy = false;
    }
  }

  // Coming back to the tab is exactly when a reply is most likely to be
  // waiting (the email or push brought them back), so that check skips
  // the timer -- but not twice within a few seconds (focus and
  // visibilitychange usually fire together).
  function onReturn() {
    if (Date.now() - lastCheck > 3000) check(true);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onReturn(); });
  window.addEventListener('focus', onReturn);
  const timer = setInterval(() => check(false), 5000);

  return {
    check: () => check(true),
    // After the page itself changes read state (a thread opened and
    // marked read), so the next check isn't mistaken for news.
    setBaseline: (rows) => { lastSig = portalUnreadSignature(rows); },
    stop: () => clearInterval(timer),
  };
}

// Pages that only show the nav badges (Quotes, Invoices, Contracts,
// Settings): load once, then keep them current.
let portalNavUnreadWatcher = null;
function portalStartUnreadBadges(supabaseClient) {
  return portalLoadUnreadCounts(supabaseClient).then((rows) => {
    portalApplyNavUnreadBadges(rows);
    if (!portalNavUnreadWatcher) portalNavUnreadWatcher = portalWatchUnread(supabaseClient, portalApplyNavUnreadBadges, { baseline: rows });
    else portalNavUnreadWatcher.setBaseline(rows);
    return rows;
  });
}

// Keeps a thread's "Messages" button in step with its unread count:
// the orange pill and the .has-unread outline, added or removed.
function portalSyncThreadToggle(toggleEl, pillId, count) {
  if (!toggleEl) return;
  let pill = document.getElementById(pillId);
  toggleEl.classList.toggle('has-unread', count > 0);
  if (!count) { if (pill) pill.remove(); return; }
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'portal-unread-pill';
    pill.id = pillId;
    toggleEl.appendChild(document.createTextNode(' '));
    toggleEl.appendChild(pill);
  }
  pill.textContent = count + ' new';
}

// The "Triple H replied" bar at the top of Request and Jobs. Those tabs
// get a badge when there's a reply, but opened on a blank request form
// (or the check-up list) with the conversation somewhere below it. This
// puts each unread conversation one tap away. items: [{ title, count,
// action }] where action is the page's own inline handler to open it.
function portalReplyNoticeHtml(items) {
  const list = (items || []).filter(i => i && i.count > 0);
  if (!list.length) return '';
  const total = list.reduce((sum, i) => sum + i.count, 0);
  const heading = total === 1 ? 'Triple H replied' : 'Triple H replied \u00b7 ' + total + ' new messages';
  const shown = list.slice(0, 3);
  const extra = list.length - shown.length;
  return '<div class="portal-reply-notice">' +
    '<div class="portal-reply-notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg></div>' +
    '<div class="portal-reply-notice-body">' +
      '<div class="portal-reply-notice-title">' + heading + '</div>' +
      shown.map(i =>
        '<button type="button" class="portal-reply-notice-item" onclick="' + portalThreadEscape(i.action) + '">' +
          '<span class="portal-reply-notice-about">' + portalThreadEscape(i.title) + '</span>' +
          '<span class="portal-unread-pill">' + i.count + ' new</span>' +
          '<span class="portal-reply-notice-open">Open</span>' +
        '</button>'
      ).join('') +
      (extra > 0 ? '<div class="portal-reply-notice-more">+ ' + extra + ' more below</div>' : '') +
    '</div>' +
  '</div>';
}

// Re-renders an open thread for a background refresh without losing
// what the client was in the middle of typing, or their cursor. Leaves
// the panel alone (returns false) while a send is in flight -- the
// send re-renders the thread itself once it lands.
function portalReplaceThreadKeepingDraft(panel, inputId, html) {
  const prev = document.getElementById(inputId);
  if (prev && prev.disabled) return false;
  const draft = prev ? prev.value : '';
  const hadFocus = !!prev && document.activeElement === prev;
  panel.innerHTML = html;
  const next = document.getElementById(inputId);
  if (next && draft) { next.value = draft; portalAutosizeComposer(next); }
  if (next && hadFocus) next.focus({ preventScroll: true });
  return true;
}

// Scroll a card into view and open its thread if it isn't already.
function portalOpenThreadFromNotice(cardId, toggleFn, threadId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const toggle = card.querySelector('.portal-thread-toggle');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggleFn(threadId, toggle);
}

// ---------- Message threads (2026-09-22) ----------
// One renderer for both two-way threads (work requests and completed
// jobs), which used to be two hand-copied versions: date-only meta
// under every bubble, and on portal/jobs.html an "Invalid Date" on
// every single message (its formatDate() appended 'T00:00:00' to a
// full timestamp). Now: a day divider when the day changes, the time
// on each bubble, the sender named only when it changes, and a "New"
// divider above the first unread Triple H reply.
function portalMessageTime(iso) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

function portalMessageDayLabel(iso, now) {
  const d = new Date(iso);
  const today = new Date((now || new Date()).getTime()); today.setHours(0, 0, 0, 0);
  const day = new Date(d.getTime()); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = d.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat('en-US', sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

// messages: [{ sender_type, message, created_at }] oldest first.
// unreadCount: how many of the newest 'internal' messages are unread
// (unread = every Triple H message after the watermark, so they are
// always the LAST n internal messages).
function portalMessageThreadHtml(messages, options) {
  options = options || {};
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) {
    return '<div class="portal-thread-empty">' + portalThreadEscape(options.emptyText || 'No messages yet. Ask us anything below.') + '</div>';
  }
  const unread = Number(options.unreadCount) || 0;
  const internalIdx = [];
  list.forEach((m, i) => { if (m.sender_type === 'internal') internalIdx.push(i); });
  const firstUnreadIdx = unread > 0 && internalIdx.length ? internalIdx[Math.max(0, internalIdx.length - unread)] : -1;

  let html = '<div class="portal-thread" role="log" aria-label="Messages">';
  let lastDay = '';
  let lastSender = '';
  list.forEach((m, i) => {
    const day = portalMessageDayLabel(m.created_at, options.now);
    const isFirstUnread = i === firstUnreadIdx;
    if (day !== lastDay) {
      // A new day that also starts the unread run gets ONE combined
      // divider ("Today · New") rather than two stacked lines.
      html += isFirstUnread
        ? '<div class="portal-thread-new"><span>' + portalThreadEscape(day) + ' &middot; New</span></div>'
        : '<div class="portal-thread-day"><span>' + portalThreadEscape(day) + '</span></div>';
      lastDay = day;
      lastSender = '';
    } else if (isFirstUnread) {
      html += '<div class="portal-thread-new"><span>New</span></div>';
      lastSender = '';
    }
    const isClient = m.sender_type === 'client';
    const sender = isClient ? 'You' : 'Triple H';
    html += '<div class="portal-msg ' + (isClient ? 'is-client' : 'is-internal') + '">' +
      (sender !== lastSender ? '<div class="portal-msg-sender">' + sender + '</div>' : '') +
      '<div class="portal-msg-bubble">' + portalThreadEscape(m.message) + '</div>' +
      '<div class="portal-msg-time">' + portalThreadEscape(portalMessageTime(m.created_at)) + '</div>' +
      '</div>';
    lastSender = sender;
  });
  return html + '</div>';
}

// A private escape so this renderer never depends on each page having
// defined its own escapeHtml() under the same name.
function portalThreadEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The composer under a thread. inputId/sendId are how each page's own
// send function finds the field and button; onSend is that page's own
// function call as a string (e.g. "sendMessage(12)").
function portalComposerHtml(inputId, sendId, onSend, placeholder) {
  return '<div class="portal-composer">' +
    '<textarea id="' + inputId + '" rows="1" maxlength="2000" placeholder="' + portalThreadEscape(placeholder || 'Write a message...') + '" aria-label="Write a message" ' +
      'oninput="portalAutosizeComposer(this)" onkeydown="if((event.metaKey||event.ctrlKey)&&event.key===\'Enter\'){event.preventDefault();' + onSend + ';}"></textarea>' +
    '<button type="button" class="portal-composer-send" id="' + sendId + '" onclick="' + onSend + '" aria-label="Send message">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-5 16-3.5-6.5z"/><path d="M11.5 13.5 20 4"/></svg>' +
    '</button>' +
  '</div>';
}

function portalAutosizeComposer(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// Newest message in view after (re)rendering a thread.
function portalScrollThreadToEnd(panel) {
  const thread = panel && panel.querySelector('.portal-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}

// Disables the composer while a send is in flight -- a double-tap used
// to post the same message twice. Returns a restore() function for the
// failure path; on success the page re-renders the whole thread anyway.
function portalSetComposerSending(inputEl, sendBtn) {
  if (inputEl) inputEl.disabled = true;
  if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add('is-sending'); }
  return function restore() {
    if (inputEl) inputEl.disabled = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('is-sending'); }
  };
}

// Deep-link from Home's action inbox (Pay / Approve / Sign / Reply)
// onto the matching card. Pages call this after they finish rendering
// so the target actually exists. Reuses dashboard.html's existing
// highlight animation class name rather than inventing a second one.
function portalScrollToHash() {
  const id = (location.hash || '').replace(/^#/, '');
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('is-highlighted');
}

