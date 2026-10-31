# Project reference

Detailed reference for the repo: what every file is for, how sync, booking
and automation work, the cache-busting scheme, deploy pitfalls, and what must
never be deleted. This moved here verbatim from the root `README.md` on
2026-10-31. Wherever it says "below" about a "What changed" entry, that entry
is now in [`CHANGELOG.md`](CHANGELOG.md).

This repo actually serves **two separate things** from the same domain:

1. **The public marketing site** — homepage + 5 city landing pages, meant for customers and search engines. Lives at the repo root.
2. **An internal Workspace tool suite** — Dashboard, Job Tracker (with the Calendar view), Finance, Invoice Generator (with Quick charge), Contract Generator, Route Planner, Clients, Review Request Sender, Runway Dashboard, Appliance Wiki, Settings, Dev Tools, and Site Content, at `/tools/workspace.html` onward. Not linked from the public site, not indexed, but hosted on the same domain and repo since it's all static files anyway. **As of 2026-08-10, these live under `/tools/`, not the repo root** — see below.

The public site uses one shared stylesheet (`styles.css`, repo root). The tool suite has its own separate stylesheet (`tools/styles-tools.css`) — genuinely two files now, not one shared across everything; see "Shared files" below for what `styles.css` actually still covers.

## ⚠️ Read this before touching deployment at all

Two things on this specific repo have caused real, hours-long confusion before. Both are cheap to avoid if you know about them going in:

1. **`.nojekyll` must be named EXACTLY that — dot included — sitting at the repo root.** GitHub Pages runs every push through Jekyll by default, even plain static HTML, and Jekyll silently excludes anything starting with a dot (including `.well-known`, and anything similar added in the future). A file named `nojekyll` without the leading dot is a completely different, meaningless filename to GitHub — it will look right in a casual glance at the file list and still not work. If a dot-prefixed path ever 404s on this site, check this filename character-by-character before investigating anything else.
2. **The repo's file listing, and even a "Success" build status, are not reliable enough to confirm what's actually live.** The one source of truth that's never been wrong: **Actions tab → most recent run → Artifacts → download the `github-pages` file → unzip it → extract the `artifact.tar` inside it → look at the literal files.** That's the actual deployed output. Everything else (the repo listing, incognito browser testing, a green checkmark) is one inference away from it and has each individually given a misleading answer at some point on this project.

## Public site — file structure (repo root)

**Most public pages live flat at the repo root, deliberately.** GitHub
Pages serves each one at its exact current path with no server-side
redirect capability -- moving a live, indexed page changes its live
URL, which breaks Google's index and every existing backlink pointing
at the old one unless something is left behind to forward traffic.
This table groups everything by kind for readability.

**Real exceptions, made 2026-09-21:** the 8 service pages (5 plain +
3 service×city) moved from the root into `/services/`, and the 8 city
landing pages moved into `/locations/`. Both families were judged
worth the one-time cost because they're the parts of the site that
actively keep growing (3 new service×city pages added in a single
week, 2026-09-18, and the city-page count has grown from 5 to 7 over
the same stretch) -- unlike the rest of the site, which is a fixed
set. A thin redirect stub was left behind at each of the 16 old root
paths (see "Do not delete" below) specifically to soften that cost --
a visitor or search engine hitting the old URL gets forwarded to the
new one instead of a 404, same pattern this repo already used for
retired `/tools/` pages. `terms.html`/`privacy.html` and the rest of
the public pages were considered for the same treatment and rejected
-- they're a fixed, non-growing set, so there's no future-scaling
upside to offset the cost.

**Homepage, booking & core**

| File | Purpose |
|---|---|
| `index.html` | Main homepage — single-page site (services, reviews, about, areas, schedule, contact/FAQ/terms). Contact form inserts directly into `th_leads` (anon key) -- Formspree was removed 2026-08-24, replaced by a real, in-house Resend email pipeline (see "Booking system" below for the equivalent pipeline on the booking side). |
| `booking.html` | **In-house booking system** (added 2026-08-25, replacing Cal.com entirely -- subscription itself confirmed cancelled). 3-step flow: service → real open time slot → contact info. Phone number auto-formats live to `(XXX) XXX-XXXX` as the guest types; both phone and email get on-theme inline validation (native browser constraint validation was already enforcing a real `@`, this just makes it visible instead of a default tooltip). Redesigned 2026-08-25 with a real desktop layout (a sidebar builds up the appointment summary progressively) and a hexagon icon motif echoing the brand mark. See "Booking system" below for the full picture. |
| `manage-booking.html` | Guest self-service cancel/reschedule for a `th_bookings` self-service booking, reached via a unique token link in the confirmation email -- **not in the sitemap** (`noindex, nofollow`, deliberately unreachable except through that link). Same design system as `booking.html`. See "Booking system" below. |
| `manage-job.html` | The same guest cancel/reschedule-request pattern as `manage-booking.html`, but for a manually-scheduled job (`public.jobs`) instead of a self-service booking -- reschedule is request-only here (jobs have no time-slot exclusion constraint, so an instant move could double-book a day). Also token-gated, also excluded from the sitemap. |
| `about.html` | "Meet Steven Robinson" — LLC status, Eagle Scout background, prior maintenance-technician career. |
| `our-work.html` | Project gallery (tile, flooring, drywall, curtain track, etc. — see `images/gallery/`). |
| `careers.html` | Hiring/job-application page. |

**City landing pages** (`/locations/`) — one per service area, standard coverage unless noted. **Moved from the repo root into `/locations/` on 2026-09-21**, same batch and same redirect-stub treatment as the service pages below.

| File | Area |
|---|---|
| `locations/handyman-st-george-ut.html` | St. George, UT (the home base) |
| `locations/handyman-hurricane-ut.html` | Hurricane, UT |
| `locations/handyman-washington-city-ut.html` | Washington City, UT |
| `locations/handyman-santa-clara-ivins-ut.html` | Santa Clara & Ivins, UT |
| `locations/handyman-la-verkin-ut.html` | La Verkin, UT |
| `locations/handyman-leeds-ut.html` | Leeds, UT |
| `locations/handyman-cedar-city-ut.html` | Cedar City, UT — **by-request** (orange "AVAILABLE BY REQUEST" badge, own trip-fee FAQ) |
| `locations/handyman-mesquite-nv.html` | Mesquite, NV — **by-request** (same badge treatment, NV address in schema) |
| `locations/handyman-salt-lake-valley-ut.html` | Salt Lake valley (Sandy, West Jordan, South Jordan, Draper, Murray, Cottonwood Heights, Holladay, Midvale) — **by appointment only**, one page, framed as a planned trip from St. George (no local office; roughly 300 miles) |

**Service landing pages** (`/services/`) — one per service, not tied to a specific city. **Moved from the repo root into `/services/` on 2026-09-21** -- a redirect stub was left behind at each old root path (see "Do not delete" below) specifically so this move doesn't cost the pages their existing Google ranking/backlinks.

| File | Service |
|---|---|
| `services/washer-dryer-repair.html` | Washer/dryer repair (keeps the triage tool, links out to 2 blog posts) |
| `services/plumbing-repairs.html` | Plumbing repairs |
| `services/drywall-painting.html` | Drywall & painting |
| `services/handyman-repairs.html` | Doors, cabinets & hardware, carpentry & trim, weatherstripping |
| `services/assembly-installation.html` | Furniture/fixture assembly & installation |

**Service × city landing pages** (`/services/`) — one converting page per service+city pair, not a factory of near-duplicates (see `docs/service-city-landing-pages.md` for the reusable template and the doorway-page reasoning behind writing one per pair instead of find-and-replacing a city name). Also moved into `/services/` on 2026-09-21, same redirect-stub treatment.

| File | Pair |
|---|---|
| `services/washer-dryer-repair-st-george-ut.html` | Washer/dryer repair × St. George (added 2026-09-18, first instance) |
| `services/refrigerator-repair-st-george-ut.html` | Refrigerator repair × St. George (added 2026-09-18) |
| `services/dishwasher-repair-st-george-ut.html` | Dishwasher repair × St. George (added 2026-09-18) |

**Legal pages**

| File | Purpose |
|---|---|
| `terms.html` | Terms & Conditions — standalone page (`index.html` also has its own `termsOverlay` JS modal, reachable at `/#terms`; not a duplicate content problem since the modal is for on-page convenience and this file is the canonical, indexable, linkable version). No attorney review has been done on this text — a past session removed a visible "not reviewed by an attorney" disclaimer at the user's request, but the underlying legal risk it described didn't go away with the note. |
| `privacy.html` | Privacy Policy. |

**Blog & client area**

| File | Purpose |
|---|---|
| `blog/` | **Blog** (added 2026-09-01). `index.html` lists the posts; 10 posts as of 2026-09-19, each a standalone page with its own SEO metadata and Article structured data. `blog.css` extends the main site's brand tokens rather than introducing a separate design system (page headlines use Anton, matching the site's own h1; card-level headlines use Oswald, matching the service/contact cards). Photos are freely licensed Unsplash images, each individually verified before use — see the note under "Do not delete" about why there's no stock-photo shortcut here. |
| `portal/` | **Client portal** (added 2026-08-31, substantially extended through 2026-09-04) — 8 pages covering a client's entire relationship with the business, not just invoice payment: `login.html`, `set-password.html`, `home.html` (landing page, "Needs Your Attention" summary), `dashboard.html` (invoices + Stripe payment), `quotes.html` (review/questions/approval/self-scheduling), `jobs.html` (job history, warranty, check-up reminders), `work-orders.html` (Request Work form + two-way messaging), `settings.html` (saved cards, notification preferences). Deliberately shares NO JavaScript with `/tools/`. **Read `docs/CLIENT-PORTAL.md` before touching anything here** — it's the current, authoritative reference for every page and table; this row is a summary, not a substitute. Only `login.html` is indexable; every other page is `noindex` on purpose. |

**Site infrastructure / SEO meta files**

| File | Purpose |
|---|---|
| `sitemap.xml` | Lists all 41 live, indexable public URLs as of 2026-10-16 (each `lastmod` is that file's last git commit date; no `changefreq`/`priority`, which Google ignores): the homepage, `booking.html`, every city/service/service×city landing page above, `about.html`/`careers.html`/`our-work.html`, both legal pages, the blog index and its 16 posts, and the 9 location pages (the 8 St. George-area towns plus the one Salt Lake valley page). Deliberately excluded: `manage-booking.html`/`manage-job.html` (token-gated, `noindex`), and everything under `/tools/`/`/portal/` (all `noindex`, including `portal/login.html` -- the internal tool suite and client portal are not meant to be discoverable via search). Update this and resubmit in Google Search Console any time a page is added or removed. |
| `robots.txt` | Allows public-page crawlers; Disallow `/tools/` and `/portal/` (already noindex on those pages). Blocks bulk AI-training crawlers (`GPTBot`, `CCBot`, `Google-Extended`); allows live-retrieval/answer bots. |
| `404.html` | Custom not-found page (self-contained, own inline styles, doesn't use `styles.css`) |
| `.well-known/security.txt` | RFC 9116 security contact file. Requires `.nojekyll` (see above) to actually be reachable — this is exactly what broke for a long time. |
| `.nojekyll` | Empty file, must exist at repo root with this exact name. See the warning above — this is not optional and getting the filename wrong is silent. |
| `favicon.ico` | Multi-resolution icon (16/32/48/64px) — **must stay at repo root**, not inside `images/`. Browsers check `/favicon.ico` by default regardless of `<link>` tags. |
| `CNAME` | Custom domain config for GitHub Pages — don't touch unless the domain changes |
| `google0b12c450e3945a19.html`, `google523d668a9a330d64.html` | Google Search Console ownership verification — must stay at repo root, one per domain variant |
| `site-manifest.json` | PWA manifest for the public site specifically — separate from `/tools/manifest.json`, which is a different manifest for the internal tools. Not duplicates; each is genuinely used by its own half of the site. |

## Internal tools — file structure (`/tools/`)

**Moved here from the repo root on 2026-08-10** to de-clutter the root, which had ~20 internal files sitting alongside the handful of public-site files GitHub Pages and search engines specifically expect at the exact root. Every cross-link between these pages was updated to match; nothing else on the public site changed.

| File | Purpose |
|---|---|
| `tools/workspace.html` | **Dashboard** — the home screen, rebuilt Today-first on 2026-09-21: a one-line greeting band, then **Next Job** (tap-to-call, tap-for-directions, **Open Job**), **Today's route** (every stop, with **Route all** — one Google Maps link through every address on today's schedule), two daily actions (Find client, which opens Search, and Calendar — the rest are in **+ New**), the **Needs attention** inbox open by default (work requests, leads, applicants, bookings, jobs due this week, follow-ups), and **Money Owed**: every unpaid invoice (overdue first) with a two-tap **Mark paid**, Ready to invoice, and a search over invoices and logged income. Business Snapshot, Analytics, and Compliance & Documents sit collapsed under one **Business** label (the 2026-10-31 redundancy pass took out the duplicate search box, Rest of Today, the Income lane, the Mileage tile and the Gallery Queue, which moved to Site Content). No chip row, no tile grid: navigation is the sidebar (desktop) or bottom bar + More (phone). Bookmark this one. |
| `tools/job-tracker.html` | Jobs, Suppliers (the old Contacts tab, for vendors and parts houses since 2026-10-31; clients are on Clients), Notes — 3 tabs, one page. The Jobs tab has three views, remembered per device: **List** (a sortable table on desktop), **Board** (Not Started / In Progress / Done columns), and **Calendar** (moved here from the retired `calendar.html` on 2026-09-21 — a month view of every dated job plus unconverted online bookings in purple, tap a day for detail, **Add to Phone** exports a `.ics`; deep link `#calendar`). Cost Lookup, Profitability, Income, and Expenses moved out to `finance.html` on 2026-08-20. |
| `tools/finance.html` | Expenses (receipt required; the per-mile rate lives here; the default tab), Income, Profitability — split out of `job-tracker.html` on 2026-08-20 once these had grown into an entire bookkeeping system living inside a job list. Cost Lookup and Inventory tabs were removed on 2026-10-31 (their stored data is kept). |
| `tools/invoice-generator.html` | Invoice + Quote/Estimate + **Quick charge** + Recent tabs. Quick charge (moved here from the retired `pos.html` on 2026-09-21; deep link `#pos`) charges a client's card on the spot with no invoice -- one tap if that email has a saved card, otherwise a card form with a typed-name authorization; Stripe.js loads only at that moment. Tax-aware, per-line "Taxable" toggle. Convert a Quote to an Invoice with one tap. Generates a branded PDF with your Venmo QR built in. Both logs support deleting an entry (added 2026-08-26, with real cross-device delete protection built in from day one -- see "Deletion resurrection / tombstones" in `DISASTER_RECOVERY.md`), separate from the invoice/quote PDF itself, which is unaffected either way. |
| `tools/contract-generator.html` | Fill in a client/job, generate a branded contract PDF to email/text. Has two signature canvases — see the swipe-gesture note below if working on touch gestures anywhere near this page. |
| `tools/route-planner.html` | Multi-stop Google Maps route links, reorderable stops and a map preview. In the More drawer and Search (not the desktop sidebar) since 2026-10-31; the trip-cost analyzer was removed then — bill mileage with the invoice's **+ Add mileage**. |
| `tools/review-request.html` | Generates a review-request text message; deep-linkable with a client name/job pre-filled. Also has Google/Yelp QR code tabs. |
| `tools/runway-dashboard.html` | Personal + business financial runway tracking — debts, income, expenses, month-by-month. Save Month takes revenue/expenses/fuel straight from Finance (`finance.html`), no double entry; you add draws, cash and other expenses. The tax set-aside rate is the Dashboard's (one setting, `th_setaside_rate`, since 2026-10-31). |
| `tools/parts-reference.html` | **Appliance Wiki** — quick lookup for common appliance issues: what part it usually is, the part number, roughly what it costs. |
| `tools/settings.html` | Account info, display density and color theme, push notifications, tour replay (the tour is a 24-step tutorial as of 2026-09-22 -- every page and tab, about two minutes), password reset, **Backup & Restore** (moved here from the Dashboard on 2026-09-21 — the same full JSON export/import, no hop through another page), sign out. |
| `tools/dev-tools.html` | Site diagnostics and maintenance utilities, regrouped on 2026-09-24 into 7 tabs by the question each answers: Health (is anything broken right now), Data (is the business data clean, and can it come back), Sync (this device), Notifications, Ops (deploys, the to-do lists, shortcuts), Reports, and Access. Each tab is split into named sections; live panels are open cards, and the tools you only reach for now and then are collapsed one-line rows. 34 panels (Health's Live status gained the client portal's bug reports and client errors from Clients on 2026-10-31). Access is role-gated (`account_roles` table, see `DISASTER_RECOVERY.md`); an account without "Dev Tools (full technical)" (Steve's Owner account) sees only those two portal logs (Health tab), Client registry (Data tab) and Account permissions (Access tab), while a Developer-role account sees all 7 tabs. `#backup` lands on Data &rarr; Backup & restore. Also supports swiping left/right between tabs on mobile, scoped to the panel content area so it doesn't fight with the tab bar's own horizontal scroll. |
| `tools/site-content.html` | Edits the public site's changeable text and numbers with no deploy: Google star rating and review count, banners, homepage hours, phone, email, FAQ, Terms, and the **Gallery queue** (photos starred in Job Tracker for the website's gallery; moved here from the Dashboard on 2026-10-31). Fields are checked as you type, every publish shows live-vs-new first, and **Undo this save** / per-field history put back earlier values (rebuilt 2026-09-23, backed by `cms_publish_content()` / `cms_undo_content()` in `sql/site-content/cms_safe_publish_and_undo.sql`). Reached from **Website** in the sidebar and the More drawer (shown only to accounts with the "Site content" permission, since 2026-09-23) or Dev Tools &rarr; Content; needs that permission. Split out of `dev-tools.html` on 2026-08-20. |
| `tools/client-detail.html` | Full history for one client (jobs, invoices, quotes, contracts) — reached from workspace.html or job-detail.html, not linked from the main nav directly. |
| `tools/job-detail.html` | Full detail view for one job (photos, linked invoices, margin) — reached from job-tracker.html or finance.html, not linked from the main nav directly. |
| `tools/login.html` | Auth entry point for the whole suite. |
| `tools/reset-password.html` | Password reset flow, reached from a Supabase auth email link. |

## Shared files (used by BOTH the public site and internal tools — stayed at repo root deliberately)

| File | Purpose |
|---|---|
| `styles.css` | The public site's stylesheet, plus shared design tokens (colors, fonts) both halves of the site draw from. **No longer the tool suite's own CSS** — that split out into `tools/styles-tools.css` once the tool suite's own styling grew large enough to warrant its own file (see below). Referenced via the absolute path `/styles.css` from every page regardless of folder, so it never needed to move. |
| `service-worker.js` | Shared PWA service worker. **Deliberately stayed at the repo root, not moved into `/tools/`**, even though it's mostly tool-related — confirmed it's also referenced by the public site's pages, and a service worker's scope defaults to wherever the file itself lives (not wherever it's registered from), so keeping it at root is what lets one service worker cover the whole site. `PRECACHE_URLS` is a hardcoded list (a service worker has no filesystem access at runtime to discover new files itself), and its own comments document this exact class of drift recurring repeatedly by hand -- `npm run check-consistency` now verifies it automatically on every push instead: every real page/script in `/tools/` is in the list (2 more real, live gaps -- `reset-password.html`, `tools-tour.js` -- found and fixed 2026-08-26 this way), and every entry in the list points at a file that actually exists (a stale entry 404s and aborts `cache.addAll()` for every file in the list, not just the stale one -- exactly what happened for real when `tools-common.js` was retired but left behind). |
| `images/` | Logos, favicons, gallery photos, OG share image, Venmo QR code. Should contain only actual image files — a past upload mistake once left duplicate copies of `index.html`, `job-tracker.html`, and `styles.css` sitting in here; if any stray HTML/CSS ever turns up in this folder again, it's a mistake, not intentional. |

## Files inside `/tools/` that are NOT shared with the public site

| File | Purpose |
|---|---|
| `tools/sync.js` | The entire cloud-sync engine — push/pull to Supabase, real-time subscriptions, Leads fetch/update/delete, Job Photos and Receipts upload/delete. Supabase credentials live here (anon/public key only — never the secret key). |
| `tools/data-layer.js` | Shared read/write path for jobs, invoices, expenses, and the client registry (`clientId`s, backfill migration from name-matching). Every page reading or writing this data should go through here rather than touching `localStorage` directly, so a fix (or a sync-push trigger) only needs to happen in one place. |
| `tools/styles-tools.css` | The tool suite's own stylesheet — everything specific to `/tools/` pages (sticky header, sidebar, bottom nav, badges, forms) lives here, separate from the public site's `styles.css`. Every page loading it must use the exact same `?v=` cache-bust version, and that version is the file's own real content hash (not a manually-chosen date) as of 2026-08-26 -- see "Cache-busting" below. |
| `tools/tools-effects.js`, `tools/tools-dialogs.js`, `tools/tools-media-sharing.js`, `tools/tools-nav-pwa.js` | Shared tool behavior, split out of a since-retired `tools-common.js` (2026-08-20, once it had grown to 1,447 lines mixing everything together): completion celebration/help-modal content/icon-search; the custom confirm/alert dialog system (`escapeHtml` lives here specifically, not in `tools-effects.js` — worth double-checking before assuming which file has a given helper); photo lightbox/voice dictation/toasts; and the mobile bottom nav + desktop sidebar injection (sidebar added 2026-08-20), respectively. |
| `tools/auth.js` | Login/session handling, including the redirect-to-login-and-back-again flow, plus the account-roles system (`hasDevToolsAccess()`, `canManageRoles()`) that gates Dev Tools access. |
| `tools/push-notifications.js`, `tools/qrcode-lib.js`, `tools/manifest.json` | Push notification setup, QR code generation, and the internal-tools PWA manifest (separate from the public site's `site-manifest.json` at the root). |

## Backend

The internal tools sync through a **separate Supabase project belonging to Triple H only** — never shared with any other business. See `DISASTER_RECOVERY.md` at the repo root for incident runbooks, and `sql/` + `edge-functions/` for schema history and the deployed Edge Function's source.

- `sql/` — every schema/migration/fix file actually run against Supabase, kept as a record of what was done and why. Organized into subfolders by feature area (`booking/`, `leads/`, `site-content/`, `security/`, `infra/`, `portal/`) as of 2026-08-26, since 27 flat files in one folder had stopped being easy to scan. Not meant to be blindly re-run; read each file's own comments first, since some are idempotent and some (the duplicate-cleanup fixes) are meant to run exactly once. **Note `sql/security/fix_authenticated_only_rls_policies.sql` (2026-09-01) in particular** — it documents a real vulnerability that affected seven tables and the general lesson behind it.
- `edge-functions/` — snapshots of every deployed Edge Function's source, for reference/disaster-recovery: `send-push-index.ts` (`Send-Push`, capitalized slug -- Supabase treats function names case-sensitively), `send-lead-email-index.ts` (`send-lead-email`, replaces Formspree), `send-booking-email-index.ts` (`send-booking-email`, added 2026-08-25 with the booking system), `uptime-alert-index.ts` (`uptime-alert`, added 2026-08-25 with uptime monitoring), `advisor-health-index.ts`, and `trigger-workflow-index.ts`. **The client portal's five functions** (`sync-invoice-to-portal`, `send-invite`, `send-invoice-notification`, `create-payment-intent`, `stripe-webhook`) are documented in `docs/CLIENT-PORTAL.md` rather than snapshotted here — including the two non-obvious constraints (`stripe-webhook` must run with `verify_jwt: false`, and `sync-invoice-to-portal` forwards the caller's own token rather than the service role key). Restoring any function for real requires the Supabase CLI plus re-adding that function's own secrets in Supabase's own dashboard -- none of those keys are ever stored in this repo.

## Cross-device sync — how it actually works (substantially extended 2026-08-25 through 2026-08-26)

Most business data (jobs, invoices, contracts, quotes, clients, expenses, income, contacts) lives as one JSON blob in a single `workspace_sync` row, kept in sync across devices by a **union merge** (`mergeRecordArrays` in `sync.js`) rather than a plain overwrite -- so two devices adding different new records at the same time don't clobber each other.

The real tradeoff that comes with a union merge: it can't tell "this record never existed here" apart from "this record existed here and was deliberately deleted," so a device that hasn't yet pulled a deletion can push its old copy right back and resurrect it. **Fixed with a tombstone per record type that supports deletion** -- every job, client, expense, income entry, contact, contract, invoice, and quote deletion now records one, and every sync pull filters against it. Full detail, the complete list of which record types are covered, and exactly how to extend this to a new one later: see "Deletion resurrection / tombstones" in `DISASTER_RECOVERY.md`.

Deleting something also snapshots it into a separate "Graveyard" (Dev Tools → Data → Get it back), so a genuine mistake can actually be restored -- not just prevented from silently reappearing, which is all the tombstones above do. See "Graveyard" in `DISASTER_RECOVERY.md` for the full detail, including the one real limit (a deleted expense's receipt photo isn't recoverable, since that file is gone from cloud storage immediately).

## Booking system (added 2026-08-25, replaces Cal.com entirely)

Requested directly: full ownership and Triple H branding (not Cal.com's), plus a real database-level guarantee against double-booking. `booking.html` is the public-facing page (all 16 old Cal.com links across `index.html` and the 5 city pages now point to it); `th_bookings` is the Supabase table backing it. The Cal.com subscription itself has been cancelled.

- **The actual protection against double-booking is a database exclusion constraint**, not client-side JS -- `no_overlapping_confirmed_bookings` on `th_bookings`, using a `padded_range` column (set by a `BEFORE INSERT/UPDATE` trigger, not a generated column -- Postgres requires generated-column expressions to be IMMUTABLE, and `timestamptz +/- interval` is only STABLE even for a fixed-duration interval like minutes) that pads each booking 15 minutes on both sides. This gives a real 30-minute gap between any two adjacent bookings for travel/wrap-up time, added after the original constraint (exact-overlap only, zero gap) was found not to actually guarantee this.
- **Privacy**: `th_bookings` holds real customer PII (name, phone, email, address). The `anon` role has no SELECT policy on it at all -- the public booking page's own availability check reads through a separate view, `th_bookings_availability`, which exposes only `start_at`/`end_at` and nothing else. Staff (authenticated) has full SELECT/UPDATE/DELETE (the DELETE policy was missing entirely until caught while building the Dev Tools test panel below -- its own cleanup step was silently failing).
- **Guest self-service cancel/reschedule** (`manage-booking.html`, added after the initial build): each booking gets a random, unguessable `cancel_token` (uuid, server-generated at insert, never client-settable) included only in the guest's own confirmation email. Two SECURITY DEFINER RPC functions, `get_booking_by_cancel_token` (read-only lookup) and `cancel_booking_by_token`/`reschedule_booking_by_token`, let a guest manage their own booking without a login. Rescheduling derives duration from the existing booking server-side (never trusted from the client) and relies on the same exclusion constraint for collision safety -- a genuine conflict is caught and reported as `slot-taken`, not a raw database error.
- **Notifications**: one consolidated trigger (`notify_booking_status_change`) fires on `th_bookings` INSERT or UPDATE and calls the `Send-Push` Edge Function, which distinguishes new/cancelled/rescheduled by comparing old vs. new status and start time. (This replaced two separate triggers that each tried to fire their own notification on the same event -- consolidated on general principle even though the real missing-notification bug traced to something else: `Send-Push`'s own UPDATE handler originally only recognized a cancellation and silently discarded a genuine reschedule.) A second, independent trigger sends the guest confirmation email (`send-booking-email`) -- same proven pattern as `th_leads`, so a Resend outage and a push-notification outage are independent failure modes.
- **Realtime**: `th_bookings` is in the `supabase_realtime` publication (added after launch -- it wasn't originally, so a guest's own cancellation or reschedule was invisible to staff watching `workspace.html` or `calendar.html` until a manual reload). Both pages subscribe via `startBookingsRealtime()` in `sync.js`.
- **Job Tracker integration**: a new "Upcoming Bookings" panel on the Dashboard (`workspace.html`, Action Items) shows confirmed, unconverted bookings; "Add to Jobs" creates a real job entry (`fetchUnconvertedBookings`/`markBookingConverted` in `sync.js`). The job schema has no time-of-day field, so the booking's actual time window goes into the new job's `notes`.
- **Calendar integration**: `calendar.html` shows unconverted bookings too (see its entry above) -- a booking is visible there the moment it's made, without waiting for manual conversion.
- **Dev Tools integration**: a "Recent Bookings" panel (Notifications tab) shows the last 20 bookings regardless of conversion status. A separate "Booking notification test" panel runs a real booking through its full lifecycle (create, reschedule, cancel) in one pass on far-future dates, exercising all three notification paths and cleaning up after itself -- directly automates the same manual debugging sequence originally used to find the reschedule-notification bug above.
- **Business hours and service durations are plain constants in `booking.html`** (`HOURS_BY_WEEKDAY`, `SERVICES`), not a database-configurable setting -- adjust directly in that file if either ever changes (and in `manage-booking.html`'s own copy of the same constants, used for the reschedule picker). Current hours: Mon-Fri 2pm-10pm, Sat 7am-10pm, Sun 2pm-8pm.
- **Reporting columns** (added for Dev Tools' Reports tab): `th_bookings.cancelled_at`, `.reschedule_count`, `.last_rescheduled_at`, and `th_leads.handled_at` are all set automatically by BEFORE UPDATE triggers (`track_booking_changes`, `track_lead_handled`) the moment the real state change happens -- never by application code setting them directly. `created_at` alone can't answer "how many this week" for anything except brand-new rows, since it never changes after the row is first inserted.
- **Design**: both pages share one visual system -- a hexagon icon motif (CSS `clip-path`) echoing the brand's own hex logo mark, reusing the site's existing service icons from `index.html`. `booking.html` has a real desktop layout (a sticky sidebar builds up the appointment summary progressively) rather than the mobile column simply stretched wide, which was the original state before a design pass caught it.
- **Phone/email**: the phone field auto-formats live to `(XXX) XXX-XXXX` as the guest types (no native browser masking exists for `type="tel"`); both fields get on-theme inline validation styling -- native constraint validation (`type="email"`, a `pattern` on phone) already blocked bad input, this just makes that enforcement visible instead of a default, easy-to-miss browser tooltip.

## Automated jobs (2026-08-15, substantially expanded 2026-08-25)

Three independent layers of automation, each doing a different job:

**GitHub Actions** (`.github/workflows/`) — all added because they needed
to be added by hand in the GitHub web UI (creating/editing anything
under `.github/workflows/` requires the `workflow` OAuth scope, which
the assistant's GitHub token was never granted):
- `backup-cms-content.yml` — daily, backs up `site_content`/`site_faq`/`site_terms` to `backups/` using the public anon key (safe, since "Anyone can read site content" is already a real policy).
- `backup-sensitive-data.yml` (2026-08-27, replaces the retired `backup-business-data.yml`) — daily, backs up `workspace_sync` (every job, invoice, contract, quote), `th_leads`, `th_bookings`, and every file in the 3 Supabase Storage buckets (`secure-documents`, `job-photos`, `receipts`) to a **separate, private** repo (`tripleh-private-backups`), not this one. Moved out of this repo specifically because `workspace_sync` was found to already contain real, exposed client PII (name/phone/address/email) committed to this public repo's history -- this repo being public was a real constraint the original `backup-business-data.yml` never accounted for. Storage files had no backup coverage anywhere at all before this (confirmed directly: neither the old workflow nor Supabase's own Pro-tier daily backups cover Storage, only database tables) -- see `scripts/backup-storage-bucket.py`, which recurses into the buckets' real subfolder structure (a flat, non-recursive list would have silently backed up zero files). Needs both `SUPABASE_SERVICE_ROLE_KEY` (already set) and a new `PRIVATE_BACKUP_REPO_TOKEN` repo secret -- see the workflow file's own header comment for the one manual setup step (a fine-grained PAT can't be minted via the API, has to be created by hand).
- `uptime-check.yml` — every 10 minutes, the in-house replacement for HetrixTools (requested directly). Checks the live site from GitHub's own network (deliberately external to Supabase -- a `pg_cron` job running inside the database can't wake a paused database back up to run itself), logs every check to `th_uptime_checks`, and calls the `uptime-alert` Edge Function on a real state change (up→down or down→up) only, never on every check during an ongoing outage.
- `check-links.yml` — weekly plus on push, runs `scripts/check-links.py` (internal file references across every HTML file, external links on the 6 public pages only).
- `lighthouse.yml` — daily, scores the live public site against `.github/lighthouserc.json`'s thresholds. Runs on a schedule rather than directly on push, since Pages needs a little time to actually deploy after a push lands.
- `cleanup-artifacts.yml` — daily, keeps only the 3 most recent Actions artifacts of each name. Every push generates a full-site Pages deployment artifact; without this they pile up (275MB across 30 of them was the actual trigger for adding this). Uses the workflow's own built-in `GITHUB_TOKEN` with `permissions: actions: write` — no secret needed for this one specifically.

**Supabase `pg_cron`** (`select * from cron.job;` to see live state):
- `daily-reminder-check` — 1am daily, 11 business-condition checks (see the header comment in `edge-functions/send-push-index.ts` for the full list).
- `weekly-business-digest` — Monday mornings, one summary push AND email (jobs completed, invoiced, new leads, outstanding balance, weekly uptime %) rather than a specific alert — trend awareness, not task nagging. The email half (`REPORTS_EMAIL_FROM` secret) is optional and gracefully skips if not configured, without ever blocking the push half.
- `archive-old-notification-log` — monthly, deletes `notification_log` rows older than 3700 days. That number isn't arbitrary: two of the 11 daily checks use a 3650-day resend interval specifically to nudge only once, ever — retention has to stay longer than the longest resend interval in use, or a "one-time" nudge would silently start repeating once its log row got archived.

**Dev Tools panels** (`tools/dev-tools.html`, 7 tabs since the 2026-09-24 regroup — see the table above) — Storage browser (file counts/sizes across all 3 buckets), Data integrity check (job-photo records vs. actual files, in both directions, plus contact-less leads), Trigger workflows (runs any GitHub Actions workflow on demand via the `trigger-workflow` Edge Function — never a GitHub token in this file), Uptime monitoring (current status, 24h/7d uptime %, recent incidents), and Recent bookings (last 20 bookings regardless of conversion status).

## ⚠️ Do not delete

- **`google0b12c450e3945a19.html`** and **`google523d668a9a330d64.html`** — Google Search Console ownership verification files, one per domain variant. Deleting either breaks Search Console verification for that property.
- **`favicon.ico`** — must stay at repo root.
- **`.nojekyll`** — must stay at repo root, with exactly that filename (dot included). See the warning at the top of this document.
- **The 16 redirect stubs left at the old root paths of the pages moved into `/services/` and `/locations/` on 2026-09-21**: the 8 service pages (`washer-dryer-repair.html`, `plumbing-repairs.html`, `drywall-painting.html`, `handyman-repairs.html`, `assembly-installation.html`, `washer-dryer-repair-st-george-ut.html`, `refrigerator-repair-st-george-ut.html`, `dishwasher-repair-st-george-ut.html`) and the 8 city pages (`handyman-st-george-ut.html`, `handyman-hurricane-ut.html`, `handyman-washington-city-ut.html`, `handyman-santa-clara-ivins-ut.html`, `handyman-la-verkin-ut.html`, `handyman-leeds-ut.html`, `handyman-cedar-city-ut.html`, `handyman-mesquite-nv.html`). Each is a `<link rel="canonical">` + 0-delay `<meta http-equiv="refresh">` + JS `location.replace()` pointing at the real page's new path — deleting one turns a soft redirect into a hard 404 for anyone who still has the old URL bookmarked, linked, or indexed. Safe to remove only once Google Search Console shows the old URLs fully dropped from the index in favor of the new ones (months, not days) — not on a whim.
- **The 8 Salt Lake valley redirect stubs (added 2026-10-16)**: `locations/handyman-sandy-ut.html`, `handyman-west-jordan-ut.html`, `handyman-south-jordan-ut.html`, `handyman-draper-ut.html`, `handyman-murray-ut.html`, `handyman-cottonwood-heights-ut.html`, `handyman-holladay-ut.html` and `handyman-midvale-ut.html` (all in `/locations/`). They were 8 near-identical city pages; each now canonicals and redirects to `locations/handyman-salt-lake-valley-ut.html`. Same rule as the stubs above: not in the sitemap, nothing links to them, keep the files until Search Console shows them dropped.
- **`locations/handyman-salt-lake-valley-ut.html` itself, restubbed 2026-10-28**: this used to be the real, consolidated Salt Lake valley page (the 8 stubs above point here). It is now ALSO a redirect stub, this time pointing at the homepage (`/`) — see "What changed, 2026-10-28" below for the full reasoning (a temporary pull-back, not a permanent closure) and exactly what to restore. The old 8 stubs above keep working unmodified: they still canonical/redirect to this exact file, which now just forwards one hop further to the homepage instead of dead-ending. Do not delete, same rule as every other stub on this list; do not "fix" the 8 old stubs to point anywhere else either.

## Known open items

- `trigger-workflow` Edge Function needs a `GITHUB_PAT` secret (Supabase
  dashboard -> Edge Functions -> Secrets) to actually work -- a
  fine-grained GitHub PAT scoped to ONLY "Actions: Read and write" on
  this one repo. **Confirmed working as of 2026-08-16** -- a real
  authenticated request (from Steve's account) triggered a real GitHub
  Actions run, verified via both the Actions run history and the
  Edge Function's own logs.
- **Correction (2026-09-16): the accidental lowercase `send-push` Edge
  Function is NOT gone -- it was re-verified live via
  `list_edge_functions`/`get_edge_function` and is still deployed
  (slug `send-push`, id `aaa21126-3451-4bd2-a8e3-97d4f95bbf5a`, v8),
  separate from the real `Send-Push` function (v50) every call site
  actually uses. It is genuinely dead: its source is a stale snapshot
  missing three real fixes the real function has picked up since
  (the business-timezone fix, the partial-payment-aware overdue check,
  and `checkPendingReviewReminders`), and nothing calls it -- confirmed
  by grepping every `Send-Push` reference in this repo (all exact-cased,
  enforced by 4 separate test files) and by querying the live database
  directly (`cron.job` and every `pg_proc` function body) for any
  lowercase `/send-push` URL, which returned zero rows. **It should be
  deleted, but the Supabase MCP tools available in this environment
  have no delete-function call and the `supabase` CLI isn't installed
  here** -- deleting it needs the Supabase dashboard (Edge Functions →
  `send-push` → Delete) or `supabase functions delete send-push` from a
  machine with the CLI and project access. Tracked as a manual action
  item below. The earlier "no longer appears in the function list"
  note below was wrong -- probably a function list read that missed it,
  not an actual deletion.
- `advisor-health` is confirmed actually working (a real request
  returned HTTP 200 in the function's own logs, and that function
  returns a hard 500 whenever `MANAGEMENT_API_PAT` is missing, so a 200
  means the secret is genuinely set and the Management API calls
  succeeded).

**Resolved since first written (kept here briefly for history, not
because they're still open):** the Cal.com subscription has been
cancelled (confirmed 2026-08-25). Leaked-password protection is now
ON in Supabase Auth (confirmed 2026-09-15, dashboard toggle).



## Cache-busting -- how it actually works now (rewritten 2026-08-26)

Any `.js` or `.css` file in `tools/` that's genuinely loaded by 2 or
more real pages gets a `?v=` query string wherever it's loaded, and
that string is the file's own real content hash -- not a date or
timestamp anyone chooses by hand, and not a hardcoded list anyone has
to remember to update either. `scripts/check-consistency.js`'s
`detectSharedScripts()` derives the list fresh, every run, straight
from actual usage: reference it from a second page and it's covered
automatically, with nothing to add anywhere.

(This replaced an actual hardcoded 9-file list on 2026-08-26, found
by asking "what else could let this class of bug through" right after
fixing it once already: `data-layer.js` and `tools-tour.js`, genuinely
shared by 9 and 11 pages, were both missing from that list entirely,
so neither had any cache-bust monitoring at all -- `data-layer.js` was
already sitting on a real, ~4-day-stale version as a direct result,
caught only by asking the question, not by any check that existed at
the time.)

**If you edit any shared file (or aren't sure whether one counts),
run this before committing:**

```
npm run fix-versions
```

This rewrites every `?v=` reference to each shared file's real,
current hash, across every page that loads it, in one command. There
is nothing else to remember and nothing to compute by hand.

**Why the versioning itself is a hash, not a date:** the original
scheme used a human/AI-chosen `YYYYMMDDHHMM` timestamp, checked by
comparing the file's last-commit time against that timestamp inside a
12-hour grace window (meant to absorb timezone skew). That check let
the exact bug it existed to catch through three separate times in one
real day: a real function was added to `sync.js`, the `?v=` string was
never bumped to match, the gap between them happened to be under 12
hours, and the check passed cleanly -- while real users' browsers kept
serving the stale, function-missing file regardless, causing a live
`Can't find variable` error on the actual site. A content hash has no
grace window and no timing judgment call to get wrong: the version
either matches what the file contains right now, or it doesn't.

`npm run check-consistency` (also run automatically on every push,
see `.github/workflows/test.yml`) verifies every reference matches;
`npm run fix-versions` is the same script, run with `--fix-versions`,
correcting instead of just reporting.

`npm test` runs the full suite (**2,586 tests as of 2026-09-21**, all passing) — organized under `tests/` into subfolders (`booking/`, `sync/`, `dev-tools/`, `design/`, `content-quality/`, `tools/`, `workspace/`, `portal/`, `seo/`, `site-wide/`, `edge-functions/`, `referrals/`, and more as new areas get covered) by what each test actually covers, rather than one flat folder of files. The script itself is just `cd tests && node --test`; Node's test runner auto-discovers every `*.test.js` file recursively with no arguments needed, so a new test file placed anywhere under `tests/` runs automatically — nothing to add to `package.json` by hand.

**The rest of the quick-flag scripts** (2026-09-21, closing a real gap
where `check-links.py` and `eslint` both existed and both ran fine
standalone, but neither had an `npm run` alias, so a contributor had
to already know the exact underlying command):

- `npm run check-links` — wraps `scripts/check-links.py` (internal
  link/asset integrity across every HTML file, plus external-link
  reachability on public pages).
- `npm run lint` — wraps `eslint .` (config already existed at
  `eslint.config.js`; just never had a script pointing at it).
- `npm run verify` — chains `check-undefined-vars` →
  `check-consistency` → `lint` → `check-links` → the full test suite,
  in roughly fastest-to-slowest order, so a broken static check fails
  loudly before waiting on the several-minute full suite. This is the
  same sequence to run by hand before any push; `verify` just saves
  typing five separate commands.

## Deploying changes

No build step, no CI/CD. Push to `main`, GitHub Pages redeploys automatically (usually within a minute or two).

**If uploading files via GitHub's web UI:**
- For a single new nested file (e.g. anything under `.well-known/`), use **Add file → Create new file** and type the full path directly into the filename box — this reliably creates the folder structure and avoids the flattening issue below.
- For moving/adding many files at once into a folder, drag the **entire folder itself** onto the upload area, not the individual files loose — dragging loose files that were meant to go into a subfolder can flatten them out to the root instead, which has happened on this repo more than once.

**After any change, don't trust how it looks and assume it's live.** Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) at minimum before drawing any conclusion — browsers cache aggressively. But for anything where it actually matters (a fix that's still not showing, confirming a folder move went cleanly), the reliable method is downloading and inspecting the actual `github-pages` build artifact from the Actions tab, described at the top of this document. See the disaster-recovery guide's "worth knowing" notes for more on caching specifically.

## Security, and where the rest of the docs live

**`SECURITY.md`** (repo root) covers the actual current security model plainly — the RLS strategy, why `SECURITY DEFINER` functions are used and how they're locked down, and a real reporting path — plus the most recent concrete fixes and why the remaining Advisor warnings are confirmed intentional, not overlooked.

**`docs/`** is a wiki-style companion folder, built as real files in this repo rather than GitHub's separate Wiki feature (which needs its first page created once through the web UI before it exists at all — not something scriptable from here). Start at `docs/README.md`; `docs/GETTING-STARTED.md` is the right first read for anyone new to this codebase, `docs/GLOSSARY.md` covers terms used throughout this file and `DISASTER_RECOVERY.md` that don't mean the obvious thing on first read, and `docs/ARCHITECTURE-NOTES.md` holds the real architectural backlog and decisions already made with real reasons, so they don't get re-litigated later.

**`DISASTER_RECOVERY.md`** remains the deepest, most authoritative source for exact mechanisms and incident history — everything above points back to it rather than duplicating it.
