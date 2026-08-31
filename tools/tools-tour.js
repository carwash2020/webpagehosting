// Full app tour (2026-08-20) -- expanded from a 3-step, dashboard-only
// onboarding tour into a walkthrough spanning every real tool page.
// Replay it any time from Settings.
//
// Excluded on purpose, and why:
//   - job-cost-lookup.html, expense-logger.html, contact-card.html --
//     these are redirect stubs with no real content of their own.
//   - login.html, reset-password.html -- auth flow, not tools.
//   - dev-tools.html, site-content.html -- password-gated developer
//     tools, not appropriate for a general "how to use this app" tour.
//   - client-detail.html, job-detail.html -- detail views reached by
//     drilling into a specific existing record, not independent
//     destinations someone navigates to directly; a tour stop there
//     wouldn't make sense without a real record already existing.
//
// MECHANISM: one flat, ordered list of steps. Most pages get exactly
// one step; workspace.html gets 4 (its own sections). Each step names
// the page it belongs to, an optional highlightSelector (any real CSS
// selector -- an id for the 4 workspace.html sections, a class or
// attribute selector everywhere else, since none of the other 10 pages
// needed a single new id added just for this), a title, and body copy
// written around a concrete use case, not just an abstract description
// of what the page contains. State (which step you're on) is stored in
// localStorage, not the URL, so it survives a real page navigation.
// Every page in the list calls initAppTour() on its own DOMContentLoaded;
// that function is self-correcting -- if the stored step doesn't match
// the page you're actually on (say, you tapped the bottom nav instead
// of "Next"), it finds whichever step DOES belong to this page and
// shows that one instead of showing nothing or showing the wrong info.

const APP_TOUR_STEPS = [
  { page: '/tools/workspace.html', highlightSelector: '#section-snapshot', title: 'Business Snapshot', body: 'Revenue, expenses, and outstanding balances for whatever period you pick above. Check this first thing in the morning to see where things actually stand before you head out.' },
  { page: '/tools/workspace.html', highlightSelector: '#section-actionitems', title: 'Action Items', body: 'Anything that actually needs your attention today \u2014 overdue invoices, jobs due tomorrow, follow-ups, new leads. If it\u2019s empty, you\u2019re genuinely caught up.' },
  { page: '/tools/workspace.html', highlightSelector: '#section-gallery', title: 'More', body: 'Website gallery photos waiting to be published, insurance and license tracking, job analytics, and a one-tap full data backup \u2014 collapsed by default so they don\u2019t clutter this page, but a couple taps away the moment you need one of them.' },
  { page: '/tools/workspace.html', highlightSelector: '#section-tools', title: 'Tools', body: 'Every tool in this app lives here as a tile, or in the bar at the bottom of the screen on mobile. Lost on some other page? This is always the way back.' },
  { page: '/tools/job-tracker.html', highlightSelector: '#addJobBtn', title: 'Jobs', body: 'The moment you book a job, add it here. Long-press any job on the list to mark it done, edit it, or log an expense against it on the spot \u2014 no need to leave this page for that last one. Contacts and Notes tabs are right up top.' },
  { page: '/tools/finance.html', highlightSelector: '.tabs.tabs-sticky', title: 'Finance', body: 'Quoting a new job? Run the numbers in Cost Lookup first. Once it\u2019s done, Profitability shows what you actually made. Income and Expenses \u2014 including mileage \u2014 are the other two tabs, for everything money-related outside a specific job.' },
  { page: '/tools/invoice-generator.html', highlightSelector: 'button[onclick="generatePDF()"]', title: 'Invoices', body: 'Fill out a job here and hit Generate \u2014 a branded PDF invoice downloads straight to your device, ready to text or email to a client on the spot. Need a price before the work starts instead? Switch to the Quote/Estimate tab.' },
  { page: '/tools/calendar.html', highlightSelector: '#calGrid', title: 'Calendar', body: 'Every job with a date on it shows up here automatically \u2014 nothing to enter twice. Tap any day with a dot to see exactly what\u2019s scheduled.' },
  { page: '/tools/route-planner.html', highlightSelector: '.add-stop-btn', title: 'Routes', body: 'Got three or four stops lined up for the day? Add them here and get the fastest order to drive them in, opened straight into Google Maps.' },
  { page: '/tools/contract-generator.html', highlightSelector: '.form-section', title: 'Contracts', body: 'Need something signed before you start a job? Fill in a Per-Job Work Order for a one-off, or a Service Agreement for ongoing work, and get a ready-to-send PDF back.' },
  { page: '/tools/review-request.html', highlightSelector: '#sendLink', title: 'Review Requests', body: 'Right after a job wraps up, send the guest a text with a direct link to leave a Google or Yelp review. This page keeps track of who actually left one, so you know who\u2019s worth a follow-up.' },
  { page: '/tools/parts-reference.html', highlightSelector: '#prSearchInput', title: 'Parts Reference', body: 'Once you\u2019ve looked up a part number for a tricky repair, it\u2019s saved here \u2014 search it here first next time instead of digging through the same manual again.' },
  { page: '/tools/runway-dashboard.html', highlightSelector: '.tabs', title: 'Runway Dashboard', body: 'Your personal budget and the business\u2019s numbers side by side \u2014 this is where you actually check whether the business is covering its own costs yet, not just guess at it.' },
  { page: '/tools/settings.html', highlightSelector: 'a[href*="tour=1"]', title: 'Settings', body: 'Sync setup and your account live here. Forget something from this tour, or want to show someone else how this all works? This button brings the whole thing back from the start.' },
];

const APP_TOUR_STEP_KEY = 'th_app_tour_step';
const APP_TOUR_STEP_STARTED_AT_KEY = 'th_app_tour_step_started_at';
const TOUR_HIGHLIGHT_CLASS = 'th-tour-highlight';

// Keyed by the logged-in account's email, not just the browser --
// otherwise one shared device would only ever show this to whichever
// person happened to dismiss it first. Same key name the original
// 3-step dashboard tour used, so anyone who already dismissed THAT
// tour doesn't get this longer one forced on them unexpectedly.
//
// Reads the stored session directly, NOT via getCurrentUserEmail()
// (real bug found and fixed 2026-08-27, reported directly as the tour
// "still pops up almost daily") -- getCurrentUserEmail() gates on
// hasValidSession()'s strict token-expiry check, but initAppTour()
// runs synchronously, immediately, on every page that includes it --
// before that page's own initSyncOnLoad() has any chance to refresh
// an expired access token. Confirmed via a real, simulated test:
// since JWT access tokens routinely expire (hourly, by default), this
// meant getCurrentUserEmail() returned null on a very ordinary,
// routine re-open of the app (whenever the token happened to be
// expired at that exact moment), which fell back to checking
// th_onboarding_v1_seen_anon instead of the real, already-dismissed
// per-user key. The email itself is still present in the stored
// session object regardless of whether its access_token has expired
// (expiry only means the token can't be trusted for a live API call
// anymore, not that the stored session data was erased), so reading
// it directly here is reliable in exactly the case where
// getCurrentUserEmail() wasn't. Falls back to getCurrentUserEmail()
// if getStoredSession isn't available for some reason, matching this
// file's existing defensive-check convention.
function appTourSeenKey() {
  let email = null;
  try {
    const s = (typeof getStoredSession === 'function') ? getStoredSession() : null;
    email = (s && s.email) || null;
  } catch (e) { /* ignore */ }
  if (!email) email = (typeof getCurrentUserEmail === 'function' && getCurrentUserEmail()) || 'anon';
  return 'th_onboarding_v1_seen_' + email.toLowerCase();
}

function startAppTour() {
  try {
    localStorage.setItem(APP_TOUR_STEP_KEY, '0');
    localStorage.setItem(APP_TOUR_STEP_STARTED_AT_KEY, String(Date.now()));
  } catch (e) { /* ignore */ }
  const firstPage = APP_TOUR_STEPS[0].page;
  if (window.location.pathname === firstPage) {
    renderAppTourStep(0);
  } else {
    window.location.href = firstPage;
  }
}

function initAppTour() {
  // ?tour=1 forces the tour to (re)start regardless of the seen-flag --
  // this is what Settings' "Replay tour" button links to.
  const forceStart = new URLSearchParams(window.location.search).get('tour') === '1';

  // One-time migration: the flag used to be a single shared key with no
  // per-user distinction. Anyone who already dismissed the tour under
  // that old key shouldn't see it run again just because the key scheme
  // changed underneath them.
  try {
    if (localStorage.getItem('th_onboarding_v1_seen') === '1' && !localStorage.getItem(appTourSeenKey())) {
      localStorage.setItem(appTourSeenKey(), '1');
    }
  } catch (e) { /* ignore */ }

  if (forceStart) {
    startAppTour();
    // Clean the URL so refreshing or sharing the link doesn't force a
    // restart every time.
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState({}, '', url);
    return;
  }

  let stepIndex = null;
  try {
    const stored = localStorage.getItem(APP_TOUR_STEP_KEY);
    if (stored !== null) stepIndex = parseInt(stored, 10);
  } catch (e) { /* ignore */ }

  // An in-progress tour that's sat untouched for too long almost
  // certainly means the person navigated away and moved on with their
  // day, not that they're still actively working through it -- without
  // this, that stale in-progress state would keep bypassing the
  // one-time "seen" check below forever, popping the tour back up on
  // every unrelated visit to any tour-included page.
  const TOUR_ABANDON_MS = 2 * 60 * 60 * 1000; // 2 hours
  if (stepIndex !== null) {
    let startedAt = null;
    try { startedAt = parseInt(localStorage.getItem(APP_TOUR_STEP_STARTED_AT_KEY) || '', 10); } catch (e) { /* ignore */ }
    if (!startedAt || isNaN(startedAt) || (Date.now() - startedAt) > TOUR_ABANDON_MS) {
      try {
        localStorage.removeItem(APP_TOUR_STEP_KEY);
        localStorage.removeItem(APP_TOUR_STEP_STARTED_AT_KEY);
        localStorage.setItem(appTourSeenKey(), '1');
      } catch (e) { /* ignore */ }
      stepIndex = null;
    }
  }

  if (stepIndex === null) {
    // No tour currently in progress. Auto-start it once, ever, for a
    // brand new user -- but only from the dashboard, the natural first
    // landing spot, matching the original tour's behavior.
    let seen = false;
    try { seen = localStorage.getItem(appTourSeenKey()) === '1'; } catch (e) { /* ignore */ }
    if (seen || window.location.pathname !== APP_TOUR_STEPS[0].page) return;
    stepIndex = 0;
    try {
      localStorage.setItem(APP_TOUR_STEP_KEY, '0');
      localStorage.setItem(APP_TOUR_STEP_STARTED_AT_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  // Self-correcting: if the stored step's page doesn't match where we
  // actually are (the person tapped the bottom nav instead of "Next",
  // or used the browser's back button), find whichever step DOES
  // belong to this page instead of showing nothing or the wrong info.
  let step = APP_TOUR_STEPS[stepIndex];
  if (!step || step.page !== window.location.pathname) {
    const matchIdx = APP_TOUR_STEPS.findIndex(s => s.page === window.location.pathname);
    if (matchIdx === -1) return; // this page isn't part of the tour at all
    stepIndex = matchIdx;
    try { localStorage.setItem(APP_TOUR_STEP_KEY, String(stepIndex)); } catch (e) { /* ignore */ }
  }

  renderAppTourStep(stepIndex);
}

function clearAppTourHighlight() {
  const highlighted = document.querySelectorAll('.' + TOUR_HIGHLIGHT_CLASS);
  highlighted.forEach(el => el.classList.remove(TOUR_HIGHLIGHT_CLASS));
}

function dismissAppTour() {
  try {
    localStorage.removeItem(APP_TOUR_STEP_KEY);
    localStorage.removeItem(APP_TOUR_STEP_STARTED_AT_KEY);
    localStorage.setItem(appTourSeenKey(), '1');
  } catch (e) { /* ignore */ }
  const card = document.getElementById('appTourCard');
  if (card) card.remove();
  clearAppTourHighlight();
}

function goToAppTourStep(nextIndex) {
  try {
    localStorage.setItem(APP_TOUR_STEP_KEY, String(nextIndex));
    localStorage.setItem(APP_TOUR_STEP_STARTED_AT_KEY, String(Date.now()));
  } catch (e) { /* ignore */ }
  const nextStep = APP_TOUR_STEPS[nextIndex];
  if (nextStep.page === window.location.pathname) {
    renderAppTourStep(nextIndex);
  } else {
    window.location.href = nextStep.page;
  }
}

function renderAppTourStep(stepIndex) {
  const step = APP_TOUR_STEPS[stepIndex];
  clearAppTourHighlight(); // remove whatever the PREVIOUS step highlighted, if anything
  if (step.highlightSelector) {
    // querySelector, not getElementById -- highlightSelector can be an
    // id (the 4 workspace.html sections) or a class/attribute selector
    // (every other page), so a single field covers both without
    // needing a new id added anywhere.
    const el = document.querySelector(step.highlightSelector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add(TOUR_HIGHLIGHT_CLASS);
    }
  }
  // Always start from a clean slate -- guarantees exactly one
  // #appTourCard exists and the click handler below is always attached
  // to the one actually visible, never a stale duplicate.
  document.querySelectorAll('#appTourCard').forEach(el => el.remove());
  const card = document.createElement('div');
  card.id = 'appTourCard';
  card.className = 'onboarding-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'App tour');
  document.body.appendChild(card);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === APP_TOUR_STEPS.length - 1;
  card.innerHTML =
    '<div class="onboarding-dots">' + APP_TOUR_STEPS.map((_, i) => '<span class="' + (i === stepIndex ? 'is-active' : '') + '"></span>').join('') + '</div>' +
    '<div class="onboarding-title">' + step.title + '</div>' +
    '<div class="onboarding-body">' + step.body + '</div>' +
    '<div class="onboarding-actions">' +
      '<div class="onboarding-actions-left">' +
        (isFirst ? '' : '<button class="onboarding-back">Back</button>') +
        '<button class="onboarding-skip">Skip</button>' +
      '</div>' +
      '<button class="onboarding-next primary-btn">' + (isLast ? 'Got it' : 'Next') + '</button>' +
    '</div>';
  card.querySelector('.onboarding-skip').onclick = dismissAppTour;
  const backBtn = card.querySelector('.onboarding-back');
  if (backBtn) backBtn.onclick = () => goToAppTourStep(stepIndex - 1);
  card.querySelector('.onboarding-next').onclick = () => {
    if (isLast) { dismissAppTour(); return; }
    goToAppTourStep(stepIndex + 1);
  };
}
