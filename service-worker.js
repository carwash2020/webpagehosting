// Service worker for the Triple H Workspace PWA.
//
// This project deliberately had NO caching before -- a styles.css update
// once looked like the whole site was broken purely from a stale cached
// copy, and the fix at the time was to cache nothing at all. That's
// being reversed here now that the project is more stable, but the
// SAME underlying risk still needs guarding against, so requests are
// split into two different strategies depending on what's being asked
// for:
//
//   - Versioned assets (any URL with a ?v= param -- every shared JS/CSS
//     file): cache-first. These are IMMUTABLE once published -- the
//     whole point of the version string is that a content change always
//     comes with a NEW version, so the exact same URL never needs
//     re-fetching to pick up fresh content. A cache hit here needs zero
//     network round-trip at all, which matters more than it used to:
//     most tool pages went from ~5-6 shared-file requests to 9-10 after
//     splitting tools-common.js and styles.css into focused pieces
//     (2026-08-20), and forcing every one of those onto the network on
//     every single page load was a real, compounding slowdown.
//   - Everything else (HTML pages, anything without a ?v=): network-
//     first, same as before this fix. Online, every request still goes
//     to the network first -- you always get the current version, and
//     the cache only updates as a side effect of a successful fetch,
//     never served ahead of one. Offline (a dead zone on a job site, no
//     signal), only THEN does this fall back to whatever was last
//     successfully cached, so the app can still open and show existing
//     local data instead of failing to load entirely.
//
// Cross-origin requests (Supabase API calls) are never touched here --
// those always go straight to the network with no caching, since
// serving stale business data as if it were current would be actively
// misleading, not helpful. If Supabase is unreachable, those calls
// should keep failing exactly as they already did; this only helps the
// app SHELL (the pages themselves) still open.

// Bumped 2026-08-16: auth.js has had two real fixes since the last
// bump (2026-08-14) -- the session-refresh race that intermittently
// hid the Dev Tools tile, and the getAuthToken() hardening against a
// malformed stored token -- and CACHE_NAME was never bumped for
// either one. auth.js is in the precache list below, so every device
// that installed the service worker before either fix could still be
// silently running the OLD cached copy indefinitely, no matter how
// many times the page itself is refreshed -- refreshing a page doesn't
// bypass a service worker's own cache the way a hard cache-clear does.
// This is exactly the trigger that forces every client to actually
// fetch fresh files instead of continuing to serve what they already
// have stored.
// Bumped 2026-08-16 (again, same day): dev-tools.html changed again
// (added exact-value diagnostic logging to the advisor-health request,
// after a fix confirmed via cache-bump v3 didn't resolve the reported
// error) -- and dev-tools.html is also in the precache list below.
// Same reasoning as the v2->v3 bump just above: without bumping this
// again, THIS change would hit the identical "device never actually
// gets it" problem it was meant to help diagnose.
// Bumped 2026-08-16 (third time today): dev-tools.html changed again --
// found the diagnostic added in v4 WAS actually firing correctly, but
// the Client errors panel display only renders once at page load and
// wasn't refreshing itself after a new entry got logged mid-session.
// Screenshots confirmed the new code was already live (a new hint line
// in the error text was showing) but the panel still only showed old
// entries from before -- not a caching problem this time, a real bug
// in the render logic, now fixed by calling renderClientErrorLog()
// immediately after logging. Still bumping this so that fix reaches
// devices without needing yet another round-trip to explain why it
// didn't show up.
// Bumped again (2026-08-20): light mode for the internal tools app,
// tucked into Settings -- 17 HTML pages changed (the anti-flash theme
// snippet on all of them, plus the toggle itself on settings.html and
// its own separate light override on runway-dashboard.html). Also
// fixing a genuine, pre-existing gap found while already touching this
// list: settings.html itself was never added to the precache list at
// all, unlike every other real app page -- same class of oversight
// already documented and fixed twice above for other pages.
// Bumped again (2026-08-20): desktop-width layout improvements across
// 15 HTML pages -- efficient on phone stays exactly as it was,
// efficient on computer gets more room to use.
// Bumped again (2026-08-20): moved the ambient background gradient
// from body.th-tool-page to html, fixing the black-bar/gradient-
// positioning bug found right after the desktop-width work above.
// Bumped again (2026-08-20): desktop sidebar navigation, requested
// directly -- runway-dashboard.html (precached) gained its own static
// copy of the sidebar.
// Bumped again (2026-08-20): desktop board/table view added to Job
// Tracker, requested directly following the sidebar work above.
// Bumped again (2026-08-20): fixed the black-bar-on-the-right bug
// found from a direct screenshot -- 16 HTML pages plus
// styles-tools.css (all precached) genuinely changed.
// Bumped again (2026-08-20): header now spans the full width next to
// the sidebar on desktop, requested directly from a screenshot -- 14
// HTML pages plus styles-tools.css (all precached) genuinely changed.
// Bumped again (2026-08-20): fixed the .jump-nav tab bar (Snapshot/
// Action Items/More/Tools) to span the full width on desktop too,
// same fix as the header, requested directly from a screenshot.
// Bumped again (2026-08-21): moved the Live sync indicator to sit as
// a second row under the settings button on desktop, requested
// directly.
// Bumped again (2026-08-21): fixed a widespread stale-reference
// pattern found during a direct text audit -- Cost Lookup, Expenses,
// Income, and Profitability all moved to Finance during this week's
// structural rework, but 5 pages still attributed them to Job
// Tracker.
// Bumped again (2026-08-21): fixed 3 genuinely broken help buttons on
// finance.html (openCardInfo was never defined there), found by a new
// automated button-handler check requested directly.
// Bumped again (2026-08-21): fixed the Client Errors "Clear" button
// not actually persisting past a page reload, reported directly.
// Bumped again (2026-08-21): fixed a gap at the top of the screen on
// mobile with scrolled content visible through it -- the sticky
// header's top value had been offset by the safe-area-inset instead
// of staying at 0, reported directly with a screenshot.
// Bumped again (2026-08-21): added a real Delete button to the Client
// Registry in Dev Tools, requested directly.
// Bumped again (2026-08-21): added Finance and Settings tiles to the
// mobile Tools grid, requested directly.
// Bumped again (2026-08-21): Owner accounts now only see Client
// Registry and Account Roles in Dev Tools, requested directly --
// Developer keeps full, unchanged access.
// Bumped again (2026-08-21): fixed finance.html's back link (still
// went to Job Tracker, not Workspace like every other page) plus 4
// more missed stale Job Tracker/Finance references found on a more
// thorough follow-up sweep.
// Bumped again (2026-08-21): "What's new" changelog now groups
// commits by calendar day, requested directly.
// Bumped again (2026-08-21): "Flag this page for later" (suggestion
// #2, requested directly) -- a floating button on every tool page,
// synced flag queue, and a new Dev Tools panel to review them.
// Bumped again (2026-08-21): Known Issues audit (suggestion #3,
// requested directly) -- both seeded issues verified resolved against
// the live database, marked done rather than left showing as open.
// Bumped again (2026-08-21): fixed a stray blue native focus outline
// showing around buttons after a click, reported directly with a
// screenshot -- only this app's own orange :focus-visible ring should
// ever show, and only for real keyboard navigation.
// Bumped again (2026-08-21): fixed the live sync indicator and its
// refresh button not lining up on the same right edge, reported
// directly with a screenshot -- replaced fragile text-align with
// explicit flexbox column alignment.
// Bumped again (2026-08-21): fixed the tour popping up on every load
// instead of once, and the live sync/refresh button alignment,
// requested directly with screenshots.
// Bumped again (2026-08-21): the refresh button is now its own,
// fully independent position:fixed element, no longer relying on
// flexbox/shrink-to-fit sizing at all -- reported directly (twice)
// that alignment still wasn't quite right.
// Bumped again (2026-08-21): swapped the order of the refresh button
// and the live sync badge, requested directly -- refresh button now
// on top.
// Bumped again (2026-08-21): fixed the refresh button crowding the
// settings gear icon above it, reported directly -- the order swap
// left only ~8px of breathing room; now a real 20px gap.
// Bumped again (2026-08-21): found and fixed the actual root cause of
// the persistent header-button collision, reported directly across
// multiple screenshots -- a CSS selector specificity bug meant the
// main row was never actually pinned to the top of the header at all.
// Bumped again (2026-08-21): found and fixed a known iOS Safari bug
// where env(safe-area-inset-top) can unexpectedly return 0px, causing
// header content to overlap the phone's own status bar on real
// devices -- reported directly with a screenshot. Guarded every real
// usage app-wide with a 44px floor.
// Bumped again (2026-08-22): found the REAL root cause of the header/
// status-bar overlap, reported directly with a second screenshot
// showing the earlier fix had no effect at all -- a separate,
// mobile-specific media-query rule was silently overriding it with a
// flat, non-safe-area-aware padding value.
// Bumped again (2026-08-22): on mobile, the refresh button now stacks
// below "Live sync active" (matching desktop), with tighter spacing
// under the header, requested directly.
// Bumped again (2026-08-22): "Live sync active" now lives inside the
// header itself as a second row, requested directly ("move the bars
// together"), rather than a separate section below with a visible gap.
// Bumped again (2026-08-22): fixed jump-nav (the Snapshot/Action
// Items/More/Tools tabs) disappearing when scrolled -- it was sticking
// at a position now covered by the taller header, reported directly
// with a screenshot. Now measures the header's real height dynamically
// instead of relying on a hardcoded pixel value.
// Bumped again (2026-08-22): jump-nav (Snapshot/Action Items/More/
// Tools) now scrolls away normally with the page instead of staying
// sticky/pinned, requested directly ("the tools to slide") -- the
// previous fix correctly positioned it below the header but kept it
// sticky, which was reported as exactly the wrong behavior.
// Bumped 2026-09-02: data-layer.js, dev-tools-shared.js, and auth.js
// all changed across two separate merges (client-identity unification,
// then the role-check retry fix below) and NEITHER one bumped
// CACHE_NAME -- the failure mode the 2026-08-16 comment above already
// warned about.
//
// Worth being precise about what this bump does and doesn't guarantee
// (caught in review, and correct): every reference to these files
// carries a content-hash ?v= query param, and caches.match(event.request)
// below matches on the FULL request URL, search params included. So a
// genuine ?v= change on its own already produces a cache MISS for that
// new URL regardless of CACHE_NAME -- a real network fetch happens
// either way once the HTML referencing the new ?v= is loaded. Bumping
// CACHE_NAME is not what makes a correctly-?v=-bumped file fresh; what
// it actually does is (1) force every OLD versioned-URL entry to be
// dropped for good, via the activate handler's cache-name cleanup
// below, rather than sitting in storage unused forever, and (2) act as
// the real safety net for the two cases where a ?v= bump alone
// wouldn't save you: a file that's precached under its BARE path with
// no ?v= at all (this happens during install, before any page has
// requested a versioned URL), or any future change that lands without
// its ?v= correctly bumped alongside it. Bump this whenever a file in
// PRECACHE_URLS changes, even if you're confident every ?v= reference
// was updated too -- it's the backstop for the case where that
// confidence turns out to be wrong.
// Bumped 2026-09-03: dev-tools.html (precached) changed across several
// merges this week -- Portal tab panels, inline photo viewer, the
// onclick quoting fix -- without a bump. Same failure mode the
// 2026-08-16 and 2026-09-02 notes above already warned about.
// Bumped 2026-09-03: clients.html added to PRECACHE_URLS, and
// dev-tools.html/workspace.html both changed (Portal tab split out).
// Bumped 2026-09-03 (again): pos.html added to PRECACHE_URLS.
// Bumped 2026-09-05: push-notifications.js changed -- a real
// duplicate-subscription bug found during a direct scale audit was
// fixed there (a real upsert against a new unique index, instead of
// a plain insert that could accumulate duplicate rows for the same
// device). Precached under its bare path, no ?v= on this specific
// entry, so this bump is the only thing that actually invalidates
// the old cached copy -- same failure mode every prior bump above
// already warned about.
// Bumped 2026-09-05 (again): data-layer.js changed -- tombstone
// retention added (every th_*_tombstones array previously grew
// forever; now pruned to 90 days on every add), found during the
// same "should we clean up the blob" follow-up audit. Also precached
// under its bare path, same reasoning as the bump just above.
// Bumped 2026-09-05 (again): dev-tools-shared.js changed -- added a
// DEV_INFO entry for the new Portal client errors panel (automatic
// JS error capture on the portal, requested directly: "future proof
// this... what other layers can we add"). Also precached under its
// bare path.
// Bumped 2026-09-05 (again): sync.js changed -- stopped logging every
// expected, intermediate realtime CHANNEL_ERROR retry attempt as a
// client error (found investigating a real reported complaint about
// noisy client-side errors); dev-tools.html changed too (a real
// escaping-function inconsistency fixed on the same investigation).
// sync.js is also precached under its bare path.
// Bumped 2026-09-05 (again): invoice-generator.html changed -- fixed
// the iOS Safari zoom-on-focus bug (reported directly: "you click on
// a field and it zooms in"), precached under its bare path.
// Bumped 2026-09-05 (again): invoice-generator.html changed AGAIN --
// added a per-line-item Type dropdown (Labor/Mileage/Part/Other,
// requested directly), after the zoom-fix bump above had already
// deployed. Same file, same bare-path precaching, so this needed its
// own separate bump rather than assuming the prior one still covered
// a version of the file that no longer exists.
// Bumped 2026-09-05 (again): clients.html changed -- added Client
// Lookup (search by email/name/phone, spend total, and a dispute-
// evidence PDF export, requested directly: "that should go in the
// client area of the tools"), precached under its bare path.
// dev-tools-shared.js changed again too (a second DEV_INFO entry,
// after the portal-client-errors one already deployed at v52).
// Bumped 2026-09-05 (again): the iOS Safari zoom-on-focus fix
// (invoice-generator.html only, earlier the same day) was extended
// site-wide after a comprehensive scan found the identical bug on 8
// more precached tools pages (job-tracker, login, parts-reference,
// reset-password, review-request, route-planner, runway-dashboard,
// workspace).
// Bumped 2026-09-05 (again): clients.html changed -- fixed a real
// reported bug ("the clients page on computer does not fit or work
// right"), traced to a CSS override gap in the Client Lookup card
// built earlier the same day.
// Bumped 2026-09-06 (again): invoice-generator.html changed --
// line_items now saved to the internal invoice/quote logs too, not
// just the portal's own copy (requested directly, found while
// investigating a real reported receipt issue). Precached under its
// bare path.
// Bumped 2026-09-06 (v59 -> v60): /styles.css and
// /tools/styles-tools.css both changed during a run of visual work and
// this constant was not bumped at the time. Both are in PRECACHE_URLS
// and ?v= URLs are served cache-first without revalidation, so the
// installed Workspace app would have kept serving the old stylesheets
// indefinitely -- the precise failure the header above warns about.
// Bumped 2026-09-06 (v60 -> v61): /tools/styles-tools.css changed again
// (widened the surface-elevation token range for .th-tool-page, bumped
// tool-tile icon contrast). Precached under its bare path.
// Bumped 2026-09-06 (v61 -> v62): /tools/styles-tools.css changed again
// (button/icon redesign -- glass-highlight gradients on primary/
// secondary/small buttons, vivid enamel-pin tool-grid icons, refined
// flag button and sidebar/bottom-nav hex icons). Precached bare path.
// Bumped 2026-09-06 (v62 -> v63): /tools/styles-tools.css and
// /tools/tools-effects.js both changed again (dashboard section icons,
// Tools-grid category colors, dense-table pass, live-sync retry
// button). Both precached under their bare paths.
// Bumped 2026-09-06 (v63 -> v64): the type-system change. /styles.css
// and /tools/styles-tools.css are both precached here and both changed --
// every font-family in the project now resolves through four :root tokens
// (--font-display/--font-body/--font-ui/--font-app) instead of naming a
// face literally, and the body face moved off Inter. Precached ?v= URLs
// are served cache-first and never revalidated, so without this bump an
// installed Workspace would keep serving the old stylesheet indefinitely.
// Bumped 2026-09-06 (v64 -> v65): every precached tool page's <html> tag
// changed -- the inline style="background:..." (a pre-existing FOUC-
// prevention convention) used the background shorthand, which resets
// background-image along with background-color. That silently cancelled
// this stylesheet's own ambient gradient on <html> since the day it was
// added: correct in the CSS, never once visible on a real page. Fixed by
// narrowing the inline value to background-color, which still paints dark
// before CSS parses (the actual point of it) without touching a property
// it was never meant to touch.
// Bumped 2026-09-06 (v65 -> v66): tools/styles-tools.css changed again --
// Job Tracker's Jobs tab had two containers for the same list, #jobsList
// (cards) and #jobsTableWrap (a table added in a later pass), both filled
// unconditionally by renderJobs() with nothing anywhere hiding either one.
// Confirmed with real seeded data: every job rendered twice, stacked, on
// any desktop screen. Fixed with a 1024px breakpoint -- cards below it,
// table at and above it. Also fixed a real, unrelated overflow bug found
// in the same file: the status-filter button row had no wrap or scroll
// handling and forced 13px of horizontal page overflow at 390px.
// Bumped 2026-09-06 (v66 -> v67): tools-media-sharing.js and
// tools/styles-tools.css both changed again -- a real report from a
// live device's own Client Errors panel showed two recurring entries
// with no app code behind them: the browser's native View Transition
// API rejecting its own internal promises (tab backgrounded mid-
// transition, a newer navigation superseding an older one -- both
// routine on a phone used out in the field). Filtered from the error
// log by exact known message text; the duplicate, misattributed
// @view-transition{navigation:auto;} rule that caused no functional
// harm but was genuine dead weight was also removed.
// Bumped 2026-09-06 (v67 -> v68): tools/styles-tools.css changed again,
// plus tools/pos.html and tools/clients.html -- .tool-title/.tool-sub
// were used across 13 tool pages but never defined in the shared
// stylesheet (7 pages each carried an identical local copy, 6 more had
// no CSS backing the classes at all). On pos.html and clients.html
// specifically, that combined with a second, separate gap -- both
// pages were missing the standard desktop sidebar-clearance rule every
// other tool page carries -- to genuinely overlap the fixed header on
// desktop. Confirmed visually (a real screenshot showed the intro
// paragraph rendering behind the form card). Fixed both: the shared
// rule now lives here once, and both pages got the missing desktop
// layout rule.
// Bumped 2026-09-06 (v68 -> v69): tools/styles-tools.css changed again
// -- a real, significant light-theme bug found by actually screenshotting
// the tool suite with light mode on (not just reading the CSS): the
// dark-mode contrast-boost pass from earlier the same day scoped its
// override of --bg, --bg-panel, --bg-panel-2/3, and --border to
// body.th-tool-page with no check for [data-theme="light"] at all. Since
// custom properties are inherited from the nearest ancestor that sets
// them, and data-theme lives on <html> (an ancestor of body), that
// unconditional override silently beat the correct light-theme values
// for every element in the tool suite -- the sidebar, every card, every
// table -- rendering dark panels on a light page. Scoped the override to
// html:not([data-theme="light"]) instead; same values, same effect in
// dark mode, but light mode now actually looks light.
// Bumped 2026-09-07 (v69 -> v70): tools/invoice-generator.html changed --
// a visual pass on the actual Invoice/Estimate PDFs themselves (client
// deliverables, not just the in-app editor), requested directly. The two
// PDF generators (generatePDF(), generateQuotePDF()) drew an almost
// byte-identical header, line-items table, and totals block independently;
// extracted into shared drawPdfHeader()/drawPdfLineItemsTable()/
// drawPdfTotalsBlock() helpers, which also fixed two real bugs found by
// actually rendering both documents rather than just reading the code:
// (1) the estimate PDF's line-items table never got the invoice table's
// pagination guard (item #52, 2026-08-19), so a long enough estimate
// could silently draw rows off the bottom of the page; (2) the new
// "ESTIMATED TOTAL" emphasis box overlapped its own dollar amount at
// 14pt bold -- shortened the label to "EST. TOTAL" and added a
// defensive width check so a future long total label shrinks to fit
// instead of overlapping again. Visual changes: a soft divider between
// the client/job block and the line-items table, and a light orange-tint
// panel behind the final total on both documents so it reads as the
// clear focal point of the page.
// Bumped 2026-09-07 (v70 -> v71): tools/styles-tools.css and
// tools/pos.html changed, both precached here. styles.css carries a
// bare, unscoped `label { text-transform: uppercase; letter-spacing:
// 1px; }` written for the public site's contact form, and both of
// those properties inherit -- so the explanatory <span> hints nested
// inside field labels on Invoice Generator, Job Tracker, POS and
// Runway rendered as shouty, letter-spaced all-caps sentences up to
// ~100 characters long. styles-tools.css now resets casing on those
// nested hints only (the labels themselves stay uppercase, which is
// the deliberate design) and defines a shared .label-hint for the
// pattern; pos.html swaps its hand-rolled inline style for it.
// Bumped 2026-09-07 (v71 -> v72): tools/job-tracker.html changed,
// precached here. Recurring job templates' due badge gained a small
// ring showing days-remaining as a fraction of the template's own real
// cycle length (intervalMonths), the same device just added to the
// client portal's Jobs page warranty pill -- same size, same track
// brightness, deliberately reused rather than a third ring
// implementation with its own slightly different tuning.
// Bumped 2026-09-07 (v72 -> v73): tools/pos.html changed, precached
// here. The charge-success state was a bare line of green text -- the
// single most important confirmation in the app, the moment money
// actually changes hands, with less visual weight than a validation
// error -- given a proper checkmark-badge treatment matching the
// "done" language already established elsewhere in this codebase.
// Same reasoning as every prior bump in this file's history.
// Bumped 2026-09-07 (v73 -> v74): tools/workspace.html changed,
// precached here. Added a greeting banner (real time-of-day greeting +
// today's real job count, read from the same th_tracker_jobs data
// renderTodayJobs() already uses) right below the header -- previously
// the page went straight from the search box into the collapsible
// section list with no "first thing you see" moment at all.
// Bumped 2026-09-07 (v74 -> v75): /styles.css changed (a draw-in
// animation for the homepage's "How a visit actually goes" connecting
// line, gated on the same [data-reveal]/.is-visible mechanism as
// everything else), precached here.
// Bumped 2026-09-07 (v75 -> v76): /styles.css changed (dead-CSS cleanup
// -- .teardown-sticky/.teardown-track/.terms-disclaimer/.gallery-note
// removed, no markup anywhere ever referenced them), precached here.
// Bumped 2026-09-07 (v76 -> v77): /styles.css changed (dead-CSS
// cleanup -- .form-card removed, superseded on the main site long ago
// and never referenced by any page loading this stylesheet; the
// class name survives only as an unrelated same-named local class in
// tools/runway-dashboard.html's own self-contained <style> block,
// which never loads styles.css at all), precached here.
// Bumped 2026-09-07 (v77 -> v78): tools/runway-dashboard.html changed,
// precached here. It had 3 real validation prompts (naming a debt,
// expense, or income source) still going through the browser's own
// bare alert() -- it never loaded /tools/tools-dialogs.js, despite
// two of its own comments already referencing that file as the source
// of its escapeHtml()/haptic() helper copies. Every other tool page
// with any alert() at all already uses tools-dialogs.js's showAlert()
// for this. Now wired up and switched over the same way.
// Bumped 2026-09-07 (v78 -> v79): /styles.css changed (removed the
// generic ALL-CAPS .eyebrow label and single-word headline accent
// treatments the frontend-design skill's own checklist flags as
// common AI-design tells; added .coverage-badge, a real status pill
// reusing the existing .open-status dot+pill idiom), precached here.
// Bumped 2026-09-07 (v79 -> v80): job-detail.html, client-detail.html,
// and finance.html changed, all in PRECACHE_URLS. Real reported bug:
// "Live sync unavailable" on job-detail.html, always, on every
// device. Root cause: all three pages called startRealtimeSync()
// without ever loading the supabase-js <script> tag every other
// realtime-sync tool page (job-tracker.html, etc.) already has --
// window.supabase was undefined, so getSupabaseClient() always
// returned null regardless of actual network conditions. Added the
// same supabase-js tag, same URL/integrity, in the same position
// relative to sync.js, on all three.
const CACHE_NAME = 'th-workspace-v80';
const PRECACHE_URLS = [
  '/tools/workspace.html', '/tools/job-tracker.html', '/tools/invoice-generator.html', '/tools/contract-generator.html',
  '/tools/calendar.html', '/tools/route-planner.html', '/tools/review-request.html', '/tools/contact-card.html',
  '/tools/job-cost-lookup.html', '/tools/expense-logger.html', '/tools/login.html',
  // Added 2026-08-14 -- these 3 pages existed before but were never added
  // to the precache list, so they wouldn't open at all with no signal.
  // The Appliance Wiki (parts-reference.html) in particular is exactly
  // the kind of page worth having offline -- looking up a part number
  // in a basement with no signal is the scenario this cache exists for.
  '/tools/dev-tools.html', '/tools/site-content.html', '/tools/parts-reference.html', '/tools/runway-dashboard.html',
  // Added 2026-09-03 -- split off Dev Tools' own Portal tab onto its
  // own page, now a genuine daily operational tool in its own right,
  // same reasoning as everything else on this line.
  '/tools/clients.html',
  // Added 2026-09-03 -- the new POS tool, same reasoning.
  '/tools/pos.html',
  // Added 2026-08-20 -- same gap as above, these 3 pages (all from the
  // structural rework's Client/Job Detail views and the Finance split)
  // existed live but were never added here either.
  '/tools/finance.html', '/tools/client-detail.html', '/tools/job-detail.html',
  // Added 2026-08-20 -- same gap yet again, found while already
  // touching this list for the light-mode work above.
  '/tools/settings.html',
  // Added 2026-08-26 -- found by a new, automated check comparing this
  // list against the real file set, rather than another manual audit.
  // reset-password.html was missing entirely (a password-reset link
  // opened with flaky connectivity would fail to load at all), and
  // tools-tour.js was missing too -- the exact same file already found
  // missing from the separate cache-bust version list earlier the same
  // day, for the same underlying reason: a hardcoded list, maintained
  // by hand, drifting from reality.
  '/tools/reset-password.html', '/tools/tools-tour.js',
  // Bug fix (2026-08-20): tools-common.js no longer exists -- it was
  // split into 4 focused files (structural item #42). cache.addAll()
  // fails ATOMICALLY: if even one URL in this list 404s, NONE of the
  // files get precached, not just the missing one. Leaving a reference
  // to a retired file here would have silently broken offline support
  // for this entire app, not just for that one script. data-layer.js
  // (added in an earlier push) was also missing from this list --
  // found and fixed at the same time, while already touching this list
  // for the same reason.
  '/styles.css', '/tools/styles-tools.css', '/tools/dev-tools-shared.js', '/tools/sync.js', '/tools/auth.js', '/tools/data-layer.js',
  '/tools/tools-effects.js', '/tools/tools-dialogs.js', '/tools/tools-media-sharing.js', '/tools/tools-nav-pwa.js',
  '/tools/manifest.json',
  // Added 2026-08-14 -- same gap as above, these 2 scripts were live but unlisted.
  '/tools/qrcode-lib.js', '/tools/push-notifications.js',
  '/images/logo-signature-orange.webp', '/images/icon-192.png', '/images/icon-512.png', '/images/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => { /* a page not being reachable at install time shouldn't block install */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never intercept Supabase or other cross-origin calls

  // Performance fix (2026-08-20): a request carrying a ?v= cache-bust
  // param is for an IMMUTABLE resource -- the whole point of that param
  // is that a content change always comes with a NEW version string, so
  // the exact same URL never needs re-fetching to pick up fresh content.
  // These are safe (and much faster) to serve cache-first: a cache hit
  // needs zero network round-trip at all. Only requests WITHOUT a ?v=
  // (HTML pages, and anything else) still need the network-first-with-
  // reload behavior below, since guaranteeing fresh HTML after a deploy
  // is what that behavior exists to protect -- an HTML page's own URL
  // doesn't change when its content does.
  if (url.searchParams.has('v')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        });
      })
    );
    return;
  }

  // Bug fix (2026-08-20): fetch(event.request) alone does NOT guarantee
  // the network-first behavior described in the comment above -- it's
  // still subject to the browser's own HTTP cache underneath this
  // service worker, and could be silently satisfied from disk with no
  // real round-trip to the server at all, depending on what cache
  // headers the response happened to carry. { cache: 'reload' } forces
  // an actual revalidation with the server on every request, which is
  // what "network-first" was always meant to guarantee here. Found
  // after a page failed to show new content despite a confirmed-live
  // deploy -- exactly the failure mode this whole file exists to
  // prevent.
  const networkRequest = new Request(event.request, { cache: 'reload' });

  event.respondWith(
    fetch(networkRequest)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---------- push notifications ----------
self.addEventListener('push', (event) => {
  let data = { title: 'Triple H Workspace', body: 'You have a new notification.' };
  try { if (event.data) data = event.data.json(); } catch (e) { /* fall back to the default above */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/images/icon-192.png',
      badge: '/images/icon-192.png',
      data: { url: data.url || '/tools/workspace.html' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/tools/workspace.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
