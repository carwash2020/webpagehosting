// dev-tools-shared.js -- shared between dev-tools.html and
// site-content.html (2026-08-20, structural item #15: Dev Tools had
// grown to mix general developer diagnostics with an entire site-text
// CMS, and "Content" alone was 83% of the file's lines). Both pages
// load this before their own page-specific script.
//
// This file: the "?" info-modal system (openDevInfo + its DEV_INFO
// data), the password-gate for publishing anything live (used by both
// account-role changes on dev-tools.html and content/FAQ/Terms saves
// on site-content.html), fetchWithTimeout (the shared network helper
// nearly every check and save on both pages uses), and the collapsible-
// panel mechanism both pages' sections use.

  const DEV_INFO = {
    consistency: {
      title: 'Live consistency check',
      body: `<p>Checks every tool page for the boilerplate they're all supposed to carry: the login gate, a Content-Security-Policy, the PWA manifest link, and a styles.css version that matches everyone else's -- plus a check that manifest.json's own URLs all have the /tools/ prefix, since a missing prefix there caused a real "Add to Home Screen" bug once already.</p><p>This is the exact same logic that runs automatically in GitHub Actions on every push -- this just lets you run it on demand, from right here, without waiting on a push or checking the Actions tab.</p>`,
    },
    dataquality: {
      title: 'Data quality check',
      body: `<p>A different concern from the check above this one -- that one asks "is the site configured right," this one asks "is the actual business data clean." Flags client names that only differ by capitalization or spacing (like "Sarah Miller" vs. "sarah miller"), since Top Clients and Job Density both group by exact name match -- a near-duplicate silently splits one client's real numbers into two smaller, wrong-looking entries instead of one accurate one.</p><p>Also flags jobs with no date or no client name on file, since those are the two fields several other features (weekday density, the client leaderboard, follow-up reminders) all quietly depend on being present.</p>`,
    },
    clientregistry: {
      title: 'Client registry',
      body: `<p>A client has never been a real record in this app -- just a name retyped into jobs, invoices, quotes, contracts, and contacts separately, with nothing linking them but exact spelling. That's why navigating between pages passes the name as a search term in the URL, and why "Sarah Miller" and "sarah miller" show up as two different people in every report that groups by name.</p><p>The registry fixes that at the root: one record per real client, matched case- and spacing-insensitively, with contact details recovered from wherever they were first entered. It's built by a one-time backfill that runs when you open the Dashboard.</p><p>This panel exists so the result can actually be checked against real data -- if a client here shows the wrong job count or two people got merged who shouldn't have, that's visible now rather than surfacing later as a quietly wrong number in a report.</p><p>Important: the backfill only ever ADDS a new record set. It never edits or deletes anything already stored, so nothing existing can be damaged by it (there's a test enforcing exactly that).</p>`,
    },
    session: {
      title: 'Session & sync',
      body: `<p>Shows which account is actually logged in on this device, and the result of the last push or pull attempt to Supabase.</p><p>"Push now" and "Pull now" trigger a sync immediately instead of waiting for the normal automatic/debounced sync to happen on its own -- useful when you want to be sure the latest data is saved or fetched right this second.</p><p>The "History" link expands the last 20 attempts (most recent first) -- useful for spotting a pattern, like "this started failing consistently around a specific time" rather than only ever seeing the single latest result.</p>`,
    },
    onboarding: {
      title: 'Onboarding tour',
      body: `<p>The 3-step Dashboard walkthrough (Snapshot, Action Items, Tools) that new visitors see, shown exactly once per logged-in account -- keyed to the account's email specifically, not just the browser, so if Connor and Steve ever share a device, dismissing it on one account doesn't hide it from the other.</p><p>"Replay quick tour" forces it to run again regardless of whether it's already been seen, by opening the Dashboard with a one-time override in the URL. It clears itself from the URL as soon as the tour finishes or gets skipped.</p>`,
    },
    roles: {
      title: 'Account roles',
      body: `<p>Replaces the old hardcoded rule (only connor@ ever got Dev Tools access) with a real role system stored in Supabase. Both Owner and Developer get identical access to every feature on this page -- the only difference is that a Developer can also change which role an account holds.</p><p>A safety check in the database itself blocks removing or downgrading the very last role that can manage roles, so a mistake here can't accidentally lock both of you out of ever assigning roles again.</p><p>Anyone signed in can see this list; only a Developer sees an enabled dropdown to actually change anyone's role.</p>`,
    },
    localdata: {
      title: 'Local data snapshot',
      body: `<p>Every piece of Triple H data stored in this browser's localStorage right now, and how much space each one is using.</p><p>This reflects THIS device only, deliberately -- not synced. A few of these (the login session, migration "have I run yet" flags) would actually break things if synced across devices, so this stays local on purpose.</p><p>The internal migration/seed flags are collapsed behind their own toggle since there can be 30+ of them and they add no diagnostic value on their own -- just real data stays visible up top.</p>`,
    },
    wikihealth: {
      title: 'Appliance Wiki health',
      body: `<p>A quick read on how much is in the Appliance Wiki: how many brands and specific models, how many issues logged in total, and how many of those are Verified (sourced from a real catalog) versus Logged by you (a firsthand field report).</p>`,
    },
    device: {
      title: 'Device info',
      body: `<p>What this specific device and browser currently report: screen size, viewport size, online status, and the full browser identification string. Useful for figuring out why something looks or behaves differently on a phone versus a computer.</p>`,
    },
    serviceworker: {
      title: 'Service worker & cache',
      body: `<p>Shows whether a service worker is actually registered on this device, its current state, what's in Cache Storage, and roughly how much space it's using.</p><p>"Clear cache & unregister" wipes all of it and reloads a clean slate -- the same thing Chrome's own DevTools "Clear Storage" button does. Useful when something looks stale or behaves differently after a real update, since a leftover cached file is a common cause of that.</p>`,
    },
    clienterrors: {
      title: 'Client errors',
      body: `<p>The last 20 JavaScript errors that happened on ANY tool page, on either device, captured automatically in the background (no action needed to log them). Shows the error message, which page it happened on, who was on it, and when.</p><p>Synced across devices -- an error on Steve's phone shows up here on Connor's device too, once the next sync happens.</p>`,
    },
    pushtest: {
      title: 'Push notification test',
      body: `<p>Inserts a test lead using the exact same path the real contact form uses (not a direct call to the Send-Push function itself, which needs a service_role key that must never sit in this page's JavaScript). That insert should trigger the same server-side notification pipeline a real lead does.</p><p>This can't directly confirm a push was actually received on any device -- only that the insert (and whatever fires from it server-side) ran without an error. The test lead gets deleted automatically a few seconds later either way.</p>`,
    },
    pushhistory: {
      title: 'Push notification history',
      body: `<p>Reads notification_log directly -- the same table the Send-Push edge function's own de-duplication logic uses to decide whether a category has already fired recently, so this is the real record of what's actually gone out, not a separate log kept just for display.</p><p>Doesn't confirm a push was actually received on any device, only that it was sent from this end -- same limitation as the test button above.</p>`,
    },
    bookingtest: {
      title: 'Booking notification test',
      body: `<p>Runs a real booking through its full lifecycle: creates a test booking, reschedules it, then cancels it -- exercising all three notification paths (new booking, rescheduled, cancelled) in one run, using far-future dates that can't collide with a real appointment. Cleaned up automatically afterward.</p><p>Doesn't confirm a push or email was actually received, only that each step ran and the server accepted it -- same limitation as the Push notification test above. Check the Send-Push and send-booking-email edge function logs in Supabase directly to confirm delivery.</p>`,
    },
    recentbookings: {
      title: 'Recent bookings',
      body: `<p>Reads th_bookings directly -- the last 20 appointments booked through the site, regardless of whether they've already been converted into a Job Tracker entry. This is specifically for confirming the booking pipeline itself actually worked (the guest's submission landed, the notification fired), separate from the Job Tracker conversion step, which is its own action taken later from the Dashboard's Upcoming Bookings panel.</p>`,
    },
    knownissues: {
      title: 'Known issues',
      body: `<p>Real, still-open items -- add a new one right from here with "+ Add issue", check one off once it's actually resolved, or delete it once it's no longer worth tracking. Synced across devices, so anything either account logs shows up for both.</p>`,
    },
    flaggedpages: {
      title: 'Flagged pages',
      body: `<p>Anything flagged from the small button in the bottom-right corner of any tool page -- for a moment when something looks off but there isn't time to write it up properly. Just the page, an optional note, and when it was flagged. Resolve once it's actually fixed, or delete it if it turns out not to be worth chasing. Synced across devices, same as Known Issues.</p>`,
    },
    deploy: {
      title: 'Deploy history',
      body: `<p>Pulls the last 8 GitHub Actions runs for this repo directly from GitHub's public API -- no login needed since the repo is public. The top summary is the single most recent run; the list below it shows enough history to spot a pattern (e.g. "this started failing consistently a few runs back") rather than just a single snapshot.</p>`,
    },
    uptimemonitoring: {
      title: 'Uptime monitoring',
      body: `<p>In-house replacement for HetrixTools. A GitHub Actions workflow checks the live site every 10 minutes from outside Supabase entirely, logs every result, and alerts (push + email) only on a real state change -- going down, or recovering. This panel shows the current status, uptime over the last 24 hours and 7 days, average response time, and recent incidents grouped into single entries rather than every individual check.</p>`,
    },
    regressioncheck: {
      title: 'Regression checker',
      body: `<p>Compares the current code against an earlier commit and flags anything that looks like it disappeared without a clear replacement -- a JavaScript function, an HTML element id, or a CSS class that existed in the older version but can't be found anywhere in the newer one.</p><p>Uses GitHub's own diff for the comparison (one API call, not dozens), so it only looks inside files that actually changed between the two commits. If something moved into a file that <em>didn't</em> change in this same range -- rare, but possible -- this won't catch it. Flags things to look at, not a guarantee either way; always worth a real look at anything it surfaces, and it's normal for planned renames or intentional removals to show up here too.</p><p>Very large files sometimes come back from GitHub without a full diff -- those are listed separately as "couldn't auto-check," worth a manual look rather than assumed fine.</p>`,
    },
    changelog: {
      title: "What's new",
      body: `<p>Real commit messages from this repo, newest first -- same public GitHub API as Deploy History above, so no separate setup. Each entry shows its short title by default; "Show full message" expands the complete explanation of what changed and why, right here, without leaving the app. The GitHub link still goes to the actual code diff (the literal before/after of every file), for anyone who wants to see the change itself rather than just read about it.</p><p>To revert something you don't like: just ask in chat which commit (or describe what changed) and it can be reverted directly -- that's a normal git operation, not something this page needs a button for.</p>`,
    },
    sitecontent: {
      title: 'Site content',
      body: `<p>Edits a small set of fields on the public site directly -- the phone number, email, both hours lines, and up to 2 announcement banners -- without touching any code or pushing through GitHub.</p><p>Phone and email are the big ones: changing either updates EVERY place it appears across the whole homepage at once -- the header, the hero button, the mobile menu, the contact cards, the footer, all 3 FAQ answers that mention it, and the Terms modal -- not just one spot.</p><p>Leave a field blank to fall back to whatever's already hardcoded in the page (for phone/email/hours) or to hide it entirely (for the banners). Changes typically go live within a few seconds. Needs a one-time SQL setup run in Supabase before this will work -- see the setup notes if the form below shows an error.</p>`,
    },
    contenthistory: {
      title: 'Content edit history',
      body: `<p>Every change ever made to Site Content, the FAQ, or Terms &amp; Conditions -- what it was, what it became, who changed it, and when. The last 50 edits across all three, merged together.</p><p>This is written by a database trigger, not by this page's own save button -- so it's a real audit trail that would catch a change made any other way too, not just through this specific form.</p><p>The small colored dot shows who made it -- blue for Connor, pink for Steve.</p><p>"Restore this value" puts an old value back -- for a deleted FAQ/Terms item, it re-adds it as a new entry at the end of the list rather than in its original spot, since the original no longer exists to restore into directly.</p><p>"Download backup" saves everything currently in all 3 content tables as one JSON file -- a safety net to grab before a big editing session, not an automatic backup.</p>`,
    },
    links: {
      title: 'Quick links',
      body: `<p>Direct shortcuts to the places you'd otherwise have to remember URLs for or dig up bookmarks for: the GitHub repo itself, its Actions run history, the Supabase project dashboard, the HetrixTools uptime monitors (the site itself, plus the keep-alive that stops Supabase's free tier from auto-pausing), and the actual live public site.</p>`,
    },
    advisorhealth: {
      title: 'Advisor health',
      body: `<p>Pulls Supabase's real security and performance advisor findings (the same lints get_advisors surfaces) directly into this page. Calls a Supabase Edge Function (advisor-health) that alone holds a Supabase Management API Personal Access Token -- never present anywhere in this page's own code, same reasoning as the GitHub token used by Trigger workflows.</p><p>Unlike a GitHub fine-grained token, a Supabase PAT can't be scoped to just this one project -- it's account-wide access to advisor data for every project the account can see. Treat it as more sensitive than GITHUB_PAT for that reason.</p><p>Sorted worst-first (errors, then warnings, then info) so whatever most needs attention is always at the top.</p>`,
    },
    storagebrowser: {
      title: 'Storage browser',
      body: `<p>Scans all 3 Storage buckets (job-photos, receipts, secure-documents) and shows a real file count and total size for each -- there was previously no way to see what's actually in these buckets from inside the app at all.</p><p>Since each bucket stores files inside per-record folders (job-&#123;id&#125; for photos, expense-&#123;id&#125; for receipts) rather than flat, this has to list the bucket root first to find the folders, then list inside each one -- so a bucket with a lot of jobs or expenses will take a few seconds longer than one with just a handful.</p>`,
    },
    bookingfunnel: {
      title: 'Booking funnel health',
      body: `<p>New bookings, cancellations, and reschedules over the last 8 rolling weeks (each bar is a 7-day window counting back from right now, not a calendar week -- the right-most bar is always "the last 7 days," whatever day it happens to be). Uses the real cancelled_at/last_rescheduled_at timestamps, not created_at -- a booking made three weeks ago and cancelled yesterday counts as yesterday's cancellation, not three weeks ago's.</p><p>A reschedule only counts once per booking, in the week of its MOST RECENT reschedule -- there's no full history of every individual reschedule event, only a running count and the latest timestamp, so a booking rescheduled twice in the same week and once the week before shows up as one bar in the more recent week.</p>`,
    },
    leadresponsetime: {
      title: 'Lead response time',
      body: `<p>How long a lead actually sits before someone marks it handled, using the real handled_at timestamp (set the moment handled first becomes true, regardless of which screen does it) rather than assuming it happened right when the lead came in. Average and median are both shown since one very old, finally-handled lead can pull the average up a lot without median moving much.</p><p>Currently-unhandled leads are counted separately, along with how long the single oldest one has been waiting -- the number most worth acting on directly.</p>`,
    },
    uptimetrend: {
      title: 'Uptime trend',
      body: `<p>Weekly uptime % over the last 8 rolling weeks (7-day windows counting back from now), from the same th_uptime_checks data the Uptime monitoring panel uses for its current-status view -- this is the trend version, not a replacement for that panel. Green is 99.5%+, orange is 95-99.5%, red is below 95%; a flat gray sliver means no checks were logged in that window at all (the monitor itself was down or hadn't started yet), not 100% uptime.</p>`,
    },
    dataintegrity: {
      title: 'Data integrity check',
      body: `<p>Cross-checks job photo database records against actual files in Storage, in BOTH directions: a record whose file is missing (an upload that got interrupted after the metadata was saved but before the file finished), and a file sitting in Storage with no matching record (the reverse -- the file landed but the database insert never completed). Either one means a photo that looks like it exists but doesn't actually work.</p><p>Also flags any lead with neither a phone number nor an email on file -- either one alone is completely normal, but both blank usually means the contact form was submitted incompletely and there's currently no way to reach that person back.</p><p>Three booking checks too: a booking whose job_id points at a job that's since been deleted (a stale, one-way link -- the job schema has no back-reference); a cancelled booking that's still linked to a job (the cancellation notification flags this once, at the moment it happens, but this check catches it if that notification was ever missed, so the job doesn't sit around unresolved); and a booking whose end time is at or before its start time, which should never happen but is worth a real check rather than assuming it can't.</p>`,
    },
    triggerworkflows: {
      title: 'Trigger workflows',
      body: `<p>Runs any of the 5 GitHub Actions workflows on demand instead of waiting for its schedule. Calls a Supabase Edge Function (trigger-workflow) that holds the actual GitHub credential server-side -- it's never present anywhere in this page's own code, since anything sitting in client-side JS on a public page can be read by anyone who views the page source.</p><p>That function separately verifies the account calling it is genuinely signed in AND has a real assigned role (the same account_roles check everything else on this page depends on) before it will do anything, regardless of what this page itself shows -- so this stays safe even if something else about the page's own access control were ever wrong.</p>`,
    },
  };
  function openDevInfo(key) {
    const info = DEV_INFO[key];
    if (info && typeof openInfoModal === 'function') openInfoModal(info.title, info.body);
  }
  // Soft confirmation gate before publishing anything to the live site
  // (Site Content, FAQ, or Terms saves) -- see the modal's own text for
  // the honest limit of what this actually protects against. Hashed
  // rather than stored in plain text so it's not trivially visible at
  // a glance, though that's a small speed bump, not real security --
  // anyone who views this page's source and is determined enough can
  // still bypass it.
  const DEV_PASSWORD_HASH = '70abb329febcd9d03819bedb5c5c9d67d6d3ca2a31711ee7dff634b7982e893c';
  let _devPasswordResolve = null;
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function showDevPasswordPrompt() {
    return new Promise(resolve => {
      _devPasswordResolve = resolve;
      const overlay = document.getElementById('devPasswordOverlay');
      const input = document.getElementById('devPasswordInput');
      input.value = '';
      overlay.classList.add('is-open');
      setTimeout(() => input.focus(), 50);
    });
  }
  function devPasswordSubmit() {
    const value = document.getElementById('devPasswordInput').value;
    document.getElementById('devPasswordOverlay').classList.remove('is-open');
    if (_devPasswordResolve) { _devPasswordResolve(value); _devPasswordResolve = null; }
  }
  function devPasswordCancel() {
    document.getElementById('devPasswordOverlay').classList.remove('is-open');
    if (_devPasswordResolve) { _devPasswordResolve(null); _devPasswordResolve = null; }
  }
  async function confirmDevPassword() {
    // Remembered for the rest of this browser session (sessionStorage,
    // not localStorage -- clears automatically the moment the tab
    // closes) so editing several things back-to-back doesn't mean
    // re-typing the password every single time.
    if (sessionStorage.getItem('th_dev_password_confirmed') === '1') return true;
    const entered = await showDevPasswordPrompt();
    if (entered === null) return false; // cancelled
    if (!entered) { showToast('Dev password required.', { type: 'error' }); return false; }
    const hash = await sha256Hex(entered);
    if (hash !== DEV_PASSWORD_HASH) {
      showToast('Incorrect dev password.', { type: 'error' });
      return false;
    }
    sessionStorage.setItem('th_dev_password_confirmed', '1');
    return true;
  }
  async function fetchWithTimeout(url, ms, extraOpts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, Object.assign({ cache: 'no-store', signal: controller.signal }, extraOpts || {}));
    } finally {
      clearTimeout(timer);
    }
  }
  const COLLAPSE_KEY_PREFIX = 'th_dev_panel_open_';
  function toggleDevPanel(headingEl) {
    const panel = headingEl.closest('.dev-panel');
    if (!panel) return;
    const key = panel.getAttribute('data-collapse-key');
    const nowCollapsed = panel.classList.toggle('is-collapsed');
    // sessionStorage, not localStorage -- matches the dev password's
    // own scope, so a fresh tab starts from the same clean default
    // rather than inheriting a layout set days ago.
    if (key) {
      try { sessionStorage.setItem(COLLAPSE_KEY_PREFIX + key, nowCollapsed ? '0' : '1'); } catch (e) { /* private mode, ignore */ }
    }
  }
  function initCollapsiblePanels() {
    document.querySelectorAll('.dev-panel.is-collapsible').forEach(panel => {
      const key = panel.getAttribute('data-collapse-key');
      let wasOpen = null;
      if (key) {
        try { wasOpen = sessionStorage.getItem(COLLAPSE_KEY_PREFIX + key); } catch (e) { wasOpen = null; }
      }
      if (wasOpen !== '1') panel.classList.add('is-collapsed');
    });

    // The Content jump-nav link targets "Site content", which is one of
    // the collapsed-by-default panels -- landing on a collapsed panel
    // reads as a broken link. Expand whatever a jump lands on.
    document.querySelectorAll('.jump-nav a').forEach(link => {
      link.addEventListener('click', () => {
        const target = document.querySelector(link.getAttribute('href'));
        const panel = target && target.closest('.dev-panel.is-collapsible');
        if (panel && panel.classList.contains('is-collapsed')) {
          const heading = panel.querySelector('.dev-panel-heading');
          if (heading) toggleDevPanel(heading);
        }
      });
    });
  }
