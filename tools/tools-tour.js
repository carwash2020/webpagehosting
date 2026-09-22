// Full app tour (2026-08-20) -- expanded from a 3-step, dashboard-only
// onboarding tour into a walkthrough spanning every real tool page.
// Replay it any time from Settings.
//
// Excluded on purpose, and why:
//   - job-cost-lookup.html, expense-logger.html, contact-card.html,
//     calendar.html (retired 2026-09-21, now the Calendar view inside
//     job-tracker.html), pos.html (retired 2026-09-21, now the Quick
//     charge tab inside invoice-generator.html) -- these are redirect
//     stubs with no real content of their own.
//   - login.html, reset-password.html -- auth flow, not tools.
//   - dev-tools.html, site-content.html -- password-gated developer
//     tools, not appropriate for a general "how to use this app" tour.
//   - client-detail.html, job-detail.html -- detail views reached by
//     drilling into a specific existing record, not independent
//     destinations someone navigates to directly; a tour stop there
//     wouldn't make sense without a real record already existing.
//
// MECHANISM: one flat, ordered list of steps, grouped by page in the
// bottom bar's order (Home, Jobs, Clients, Money -- Invoices then
// Finance -- then the More drawer). Rewritten 2026-09-22 as a real
// tutorial: the Dashboard gets 7 steps (hero, inbox, actions, Business,
// getting around, Create, search), tabbed pages get one step per tab,
// the rest one each -- 25 in all.
// Each step names the page it belongs to, a highlightSelector (any real
// CSS selector; a comma-separated list means "the first one that is
// visible at this width", which is how one step points at the phone
// bar OR the desktop sidebar), a title, body copy written around what
// you actually do there, and an optional onShow -- a page function to
// call first (activateTab('expenses'), activateGenTab('pos')...) so the
// tab being described is the one on screen. State (which step you're on) is stored in
// localStorage, not the URL, so it survives a real page navigation.
// Every page in the list calls initAppTour() on its own DOMContentLoaded;
// that function is self-correcting -- if the stored step doesn't match
// the page you're actually on (say, you tapped the bottom nav instead
// of "Next"), it finds whichever step DOES belong to this page and
// shows that one instead of showing nothing or showing the wrong info.

const APP_TOUR_STEPS = [
  { page: '/tools/workspace.html', highlightSelector: '#todayHero', title: 'Today', body: 'Welcome! This two-minute tour walks through every page and tab. Skip any time; replay it from Settings. The Dashboard opens on the day: your <strong>next job</strong> (tap the address for directions, the number to call, or <strong>Route today</strong> for every stop in Google Maps), <strong>Money Owed</strong> with a one-tap <strong>Mark paid</strong>, and the rest of today\u2019s schedule.' },
  { page: '/tools/workspace.html', highlightSelector: '#section-actionitems', title: 'Needs attention', body: 'Your inbox, open by default: new leads, online bookings, and work requests waiting on a reply, jobs due this week, clients overdue for a follow-up, and unpaid invoices. Each row has its own action (Reply, Add as job, Mark paid). A group with nothing in it hides itself \u2014 a short list here means you are caught up.' },
  { page: '/tools/workspace.html', highlightSelector: '#dashPrimaryStrip', title: 'Quick actions', body: '<strong>New job</strong> opens Jobs with the form ready. <strong>Create invoice</strong> and <strong>Quick charge</strong> (take a card on the spot, no invoice) open Invoices. <strong>Find client</strong> searches everything. <strong>Calendar</strong> is the month view of your jobs. <strong>Log expense</strong> opens Finance with the receipt form ready.' },
  { page: '/tools/workspace.html', highlightSelector: '#section-snapshot', title: 'Business', body: 'The occasional checks live under this one label, collapsed until you want them: <strong>Business Snapshot</strong> (revenue, expenses, net, outstanding for any period), <strong>Analytics</strong>, <strong>Compliance &amp; Documents</strong> (insurance and license dates, secure files), and the website <strong>Gallery Queue</strong>.' },
  { page: '/tools/workspace.html', highlightSelector: '.th-desktop-sidebar, .th-bottom-nav', title: 'Getting around', body: 'On a phone or tablet this bar is how you get anywhere: <strong>Home, Jobs, Clients</strong>, and <strong>Money</strong> \u2014 Invoices and Finance under one tab, with a switch at the top to hop between them. The grid button at the top right of every page opens <strong>More</strong>: Route Planner, Runway, Contracts, Reviews, the Appliance Wiki, and Settings. On a computer the same list is the sidebar on the left. Stuck on a page? <strong>More \u2192 How this page works</strong> explains it (on a computer, the <strong>?</strong> in its header).' },
  { page: '/tools/workspace.html', highlightSelector: '.th-sidebar-new, .th-bn-create', title: 'Create anything', body: 'The orange <strong>+</strong> starts anything, from any page: a job, an invoice, a quote, a quick charge, an expense (snap the receipt), income, a contact, a contract, or a review request. On a computer it is the <strong>New</strong> button at the top of the sidebar, or just press <strong>N</strong>.' },
  { page: '/tools/workspace.html', highlightSelector: '.th-sidebar-search-trigger, .th-hdr-search', title: 'Search anywhere', body: 'The magnifier (or <strong>Ctrl+K</strong> / <strong>\u2318K</strong> on a computer) opens search from any page. Type a client\u2019s name to jump to their jobs, invoices, quotes, or contracts \u2014 or type what you want to do, like \u201cexpense\u201d, \u201cquote\u201d, or \u201croute\u201d, and it takes you straight there. You never have to remember which page something lives on.' },
  { page: '/tools/job-tracker.html', highlightSelector: '#addJobBtn', title: 'Jobs: add one the moment you book it', body: 'Tap <strong>Add a Job</strong>: title, client, phone, address, date, priority, notes (the microphone dictates). On the card, <strong>Done</strong> finishes a job in one tap; long-press a card to edit it, log an expense against it, or attach photos. Marking a job done offers a pre-filled review request for that client.' },
  { page: '/tools/job-tracker.html', highlightSelector: '#jobViewSwitch', title: 'One list, three views', body: 'Switch between List, Board, and Calendar with the buttons above the list \u2014 the choice is remembered on this device. <strong>List</strong> is a sortable table on a computer. <strong>Board</strong> puts Not Started, In Progress, and Done side by side. <strong>Calendar</strong> is a month view of every dated job (online bookings you have not added yet show in purple); tap a day for its detail and <strong>Add to Phone</strong> to export it.' },
  { page: '/tools/job-tracker.html', highlightSelector: '[data-tab="contacts"]', title: 'Contacts and Notes', body: '<strong>Contacts</strong> is your address book for clients, suppliers, and vendors \u2014 tap <strong>History</strong> on anyone to see their past jobs and lifetime spend. <strong>Notes</strong> holds as many named notes as you want; they save as you type and sync to your other devices.', onShow: { fn: 'activateTab', args: ['contacts'] } },
  { page: '/tools/clients.html', highlightSelector: '#clientDirSearch', title: 'Clients', body: 'Everyone you have worked for, found by name, phone, email, or street. Each row shows what they owe (red once it is overdue) and their next or last job; the phone button calls them. Tap a client for their whole history and one-tap New job or Invoice; long-press for Text, Email, or Directions. <strong>Owes you</strong> lists just the people with a balance. The <strong>Portal</strong> tab is the client-portal admin: accounts, invites, referral credit, work requests.', onShow: { fn: 'activateClientsTab', args: ['directory'] } },
  { page: '/tools/invoice-generator.html', highlightSelector: 'button[onclick="generatePDF({ send: true })"]', title: 'Invoices', body: 'Fill in the job and its line items (Labor, Mileage, Part, or Other \u2014 the Qty column changes unit to match), untick Tax on anything exempt, then <strong>Download PDF</strong> for a branded copy or <strong>Send to Client</strong> to email it and post it to their portal, where they can pay by card. Either way it is saved to your log and flows into Finance.', onShow: { fn: 'activateGenTab', args: ['invoice'] } },
  { page: '/tools/invoice-generator.html', highlightSelector: '[data-tab="quote"]', title: 'Quote / Estimate', body: 'Same form, before the work starts. Download an estimate PDF (clearly labelled as an estimate, not a bill) or send it to the client. Once the job is done, <strong>Convert to Invoice</strong> copies everything across so nothing is typed twice.', onShow: { fn: 'activateGenTab', args: ['quote'] } },
  { page: '/tools/invoice-generator.html', highlightSelector: '#posClientEmail', title: 'Quick charge', body: 'For a small job that needs no invoice. Type the client\u2019s email and an amount. If they have paid you before, their card is already on file and it is one tap; otherwise a card form appears (they type their name and sign on the screen to authorize it, and that card is saved for next time). Every charge lands in Finance as income, tagged so you can tell it apart from an invoice.', onShow: { fn: 'activateGenTab', args: ['pos'] } },
  { page: '/tools/invoice-generator.html', highlightSelector: '[data-tab="recent"]', title: 'Recent invoices and quotes', body: 'Everything you have generated, searchable by client or number, with the conversion rate of quotes into paid work. Delete an entry here if you made one by mistake \u2014 it is removed on every device, not just this one.', onShow: { fn: 'activateGenTab', args: ['recent'] } },
  { page: '/tools/finance.html', highlightSelector: '[data-tab="expenses"]', title: 'Finance: Expenses', body: 'Log every receipt here (a photo of it is required) and tie it to a job so it counts against that job\u2019s profit. Mileage uses the rate Route Planner shares. This page reopens on whichever tab you used last.', onShow: { fn: 'activateTab', args: ['expenses'] } },
  { page: '/tools/finance.html', highlightSelector: '[data-tab="income"]', title: 'Income', body: 'Every payment: invoices flow in automatically when they are paid, Quick charges arrive tagged, and anything else can be added by hand. Filter by period to see what actually came in.', onShow: { fn: 'activateTab', args: ['income'] } },
  { page: '/tools/finance.html', highlightSelector: '[data-tab="profitability"]', title: 'Profitability', body: 'What each finished job actually made after its expenses and mileage \u2014 the honest answer to whether a kind of job is worth taking again. Tap a job to open its full detail page.', onShow: { fn: 'activateTab', args: ['profitability'] } },
  { page: '/tools/finance.html', highlightSelector: '[data-tab="cost"]', title: 'Cost Lookup and Inventory', body: 'Quoting a job? Run the parts, labor, mileage, and sales tax here first \u2014 the tax rate is shared with the Invoice Generator, so change it in either place. <strong>Inventory</strong> tracks the parts you keep on the truck.', onShow: { fn: 'activateTab', args: ['cost'] } },
  { page: '/tools/route-planner.html', highlightSelector: '.add-stop-btn', title: 'Routes', body: 'Three or four stops lined up? Add them (or <strong>Pull Today\u2019s Jobs</strong>), get the fastest order, and open the whole run in Google Maps. The cost analyzer estimates fuel for the trip. From the Dashboard, <strong>Route today</strong> does the common case in one tap.' },
  { page: '/tools/contract-generator.html', highlightSelector: '.contract-tab', title: 'Contracts', body: 'Three kinds: a <strong>Per-Job Work Order</strong> for a one-off, a <strong>Short-Term Project</strong> agreement, and a <strong>Long-Term Service</strong> agreement for recurring work. Fill it in, both parties sign on screen, and a branded PDF is ready to send.' },
  { page: '/tools/review-request.html', highlightSelector: '#sendLink', title: 'Review requests', body: 'Right after a job wraps up, send the client a text with a direct link to leave a Google or Yelp review; the tabs also hold QR codes you can show in person. The list underneath tracks who actually left one.' },
  { page: '/tools/parts-reference.html', highlightSelector: '#prSearchInput', title: 'Appliance Wiki', body: 'Opens ready to type: a brand, an appliance type, or a model number. Each appliance card has its manual and parts-catalog links and the issues you have logged on real jobs. Pinned and recent ones sit right under the search box.' },
  { page: '/tools/runway-dashboard.html', highlightSelector: '.tabs', title: 'Runway Dashboard', body: 'Your personal budget and the business\u2019s numbers side by side: <strong>Personal Budget</strong>, <strong>Business Dashboard</strong> (pull a month straight from Finance), <strong>Net Worth</strong>, and <strong>Runway Summary</strong> \u2014 whether the business covers your bills yet, and a safe-draw calculator. It reopens on the tab you used last.' },
  { page: '/tools/settings.html', highlightSelector: 'a[href*="tour=1"]', title: 'Settings', body: 'Account, display density, light or dark theme, push notifications, password, and two-factor sign-in. Forget something from this tour? This button replays it. That is the whole app \u2014 tap Got it and get to work.' },
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

// A step may point at several candidates (".th-desktop-sidebar,
// .th-bottom-nav"): the first one actually rendered at this viewport
// width wins, so the highlight never lands on a display:none element.
// Falls back to the first match so a step still renders something in a
// bare test DOM with no stylesheet.
function pickVisibleTourTarget(selector) {
  let all;
  try { all = Array.from(document.querySelectorAll(selector)); } catch (e) { return null; }
  const shown = (el) => {
    try { const cs = window.getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; } catch (e) { return true; }
  };
  // An element inside a display:none ancestor (the sidebar's Search row
  // on a phone) keeps its own computed display, so its own style is
  // not enough -- getClientRects() is empty for anything not laid out.
  // Bare test DOMs lay nothing out at all, hence the second pass.
  const laidOut = (el) => { try { return el.getClientRects().length > 0; } catch (e) { return true; } };
  return all.find(el => shown(el) && laidOut(el)) || all.find(shown) || all[0] || null;
}

function renderAppTourStep(stepIndex) {
  const step = APP_TOUR_STEPS[stepIndex];
  clearAppTourHighlight(); // remove whatever the PREVIOUS step highlighted, if anything
  // onShow (2026-09-22): put the tab this step describes on screen first,
  // via the page's own switch function by name -- no eval, no CSP change.
  // A page that lacks the function (a bare test DOM) just skips it.
  if (step.onShow && typeof window[step.onShow.fn] === 'function') {
    try { window[step.onShow.fn].apply(null, step.onShow.args || []); } catch (e) { /* the step still renders */ }
  }
  if (step.highlightSelector) {
    // querySelector, not getElementById -- highlightSelector can be an
    // id, a class/attribute selector, or a comma-separated list (see
    // pickVisibleTourTarget), so a single field covers every case.
    const el = pickVisibleTourTarget(step.highlightSelector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add(TOUR_HIGHLIGHT_CLASS);
      // Pages keep rendering after DOMContentLoaded (role-gated sections,
      // synced lists), which can push the target back off screen after
      // the scroll above already happened -- seen for real on settings.html
      // on a phone. Re-check twice and scroll again if it drifted; the
      // card itself takes the bottom ~220px, so aim for the space above it.
      [400, 900, 1800].forEach(delay => setTimeout(() => {
        if (!el.isConnected || !el.classList.contains(TOUR_HIGHLIGHT_CLASS)) return;
        const r = el.getBoundingClientRect();
        const usable = window.innerHeight - 220;
        if (r.top < 0 || r.bottom > usable) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, delay));
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
    '<div class="onboarding-count">' + (stepIndex + 1) + ' / ' + APP_TOUR_STEPS.length + '</div>' +
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
