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
// the page it belongs to. State (which step you're on) is stored in
// localStorage, not the URL, so it survives a real page navigation.
// Every page in the list calls initAppTour() on its own DOMContentLoaded;
// that function is self-correcting -- if the stored step doesn't match
// the page you're actually on (say, you tapped the bottom nav instead
// of "Next"), it finds whichever step DOES belong to this page and
// shows that one instead of showing nothing or showing the wrong info.

const APP_TOUR_STEPS = [
  { page: '/tools/workspace.html', sectionId: 'section-snapshot', title: 'Business Snapshot', body: 'Revenue, expenses, and outstanding balances for whatever period you pick above.' },
  { page: '/tools/workspace.html', sectionId: 'section-actionitems', title: 'Action Items', body: 'Anything that actually needs your attention today \u2014 overdue invoices, jobs due tomorrow, follow-ups, new leads.' },
  { page: '/tools/workspace.html', sectionId: 'section-gallery', title: 'More', body: 'Website gallery photos waiting to be published, insurance and license tracking, job analytics, and a one-tap full data backup \u2014 all tucked in here, collapsed by default.' },
  { page: '/tools/workspace.html', sectionId: 'section-tools', title: 'Tools', body: 'Every tool in this app lives here as a tile, or in the bar at the bottom of the screen on mobile.' },
  { page: '/tools/job-tracker.html', title: 'Jobs', body: 'Every job you\u2019re running: add one, mark it done, and long-press any job for quick actions like logging an expense on the spot. Contacts and Notes live here too.' },
  { page: '/tools/finance.html', title: 'Finance', body: 'A cost calculator for estimating a job before you take it, job profitability, and your income and expense logs \u2014 including mileage.' },
  { page: '/tools/invoice-generator.html', title: 'Invoices', body: 'Fill out a job, hit Generate, and a branded PDF invoice or quote downloads straight to your device. Recent Invoices keeps a running log.' },
  { page: '/tools/calendar.html', title: 'Calendar', body: 'Everything scheduled \u2014 jobs, follow-ups, anything with a date \u2014 in one monthly view.' },
  { page: '/tools/route-planner.html', title: 'Routes', body: 'Line up several stops for the day and get the most efficient driving order between them.' },
  { page: '/tools/contract-generator.html', title: 'Contracts', body: 'Per-job work orders, short-term agreements, and long-term service agreements \u2014 fill in the blanks and get a signed-ready PDF.' },
  { page: '/tools/review-request.html', title: 'Review Requests', body: 'Send a guest a quick link to leave a Google or Yelp review, and track whether they actually left one.' },
  { page: '/tools/parts-reference.html', title: 'Parts Reference', body: 'A running wiki of appliance parts and known issues you\u2019ve looked up before, so you\u2019re not searching the same part number twice.' },
  { page: '/tools/runway-dashboard.html', title: 'Runway Dashboard', body: 'Personal budget and business numbers side by side \u2014 how much runway you\u2019ve got, and whether the business is covering its own costs yet.' },
  { page: '/tools/settings.html', title: 'Settings', body: 'Sync setup and your account live here \u2014 and you can replay this tour any time from this same page.' },
];

const APP_TOUR_STEP_KEY = 'th_app_tour_step';

// Keyed by the logged-in account's email, not just the browser --
// otherwise one shared device would only ever show this to whichever
// person happened to dismiss it first. Same key name the original
// 3-step dashboard tour used, so anyone who already dismissed THAT
// tour doesn't get this longer one forced on them unexpectedly.
function appTourSeenKey() {
  const email = (typeof getCurrentUserEmail === 'function' && getCurrentUserEmail()) || 'anon';
  return 'th_onboarding_v1_seen_' + email.toLowerCase();
}

function startAppTour() {
  try { localStorage.setItem(APP_TOUR_STEP_KEY, '0'); } catch (e) { /* ignore */ }
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

  if (stepIndex === null) {
    // No tour currently in progress. Auto-start it once, ever, for a
    // brand new user -- but only from the dashboard, the natural first
    // landing spot, matching the original tour's behavior.
    let seen = false;
    try { seen = localStorage.getItem(appTourSeenKey()) === '1'; } catch (e) { /* ignore */ }
    if (seen || window.location.pathname !== APP_TOUR_STEPS[0].page) return;
    stepIndex = 0;
    try { localStorage.setItem(APP_TOUR_STEP_KEY, '0'); } catch (e) { /* ignore */ }
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

function dismissAppTour() {
  try {
    localStorage.removeItem(APP_TOUR_STEP_KEY);
    localStorage.setItem(appTourSeenKey(), '1');
  } catch (e) { /* ignore */ }
  const card = document.getElementById('appTourCard');
  if (card) card.remove();
}

function goToAppTourStep(nextIndex) {
  try { localStorage.setItem(APP_TOUR_STEP_KEY, String(nextIndex)); } catch (e) { /* ignore */ }
  const nextStep = APP_TOUR_STEPS[nextIndex];
  if (nextStep.page === window.location.pathname) {
    renderAppTourStep(nextIndex);
  } else {
    window.location.href = nextStep.page;
  }
}

function renderAppTourStep(stepIndex) {
  const step = APP_TOUR_STEPS[stepIndex];
  if (step.sectionId) {
    const el = document.getElementById(step.sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  let card = document.getElementById('appTourCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'appTourCard';
    card.className = 'onboarding-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'App tour');
    document.body.appendChild(card);
  }
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
