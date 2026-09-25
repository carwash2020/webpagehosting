# Triple-H-Enterprise-Webpage

<img src="docs/assets/repo-banner.svg" alt="Triple H Enterprises" width="100%">

[![Tests and consistency check](https://github.com/carwash2020/webpagehosting/actions/workflows/test.yml/badge.svg)](https://github.com/carwash2020/webpagehosting/actions/workflows/test.yml)
[![Check links](https://github.com/carwash2020/webpagehosting/actions/workflows/check-links.yml/badge.svg)](https://github.com/carwash2020/webpagehosting/actions/workflows/check-links.yml)

Source for the live website at **[www.triplehenterprisesllc.biz](https://www.triplehenterprisesllc.biz)**
— Triple H Enterprises LLC, handyman & appliance repair, St. George, UT.
Hosted on GitHub Pages, deployed automatically on push to `main`.

This repo actually serves **two separate things** from the same domain:

1. **The public marketing site** — homepage + 5 city landing pages, meant for customers and search engines. Lives at the repo root.
2. **An internal Workspace tool suite** — Dashboard, Job Tracker (with the Calendar view), Finance, Invoice Generator (with Quick charge), Contract Generator, Route Planner, Clients, Review Request Sender, Runway Dashboard, Appliance Wiki, Settings, Dev Tools, and Site Content, at `/tools/workspace.html` onward. Not linked from the public site, not indexed, but hosted on the same domain and repo since it's all static files anyway. **As of 2026-08-10, these live under `/tools/`, not the repo root** — see below.

The public site uses one shared stylesheet (`styles.css`, repo root). The tool suite has its own separate stylesheet (`tools/styles-tools.css`) — genuinely two files now, not one shared across everything; see "Shared files" below for what `styles.css` actually still covers.

## Contents

- [Read this before touching deployment at all](#️-read-this-before-touching-deployment-at-all)
- [Public site — file structure](#public-site--file-structure-repo-root)
- [Internal tools — file structure](#internal-tools--file-structure-tools)
- [Shared files](#shared-files-used-by-both-the-public-site-and-internal-tools--stayed-at-repo-root-deliberately)
- [Files inside `/tools/` that are NOT shared](#files-inside-tools-that-are-not-shared-with-the-public-site)
- [Backend](#backend)
- [Cross-device sync — how it actually works](#cross-device-sync--how-it-actually-works-substantially-extended-2026-08-25-through-2026-08-26)
- [Booking system](#booking-system-added-2026-08-25-replaces-calcom-entirely)
- [Automated jobs](#automated-jobs-2026-08-15-substantially-expanded-2026-08-25)
- [Do not delete](#️-do-not-delete)
- [Known open items](#known-open-items)
- [Cache-busting — how it actually works now](#cache-busting----how-it-actually-works-now-rewritten-2026-08-26)
- [Deploying changes](#deploying-changes)
- [Security, and where the rest of the docs live](#security-and-where-the-rest-of-the-docs-live)
- [What changed, 2026-09-04 through 2026-09-07](#what-changed-2026-09-04-through-2026-09-07)
- [What changed, 2026-09-08](#what-changed-2026-09-08)
- [What changed, 2026-09-20 -- duplicate meta descriptions, a stale-date test time bomb, and a merged RLS policy](#what-changed-2026-09-20----duplicate-meta-descriptions-a-stale-date-test-time-bomb-and-a-merged-rls-policy)
- [What changed, 2026-09-21 -- booking.html audit, referral-code refinements, and a cron auth incident](#what-changed-2026-09-21----bookinghtml-audit-referral-code-refinements-and-a-cron-auth-incident)
- [What changed, 2026-09-21 -- Workspace IA round 2: POS folded into Invoices, tablets get the nav bar, one less header button](#what-changed-2026-09-21----workspace-ia-round-2-pos-folded-into-invoices-tablets-get-the-nav-bar-one-less-header-button)
- [What changed, 2026-09-22 -- Workspace IA round 3: search-first Appliance Wiki, Runway remembers its tab, login return paths](#what-changed-2026-09-22----workspace-ia-round-3-search-first-appliance-wiki-runway-remembers-its-tab-login-return-paths)
- [What changed, 2026-09-22 -- Workspace IA round 4: a 24-step tutorial, a launcher in the search box, tab deep links everywhere](#what-changed-2026-09-22----workspace-ia-round-4-a-24-step-tutorial-a-launcher-in-the-search-box-tab-deep-links-everywhere)

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
| `sitemap.xml` | Lists all 34 live, indexable public URLs as of 2026-09-21: the homepage, `booking.html`, every city/service/service×city landing page above, `about.html`/`careers.html`/`our-work.html`, both legal pages, the blog index and its 10 posts. Deliberately excluded: `manage-booking.html`/`manage-job.html` (token-gated, `noindex`), and everything under `/tools/`/`/portal/` (all `noindex`, including `portal/login.html` -- the internal tool suite and client portal are not meant to be discoverable via search). Update this and resubmit in Google Search Console any time a page is added or removed. |
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
| `tools/workspace.html` | **Dashboard** — the home screen, rebuilt Today-first on 2026-09-21: a one-line greeting band, then **Next Job** (tap-to-call, tap-for-directions, **Open Job**, and **Route today** — one Google Maps link through every address on today's schedule), **Money Owed** listing every unpaid invoice (overdue first) with a two-tap **Mark paid**, **Rest of Today**, the four daily actions (New job / Create invoice / Find client / Calendar), then the **Needs attention** inbox open by default (work requests, leads, applicants, bookings, jobs due this week, follow-ups, unpaid invoices). Business Snapshot, Analytics, Compliance & Documents, and the Gallery Queue sit collapsed under one **Business** label. No chip row, no tile grid: navigation is the sidebar (desktop) or bottom bar + More (phone). Bookmark this one. |
| `tools/job-tracker.html` | Jobs, Contacts (with client history), Notes — 3 tabs, one page. The Jobs tab has three views, remembered per device: **List** (a sortable table on desktop), **Board** (Not Started / In Progress / Done columns), and **Calendar** (moved here from the retired `calendar.html` on 2026-09-21 — a month view of every dated job plus unconverted online bookings in purple, tap a day for detail, **Add to Phone** exports a `.ics`; deep link `#calendar`). Cost Lookup, Profitability, Income, and Expenses moved out to `finance.html` on 2026-08-20. |
| `tools/finance.html` | Cost Lookup (with sales tax), Profitability, Income, Expenses (receipt required, mileage rate shared with Route Planner's cost analyzer) — split out of `job-tracker.html` on 2026-08-20 once these four had grown into an entire bookkeeping system living inside a job list. |
| `tools/invoice-generator.html` | Invoice + Quote/Estimate + **Quick charge** + Recent tabs. Quick charge (moved here from the retired `pos.html` on 2026-09-21; deep link `#pos`) charges a client's card on the spot with no invoice -- one tap if that email has a saved card, otherwise a card form with a typed-name authorization; Stripe.js loads only at that moment. Tax-aware, per-line "Taxable" toggle. Convert a Quote to an Invoice with one tap. Generates a branded PDF with your Venmo QR built in. Both logs support deleting an entry (added 2026-08-26, with real cross-device delete protection built in from day one -- see "Deletion resurrection / tombstones" in `DISASTER_RECOVERY.md`), separate from the invoice/quote PDF itself, which is unaffected either way. |
| `tools/contract-generator.html` | Fill in a client/job, generate a branded contract PDF to email/text. Has two signature canvases — see the swipe-gesture note below if working on touch gestures anywhere near this page. |
| `tools/route-planner.html` | Multi-stop Google Maps route links + a fuel-cost/sales-tax "to and from" cost analyzer. |
| `tools/review-request.html` | Generates a review-request text message; deep-linkable with a client name/job pre-filled. Also has Google/Yelp QR code tabs. |
| `tools/runway-dashboard.html` | Personal + business financial runway tracking — debts, income, expenses, month-by-month. Pulls revenue/expenses straight from Finance (`finance.html`), no double entry. |
| `tools/parts-reference.html` | **Appliance Wiki** — quick lookup for common appliance issues: what part it usually is, the part number, roughly what it costs. |
| `tools/settings.html` | Account info, display density and color theme, push notifications, tour replay (the tour is a 24-step tutorial as of 2026-09-22 -- every page and tab, about two minutes), password reset, **Backup & Restore** (moved here from the Dashboard on 2026-09-21 — the same full JSON export/import, no hop through another page), sign out. |
| `tools/dev-tools.html` | Site diagnostics and maintenance utilities, regrouped on 2026-09-24 into 7 tabs by the question each answers: Health (is anything broken right now), Data (is the business data clean, and can it come back), Sync (this device), Notifications, Ops (deploys, the to-do lists, shortcuts), Reports, and Access. Each tab is split into named sections; live panels are open cards, and the tools you only reach for now and then are collapsed one-line rows. 32 panels. Access is role-gated (`account_roles` table, see `DISASTER_RECOVERY.md`); an account without "Dev Tools (full technical)" (Steve's Owner account) sees only Client registry (Data tab) and Account permissions (Access tab), while a Developer-role account sees all 7 tabs. `#backup` lands on Data &rarr; Backup & restore. Also supports swiping left/right between tabs on mobile, scoped to the panel content area so it doesn't fight with the tab bar's own horizontal scroll. |
| `tools/site-content.html` | Edits the public site's changeable text and numbers with no deploy: Google star rating and review count, banners, homepage hours, phone, email, FAQ, Terms. Fields are checked as you type, every publish shows live-vs-new first, and **Undo this save** / per-field history put back earlier values (rebuilt 2026-09-23, backed by `cms_publish_content()` / `cms_undo_content()` in `sql/site-content/cms_safe_publish_and_undo.sql`). Reached from **Website** in the sidebar and the More drawer (shown only to accounts with the "Site content" permission, since 2026-09-23) or Dev Tools &rarr; Content; needs that permission. Split out of `dev-tools.html` on 2026-08-20. |
| `tools/client-detail.html` | Full history for one client (jobs, invoices, quotes, contracts) — reached from workspace.html or job-detail.html, not linked from the main nav directly. |
| `tools/job-detail.html` | Full detail view for one job (photos, linked invoices, margin) — reached from job-tracker.html or finance.html, not linked from the main nav directly. |
| `tools/login.html` | Auth entry point for the whole suite. |
| `tools/reset-password.html` | Password reset flow, reached from a Supabase auth email link. |
| `tools/contact-card.html`, `tools/job-cost-lookup.html`, `tools/expense-logger.html`, `tools/calendar.html`, `tools/pos.html` | Retired — redirect stubs kept so old bookmarks don't 404. `contact-card.html` redirects into `job-tracker.html`'s Contacts tab (never moved); `job-cost-lookup.html` and `expense-logger.html` redirect into `finance.html`'s Cost Lookup/Expenses tabs (both moved there from Job Tracker on 2026-08-20); `calendar.html` redirects to `job-tracker.html#calendar` (the Calendar became a Job Tracker view on 2026-09-21); `pos.html` redirects to `invoice-generator.html#pos` (POS became the Quick charge tab the same day). |

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

## What changed, 2026-09-04 through 2026-09-07

Folded in from `README_ADDENDUM.md`, which was a point-in-time snapshot
kept alongside this file until it could be merged here. `CONTINUE-HERE.md`
remains the actively-maintained pick-up notes for a fresh session; this
section is the durable record.

### Client portal — features added this period

All in `portal/`, all requested directly.

| Thing | Where | Notes |
|---|---|---|
| Push notifications | `portal/push-notifications.js`, `Send-Push` Edge Function | Targeted per-client (never a broadcast to every subscriber) via a dedicated `client-notification` payload type, distinct from the internal team's own broadcast alerts |
| Offline support / install prompt | `portal/service-worker.js` | Separate service worker from the internal tools' own; network-first with offline fallback |
| Skeleton loading states | `portal/portal-app.js`, `portal/portal-app.css` | Generic card-shaped skeleton, reused across every list page rather than a bespoke one per page |
| Pull-to-refresh | `portal/portal-app.js` | |
| Biometric app lock (Face ID / Touch ID / device PIN) | `portal/portal-app.js`, Settings → Security | Local-only gate, not a server-verified factor — see disaster-recovery Scenario 12 |
| Automatic client-side error capture | `portal/portal-app.js` → `portal_client_errors` table | See disaster-recovery Scenario 10 |
| Collapsible Settings sections | `portal/settings.html` | Every section starts collapsed to cut down scroll length |
| Line-item Type dropdown on invoices (Labor/Mileage/Part/Other) | `tools/invoice-generator.html` | Qty column shows the right unit (hrs/mi/ea) per row; both the on-screen editor and the exported PDF reflect it |

### Client portal — functional capabilities (added 2026-09-02 through 2026-09-04, missing from this README until 2026-09-09)

The table above only covers polish (push, offline, skeletons, biometric
lock). The portal's actual functional surface grew well past invoice
viewing in the same period and was never added here — found during a
direct doc-audit request ("does the README and recovery guide mention
the new [portal] features?"). `docs/CLIENT-PORTAL.md` was kept current
throughout; this file and `DISASTER_RECOVERY.md` were not. Full detail
always lives in `docs/CLIENT-PORTAL.md` — this is the summary a reader
of this file needs to know these exist at all:

| Feature | Where | Notes |
|---|---|---|
| **Quotes**: review, ask a question, approve/decline, self-schedule the job | `portal/quotes.html`, `client_portal_quotes`, `quote_questions` | Approving creates a real `th_bookings` row via `schedule-quote-job`; declining is final (no re-approve) |
| **Job history**: past jobs, warranty status, downloadable receipts | `portal/jobs.html`, `client_portal_jobs` | Warranty derived from the linked invoice's own terms, not a separate manually-tracked date |
| **Check-up reminders**: recurring maintenance visit due dates, client self-schedules | `portal/jobs.html` (reminder), `client_portal_checkups`, `schedule-checkup-visit` | Mirrors an internal Recurring Job Template only for a client who already has portal access; no approval gate (unlike quotes) |
| **Request Work**: a client submits a new job request (title/description/urgency/photos/preferred day) | `portal/work-orders.html`, `client_portal_work_orders` | Internal team is alerted via `notify-new-work-order-email` — **this exact pathway had a real bug, since fixed 2026-09-09, see "What changed" below** |
| **Two-way messaging** on a submitted work request | `portal/work-orders.html`, `client_portal_work_order_messages` | Client message → internal team; internal reply → client email + push |
| **Home/landing page**: "Needs Your Attention" summary (unpaid invoices, pending quotes, open requests, upcoming appointments) | `portal/home.html` | First page after sign-in, replacing a direct-to-dashboard redirect |
| **Saved card management, notification preferences, signed authorizations** | `portal/settings.html`, `card_authorizations`, `client_notification_preferences` | Per-notification-type opt-out (invoice/quote emails, work-order emails, message emails) |

### Internal tools — features added this period

| Thing | Where | Notes |
|---|---|---|
| **Client Lookup** (search by email/name/phone, spend total, dispute-evidence PDF export) | `tools/clients.html` | Deliberately placed here, not Dev Tools — this page is already accessible to Owner accounts, not Developer-gated |
| Daily Stripe payment reconciliation | `reconcile-stripe-payments` Edge Function | Alert-only, never auto-marks anything paid — see disaster-recovery Scenario 11 |
| `line_items` saved to the internal invoice/quote logs | `tools/invoice-generator.html` | Previously only the portal's own copy had this; a "Download PDF only" invoice never sent to a client had it permanently lost otherwise |

### The public site's visual redesign

Starting 2026-09-06, using a Claude Code skill called **scroll-craft**,
committed at `.claude/skills/scroll-craft/` so it travels with the repo
to any session on any device. A rollback checkpoint tag exists for this
specific body of work: `pre-scroll-craft-redesign-2026-09-06`. See
`DISASTER_RECOVERY.md` for the exact rollback commands.

### New root-level docs

- **`CONTINUE-HERE.md`** — actively-maintained pick-up notes for a fresh
  session. Read this first when resuming design work on the public site
  or portal.
- **`CONTRIBUTING.md`** — contribution guidelines.

### Scale-hardening fixes made this period

Found during a direct, requested scale/future-proofing audit — full
detail in `DISASTER_RECOVERY.md`:

- Missing indexes added on `client_portal_jobs.client_email` and
  `card_authorizations.client_email`.
- A real duplicate-push-notification bug fixed (no constraint previously
  prevented a device accumulating multiple subscription rows for the
  same real endpoint).
- 90-day retention added to every tombstone array (13 of them),
  previously growing forever with no expiry.

### A site-wide bug fix worth knowing about

The iOS Safari zoom-on-focus bug (a tapped form field under 16px
triggers the whole page to auto-zoom) was found and fixed across
**every** page on the site — all 8 portal pages, 8 tools pages, and the
public booking form — not just the one page it was originally reported
on. A repo-wide test (`tests/site-wide/mobile-zoom-fix.test.js`) now
guards against this specific bug class reappearing anywhere.

## What changed, 2026-09-08

A Master Audit pass (W01–W24 work items) plus direct visual feedback on
the homepage, closing out with real bug fixes and a full CodeQL sweep.

### Homepage/landing-page redesign, in order

| Thing | Notes |
|---|---|
| Symptom-first triage entry point, leave-behind job sheet, review wall (was a carousel), flat orange primary CTA | Master Audit W08/W14/W15/W16 |
| Live "next opening" pill beside the open/closed indicator | W17 |
| Shared PDF layout renderer for invoice/quote/contract | W18 |
| Rebuild before/after slider lit up as a real second "loud moment"; a real closing screen instead of fading into the footer | W19/M02, W20/M04 |
| Service-area diagram activated, then redesigned twice more on direct feedback — dropped the concentric "orbit ring" background, re-plotted every city by angle+radius with real angular separation | W21/M03, then two rounds of polish |
| Homepage trimmed for length: compact `#areas` links, `#schedule`/`#contact` merged into one section, `.btn.blue` flattened (a leftover glossy gradient) | Two length-reduction audits |
| Review cards given a fixed, line-clamped height so the wall reads as a matched set; triage appliance rows got real icons; modals/lightbox/disclosures/the open-status dot all animate now (native `::details-content`, `@starting-style`) | Round-3 visual polish, all from direct screenshot feedback |
| "From the blog" teaser section + a contextual in-prose link from `#honest` to a specific post | SEO fix — no page on the site ever linked directly to an individual blog post before this, only to `/blog/` itself |

### Real bugs found and fixed

- **Money Owed / invoice balance showing wrong** (`tools/workspace.html`, `tools/runway-dashboard.html`): `invoice.total` is subtotal + a percentage tax, which almost never lands on a whole number of cents — comparisons now happen in whole cents everywhere, and `invoice-generator.html` rounds tax/total to the nearest cent at the source.
- **Landing pages missing their 4th trust-badge card**: the `.trust-grid` CSS went 4-column when `index.html` got a "Licensed & Insured" card; the 5 landing pages never got the matching 4th card, leaving a blank grid cell.

### CodeQL: both remaining alerts resolved, one of them a real find

- **Alert #57** ("Clear text storage of sensitive information," found *during this same sweep*, not pre-existing): `dev-tools.html`'s `describeHeaderValue()` diagnostic helper — called with real credentials (`SUPABASE_ANON_KEY`, a live Authorization token) to debug a byte-encoding fetch error — was echoing back a real excerpt of whatever it was describing. A genuine leak, fixed by severing the dataflow: the diagnostic now only reaches `console.warn()`, never the persisted, cross-device-synced client error log.
- **Alert #53** ("Clear text storage of sensitive information," `logClientError()`'s error/stack capture): the redaction is real and tested, but CodeQL's static model doesn't credit a custom sanitizer as clearing taint. Closed with a documented inline suppression rather than further sanitization, since further sanitization was already proven not to satisfy it. See `DISASTER_RECOVERY.md` Scenario 15 for the full "what actually worked vs. what didn't" writeup, including a real inconsistency between a PR's own CodeQL check and the repo's Security tab.

Full detail, exact commits, and version-number history: `git log`, and the
PR descriptions for #188 through #194.

## What changed, 2026-09-08 (later the same day) — code-health pass

A direct code-health/grading pass across the public site, internal tools,
and the site's longevity/owner-dependency posture. The homepage's overall
content and structure (word count, section order, the teardown slider, the
before/after reveal) were explicitly left alone per direct instruction —
only the triage section's own weight was in scope there.

### Homepage: `#triage` shrunk, not moved

The "Is it worth fixing?" section used to carry two separate ways to
browse by appliance: the symptom-first grid (grouped into closed-by-default
rows per appliance) *and* a second, older step-by-step "pick an appliance,
then pick a symptom" picker, demoted into a collapsed disclosure below it.
Both did the same job. The older picker (and the `appEl`/`symEl`/`symStep`/
`selectAppliance()` plumbing in `triage.js` it needed) was removed outright
— real duplicate page weight for zero added function — rather than
collapsed further. `triage.js` is shared by the homepage and all 5 landing
pages, so this one fix applies everywhere consistently. Tests updated:
`tests/content-quality/triage-symptom-grid.test.js`,
`tests/design/round-3-visual-polish.test.js`.

### Cache-version bumping is now one command, not three manual rules

CONTINUE-HERE.md's three cache-bust rules (bump the shared `styles.css?v=`
stamp everywhere, bump `service-worker.js`'s `CACHE_NAME`, bump
`portal/service-worker.js`'s `CACHE_NAME`) used to each require a human to
notice a file changed and compute the right new value by hand — exactly
the class of mistake that's bitten this project repeatedly. `styles.css`
(plus `triage.js`, `business-hours.js`, `site-motion.js` — the root-level
files shared across root/`tools/`/`portal/`/`blog/`) carried a hand-picked
timestamp checked only for *internal* agreement, never against the file's
real content; a real gap this pass found directly, `blog/`'s 4 pages
weren't covered by any existing check at all and were caught only by a
failing test, not by `check-consistency` itself.

`scripts/check-consistency.js` now:
- Hashes those 4 shared files' real content and rewrites every `?v=`
  reference across all 4 directories to match, the same mechanism every
  other shared tools/portal file already used, just no longer confined to
  a single directory (`checkGlobalSharedFileFreshness()`/
  `fixGlobalSharedFiles()`).
- Stores a `// precache-fingerprint:HASH` comment next to each service
  worker's `CACHE_NAME` — a hash of every precached file's real current
  content, in list order. A stale fingerprint (a precached file changed
  since it was last recorded) now auto-bumps the version number and
  updates the comment (`checkCacheFingerprint()`/`fixCacheFingerprint()`),
  instead of relying on a human to remember.

`npm run fix-versions` runs all of this in one pass; `npm run
check-consistency` (already run on every push) fails the build if any of
it drifts. A missed bump now degrades to a failed CI check, not a silent
stale deploy. `blog/` was added to the scanned directories as part of this
fix. Updated the now-stale `\d+`-only regexes in
`tests/design/trust-badge-and-review-attribution.test.js` and 5 portal/
dev-tools tests that assumed the old timestamp-only format.

### Sync: real per-field merge, and a push that can no longer blindly clobber

Two real gaps in `tools/sync.js`'s sync architecture, closed:

1. **`pushSync()` never merged anything.** `pullSync()` has always merged
   the server's data into local's per-record; `pushSync()` just POSTed
   whatever `collectSyncData()` returned — local's current state, however
   stale — straight over the server row, unconditionally. Two devices
   editing without an intervening pull meant whichever one pushed last
   silently discarded everything the other had already gotten onto the
   server. `pushSync()` now fetches the current server row and runs it
   through the same `applySyncData()` merge `pullSync()` uses *before*
   building the pushed payload, so a push now behaves like a real sync
   rather than an overwrite. Falls back to pushing local's state
   unmerged only if that fetch itself fails (matches the risk that
   already existed before this fix, not a new one).
2. **Same-record conflicts were whole-record last-write-wins.** The
   existing per-record union merge (`mergeRecordArrays`) already stopped
   an *added* record on one device from vanishing when another device
   pushed — but if the *same* record existed on both sides with different
   content, the incoming remote copy won wholesale, silently discarding
   a local edit to a completely different field. `mergeRecordArrays` now
   accepts an optional base snapshot (`th_sync_base`, this device's own
   record of what was last agreed with the server) and does a real
   3-way per-field merge when one's available: whichever side actually
   changed a given field relative to that base wins for that field, so a
   local edit to `notes` and a remote edit to `status` on the same job
   both survive together. Only a field the base/local/remote all
   disagree on in three different ways is a genuine conflict — still
   resolves to remote's value (the same safe default as before), but now
   gets logged to a new synced `th_sync_conflicts` key instead of
   happening invisibly. No base yet for a record (first sync ever) falls
   back to the original whole-record behavior unchanged.

New "Sync conflicts" panel in Dev Tools (`tools/dev-tools.html`) surfaces
that log — which record, which field(s), what was kept vs. discarded,
when — with a "Clear log" action, same pattern as the existing Client
errors panel. New tests in `tests/sync/sync-merge.test.js` cover the
different-fields-both-survive case, the genuine-same-field-conflict case
(and that it's logged), the local-edit-survives-a-stale-remote case, and
that the no-base fallback is unchanged; a source-level test confirms
`pushSync()` actually fetches-then-merges-then-collects in that order
before its POST.

### Independent second-pass review of Supabase RLS policies/grants

Full detail and the standing process this establishes for future
migrations: `SECURITY.md`'s new "RLS/grant changes get a second,
independent pass before they ship" section. Summary: ran the security and
performance advisors against the live project, cross-checked every finding
against the real function body/grants/policy expression rather than each
finding's title alone. Tightened `current_user_has_any_role()`'s grant
(was `PUBLIC`/`anon`-executable with no real caller in either role — every
policy that uses it is `{authenticated}`-only); wrapped a leftover
unwrapped `auth.email()` call inside 14 policies' `EXISTS` subqueries
(pure query-plan fix, a prior pass had wrapped `auth.role()` in the same
policies but missed the nested `auth.email()` call, so the advisor kept
flagging them). Confirmed several other flagged functions are genuinely
intentional (public booking-management token functions) or structurally
non-issues (trigger-returning functions can't be invoked outside a trigger
context regardless of grant — verified directly, not assumed) and left
those unchanged. New files: `sql/security/tighten_current_user_has_any_role_grant.sql`,
`sql/security/wrap_unwrapped_auth_email_in_rls_policies.sql`.

### CI smoke test: add job → invoice it → mark paid, end to end

New `tests/workspace/smoke-job-invoice-paid.test.js`. Every other test in
this suite exercises one function or one page's own behavior in
isolation — both real production incidents on record here (the
invoice-generator TDZ crash that silently broke every invoice/quote, and
the `th_leads` RLS policy that silently dropped every public lead
submission) were exactly the class of bug that kind of test misses,
because each individual piece worked fine alone. This test drives the
real core write path across all three real tool pages that implement it:
fills in the real Add Job form and calls the real `addJob()`
(`job-tracker.html`), links that real job and calls the real
`generatePDF()` with a real line item (`invoice-generator.html`,
confirming the logged invoice carries the real job link/title and total),
then calls the real `togglePaid()` (`workspace.html`, confirming the paid
amount matches what was entered and the job link survives). "Same
device, same localStorage" between stages is simulated by copying the
relevant key's JSON from one page's jsdom window into the next's, since
each real page is genuinely its own separate script context, in a real
browser too.

Two real environment quirks worth knowing if this test (or anything
similar) needs touching again:
- `window.eval()`'d top-level `const`/`function` declarations create
  bindings in jsdom's global lexical scope, but that's NOT the same as
  becoming an enumerable `window` property — a real parsed `<script>` tag
  referencing them directly (as `generatePDF()` does for `pdf-layout.js`'s
  `PDF_COLORS` etc.) throws `ReferenceError`. Same fix already used in
  `finance-split.test.js`: explicit `window.X = X` assignments appended
  to the eval'd source.
- `scheduleSync()`'s debounce timer is a real Node timer `window.close()`
  does not cancel (jsdom windows share the process's global timer
  queue) — left un-stubbed, it fires ~2.5s later and calls the real
  `pushSync()`, which (per the sync-merge fix above) makes a real,
  slowly-retrying fetch call against a stubbed-failing `fetch()`.
  Stubbed to a no-op; this test is about the write path landing
  correctly, not the debounced push itself, which `tests/sync/*` already
  covers.

### Jobs/invoices/quotes/contracts get real relational tables — Phase 1 (additive, not a cutover)

The architecture this addresses: every job, invoice, quote, and contract
for the whole business lives inside `th_tracker_jobs`/`th_invoices`/
`th_quotes`/`th_contracts` — JSON arrays inside **one row's** `data jsonb`
column in `workspace_sync`. There's no referential integrity at all: an
invoice's `jobRefId` is just a string that happens to match a job's id,
never enforced by the database, and a deleted job silently leaves every
invoice that referenced it pointing at nothing.

**What shipped:** real Postgres tables — `jobs`, `invoices` (+
`invoice_line_items`), `quotes` (+ `quote_line_items`), `contracts` — with
real foreign keys (`invoices.job_id → jobs.id`, `quotes.job_id →
jobs.id`, `invoices.source_quote_id ↔ quotes.converted_to_invoice_id`,
both line-item tables `ON DELETE CASCADE` from their parent), RLS scoped
to authenticated internal accounts only (no anon path — unlike
`th_leads`/`th_bookings`, nothing on the public site ever writes to
these). Backfilled from the live blob's content at time of writing (6
jobs, 2 invoices, 1 contract, 0 quotes — confirmed against the real data,
not assumed). Schema + backfill: `sql/infra/create_relational_jobs_invoices_quotes_contracts.sql`,
`sql/infra/backfill_relational_jobs_invoices_contracts.sql`.

**Deliberately Phase 1, not a full migration.** Every tool page's actual
reads and writes still go through localStorage + the existing blob-sync
mechanism (`tools/sync.js`), completely unchanged — nothing that works
today changes behavior. A new best-effort **mirror** (`mirrorUpsert()`/
`mirrorDelete()`/`mirrorReplaceLineItems()` + one wrapper per record type
in `tools/sync.js`'s new RELATIONAL MIRROR section) fires alongside every
real save/delete call site — `saveJobs()` (job-tracker.html), `logInvoice()`/
`logQuote()`/the quote→invoice conversion (invoice-generator.html),
`togglePaid()` (workspace.html), contract creation (contract-generator.html),
and all 5 real delete/tombstone points across those pages — writing the
same data into the new tables too. A mirror failure (network down, RLS
misconfigured) never throws back to the caller and never blocks the
localStorage save that already happened, the same "fire and forget"
pattern already used for the public site's lead-insert mirror.

**Why additive instead of cutting over reads immediately:** this is live,
daily-used production data for a real single-operator business. Rewriting
every tool page's read path in one pass, in one session, with no time to
let the new tables prove themselves first, is exactly the kind of change
that causes a real outage rather than prevents one — this project has two
of those on record already. Standing up the real schema and dual-writing
to it is the safe, standard way this kind of migration actually gets
done: verify the mirror matches reality over real usage, *then* move
reads over in a later, separate, carefully-tested pass. **Phase 2 (moving
actual reads to the relational tables and retiring the blob for these 4
key types) is intentionally not attempted here** — flagged as the clear
next step, not silently left undone.

New tests: `tests/sync/relational-mirror.test.js` — confirms every real
call site actually invokes the right mirror function (source-level, the
same style already used for tombstone-wiring checks elsewhere in this
suite), plus functional tests of `mirrorUpsert()`/`mirrorInvoiceToRelational()`
against a mocked `fetch` confirming the real HTTP call shape (URL,
method, headers, the `jobRefId` string correctly cast to a real number
for the bigint FK column, line items replaced via delete-then-insert),
and that a failing `fetch` never throws back to the caller.

## What changed, 2026-09-09 — triage entry point restyled to pill buttons

Direct feedback on a screenshot: the bordered-card/plus-icon accordion
look the triage entry point picked up on 2026-09-08 (`.triage-appliance-row`/
`.triage-symptom-card`) read as less interactive and less clean than the
flat pill-button style a since-removed duplicate picker used to have.
Rebuilt on that pill language instead, but still as the ONE entry point
(not reintroducing the duplicate structure removed the day before): a
row of appliance pills, single-select, reveals that appliance's symptoms
as a stacked list of pill buttons below. Same `DATA`/click-to-result
logic in `triage.js`, just a different DOM shape and `styles.css`
styling (`.triage-appliance-pills`/`.triage-appliance-pill`/
`.triage-symptom-pills`/`.triage-symptom-pill`, reusing the visual
language of the old, now-deleted `.triage-chip`). Tests in
`tests/content-quality/triage-symptom-grid.test.js` rewritten for the
new structure (one pill per appliance, symptoms populate on select and
clear on switching appliance, no more than one appliance/symptom pressed
at once). `tests/design/round-3-visual-polish.test.js` no longer checks
`.triage-appliance-row` for the shared `::details-content` animation
treatment, since it's no longer a `<details>` element at all.

## What changed, 2026-09-09 — homepage audit fixes, then a referral program

A short technical audit (broken links/images, undefined vars, cache-bust
freshness, SEO metadata, review-count honesty) turned up two small,
real fixes: two blog meta descriptions ran past ~155 chars and risked
mid-sentence truncation in search results, trimmed to match the shorter
copy already used in their own `og:description` tags. Also added, per
direct request: a `<link rel="preload">` + `fetchpriority="high"` for
the hero background (a CSS `background-image`, so the browser otherwise
doesn't discover it until CSS parses); two new FAQ items (no deposit
required, secure pets before the visit) added to both the static HTML
and the live `site_faq` table; and a "Recent Work" homepage strip
reusing the existing gallery-tile markup/lightbox — since hidden
(`#recentWork[hidden]`) on direct request until photos exist for more
than flooring/tile work. The hero's `.hero-subject` midground photo
layer (a desaturated flooring photo layered over the canyon background)
was removed entirely per direct feedback ("it looks terrible").

Then, a real feature: a **referral incentive program**. Terms confirmed
directly: a $25 credit for the referring customer, earned once the
referred customer's job is complete AND paid. See
`sql/infra/create_referral_program.sql` for the schema (`referred_by`
columns on `th_leads`/`th_bookings`/`jobs`, plus a new `referrals`
table). Capture happens in three places, since a referral doesn't only
ever arrive through a public form — a phone call or walk-in never
touches either one: `booking.html`, the homepage Request form, AND the
Job Tracker's own Add Job field. The Job Tracker also nudges Steve to
ask when the typed client name has no existing Client Registry record
(`updateFirstTimeNudge()`) — there's no way to automatically detect an
unprompted phone referral, but there IS a way to automatically detect
"this is a first-time customer" and remind him to ask. A referral is
only ever mirrored to the `referrals` table on genuine job creation
(never on an edit, so re-saving the same job can't create a duplicate
row). `workspace.html`'s `togglePaid()` flips the matching pending
referral to `earned` the moment that job's invoice reaches fully-paid
status (`mirrorReferralEarnedForJob()` in `tools/sync.js`). A new
"Referral Credits" panel in `tools/clients.html` is the ledger — a
running total of what's owed, and the one manual "Mark redeemed" step
once the credit is actually applied to the referrer's next invoice.
Tests in `tests/referrals/referral-program.test.js`.

Separately, the existing seasonal "worth doing this month" homepage
card (`#careCard`) gained one `.care-cta` link ("Schedule a visit") —
previously read-only, with nowhere to go from a tip that made someone
want to book. A single link works for all 12 months alike, unlike
linking to a specific blog post (which only exists for 2 of the 12).

## What changed, 2026-09-09 (later the same day) — automated appointment reminder emails

Direct request, after the referral program shipped: automated
day-before appointment reminders. Initially assumed this needed a new
Twilio (SMS) account or a new email provider signup — wrong on the
email half: **Resend is already the site's email provider**, wired in
for send-booking-email/send-lead-email/send-invoice-notification/etc.,
with `RESEND_API_KEY`/`LEAD_EMAIL_FROM` already configured as Supabase
secrets. The new reminder function reuses that exact same account —
no new signup, no new secret.

New `edge-functions/send-appointment-reminder-index.ts`, deployed and
live. Runs hourly via a new `send-appointment-reminders-hourly` pg_cron
job (see `sql/infra/add_appointment_reminder_emails.sql`) rather than
once daily at a fixed time — a fixed time would give some bookings 25
hours' notice and others 49, depending what time of day they're
scheduled for. Instead it queries a rolling `[now+23h, now+25h)` window
every hour, so every confirmed booking with an email gets exactly one
reminder right around the 24-hour mark. A new `reminder_sent_at`
timestamp column on `th_bookings` is both the "already sent" guard and
the audit trail. Verified live via `net.http_post` immediately after
deploy (`{"ok":true,"checked":0,"sent":0}` — correct, no bookings
existed in the window at deploy time). No SMS/Twilio integration exists
or was added — that's still a real future option, but a separate
account/cost decision for later.

## What changed, 2026-09-09 (later still) — tested every notification pathway, found and fixed a real bug

Direct request: "test all notifications." Went through every real
notification pathway one at a time, live against production (with
approval), using clearly-marked TEST rows/payloads and cleaning up
after each one -- new lead (push + email), new booking (push + email),
uptime-alert (both up/down branches), new work order, work-order
message in both directions, work-order scheduled, and the appointment
reminder from earlier today. All confirmed working end to end.

**Found and fixed a real, previously-silent production bug** in the
process: `notify-new-work-order-email-index.ts` and
`notify-work-order-message-email-index.ts`'s client→internal branch
both queried `notification_recipients` with
`notify_types=cs.%7B%22work_order%22%7D` (`cs.{"work_order"}` decoded)
-- a Postgres array-literal, not valid JSON, for a `jsonb` column.
PostgREST rejected it with a 400 every single time ("invalid input
syntax for type json"), which the function then reported up as a
generic 502 "Could not load notification_recipients" -- logged, but
never surfaced anywhere a person would see it. This meant **every
internal email for a new work-order request, and every internal email
for a client's message on one, had been silently failing since the
feature shipped (2026-09-03)** -- 6 days of real client submissions
that likely never actually reached Steve/Connor's inbox via this path
(though a work order/message itself was still saved and visible in the
portal and Workspace; only the email alert was silently dropped).
Fixed by switching to the correct JSON-array containment syntax
(`cs.%5B%22work_order%22%5D`, i.e. `cs.["work_order"]`), verified with
a manual REST call reproducing the exact 400 first, then confirmed
fixed the same way, then confirmed again through the REAL trigger path
(a real INSERT/UPDATE, not just a direct function call) before
cleaning up the test rows. Both functions redeployed live.

Three notification functions -- `send-invoice-notification`,
`send-quote-notification`, `send-invite` -- were not directly
re-tested from this session this pass: all three require a real
signed-in internal account JWT (checked via `claims.role ===
'authenticated'`), which this session doesn't have a way to mint
safely, and `send-invite` additionally creates a real, persistent
Supabase Auth user as a side effect. A static read of both
invoice/quote notification functions found no similar bug (their only
DB filters are `eq.`, not the `cs.` operator that broke here).
Confirmed separately by Steve/Connor: all three already work in real
day-to-day use (sending/resending real invoices and invites through
the tools).

## What changed, 2026-09-10 — audit round 3: backend security/performance pass

Went straight at the live Supabase project's own security and
performance advisor for the first time (not just reading SQL files),
covering ground the first two audit rounds hadn't touched. See
`DISASTER_RECOVERY.md` Scenario 19 for the full write-up;
`sql/infra/audit_round3_security_and_performance_fixes.sql` has the
complete before/after SQL.

**Fixed:**
- `next_invoice_number()`/`next_quote_number()` were callable by *any*
  authenticated account, including client portal logins now that
  clients have real logins of their own -- a client account could have
  advanced the invoice/quote sequence, or simply learned how many
  invoices the business has issued. Both now raise an exception for
  any caller that isn't an internal account (`current_user_has_any_role()`,
  the same check RLS policies already use elsewhere for this exact
  distinction), verified directly by calling both and confirming the
  exception fires.
- 7 tables (`card_authorizations`, `client_notification_preferences`,
  `client_portal_quotes`, `client_portal_work_order_messages`,
  `client_portal_work_orders`, `client_profiles`, `push_subscriptions`)
  each carried two separate permissive RLS policies for the same
  action, evaluated twice per query -- the identical performance issue
  already fixed once on `workspace_sync`/`th_leads` back in August, just
  never carried forward into the tables built during the relational-
  tables and client-portal work. Merged into one policy per action with
  an `OR` condition; access itself is unchanged.
- 5 foreign keys with no covering index
  (`client_portal_work_orders.linked_quote_id`,
  `quote_questions.quote_id`, `referrals.referred_job_id`,
  `th_bookings.checkup_id`, `th_bookings.quote_id`) now have one.

**Verified safe, no code change:** `guard_last_role_manager_permission()`
and the 3 work-order notification functions are flagged by the advisor
as anon/authenticated-callable, but all 4 are `RETURNS trigger`
functions -- Postgres itself refuses to invoke those outside a real
trigger fire (confirmed directly: calling any of them returns `ERROR:
trigger functions can only be called as triggers`). Also confirmed by
direct column read: `card_authorizations` holds a Stripe customer
reference and an authorization/signature record, never a raw card
number.

Re-ran Supabase's advisor after applying the fixes: the
`multiple_permissive_policies` finding is gone entirely, the 5 new
indexes are in place, and the two number-generator functions now
reject non-internal callers. 1,591/1,591 tests still passing (this
pass touched only the live database, not the site's own code), all
consistency/link checks clean.

## What changed, 2026-09-10 (later still) — audit round 5: GA4 had zero custom events

Backend security/performance were re-verified unchanged (Supabase's
advisor showed nothing new since round 3). This round found something
new: GA4 had run on every public page since the site launched, but had
never once received a custom event -- only the default pageview. Steve
and Connor could see how many people visited a page, but had no way to
tell which landing page, blog post, or traffic source actually turned
into a real call, text, or booking, because that link only exists
inside GA4's own attribution model, and GA4 had nothing to attribute.

Added `analytics-events.js`, a small shared script (same pattern as
`site-motion.js`/`triage.js` -- loaded via absolute path from every
public page) that fires:
- `phone_click` / `text_click` on any `tel:`/`sms:` link, anywhere on
  the page, via one delegated click listener (also covers phone/text
  links added later by JS, e.g. the business-hours override).
- `chat_opened` when the homepage's chat bubble is opened.

Plus two events added inline at points that already existed:
- `lead_form_submitted` on the homepage's schedule form -- fires only
  on the real successful Supabase insert, not optimistically.
- `booking_step_view` (booking.html's `goToStep()`, the one place
  every step transition already passes through) and `booking_completed`
  -- fires only on the real successful `th_bookings` insert, deliberately
  NOT on the honeypot bot-trap path, which fakes a success screen for
  bots without ever creating a booking.

**Found along the way: `booking.html` had no GA4 at all**, not just
missing events. Its `Content-Security-Policy` (`script-src 'self'
'unsafe-inline'`, no `googletagmanager.com`) would have silently
blocked Google's tag script even if one had been added -- likely
deliberate, since it's the one page with a full name/phone/email/
address form. Asked directly rather than assuming either way: the
answer was to add it, using the exact same CSP allowlist pattern
already used on every other public page (index.html, the 5 city pages,
terms.html) -- `https://www.googletagmanager.com` in `script-src`,
`google-analytics.com`/`analytics.google.com` in `connect-src`. Nothing
else about that page's CSP loosened.

Also added, per direct request: a call button on `404.html` (previously
only "Back to Home" -- someone who lands there from a broken link or
typo is still a potential customer). `analytics-events.js` was added to
`GLOBAL_SHARED_FILES` in `scripts/check-consistency.js` so its
cache-bust version is tracked the same automatic way as `styles.css`/
`triage.js`/`business-hours.js`/`site-motion.js`. New tests in
`tests/content-quality/analytics-events.test.js` (6 tests, including
one confirming the honeypot path can never fire `booking_completed`).
1,597/1,597 tests passing, all consistency/undefined-vars/link/visual-
snapshot checks clean.

## What changed, 2026-09-10 (later still) — 3 service pages, plus every public page gets the blueprint background

**3 new service-specific landing pages**, same treatment as the 5 city
pages, built the same way and cross-linked from the homepage's service
modals (a new "More about this service" link, only shown for these 3):
`washer-dryer-repair.html`, `plumbing-repairs.html`,
`drywall-painting.html`. `washer-dryer-repair.html` keeps the full
triage tool (directly relevant) and links out to the 2 matching blog
posts; the other two skip triage (not appliance-symptom-based) in
favor of a plain FAQ section. All 3 added to `sitemap.xml` and the
homepage's service-modal `learnMore` links.

**Found and fixed a real visual gap, per direct request:** `about.html`,
`our-work.html`, `terms.html`, the blog index, and all 6 blog posts
were missing the blueprint-grid background + orange/blue ambient glow
(`has-blueprint-bg` on `<body>` plus a `.bg-blueprint` div) that
`index.html`, the 5 city pages, and now the 3 new service pages all
share -- these pages were quietly built on a different template
(`blog.css`'s `.blog-body` wrapper) that never picked up that
treatment. Added it to all 10 pages, matching the exact markup already
used elsewhere. `booking.html`/`manage-booking.html` deliberately keep
their own separate, simpler dark theme (never had this treatment, not
an oversight).

New tests: `tests/design/blueprint-background-coverage.test.js` (2
tests, locking in every public marketing page carries this treatment
so a future new page can't quietly skip it the way these did).
1,599/1,599 tests passing, all consistency/undefined-vars/link/visual-
snapshot checks clean.

## What changed, 2026-09-10 (later still) — 2 more service pages, and all 5 are now in the main nav

A follow-up audit found the 3 new service pages were only reachable
from the homepage's service-info modal and cross-links between the
pages themselves -- no link anywhere in the main site nav. Fixed on
both fronts:

**2 more service-specific landing pages**, closing out all 5 homepage
service cards: `handyman-repairs.html` (doors, cabinets & hardware,
carpentry & trim, weatherstripping) and `assembly-installation.html`
(flat-pack furniture, shelving, TV mounting, ceiling fans, smart home
devices). Same template as the other 3 (no triage section, plain
3-item FAQ). Both added to `sitemap.xml` and wired into the homepage's
service-modal `learnMore` links.

**All 5 service pages added to the main nav**, site-wide: a CSS-only
"Services" dropdown (`.nav-dropdown`/`.nav-dropdown-menu`, opens on
hover/focus, no JS) on desktop, and an always-visible
`.mobile-services-sublist` under the mobile menu's existing "Services"
link. The "Services" link itself still points at `#services`/`/#services`
as before -- the dropdown is purely additive. Rolled out to every
public marketing page (homepage, all 5 city pages, all 5 service
pages, about/our-work/terms, blog index + 6 posts). Footer "Services"
column on the 3 pre-existing service pages updated from 3 links to 5.

New tests: `tests/design/nav-services-dropdown.test.js` (3 tests,
locking in the nav-dropdown + mobile sublist on every public page, and
that the dropdown's shadow routes through `--shadow-hover` rather than
a hardcoded rgba). `tests/design/blueprint-background-coverage.test.js`
and `tests/design/homepage-stats-bar.test.js` updated for the 2 new
pages -- the stats-bar test's "communities served" file glob was
tightened to `handyman-*-ut.html`/`-nv.html` so it stops
double-counting `handyman-repairs.html` as a city satellite page.
1,602/1,602 tests passing, all consistency/undefined-vars/link/visual-
snapshot checks clean.

## What changed, 2026-09-11 -- manual jobs can now send a booking confirmation email

Direct request, prompted by a real question about the phone-booking
workflow: "if a guest asks us to schedule them, and we put the job on
the calendar, does that send them a confirmation email? Can we add
that safely, without accidentally sending it multiple times?"

Answer, confirmed by reading the actual code: no, not until now.
Only `booking.html`'s self-service flow ever auto-emailed a customer
(an `INSERT` trigger on `th_bookings`) -- a job created by hand in
`tools/job-tracker.html` writes to `public.jobs` instead, which had no
trigger and no notification path at all. (Separately confirmed: a
guest's self-service booking DOES land on the internal Calendar the
moment they book, with no manual "approval" step -- `booking.html`
inserts with `status` defaulting straight to `'confirmed'`.)

**New: a "Send Confirmation Email" button on any Job Tracker job with
a client email on file.** Backed by a new edge function,
`send-job-confirmation-email`, which sends the same "You're booked"
email booking.html guests get automatically. Double-send protection
(the specific worry in the request) is enforced server-side with an
**atomic conditional claim**: `jobs.confirmation_sent_at` (new
nullable column, same shape as the existing
`th_bookings.reminder_sent_at` reminder-email guard) is only set via
`UPDATE ... WHERE confirmation_sent_at IS NULL`, so two concurrent
clicks (a fast double-click, or two staff on two devices) can never
both succeed -- Postgres serializes the two writes and only one can
match the `WHERE` clause. If the Resend send itself then fails, the
claim is rolled back (set back to `null`) so a transient failure
doesn't permanently lock the job out of ever being confirmed -- staff
just click the button again.

Deliberately did NOT let the existing one-way `jobs` relational mirror
(`mirrorJobsToRelational` in `tools/sync.js`) touch this column at
all: since that mirror upserts the *entire* local jobs array on every
save regardless of which job actually changed, a stale local session
on one device (one that hasn't yet learned another device already
sent the confirmation) could otherwise push a plain object without
`confirmation_sent_at`, and PostgREST's bulk-upsert behavior would
fill the missing column as `NULL` for that row -- silently erasing the
server-set timestamp and reopening the exact double-send window this
feature exists to close. `confirmation_sent_at` is treated as
strictly server-owned; the client only ever reads back what the edge
function's response says and stores it locally for the button's own
display state (which syncs across devices through the existing,
separate per-field-merge blob sync, not the relational mirror).

New files: `sql/infra/add_job_confirmation_email.sql` (migration,
applied live), `edge-functions/send-job-confirmation-email-index.ts`.
New tests: `tests/workspace/job-confirmation-email.test.js` (10 tests
-- button visibility states, the actual fetch call and its auth
header, the 409-triggers-a-re-render behavior, that the mirror never
touches the guard column, and that the edge function's claim genuinely
happens before the send and is rolled back on a failed send).
1,622/1,622 tests passing, all consistency/undefined-vars/link/visual-
snapshot checks clean.

## What changed, 2026-09-11 (later the same day) -- job confirmation emails now BCC the internal inbox

Direct follow-up to the manual job confirmation feature above: "we
should be CC'ed on the email... to confirm it worked correctly each
time and to have additional record. not redundant" -- the internal
inbox getting a copy of a confirmation staff themselves just sent is
a verification record, not the same "tell staff something happened"
notification the self-service booking flow's separate internal email
serves.

`send-job-confirmation-email` now BCCs `LEAD_EMAIL_TO` (the same
address list already configured for the booking/lead pipeline -- no
new secret) on every guest confirmation it sends. BCC, not CC or a
second email, so staff never appear as a visible recipient on the
customer's own copy, matching the discretion pattern already used
elsewhere in the notification pipeline. Redeployed live.

New test in `tests/workspace/job-confirmation-email.test.js` (now 11
tests) locking in the BCC. 1,623/1,623 tests passing, all
consistency/undefined-vars/link/visual-snapshot checks clean.

## What changed, 2026-09-13 -- fixed a live `23505 duplicate key` error in the notification de-dup log

A real production Postgres error came in verbatim: `duplicate key
value violates unique constraint
"notification_log_notif_type_item_key_key"`. Root cause: both places
that write to the shared `notification_log` de-dup table
(`send-push`'s `markNotified()` and `reconcile-stripe-payments`'s
`markAlerted()`) called PostgREST's upsert with `Prefer:
resolution=merge-duplicates` but never told it which constraint to
resolve against. Without an explicit `on_conflict` parameter,
PostgREST defaults the conflict target to the table's primary key --
here, a freshly-generated random `id` on every insert, which can never
actually collide. That silently turned the "upsert" into a bare
INSERT, which then hit the table's real unique constraint,
`UNIQUE(notif_type, item_key)`, and failed outright the moment the
same ongoing condition (an overdue invoice, a stuck job, an unresolved
Stripe mismatch, etc.) got renotified after its own resend interval
elapsed -- which is to say, on the very first repeat of anything this
table was built to de-duplicate.

Fixed both call sites by adding `?on_conflict=notif_type,item_key` to
the upsert URL, and audited every other `resolution=merge-duplicates`
site in the codebase to check for the same mistake elsewhere -- all
others were already correct, either naming their own real unique
constraint (`push_subscriptions`, `workspace_sync`, the four
`client_portal_*` portal-sync tables) or correctly relying on the
default primary key because that table's PK genuinely is the key
being reused (`tools/sync.js`'s generic job/invoice/etc. mirror).
Redeployed both `send-push` and `reconcile-stripe-payments` live.

New tests in `tests/edge-functions/stripe-reconciliation.test.js` (now
11 tests) locking in the `on_conflict=notif_type,item_key` fix for
both functions. 1,625/1,625 tests passing, all
consistency/undefined-vars/link/visual-snapshot checks clean.

## What changed, 2026-09-14 -- manually-scheduled jobs can now be cancelled or have a reschedule requested

Direct follow-up, in response to "what else should we add?": self-
service bookings (`th_bookings`) already have a cancel/reschedule link
via `manage-booking.html`; manually-scheduled jobs (`public.jobs`) had
no equivalent at all. Confirmed directly with the user before
building: reschedule for a job is **request-only**, not an instant
move like a booking reschedule. `th_bookings`' own reschedule is
checked against a real time-slot exclusion constraint (only one
booking can hold a given time range), so it's safe to move instantly.
`jobs.job_date` is a plain date with no time-of-day and no such
constraint -- staff schedule these by hand, so an unattended instant
move could silently double-book a day already committed to another
job. The customer submits a preferred new date; staff get an email and
apply it themselves in Job Tracker if it works.

**New public page: `manage-job.html`**, this repo's counterpart to
`manage-booking.html`. Reached via a `?token=` link (a new
`jobs.cancel_token`, same nullable-guard shape as everything else in
this feature) that's now included in the job confirmation email
(`send-job-confirmation-email`, "Manage your appointment here"). Shows
the job, and offers "Cancel this appointment" (with a confirm step) or
"Request a different date" (a plain date field, not a live slot
picker -- this is a request, not a booking).

**New SQL** (`sql/infra/add_job_cancel_reschedule.sql`, applied live):
`cancel_token`, `cancelled_at`, `reschedule_requested_date`,
`reschedule_requested_at` on `public.jobs`; `get_job_by_cancel_token`
(read-only lookup, deliberately never returns phone/client_email/
notes/client_id), `cancel_job_by_token`, `request_job_reschedule_by_token`
(never touches `job_date` itself -- only the request columns); and
`notify_job_status_change`, a trigger that emails staff only on the
two real customer-initiated transitions (`cancelled_at` or
`reschedule_requested_at` newly set), never on an ordinary edit staff
make themselves -- same targeted-transition shape as `th_bookings`'
own `notify_booking_status_change`.

**New edge function** `send-job-status-change-email` -- staff-facing
only, no guest email involved. Re-derives the transition from
`old_record`/`record` itself rather than just trusting the trigger's
own gate, matching how `send-push-index.ts` already double-checks
`th_bookings`' cancel/reschedule transitions. The reschedule-request
email is explicit that nothing was applied automatically.

New tests: `tests/booking/manage-job.test.js` (9 tests, matching the
style of the existing `manage-booking.test.js`) and
`tests/workspace/job-cancel-reschedule-backend.test.js` (9 tests,
static-source checks on the migration and both edge functions).
1,641/1,641 tests passing, all consistency/undefined-vars/link/visual-
snapshot checks clean.

## What changed, 2026-09-15 -- structured-data pass for AI answer engines (GEO/AEO), plus a differentiated robots.txt

Prompted by a research request into getting Triple H recommended by AI
answer engines (ChatGPT, Perplexity, Google AI Overviews/Gemini,
Claude) and voice assistants (Siri, Google Assistant, Bixby, Alexa).
The research itself (two background agents, web-search-grounded) found
these systems don't share one index -- Yelp is disproportionately
important across ChatGPT/Perplexity/Siri/Alexa, GBP drives Google's own
AI surfaces, and Princeton's GEO paper (arXiv:2311.09735) found
schema markup is "hygiene," not the main citation lever, with
statistics/quotes/authoritative citations in visible content doing
most of the work. Full findings and the prioritized action list
(most of which requires the business owner logging into Google
Business Profile/Yelp/Apple Business Connect/Angi/BBB/Bing Places
directly -- not something fixable from this repo) were handed off in
chat, not written to a file here. This entry covers only the pieces
that were fixable directly in the repo.

**Real gap found and fixed:** the 7 city landing pages
(`handyman-hurricane-ut.html` and the rest) had visible on-page FAQ
content with zero matching `FAQPage` JSON-LD -- only the homepage and
the 5 service pages had it. Fixed by adding real `FAQPage` schema built
from each page's own actual visible FAQ text (not invented content),
preserving each city's real trip-fee answer (standard 15-mile-radius
wording for the 5 standard-coverage cities, the distinct by-request
wording already on the page for Cedar City and Mesquite). Same 7 pages
also gained a `Service` schema block (`serviceType`, `provider`,
`areaServed` matching each page's existing `areaServed` values,
`hasOfferCatalog` reusing the same 6 service offerings already listed
on the homepage's own schema) -- per the research, this is what lets an
answer engine match "who does appliance repair in Hurricane" to a
specific service+location pairing, which the existing
`HomeAndConstructionBusiness`-only schema didn't explicitly encode.

**Second gap found and fixed:** the 5 service pages
(`washer-dryer-repair.html`, `plumbing-repairs.html`,
`drywall-painting.html`, `handyman-repairs.html`,
`assembly-installation.html`) already had `Service` schema but were
missing `FAQPage` despite each having its own real, distinct visible
FAQ section -- fixed the same way, using each page's actual FAQ text.

**BreadcrumbList added site-wide** to every page that didn't already
have one and isn't the homepage itself: all 7 city pages, all 5 service
pages, `about.html`, `our-work.html`, `terms.html`, `blog/index.html`,
and all 6 individual blog posts (Home → Blog → post title for posts;
Home → page name for the rest). Cheap, low-risk structured-data hygiene
per the research -- clarifies site hierarchy for crawlers/engines, no
visible change to the rendered page.

**`robots.txt` gained explicit per-crawler rules**, splitting AI bots
into two groups rather than leaving them under the blanket `User-agent:
*` rule: live-retrieval/answer bots that ground an actual chat response
(`OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `Claude-SearchBot`,
`Claude-User`) are explicitly allowed, since being cited by these is
the whole point; bulk AI-training crawlers (`GPTBot`, `CCBot`,
`Google-Extended`) are disallowed -- this doesn't remove the site from
Google/Bing search or from Google's own AI Overviews (ordinary
Googlebot/Bingbot crawling, which those actually depend on, is
untouched by this), it only opts the site out of being scraped
wholesale into a model's training set, which has no bearing on whether
the business gets recommended in an answer. The research flagged this
specific split as a defensible judgment call, not a hard best practice
-- allowing everything would also have been reasonable for a small
business with no proprietary content to protect.

**`llms.txt` was deliberately NOT added** -- the research found
adoption is still only ~10% of domains after 18 months, AI crawlers
essentially don't fetch it in practice (0.1% of bot traffic in one
90-day study), and Google has explicitly said it doesn't support it.
Not worth the effort right now; revisit if that changes.

**Explicitly NOT touched, and why:** `AggregateRating` schema was not
expanded/added anywhere new -- the research flagged that re-publishing
third-party (Google/Yelp) review scores as first-party `AggregateRating`
schema violates both Google's and the platforms' own guidelines, and
with only ~7 Google reviews there isn't a healthy count to mark up yet
regardless. `speakable` schema was also skipped -- low priority, unclear
relevance to LLM chat answer engines specifically (it's mainly a Google
Assistant voice-readback feature). Content-quality rewrites (leading
with stats/quotes, an ongoing freshness cadence) were identified as the
single highest-evidence lever in the research but were deliberately
left for a future session with the user's direction, rather than
rewriting live marketing copy unprompted.

Verified before committing: every new/existing JSON-LD block across all
21 changed HTML files parses as valid JSON (scripted check, not
eyeballed), div-tag balance holds on every changed file,
`npm run check-consistency` and `scripts/check-links.py` both pass
clean, and the existing `tests/seo/local-business-schema.test.js`,
`tests/design/blog-post-meta.test.js`,
`tests/design/homepage-stats-bar.test.js`, and
`tests/referrals/referral-program.test.js` suites (the ones that
actually assert on this site's schema/meta content) all still pass
(37/37). The full `npm test` run was also kicked off, covering the
much larger, mostly-unrelated internal-tools test suite.

**False alarm, corrected same session:** this repo's dependencies
(`node_modules`) weren't installed before this session (`npm test` and
`npm run check-undefined-vars` both failed outright with
`Cannot find module 'jsdom'`). Running `npm install` mid-session
briefly surfaced what looked like a real bug --
`check-undefined-vars.js` reporting `tools/qrcode-lib.js` and
`tools/push-notifications.js` both declaring `VAPID_PUBLIC_KEY` -- but
a direct grep across both files found the declaration only exists in
`push-notifications.js`, and re-running the check after the install
fully completed came back clean (`52 pages checked, all clean`). The
apparent collision was a transient false positive from an
incomplete/mid-install dependency state, not a real bug worth fixing.
Also confirmed: `npm run check-consistency` (16 tool + 8 portal pages),
`scripts/check-links.py` (all internal references across 59 HTML files
resolve), and `scripts/check-visual-snapshot.js` (6 targets, all match
baseline) all pass clean. The full `npm test` run (1,420+ tests, mostly
unrelated internal-tools coverage) was kicked off but is slow enough in
this environment to need a longer timeout than one command allows --
the targeted suites that actually assert on this site's schema/meta
content (`tests/seo/local-business-schema.test.js`,
`tests/design/blog-post-meta.test.js`,
`tests/design/homepage-stats-bar.test.js`,
`tests/referrals/referral-program.test.js`) were run directly and pass
37/37.

**`sitemap.xml` `lastmod` dates updated** for exactly the 22 URLs whose
underlying pages genuinely changed in this session (the 7 city pages,
5 service pages, about/our-work/terms, the blog index, and all 6 blog
posts) -- bumped to 2026-09-15, the real date of the schema/breadcrumb
additions above. Every other `lastmod` in the file was left untouched.

**Third real gap found and fixed, same pass:** all 5 service pages'
`Service` schema had a `provider` (a nested `HomeAndConstructionBusiness`
stub) with no `sameAs` at all -- meaning every other schema block across
the site (homepage, all 7 city pages) links the business entity to its
Facebook/Instagram/LinkedIn/Yelp profiles except these 5. Added the same
4-link `sameAs` array to each service page's `provider` object,
matching what's already on every city page. This is exactly the kind
of cross-page attribute consistency the research flagged as helping an
answer engine build confidence that mentions across the web refer to
the same entity.

## What changed, 2026-09-15 (later the same day) -- a real cookie-consent banner, gating GA4 with Google Consent Mode v2

Prompted directly ("Can we add cookies?"), after first confirming this
isn't legally required: neither the Utah Consumer Privacy Act (UCPA;
$25M+ annual revenue threshold, per [Enzuzo's 2026 UCPA guide](https://www.enzuzo.com/blog/utah-consumer-privacy-act-ucpa)
and [Ketch's UCPA compliance page](https://www.ketch.com/regulatory-compliance/utah-consumer-privacy-act-ucpa)),
CCPA (California revenue/data-volume thresholds), nor GDPR (no EU
targeting) apply to a business this size. Built anyway as the right
thing to do given real GA4 tracking cookies were firing unconditionally
on every page load with zero user choice -- previously Terms &sect;12
only *disclosed* this, with no actual consent mechanism.

**Approach: Google Consent Mode v2**, the current standard way to gate
GA4 specifically (rather than blocking the gtag.js script entirely,
which would also break the existing GA4 event tracking wiring the
moment consent IS granted). Every one of the 23 public pages that loads
GA4 (`G-TMJJMGY2DQ`) now has a small inline script, placed immediately
before the existing GA4 tag, that reads `localStorage['th-cookie-consent']`
synchronously and calls `gtag('consent', 'default', { analytics_storage:
..., ad_storage: 'denied', ... })` *before* gtag.js itself ever runs --
so no analytics cookie is set until a real choice is made. A new
shared `/cookie-consent.js` (loaded on all 23 pages, same pattern as
`site-motion.js`/`analytics-events.js`) shows a bottom-fixed banner on
first visit (Accept/Decline), calls `gtag('consent', 'update', ...)`
and stores the choice, and exposes `window.reopenCookiePreferences()`
so a visitor can change their mind later -- wired to a new "Cookie
Preferences" link added to every page's existing footer (`.footer-bottom`).
`booking.html` has GA4 too and got the consent-default snippet + banner
script, but has no shared site footer to hang a preferences link off
of -- the banner itself still appears there on first visit, same as
everywhere else. `manage-booking.html`, `manage-job.html`, and
`404.html` load no analytics at all and were left untouched.

New CSS (`.cookie-banner` and friends, appended to `styles.css`) reuses
the site's existing theme tokens (`--bg-panel`, `--border`, `--orange`,
etc.) so it tracks light/dark automatically with no separate theme
block, matching the pattern already established for every other
themed component on the site.

**Verified with real execution, not just a syntax check** (this
project has been bitten before by code that looks right but throws at
runtime -- see the 2026-07-31 Invoice Generator incident above): built
a jsdom harness combining the real consent-default snippet, the real
GA4 config block, and the real `cookie-consent.js` as they'd actually
run together in one page, and confirmed the banner appears on first
load, Accept fires `gtag('consent','update',{analytics_storage:'granted'})`
and persists it, Decline does the equivalent with `'denied'`, the
banner does NOT reappear on a later load once a choice exists, and
`reopenCookiePreferences()` correctly reopens it on demand. (A first
attempt at this test used a naive single `window.eval()` call and threw
a `ReferenceError` on bare `gtag(...)` -- that was confirmed to be an
artifact of the flawed test harness, not a real bug, once retested with
a faithful multi-`<script>`-tag reproduction matching how the page
actually loads.)

**Terms & Conditions &sect;12 updated** (in both `terms.html` and
`index.html`'s static fallback content) to describe the actual banner
and link to it, rather than just disclosing analytics use with no
mechanism. **Not updated: the live Supabase-backed Terms content**
(`site_terms` table, editable via Dev Tools' CMS -- see the "Public
site CMS" section above) that the homepage's Terms modal actually
renders from in production. This session had no reason to write
directly to the live production database for a wording change like
this; the same &sect;12 wording change should be made there too via
Dev Tools, by the business owner or a future session with explicit
direction to touch live data.

**Editing `styles.css` changed its content hash**, which the project's
own `check-consistency.js` correctly flagged as 24 pages now serving a
stale `?v=` cache-bust stamp (would have meant some visitors getting a
cached pre-cookie-banner copy of the stylesheet). Fixed by running the
project's own `npm run fix-versions`, which additionally bumped the two
service worker `CACHE_NAME` values (`th-workspace-v138` -> `v139`,
`th-portal-v61` -> `v62`) since a precached file's contents changed --
this touched every tool/portal page too, purely as a cache-bust stamp
refresh, no content changes to any of them.

Verified before committing: all 23 changed public pages still parse as
valid JSON-LD with balanced `<div>`/`<span>`/`<p>` tags, `npm run
check-consistency` passes clean (24 pages, no stale stamps), `npm run
check-undefined-vars` passes clean (52 pages), `scripts/check-links.py`
resolves every internal reference across 59 HTML files, and the
schema/meta-focused test suites
(`tests/seo/local-business-schema.test.js`,
`tests/design/blog-post-meta.test.js`,
`tests/design/homepage-stats-bar.test.js`,
`tests/referrals/referral-program.test.js`) pass 37/37.

**Follow-up, same day, on explicit request:** the live Supabase
`site_terms` row this entry flagged as intentionally not updated (id
13, "12. Cookies and Analytics") was updated directly via SQL to the
same wording now live in `terms.html`/`index.html`'s static fallback --
confirmed via `site_terms_history` (a real `update` row logged at
2026-09-15 21:02:30 UTC, following the existing `insert` from
2026-08-13). This is the content the homepage's Terms modal actually
renders in production, so both the static fallback and the live CMS
copy now say the same thing.

## What changed, 2026-09-16 -- off-site SEO gap identified, GBP/directory copy drafted

Checked whether the on-page GEO/AEO work (schema, robots.txt) actually
gets Triple H recommended for a real, un-branded query like "washer
dryer repair St George Utah." It does not: a branded search correctly
surfaces `triplehenterprisesllc.biz` as the #2 organic result, but the
generic query returns only national franchises (Mr. Appliance, Sears)
and established local competitors with directory/citation presence
Triple H doesn't have yet -- confirming on-page schema was necessary
but not sufficient. A search for the bare domain string also turned up
no real third-party mentions of it, meaning near-zero backlinks/citations
point to the site by name.

None of this is fixable from the repo -- it needs a claimed Google
Business Profile and real directory listings (BBB, Angi, Thumbtack,
Yelp, Nextdoor, Yellow Pages), which only the business owner can create.
Audited the site's own NAP data first (`index.html`'s `LocalBusiness`
schema and visible contact info -- name, `(435) 414-1667`,
`steve@triplehenterprisesllc.biz`, St. George, UT 84790) and confirmed
it's consistent site-wide, then drafted ready-to-paste GBP description/
category/service-list/seed-Q&A copy and a shared directory-listing
description, added to `docs/ACTION-ITEMS.md` under a new "SEO copy
drafts" section so items 1 and 3 of the existing SEO action list are
copy/paste instead of blank-page work. No code changes.

**Also flagged, pending an answer only the owner can give:** the site
shows 7 reviews but Google's own listing currently shows 6 -- one of
the 7 is real but not actually a Google review. Every review card on
the site is labeled "on Google," so which one to correct can't be
determined from the code; the owner will check and confirm which
quote it is. Not touched yet.

## What changed, 2026-09-16 -- replaced every window.alert() in the client portal with a themed toast

Found and fixed a real bug while looking for portal polish work:
`portal/work-orders.html` already called `showToast()` on a failed
message send, but no `showToast` was defined anywhere in the portal --
that error path threw a silent `ReferenceError` instead of telling the
client their message didn't send. Added a real `showToast()` to
`portal/portal-app.js` (mirroring the existing `portalConfirm()`
pattern -- injects its own DOM once, on first use, shared across every
portal page) plus matching `.portal-toast` styles in
`portal/portal-app.css`, sized to clear the bottom tab bar the same
way the internal tools' own toast already clears theirs.

While at it, replaced every other `window.alert()` in the portal with
this same toast, not just the one broken call site: 2 in
`portal/quotes.html` (quote approve/decline failures), 3 in
`portal/dashboard.html` (PDF-not-ready, and 2 signature-name
validations), and 5 in `portal/settings.html` (saved-card
add/remove failures and a signature-name validation). `alert()`
blocks the whole page and reads as dated next to the portal's other
custom modals; none of these needed to stay native.

Verified: `npm run fix-versions` (bumped `portal/service-worker.js`'s
`CACHE_NAME` since `portal-app.js`/`portal-app.css` content changed),
`npm run check-consistency` and `node scripts/check-undefined-vars.js`
both pass clean, and the full portal test suite (448/448, including
the alert-regex check in `tests/portal/job-receipt-link.test.js`)
passes.

## What changed, 2026-09-16 -- every blog post now has its own unique photo

All 6 blog posts previously drew from just 3 Unsplash stock photos,
reused 2-3x each. This environment's network policy blocks outbound
access to every image CDN tested (Unsplash, Pexels, Pixabay, Wikimedia
-- see the earlier same-day SEO-gap entry above), so these couldn't be
sourced independently; the owner supplied real photos directly for
each post instead, which were wired in one at a time as they arrived.

`fridge-not-cooling.html`, `dishwasher-not-cleaning.html`,
`washer-wont-drain.html`, `appliance-repair-or-replace.html`, and
`dryer-not-heating.html` each now have their own distinct photo, real
alt text describing what's actually shown, and the site's usual
Unsplash URL-parameter convention (`fm=jpg&q=80&w=1400&auto=format&fit=crop`).
`handyman-to-do-list.html` already had a unique photo and needed no
change. No page shares an image with another anymore.

Two supplied photos were **Unsplash+ (paid tier)** images -- easy to
spot by the `plus.unsplash.com/premium_photo-...` URL and the tiled
"Unsplash+" watermark visible in the preview -- and were not used,
since that tier needs a separate paid license. A third supplied photo
(a real, unwatermarked kitchen) didn't match its intended post
(`dryer-not-heating.html` needed a dryer, not a kitchen) and was
logged in `docs/ACTION-ITEMS.md` under "Reserved images" for a future
post instead of being forced in.

Verified: `npm run check-consistency`, `node scripts/check-undefined-vars.js`,
and `python3 scripts/check-links.py` all pass clean.

## What changed, 2026-09-16 -- corrected the site's reviews to only show ones verifiable against the real Google listing

The owner checked the real Google Business Profile against the site's
7 review quotes to find the one that had been flagged as not actually
a Google review. It turned out to be bigger than one quote: only 3 of
the 7 matched a real Google reviewer's actual written text (PD IND.,
Belinda Christensen, Jilleen Zufelt); Google has 6 reviews total, but
2 of them (Austin Mayer, Micah Naegle) are star-only with no written
text at all. The remaining 4 site quotes couldn't be traced to any
verifiable source.

Rather than write plausible-sounding text and attach it to Austin's or
Micah's names to hit a round number, the 4 unverifiable quotes were
removed outright, and Jilleen Walker's real review -- 5 stars, never
added to the site before -- was added as a genuine 4th quote. Updated
everywhere this touches:

- `index.html`'s full reviews wall: 7 cards -> 4, all verified; removed
  the now-empty "Show 3 more reviews" `<details>` disclosure entirely.
- The `aggregateRating.reviewCount` schema and the homepage's "Real
  5-Star Reviews" stat: `7` -> `4`, consistent with this site's
  existing policy that the count must match visible page content, not
  a raw external total (see `reviews-wall.test.js`'s original 2026-09-07
  rationale for why this matters for structured-data honesty).
- The condensed 3-quote review section shared by the other 13 pages
  (7 city/service pages, `about.html`, `our-work.html`, plus 6 more
  city pages): the one unverifiable quote among the 3 shown
  ("Called in the morning...") was swapped for Jilleen Walker's real
  text on every page.
- `tests/content-quality/reviews-wall.test.js`,
  `tests/content-quality/landing-page-social-proof.test.js`, and
  `tests/seo/local-business-schema.test.js` updated to match the new
  count and quote text.

Verified: `npm run check-consistency`, `node scripts/check-undefined-vars.js`,
`python3 scripts/check-links.py`, and the affected test files (104/104)
all pass clean; full suite run separately.
## What changed, 2026-09-16 -- automated client-facing payment reminder emails

Direct request: "focus on automation of invoices, reviews, schedules,
emails, reports -- look at what we currently have and find ways to
make it better." An audit of each area found automation already in
good shape for schedules (appointment reminders, confirmation emails,
cancel/reschedule) and reports (the 2026-08-15 weekly digest already
emails Steve a real summary -- jobs completed, revenue invoiced, new
leads, outstanding balance, uptime -- on top of the existing push).
**The real gap was invoices**: an overdue invoice already produced an
internal push notification and showed on the Dashboard's Outstanding/
Overdue cards, but nothing ever told the *client* -- Steve had to
notice and follow up by hand every single time.

**New edge function**, `send-payment-reminder` -- a daily cron (not
hourly; "overdue" is date-level, not time-of-day) that emails the
client directly at three escalating checkpoints: 3 days overdue (a
friendly nudge), 7 days (a restated balance), 14 days (a firmer note
that says a call is likely coming). Each invoice gets at most one
email per run, at whichever checkpoint is currently the highest one
crossed that hasn't already gone out -- so a cron gap never fires a
backlog of 3 emails to the same client in one day, and once the 14-day
email has gone out nothing further is automated by design; that's the
point a human should actually call. Reuses the exact same de-dup
mechanism `send-push` already established for the internal overdue
notification (`notification_log`, keyed on `notif_type`+`item_key`,
just three new `notif_type`s -- `invoice-reminder-3d`/`-7d`/`-14d`)
rather than a new table, and respects the same
`wants_invoice_quote_emails` preference a client already controls in
Portal Settings. Partial payments are handled with the identical
whole-cents-rounded `getPaidAmount`/`getRemainingCents` logic
`workspace.html` uses, so the reminder always shows the real remaining
balance, not the original total. No new secrets -- reuses
`RESEND_API_KEY`/`LEAD_EMAIL_FROM`/`LEAD_EMAIL_TO`, same as the
appointment-reminder pipeline.

**New cron**, `sql/infra/add_payment_reminder_emails_cron.sql` --
`send-payment-reminders-daily`, same vault-secret pattern as every
other scheduled job in this project. Needs deploying
(`supabase functions deploy send-payment-reminder`) and the SQL file
run once before it's actually live -- not yet confirmed run as of this
entry.

New tests: `tests/edge-functions/payment-reminder.test.js` (16 tests,
static-source checks matching the style already established for this
project's other edge functions -- Deno TypeScript can't be executed
directly under Node's test runner).

**Correction, written moments after this entry**: the line originally
here claimed "review requests are sent but never tracked" as the next
open item. That was wrong -- checked directly against the live repo
before starting that work and found `review-request.html` already has
a full sent-log (status: sent/received/no_response, a real conversion-
rate summary) and a delayed-reminder feature, built in an earlier
session this doc's own "What changed" history hadn't been read closely
enough to notice. The actual remaining gap, and what got built next
(see the following entry): that reminder only ever surfaced passively
on page-open, never as a real push.

## What changed, 2026-09-16 (later the same day) -- pending review-reminder push, and a client-facing quote follow-up email

Continuing the same invoice/review/schedule/email/report automation
audit that added `send-payment-reminder` earlier the same day. Two more
real gaps closed:

**1. Review-follow-up reminders now actually notify, not just wait to
be noticed.** `review-request.html` already lets Steve set a delayed
reminder ("remind me in 5 days") after sending a review request --
but that reminder was entirely passive: it only ever surfaced the next
time he happened to open that exact page on or after the target date
(the page's own toast copy says this outright: "this won't send a
phone notification on its own"). Added `checkPendingReviewReminders()`
to `send-push-index.ts`'s existing daily `reminder-check` pipeline --
reads `th_review_requests_pending` straight out of the same
`workspace_sync` blob every other daily check already reads, compares
`remindAt` against business-timezone "today" as a plain date string
(no `Date` parsing, avoiding the exact UTC-vs-business-tz class of bug
this file has been bitten by twice before), and fires a real push the
moment a reminder is due. One-time per reminder (`review-reminder-due`
resend interval: effectively never, same as `job-no-photos`/
`warranty-checkin`) -- the reminder itself stays visible on the page
until Steve dismisses it, so resending the push daily on top of that
would just be noise. No schema change, no new secret -- purely additive
to the existing daily cron.

**2. New edge function `send-quote-followup`** -- an unconverted quote
already produced an internal push to Steve after 14 days
(`checkUnconvertedQuotes`), but exactly like the overdue-invoice gap
closed earlier this same day, nothing ever told the *client* their
quote was still waiting on a decision. Queries `client_portal_quotes`
directly (not the blob) -- the real client-facing source of truth,
with a real `status` column (`pending`/`approved`/`declined`) and
`client_email` already on every row, so it's exactly the population
that can actually be emailed. One nudge per quote at 7 days pending --
earlier than Steve's own 14-day internal alert, on purpose, so the
client gets a chance to act before he's told to chase them down
himself. Reuses the same `notification_log` de-dup mechanism and the
same `wants_invoice_quote_emails` preference already established for
`send-payment-reminder`/`send-invoice-notification` -- a quote is the
same category of email to a client as an invoice. No new secrets.

**New cron**, `sql/infra/add_quote_followup_email_cron.sql` --
`send-quote-followup-daily`, offset an hour from the payment-reminder
cron so the two daily sends don't bunch at the same minute. Same
deploy caveat as `send-payment-reminder`: needs
`supabase functions deploy send-quote-followup` and the SQL file run
once -- not yet confirmed run as of this entry, tracked in
`docs/ACTION-ITEMS.md`.

New tests: `tests/edge-functions/pending-review-reminder-push.test.js`
(7 tests) and `tests/edge-functions/quote-followup.test.js` (12
tests), same static-source-check style as this project's other edge
function tests.

**Still open from the original audit**: job photos (flagged
elsewhere in this doc as "not yet tested end-to-end") and converting a
recurring job template straight to an invoice (still fully manual each
time) remain unbuilt.

## What changed, 2026-09-16 (later still) -- one-click "Create Invoice" from a job

Closed the "converting a recurring job template straight to an invoice
(still fully manual each time)" gap flagged just above. Invoice
Generator already had a Job Ref dropdown that autofills client name,
address, and description once a job is picked -- but getting there
still meant leaving Job Tracker, opening Invoice Generator by hand, and
finding the right job in that dropdown yourself. A job created from a
recurring template (`createJobFromTemplate()`) went through exactly
that same manual path, same as any other job.

Added a **"Create Invoice"** button to every job row in
`tools/job-tracker.html` (both the card view and the desktop table
view), linking to `/tools/invoice-generator.html?jobRef=<job id>`.
`invoice-generator.html` now reads that `?jobRef=` param on load
(`applyJobRefFromUrl()`), selects the matching job in the existing Job
Ref dropdown, runs the same `autofillFromJobRef()` the dropdown's own
`onchange` already used, fills the first blank line-item description
with the job's title, and strips the query param from the URL so a
later reload or "New Invoice" reset doesn't keep re-applying a job that
may since have changed. A stale or tampered `?jobRef=` (job no longer
exists) is a silent no-op -- the form just opens blank, same as
today. No schema change, no new storage key, reuses the job-linking
plumbing (`jobRefId`/`jobRefTitle` on the saved invoice) that already
existed.

This doesn't touch the recurring-template-to-job step itself (unchanged
-- still a click on "Create Job"), only the second half of that
workflow: template -> job was already one click, job -> invoice is now
one click too.

## What changed, 2026-09-16 (later the same day) -- fixed a false "invoice overdue" push caused by a sync-merge inconsistency

A real bug flagged by a business-health report pass (see
`docs/specialist-logs/bugfix.md` for the full root-cause writeup): an
invoice that was paid in full still showed `paid: false`, and fired a
real overdue-payment push to Steve. The cause wasn't a missing write
path -- `tools/workspace.html`'s `togglePaid()` already keeps `paid` and
`paidAmount` in sync on every edit -- it was `tools/sync.js`'s per-field
3-way merge, which can independently resolve `paidAmount` from one
device's edit and `paid` from a different (stale) device's edit,
leaving the merged invoice internally inconsistent even though each
field's own merge was individually defensible.

Fixed with a new `deriveInvoicePaid()` helper in `sync.js` that
recomputes `paid` from `paidAmount`/`total` (same whole-cents comparison
`invoicePaymentStatus()` already used for display) -- called from
`mirrorInvoiceToRelational()` (what the overdue-push check actually
reads) and from a new post-merge normalization pass on `th_invoices` in
`applySyncData()`, so neither the relational mirror nor a device's own
local copy can be left holding the inconsistent state again. New
regression test in `tests/sync/applysyncdata-malformed-json.test.js`
reproduces the exact merge-conflict shape.

## What changed, 2026-09-16 (still later) -- confirmed automation deploy, plus a client-facing quote PDF

A deep-dive audit of the whole project's open backlog turned up two
things worth acting on immediately.

**1. The two pending edge-function deploys from earlier today were
already done.** `send-payment-reminder` and `send-quote-followup`
were flagged in `docs/ACTION-ITEMS.md` as "written and tested but
needs a real deploy step I can't do myself." Checked directly against
the live Supabase project: both functions are `ACTIVE` with source
matching this repo exactly, and both crons
(`send-payment-reminders-daily`, `send-quote-followup-daily`) are
active. Someone with dashboard/CLI access must have run the deploy
between then and now -- `docs/ACTION-ITEMS.md` just never got updated
to say so. Fixed there now.

**2. Client-facing quote PDF**, closing the "no standalone quote PDF"
gap `docs/CLIENT-PORTAL.md` had flagged as an intentional scope cut
back when quote approval first shipped. `portal/quotes.html` now has
a "Download PDF" button on every quote card
(`downloadQuotePDF()`), mirroring `portal/dashboard.html`'s existing
invoice-PDF layout closely (same header band, same BILL TO/line-item
table shape) so an invoice and a quote from this business read as the
same family of document. Differences reflect the real data: the
document is always labeled QUOTE (a quote has no paid/unpaid state),
the status line shows PENDING/APPROVED/DECLINED instead of PAID/
UNPAID, the total is labeled "ESTIMATED TOTAL" rather than "TOTAL
DUE", and the footer says outright that it's an estimate, not a final
invoice. Reads from the exact same `currentQuotes` array already
populated by RLS-scoped Supabase queries -- no second query, no new
trust boundary. New tests:
`tests/portal/quotes-pdf.test.js` (8 tests, mirroring
`tests/portal/dashboard-invoice-pdf.test.js`'s own source-inspection
style).

## What changed, 2026-09-16 (still later again) -- two-way messaging on a completed job

Closes the "messaging thread per job" gap `docs/CLIENT-PORTAL.md` had
listed under "worth considering but has real tradeoffs" -- phase 6
built two-way messaging on work orders (a not-yet-assessed request),
but a client with a follow-up question about a job that's already
**done** had no channel except filing a brand-new work order or
calling. Deliberately kept as its own table/thread rather than
overloading work orders: the two have different parent tables
(`client_portal_work_orders` vs `client_portal_jobs`), and sharing one
messages table between them would mean every row forever carrying an
"exactly one of these two foreign keys is set" constraint.

**New table** `client_portal_job_messages` (`sql/portal/create_client_portal_job_messages.sql`)
mirrors `client_portal_work_order_messages`' shape and RLS almost
exactly -- a client posts only as themselves on their own job, an
internal account posts only as themselves and only by actually holding
an `account_roles` row (`current_user_has_any_role()`, reused as-is).
**New edge function** `notify-job-message-email`, triggered the same
way as its work-order counterpart (a `SECURITY DEFINER` trigger
function reading the same Vault-stored service-role key, `net.http_post`
to itself) -- handles both directions in one function: a client
message emails the internal team (the same `notification_recipients`
list new-work-order alerts already use -- no separate list to
maintain, and no UI exists today to configure one per source anyway),
an internal reply emails the client and sends a push, respecting the
same `wants_message_emails` opt-out work-order messages already check.

**Client side**: `portal/jobs.html` -- every job card gets a
"Messages" toggle (lazy-loaded, since most jobs will have zero
messages) with the same bubble-thread UI work-orders.html already
established. **Internal side**: a new "Portal job messages" panel in
`tools/clients.html`, listing every portal-synced job with the same
Messages-toggle-and-reply pattern the existing Portal work orders panel
already uses -- deliberately its own panel rather than folded into that
one, since jobs and work orders are different underlying records with
different internal owners (Job Tracker vs the work-order queue).

New tests: `tests/portal/job-messaging.test.js` (15 tests, mirroring
`tests/portal/work-order-messaging.test.js`'s structure test-for-test
where the feature itself mirrors that one).

## What changed, 2026-09-17 -- fixed a stray-looking line down the homepage hero in light mode

A fresh visual audit (not just re-reading old context) turned up a real
rendering issue on the homepage: in light mode, a distinct vertical
line ran down the far-left edge of the hero photo, reading like a
rendering glitch. Root cause: `.motto-rail` (a decorative 3px "spine"
tied to the hero tagline that lights up in segments as a visitor
scrolls past the matching About-section value pill) used
`background:var(--border)` at rest, which is a light color in light
mode -- but the rail runs the full page height, crossing the hero
section, which (like its own heading text) deliberately stays on a
dark photo regardless of site theme. Same gap the hero's own text
color already had to account for, just missed for this element.

Fixed in `styles.css` (`.motto-rail .rail-seg`): the unlit color is now
a fixed translucent white instead of a theme-swapping variable, chosen
so it reads as a faint, deliberate hairline against both the dark hero
and the light-mode page (verified with direct pixel sampling, not just
a screenshot glance -- the visible jump at the hero's edge dropped from
roughly a 90-value spike to about 20). The scroll-triggered "lit"
segments (Honesty/Hustle/Helpfulness) are untouched and still work.

## What changed, 2026-09-17 -- mobile Call + Book bar, Schedule-first hero

A conversion audit of the public marketing site found two cheap misses:
the homepage hero made **Call** the loud orange primary and buried
**Schedule** as a quiet link, and mobile had no persistent way to book
while scrolling (only a Call-only sticky strip on the homepage).

**Hero CTA hierarchy.** On the homepage, and on the city and service
pages that already used the same Call-then-quiet-book pair, Schedule
is now the filled orange primary ("Schedule an appointment") and Call
is an outline button that still shows `(435) 414-1667`. Destinations
match the header Schedule button (`#schedule` on the homepage,
`/booking.html` on the others). Triage results and the service modal
still use Call-primary plus the quiet "or schedule online" link --
those fire after someone has named a specific problem. Header Schedule
and the nav phone link are unchanged.

**Sticky mobile bar.** The existing homepage-only `.sticky-call` strip
is now a two-action Call + Book bar, hidden above 760px (the same
breakpoint already used for back-to-top and the chat bubble). It is
also on the city pages, service pages, our-work, about, and the blog
index. Book uses the same target as that page's header Schedule
button. Body padding and the cookie banner / chat bubble / back-to-top
offsets are scoped with `:has(.sticky-call)` and include
`env(safe-area-inset-bottom)`, so the last content and those controls
do not sit under the bar. A short entrance animation is gated on
`prefers-reduced-motion: no-preference` (the site-wide reduced-motion
kill switch still applies either way).

`/tools/` and `/portal/` are out of scope. No AggregateRating,
robots.txt, or Supabase changes.

New tests: `tests/design/mobile-sticky-call-book-bar.test.js`. The U01
flat-primary-button tests were updated for the hero swap and still
lock Call-primary on triage and the service modal.

## What changed, 2026-09-17 -- booking path cleanup: Book goes to /booking.html

Follow-up to the sticky Call+Book bar. Schedule and Book links that
still jumped to the mid-page `#schedule` section now go to
`/booking.html`, where the real calendar is. That includes homepage
nav, hero, sticky Book, footer, and the matching Schedule links on
city, service, about, our-work, blog, and legal pages. The sticky
bar's layout and CSS are unchanged -- only the href. `#contact` still
points at Hours and the map.

In every `#schedule` section, **Book Instantly** is the orange
primary. On the homepage, Send Email is the quiet secondary. On city
and service pages, Call or Text is the outline secondary.

`booking.html` now has a canonical URL
(`https://www.triplehenterprisesllc.biz/booking.html`) and a short
expectations line on step 1, taken from the existing FAQ: no deposit,
a $25 trip fee beyond 15 miles, and emergencies should be a call or
text rather than an online booking. No invented fees, hours, or "next
available" slots.

New tests: `tests/design/booking-path-cleanup.test.js`. Sticky-bar and
U01 tests were updated for the new hrefs and card hierarchy.

## What changed, 2026-09-17 -- GA4 booking events + trust near CTAs

Lean conversion follow-up on the public marketing site. The existing
GA4 property (`G-TMJJMGY2DQ`) and `analytics-events.js` already fired
`phone_click` / `text_click` / `chat_opened`, with `lead_form_submitted`
and `booking_completed` inline on the real success paths. This extends
the same shared script (no new measurement ID, no renamed events):

- `email_click` on `mailto:` links
- `book_cta_click` on Book/Schedule links to `/booking.html`
- `booking_page_view` when `/booking.html` loads
- `booking_form_start` once, on first engagement with the booking flow
  (or if a deep-link already skipped step 1)

`booking_step_view` and `booking_completed` stay inline so the honeypot
bot-trap still cannot look like a conversion. `/portal/` and `/tools/`
are unchanged.

Homepage hero and the #schedule Book Instantly card now carry a compact
star line next to the primary CTA -- 5.0 from 4 Google reviews, quoting
the existing washer-repair review, linking to `#reviews`. booking.html
has the same line under the subhead, linking to `/#reviews`. On viewports
where the sticky Call+Book bar shows (max-width 760px), the hero line is
hidden so it is not covered on first paint; the #schedule copy stays.
No new reviews, and `aggregateRating.reviewCount` stays 4.

New tests: `tests/design/cta-trust-proof.test.js`, plus jsdom coverage
in `tests/content-quality/analytics-events.test.js`.

## What changed, 2026-09-17 -- visual quick wins: stats paint, 16px forms, directory landings

Three small public-site honesty and usability fixes. No review-count
changes and no AggregateRating JSON-LD edits.

**Stats strip first-paint.** Homepage `.stat-count` text is now the
final values (5.0 / 4 / 9) in the HTML, so view-source, no-JS, and
reduced motion never flash zeros. Count-up still runs as progressive
enhancement, interpolating from those already-rendered finals rather
than from 0.

**16px form controls.** Root `styles.css` `input, select, textarea`
(including the email modal) now use a 16px floor, the same iOS
zoom-on-focus fix portal and booking already had.

**Bare `/portal/` and `/tools/`.** Those directory URLs 404ed on GitHub
Pages. New `portal/index.html` and `tools/index.html` redirect to the
login pages with a dark canvas (`color-scheme` + inline
`background-color:#0a0a0a`) so the hop does not flash white. Tools
index is noindex; portal index matches login (`noindex, nofollow`).
Neither stub loads `styles.css`.

New tests: `tests/design/directory-index-redirects.test.js`, plus
updates to the stats-bar and site-wide 16px zoom tests.

## What changed, 2026-09-17 -- public conversion visuals

A conversion pass on first-screen chrome and the path to booking. Page
length stays; this adds navigation rather than cutting scroll-craft
sections. Review counts and `analytics-events.js` are untouched.

**Mobile chrome stack.** Promo banner, sticky header, Call+Book bar,
chat bubble, and cookie banner were competing on ≤760px. The stack is
now documented in `styles.css` (z-index + safe-area). The cookie banner
is compact on small screens, deferred until scroll or six seconds so it
does not cover hero CTAs, and hides chat/back-to-top while it is up.
Call+Book stays.

**Hero hierarchy.** The 250px crest no longer sorts above the H1 on
mobile. It is 96px and follows the headline and CTAs. Photo overlays
are lighter so the canyon still reads as a photo.

**CTA color.** Book/Schedule stays the filled orange primary. Homepage
`#schedule` already had Book Instantly as orange and Send Email as the
quiet link. Triage and the service modal still use Call-primary after
a named problem. `/portal/` and `/tools/` are unchanged.

**Booking mobile summary.** The desktop `.booking-sidebar` is still
hidden at ≤960px. Steps 2–3 now keep a compact sticky line with the
chosen service and, once set, the date/time. Step labels stay visible
at ≤600px as Service / When / Info.

**Homepage conversion spine.** A desktop sticky jump row (Services,
How a visit goes, Reviews, Book) sits under the header and hides at
≤760px, where Call+Book already covers it. An in-flow Schedule rail
after Services offers Book Instantly plus a quiet reviews link.

New tests: `tests/design/public-conversion-visuals.test.js`, plus a
mobile-summary case in `tests/booking/booking.test.js`.

## What changed, 2026-09-17 -- portal usability: action inbox, next visit, pay-first invoices

Logged-in `/portal/` only. No auth/RLS changes, no payment Edge Function
changes, and no public AggregateRating edits.

**Home action inbox.** "Needs Your Attention" is now one card per real
task, sorted unpaid invoices, then contracts to sign, then estimates
to approve, then open requests to reply. Each card's button deep-links
into the page that already handles Pay / Approve / Sign / Reply
(`#invoice-card-`, `#payFirst`, `#quote-card-`, `#contract-card-`,
`#wo-card-`). Scheduled visits are no longer duplicated there.

**Next appointment hero.** When a work request is `scheduled`,
`#nextAppointmentArea` is the largest Home surface: when, what, where
(if an address is on the request), a countdown, and the same Call/Text
links the help card already used. Still omitted when nothing is booked.

**Pay-first invoices.** Unpaid clients see amount due and invoice-date
context, plus Pay now / Pay All Outstanding, above the paid/outstanding
ring and history chart. Payment still goes through the existing Stripe
handlers. Copy says "Invoiced {date}" because `client_portal_invoices`
has no separate due-on column.

**Contracts in primary IA.** Contracts are a Home account card alongside
Invoices / Estimates / Jobs / Requests. The bottom bar stays five tabs
(Home, Request, Quotes, Invoices, Jobs). Settings stays a header icon.

**Empty states.** Invoice lists use the same is-neutral / is-error icon
pattern as quotes and jobs. Genuine empty invoices/quotes/jobs offer
Request Work. Contracts empty explains they will appear when sent -- no
fake create button.

New tests: `tests/portal/portal-usability-pr3.test.js`.

## What changed, 2026-09-17 -- internal tools usability (ops inbox + nav)

Field/ops Workspace UX, `/tools/` only. No public-site or portal
changes, and no sync/auth architecture change.

**Action Items as an ops inbox.** The six existing lists (work
requests, leads, bookings, due-soon jobs, follow-ups, income) sit in
four priority lanes with counts. Unread highlighting uses flags the
rows already had (unhandled lead, unconverted booking, submitted
request, overdue invoice). Nothing new is fetched.

**Phone More sheet.** The bottom bar is still Home / Jobs / Invoices /
Calendar / Finance. A sixth More control opens a sheet of the dests
the desktop sidebar already listed (Contracts, Route, Reviews, Wiki,
Runway, Settings). Same 720px breakpoint; PWA bar pattern unchanged.

**Jump-nav chips.** Snapshot, Action Items, and Tools stay in the row
on a phone. Gallery, Compliance, Analytics, and Backup sit behind
More; all seven chips show at 721px and up.

**Hub header.** Live sync, pending, and refresh sit in the same
toolbar row as the title. The 140px desktop second-row stack is gone.
Status stays visible.

**Job Tracker tablet density.** Cards still show below 1024 and the
dense table still shows at 1024+. 768–1023 now gets compact list rows
instead of phone-sized cards.

New tests: `tests/tools/workspace-ops-inbox.test.js`.

## What changed, 2026-09-17 -- AggregateRating matches Google Business Profile (5.0 / 7)

Connor unlocked matching the live Google Business Profile: **5.0 stars
from 7 Google reviews**. The public site had been locked at 5.0 / 4
(written, verified quotes only).

- `index.html` JSON-LD `aggregateRating`: `ratingValue` stays `5.0`;
  `reviewCount` is now `7`.
- Homepage stats strip ("Real 5-Star Reviews") and both CTA proof
  lines ("5.0 from 7 Google reviews") match that total.
- `booking.html` CTA proof line matches. Booking still has no
  `AggregateRating` of its own.
- Homepage review wall stays at the 4 written, verified quotes. No
  invented `Review` JSON-LD objects or fake cards for star-only Google
  reviews.

Tests updated: `reviews-wall.test.js`, `landing-page-social-proof.test.js`,
`local-business-schema.test.js`, `cta-trust-proof.test.js`,
`homepage-stats-bar.test.js`, `booking-conversion.test.js`.

## What changed, 2026-09-17 -- booking conversion: sticky CTAs, held-slot copy, referral, schema

Focused public-site conversion work on `/booking.html` only. No Edge
Functions, no Supabase schema, and **no AggregateRating change** —
`index.html` stays `ratingValue` 5.0 / `reviewCount` 4.

**Sticky mobile Call + Book.** The marketing pages already had the
760px Call+Book bar; booking.html did not (left off in the original
bar pass because the page is the calendar). Rechecked: the gap is Call
as an escape hatch, not a second Book destination. The bar is local
CSS (this page does not load `styles.css`). Call is `tel:+14354141667`.
Book is `#stepService` during the flow so it cannot wipe a half-filled
form; after confirm it goes to `/booking.html` for a fresh start.
Cookie-banner styles were also missing on this standalone page — added
so the injected banner sits above the bar.

**Success copy.** Confirmation now says the slot is held, then what
happens next (email with reschedule/cancel, we arrive, pay after —
cash, check, Venmo, Cash App, or card). Dropped "we'll call or text if
anything needs clarifying" as the implied confirm step. Emergency
call/text stays under the timeline.

**$25 referral credit.** Same complete-and-paid terms as the homepage
FAQ, now on step 1, under "Who referred you?", and on the confirmation
card. No new reviews or testimonials.

**JSON-LD.** booking.html had none. Added Service + ReserveAction
(provider HomeAndConstructionBusiness, St. George 84790, no street
address) and BreadcrumbList. No AggregateRating on this page.

New tests: `tests/design/booking-conversion.test.js`, plus updates to
`tests/booking/next-steps-timeline.test.js` and
`tests/referrals/referral-program.test.js`.

## What changed, 2026-09-17 -- public-site + portal UX glitch fixes

Focused glitch pass from the UX study. One PR. Did **not** change
`aggregateRating` / `reviewCount` (already 5.0 / 7 on `main` via #281),
Google Business Profile, or any `/tools/` redesign.

**Footer Hours.** The homepage footer Contact column now publishes the
same hours already on the `#contact` strip, in JSON-LD, and in
`business-hours.js`: Mon–Fri 2:00 PM–10:00 PM, Saturday 7:00 AM–10:00 PM,
Sunday 2:00 PM–8:00 PM. CMS per-day keys still override every
`.js-hours-*` node (querySelectorAll, not just the first).

**Dead `#` links.** Homepage FAQ (desktop, mobile, footer) points at
`#faq`, which already opens the FAQ modal. Footer Terms points at the
existing `/terms.html` page (the click handler still opens the modal
when JS runs). Cookie Preferences on every public footer that had the
banner link now points at `/privacy.html#cookies` and still reopens the
banner when JS is available.

**Portal Send Request.** `body.portal-page` padding under the fixed tab
bar is 96px (was 72px, flush with the bar). Standalone/PWA mode no
longer drops that padding to only the home-indicator inset. A spacer
sits under Request Work's Send Request button so it stays fully
tappable.

**Booking date row.** Thin themed scrollbar on the horizontal day
picker (`booking.html` and the portal Request Work picker).

New tests: `tests/design/ux-glitch-fixes.test.js`.

## What changed, 2026-09-17 -- GitHub Watcher standing ops checklist

Docs-only. Added `docs/github-watcher-ops.md` for the Repo Management /
GitHub Watcher lane: keep work landing on `main` (production GitHub
Pages), squash-merge when `test.yml` is green, honor the hub
escalation gate, keep AggregateRating at 5.0/4, never inflate
reviews. Linked from `docs/README.md` and `docs/hub-governance.md`.
Corrected `tripleh-features` to squash instead of merge commits.
No site, portal, tools, schema, or CI workflow changes.

## What changed, 2026-09-17 -- tools invoice list reads from the relational table

Ops relational Phase 2, invoices slice A. No public-site HTML, no
auth/RLS changes, and invoice *writes* still go through the
`th_invoices` blob (plus the existing best-effort mirror).

`tools/sync.js` now keeps a shared invoices read cache.
`cachedRelationalInvoices` starts as `null`, not `[]`, so "not loaded
yet" is distinct from a genuine empty list. `getInvoicesForRead()`
uses the cache once a fetch succeeds and falls back to `th_invoices`
while the cache is still null. A failed fetch does not store `[]`.
A local blob write, or a `workspace_sync` pull of `th_invoices`,
invalidates the cache so the list does not hide the write behind
stale relational rows.

Wired into the two invoice list surfaces:

- Workspace Income list (`workspace.html`) -- after `initSyncOnLoad()`,
  then again when the relational fetch returns, and live via
  `startInvoicesRealtime()`. `togglePaid()` still read-modify-writes
  the blob (the relational fetch has no `line_items`).
- Invoice Generator Recent tab (`invoice-generator.html`) -- same
  refresh-after-sync and realtime. `saveInvoiceLog()` still writes
  `th_invoices`.

`finance.html` and `runway-dashboard.html` are unchanged in this
slice. `invoices` is added to the `supabase_realtime` publication
(`sql/infra/add_invoices_to_realtime_phase2.sql`), same pattern as
`jobs`.

**How to verify in the tools UI**

1. Open Workspace, wait for live sync, and confirm the Income list
   still shows existing invoices (including after a pull-to-refresh).
2. Open Invoice Generator → Recent and confirm the same invoices
   appear after the page finishes its initial sync.
3. On a second signed-in device (or a second browser profile), create
   or mark an invoice paid. The first device's list should update
   without a manual reload.
4. Turn the network off, reload Invoice Generator → Recent: the list
   should still paint from the local blob, not go blank.

New tests: `tests/sync/relational-invoices-read-phase2.test.js`.

## What changed, 2026-09-17 -- homepage conversion pop

A focused public-site pass for trust, clarity, and the review flywheel.
No redesign, no new frameworks, no Supabase/Edge changes. Public
`aggregateRating` stays the live GBP match from #281: **5.0 / 7**.
The homepage wall still shows the 4 written, verified quote cards.
No invented Review objects.

**Leave a Google review.** The homepage reviews wall now has an orange
Leave a Google review button. Hero and `#schedule` proof lines, plus
city/service/about/our-work local-reviews sections, link to the same
real GBP write URL already used by `tools/review-request.html`
(`https://g.page/r/CVJ0Qr-SsDkgEAI/review`). No new quotes.

**$25 referral.** The homepage credit was FAQ-only. It now sits on the
trust rail and schedule rail. `booking.html` already carries the same
complete-and-paid terms from #278 (`.referral-nudge`, `.field-hint`,
`.conf-referral`); this pass kept those surfaces.

**Above the fold.** H1 stays "HANDYMAN AND APPLIANCE REPAIR, DONE
RIGHT." The lede is shorter. Schedule remains the filled orange
primary; Call stays outline. The teardown shop-drawing moved below the
real before/after photos so Services is next after trust. Reviews sit
above the blog teaser. Process and photos stay.

**Polish.** Tighter stats/trust spacing (`.trust` is `32px 0 40px`
with `border-top:none` so it does not double the stats-bar edge),
orange CTA hierarchy on the new review ask, 44px leave-review tap
target. Hero proof and referral lines still hide at 760px so they do
not sit behind the sticky Call+Book bar.

New tests: `tests/design/homepage-conversion-pop.test.js`.

## What changed, 2026-09-17 -- homepage hero logo above the CTAs

Connor asked for the large Triple H hex logo at the top of the
homepage hero -- above Schedule / Call -- instead of under the
buttons and hours on a phone. The small header nav logo is unchanged.

**Before.** On viewports ≤860px the crest sat last in the stacked
hero (after H1, lede, Schedule, Call, proof, referral, motto, and
hours). That was a conversion-visuals choice: a 250px `order:-1`
badge had buried the first screen, so the mark was cut to 96px and
left in source order.

**After.** The same 96px crest is first in that stacked hero, then
headline, CTAs, and supporting copy/hours. Desktop stays two-column
(copy left, ~440px mark right); a global `order:-1` would swap those
columns, so the reorder is only inside the 860px media query.

Did not restyle the brand mark, did not touch sticky Call+Book, and
did not change AggregateRating (5.0 / 7).

## What changed, 2026-09-17 -- tools fewer clicks: Mark paid, Mark Done, daily strip

Internal `/tools/` only. Same capabilities, fewer taps. No public-site,
portal, auth, sync, RLS, or AggregateRating changes.

**Mark paid.** Dashboard overdue rows (Money Owed) and Action Items
income rows now say **Mark paid**. Confirm, and the existing
`togglePaid()` path records the remaining balance as paid in full --
the same localStorage + `scheduleSync` + relational mirror + referral
earned write as before. The amount `prompt()` is gone. No payment
method field (nothing else on /tools/ required one for a manual
mark-paid).

**Mark Done.** Job Tracker cards and the desktop table have an inline
**Done** button that calls the existing `setJobStatus(id, 'done')`.
No extra hours/notes prompt; that path never collected them. Swipe,
long-press, bulk Mark Done, and the status dropdown still work.

**Daily strip.** New job (`/tools/job-tracker.html#add-job`, now opens
the add form), Create invoice, Find client (expands the dashboard
search), and Today's schedule sit above the Tools tile grid. The grid
itself is unchanged -- every tile href is still there -- but starts
collapsed under **More tools**.

### Click paths

**Mark paid, before:** Action Items → Income row labeled Overdue/Unpaid
→ amount prompt → OK. **After:** Overdue row or Income row → Mark paid
→ confirm.

**Mark Done, before (desktop):** Job Tracker → Edit → status dropdown
→ Done → Update. **After:** Job Tracker row → Done.

New tests: `tests/tools/workspace-quick-actions.test.js`.

## What changed, 2026-09-18 -- washer / appliance repair in St. George (service × city template)

First combined service + city landing page, at
`/services/washer-dryer-repair-st-george-ut.html`. City pages
(`handyman-st-george-ut.html`) and the appliance service page
(`washer-dryer-repair.html`) already existed separately. This one
targets "washer repair St. George" as a converting page, not a thin
duplicate of either parent.

**On the page.** Service + location + outcome H1, sticky Call + Book,
visible "5.0 from 7 Google reviews" (GBP-matched; the washer quote is
a real on-site review), Steven owner-operated trust, a 3-step process,
St. George / Washington County coverage, and FAQs for repair vs
replace, trip fee, same-day, and warranty. Links into `/booking.html`,
the parent service and city pages, Hurricane / Washington City, and
the matching blog posts.

**Schema.** Service + FAQPage + BreadcrumbList. No AggregateRating --
same rule as other city/service pages (rating markup stays on
`index.html`, which has the full wall). If a clone adds it, it must
stay 5.0 / 7.

**How to clone.** `docs/service-city-landing-pages.md`.

New tests: `tests/seo/service-city-landing-page.test.js`.

## What changed, 2026-09-18 -- homepage above-fold estimate form

Public homepage only. Schedule stays the filled orange primary; Call
stays the outline secondary. A compact form now sits under those
buttons so a visitor can send details without opening `booking.html`
or the mid-page email modal. The form's own **Send details** button
is outline too, so it does not compete with Schedule on a phone.

**Fields.** Name, phone, and service are required. Brief details and
email are optional. Same service list as `#scheduleForm`.

**Where it goes.** Both this form and the existing `#scheduleForm`
modal post to `th_leads` through one shared `submitLeadFromForm`
(honeypot, `client_request_id` idempotency, UTM merge,
`lead_form_submitted`). Hidden source is `Homepage estimate form`.
Did not use `th_bookings` (that holds a calendar slot) or the signed-in
portal Request Work path.

**Placement.** After Schedule/Call, still in the hero. No CSS `order`
on the form — the 96px hex mark stays above those buttons on a phone.
Text us reuses the chat bubble's `sms:` link. Sticky Call+Book stays.
AggregateRating stays **5.0 / 7**.

New tests: `tests/design/homepage-hero-lead-form.test.js`.

## What changed, 2026-09-18 -- conversion polish: sticky Text + high-intent FAQ

Public homepage and the washer St. George landing page only. One
focused follow-up to the estimate form (#285) and that landing page
(#286).

**Sticky bar.** Those two pages now keep Call + Text + Book on the
existing `.sticky-call` strip (760px, 44px targets, cookie/chat lift
unchanged). Call and Text are outline thumb actions; Book stays the
filled orange. Text reuses the chat bubble's `sms:+14354141667?body=...`
href. `booking.html` and the other marketing pages stay Call + Book.

**High-intent FAQ.** A compact five-question block sits after the
homepage estimate form, still in the hero, with no CSS `order` — the
96px hex mark stays above Schedule/Call on a phone. Answers are the
existing FAQ copy: trip fee ($25 beyond 15 miles), same-day for things
that can't wait, work guaranteed / manufacturer parts warranty, repair
vs replace (from the washer LP), and payment methods. "See all FAQs"
opens the live-fetched modal. No second FAQPage schema.

AggregateRating stays **5.0 / 7**. The wall stays 4 written quotes.

New tests: `tests/design/conversion-polish-sticky-sms-faq.test.js`.

## What changed, 2026-09-18 -- refrigerator and dishwasher repair in St. George

Two more service × city pages, cloned from
`washer-dryer-repair-st-george-ut.html`. Dryer-only St. George was
skipped: that template already covers washer and dryer. Unique
appliance niches:

- `/services/refrigerator-repair-st-george-ut.html`
- `/services/dishwasher-repair-st-george-ut.html`

Same converting layout as the washer page: H1 names the service and
city, sticky Call + Book (Text stays on the homepage and washer LP
from #288), visible "5.0 from 7 Google reviews" (GBP-matched; hero
proof uses the verified appliances quote, not a made-up
fridge/dishwasher review), 3-step process, St. George / Washington
County copy, and FAQs for repair vs replace, trip fee, same-day, and
warranty. Service JSON-LD has no AggregateRating.

Inbound links from `washer-dryer-repair.html` (What We Fix cards plus
a line next to `.areas-links`) and from the St. George city page
appliance card. Sibling links between the three St. George appliance
pages. `sitemap.xml` and the landing-page test lists include both
paths.

New tests: extended `tests/seo/service-city-landing-page.test.js`.

## What changed, 2026-09-20 -- unique account codes for the referral promo

Requested directly: referral attribution was a free-text "Who
referred you?" field, matched by staff after the fact against a
typed name that can be misspelled or ambiguous. "Unique IDs
connected to accounts" fixes that, and doubles as a general
per-account tracking ID, not just a referral code.

New table `client_account_codes` (`sql/infra/create_client_account_codes.sql`),
keyed by **email**, not the Client Registry's local `client_id`: a
portal account is also identified by email, so a code generated
before someone ever has a portal login still connects automatically
the moment they get one.

- `send-invite` generates a code automatically the moment a portal
  account is genuinely created for the first time (never on a
  resend of an existing invite, which doesn't create a new account).
- A new public edge function, `resolve-referral-code`, turns a
  `?ref=CODE` link into the referrer's real name, without ever
  exposing the underlying table (no anon policy exists on it at
  all). `booking.html` and the homepage's estimate form both resolve
  `?ref=` as a code first, falling back to the old literal-name
  behavior if it doesn't resolve -- so any link distributed before
  this shipped still works.
- Staff can generate a link for any client with an email on file
  from `tools/client-detail.html`'s new "Get referral link" button
  -- the manual path for a referral from someone who isn't (yet, or
  ever) a portal user.
- Once a portal account exists, the client sees and can copy their
  own link from a new "Refer a Friend" panel in `portal/settings.html`,
  read via RLS (a client can SELECT only their own row).

Verified live in Supabase (test row inserted, queried, deleted) that
the exact query `resolve-referral-code` runs resolves correctly.
Could not curl the deployed function itself end-to-end from this
sandbox -- outbound access to `supabase.co` is blocked by the agent
proxy here, so that specific HTTP round trip is unverified from this
session; the DB-side logic it depends on is confirmed correct.

New tests: `tests/referrals/account-codes.test.js`.

## What changed, 2026-09-20 -- duplicate meta descriptions, a stale-date test time bomb, and a merged RLS policy

Follow-up audit pass: fixed 9 landing pages sharing 2 duplicate
closing sentences in their `<meta name="description">` (and matching
`og:description`/`twitter:description`, flagged separately by a
bot's own PR summary -- worth reading those, not just the recurring
boilerplate). Also caught and fixed a real regression in
`manage-booking.html`'s own test suite: a hardcoded date used as "a
date in the past" had itself become "tomorrow" as real time passed,
silently flipping 6 tests' meaning without touching their assertions
-- fixed by computing the date relative to `Date.now()` instead of a
fixed string.

Separately, ran Supabase's own advisor against the live project and
found a real `multiple_permissive_policies` performance finding on
`client_account_codes` (added the day before): two SELECT policies
both matching `role=authenticated` were being evaluated on every
query. Merged into one policy
(`sql/infra/merge_client_account_codes_select_policies.sql`), plus
split the old catch-all staff policy into three single-action
policies (Postgres has no "FOR ALL except SELECT" shorthand).

## What changed, 2026-09-21 -- booking.html audit, referral-code refinements, and a cron auth incident

**booking.html audit** (no specific bug reported -- a fresh pass):
`selectDate()` had no guard against overlapping async calls, so
rapidly switching dates could let a stale response silently win --
fixed with a request-id guard. Also: focus never moved between
wizard steps for screen-reader users, selection state wasn't exposed
via `aria-pressed`, status/slot updates weren't in an `aria-live`
region, the post-booking "you'll get a confirmation email" promise
was unconditional even though email is optional, and name/email/
address were sent untrimmed despite already having trimmed values on
hand for validation. All fixed; new test file
`tests/booking/booking-a11y-and-race-fix.test.js`.

**Referral-code refinements** (direct follow-up on the 2026-09-20
system): three real gaps closed. (1) A portal account invited
*before* the referral-code feature shipped had no way to ever get a
code -- new edge function `ensure-my-referral-code` creates one on
the spot if missing, called by `portal/settings.html` on load. (2)
Codes were captured on bookings/leads but nothing ever showed how
many times a code had actually been used -- both the portal panel
and `tools/client-detail.html` now surface a live usage count. (3)
Sharing only offered a raw link to copy -- added `sms:` share links
in both places (generic in the portal, addressed to the client's own
phone in client-detail.html).

**Cron service-role-key incident**, found from a screenshot of Dev
Tools' Cron Health panel: `send-payment-reminder` and
`send-quote-followup` had been silently 401ing on *every* scheduled
run since 2026-09-16 -- meaning every automated overdue-invoice
reminder and quote-followup email this project ever claimed to send
had, in reality, never gone out to a client. Root cause: the vault
secret every `net.http_post` cron job authenticates with
(`send_push_service_role_key`, saved 2026-08-14) had gone stale after
this Supabase project migrated to the newer `sb_secret_...` key
format -- confirmed live via a diagnostic Edge Function that compared
the vault value against the live env var without ever printing
either secret, then fixed the same way. Only these two functions
noticed, since they're the only cron-driven functions doing a strict
`token !== SERVICE_ROLE_KEY` check rather than relying solely on
Supabase's platform `verify_jwt` (signature-only, doesn't check
role) -- every other `net.http_post` caller kept accepting the stale
but still validly-signed key. See `DISASTER_RECOVERY.md` Scenario 20
and `sql/infra/resync_cron_service_role_key.sql` (a permanent,
secret-safe maintenance function for if this recurs after a future
key-format change).

## What changed, 2026-09-21 -- Workspace tools: lazy-loading fix, sidebar icon fix, global search, and a persistent app shell

Four related changes, direct request to make the Workspace tool suite
"easier to use / more app-like" -- covered in full detail in
`docs/specialist-logs/features.md`, summarized here:

**Lazy-loading dashboard drawers, actually implemented.** Cursor's PR
described this feature (`workspace-lazy-sections.test.js`, 83 tests)
but never wrote the real code into `workspace.html` -- only a cache-
bust bump had landed, so 4 tests were failing silently. Cherry-picked
the real implementation (`dashSectionClosed`/`renderOpenedSection`/
`refreshGalleryChip`, plus matching `styles-tools.css` polish) from an
unmerged sibling branch, but not merged wholesale -- that branch
predated the `/services/`/`/locations/` folder move and would have
reverted it.

**Runway Dashboard's sidebar icons were invisible.** That page keeps
its own copy of the shared sidebar/icon CSS instead of loading
`styles-tools.css`, and that copy was missing the base `.th-icon`
rule (`fill: none; stroke: currentColor; ...`). Icons built from
stroke-drawn paths (wrench, calendar, receipt, scroll, book,
terminal, the home roofline) fell back to SVG's default
`fill: black`, rendering as solid near-black shapes invisible against
the dark hex background -- icons with an inline `fill` (the `$`
glyphs, the filled star) were unaffected, which is why it looked like
scattered breakage rather than everything being blank. Reproduced and
verified with a real Playwright render before and after the fix, not
just from the reported screenshot.

**A global command palette** (`tools/tools-command-palette.js`),
Cmd/Ctrl+K from any tool page -- searches jobs, contacts, invoices,
quotes, and contracts (the same data `workspace.html`'s own "Find a
client" box already searched, now available everywhere). A "Search
⌘K" row in the desktop sidebar; a floating button on mobile/tablet,
deliberately hidden ≥1024px since it would otherwise render
underneath the fixed sidebar there and be unclickable -- caught via a
real browser render before shipping.

**A persistent app shell**, via cross-document view transitions
(`@view-transition { navigation: auto; }`) -- the same fix already
proven in `portal/*.html` for the identical "flash between pages"
complaint, applied to all 19 real tool pages. `tools-nav-pwa.js`
injects byte-identical sidebar/bottom-nav markup on every page, so
giving those elements a shared `view-transition-name` in
`styles-tools.css` (and `runway-dashboard.html`'s own copy) makes the
shell itself read as staying in place instead of crossfading.
Deliberately *not* a real SPA rewrite (no persisted DOM, no client
router, no per-page script teardown) -- every page still does a real
navigation, so back/forward, deep-linking, and each page's own init
logic are completely unaffected by construction. Weighed against a
true SPA content-swap first and rejected it: all 19 pages assume full
unload for cleanup (Supabase realtime channels, timers, global
state), none have teardown logic, and writing/verifying that for 19
pages of live invoicing/job-tracking tooling with no existing test
coverage on this interaction pattern was judged not worth the risk
for the same visual outcome a native browser feature already
delivers as pure progressive enhancement (unsupported browsers just
keep today's exact hard-cut navigation).

New tests: `tests/tools/app-shell-view-transitions.test.js`. All four
changes verified: full suite (2597/2597), `check-consistency`,
`check-undefined-vars`, `lint`, `check-links.py`.

## What changed, 2026-09-21 -- Two Supabase security fixes from an external audit

Full detail in `docs/specialist-logs/security.md`, summarized here:

**`resync_cron_service_role_key(text)` was still callable by the public
anon key**, despite an earlier fix that revoked access from `public` --
Supabase grants `anon`/`authenticated` their own separate EXECUTE
privilege at function-creation time, so that revoke never actually
covered them. Fixed with an explicit revoke from `anon`/`authenticated`
(`sql/security/revoke_public_execute_on_internal_only_functions.sql`);
this was the real risk, since anyone holding the site's own public anon
key could have overwritten the Vault secret every cron reminder email
authenticates with. Also tightened `guard_last_role_manager_permission()`
and 6 `notify_*` trigger functions the same audit flagged, though those
were confirmed never actually callable outside a real trigger fire.

**The `job-photos` Storage bucket's policies only checked the bucket
name, not who was asking** -- any signed-in account, client portal
logins included, could call Storage directly for any job's photos.
Restricted to internal accounts only
(`sql/security/restrict_job_photos_bucket_to_internal_accounts.sql`);
confirmed no client-portal code path ever used direct Storage access in
the first place, so this closes the gap with no effect on real usage.

Both re-verified against a fresh Supabase security advisor run
afterward -- both findings are gone. Everything else the advisor still
lists is already-reviewed, intentional public access.

## What changed, 2026-09-21 -- Live FAQ now groups by category

The homepage FAQ's static fallback markup has always shown 4 categories
(Pricing & Payment, Scheduling & Availability, Service Area & Coverage,
Policies), but the live `site_faq` Supabase fetch that replaces it once
loaded always flattened everything into one list -- the categories only
existed in the brief pre-fetch flash. Added a `category` column to
`site_faq`, backfilled all 15 live rows to match their existing static
grouping, and updated the fetch to group by category (ordered by first
appearance in `sort_order`, no new ordering column needed). The FAQ
editor in `tools/site-content.html` now has a Category field too, so
future edits through the CMS stay grouped. Full detail in
`docs/specialist-logs/features.md`.

## What changed, 2026-09-21 -- Client portal no longer flashes blank on first load

`dashboard.html`/`quotes.html`/`home.html` already baked a static
skeleton-card placeholder into their list containers, but
`jobs.html`, `work-orders.html`, and `contracts.html` didn't -- their
loading skeleton only appeared after the async sign-in check finished,
so those 3 pages showed genuinely empty content until then. Added the
same static skeleton markup to all 3. `settings.html` was also checked
and found to already have skeletons on every dynamic panel -- no real
gap there. Full detail in `docs/specialist-logs/features.md`.
## What changed, 2026-09-22 -- Workspace IA round 4: a 24-step tutorial, a launcher in the search box, tab deep links everywhere

Owner's brief: "look for any last-minute improvements you can make, as
big as you want, make it super easy to use, then update the tutorial to
teach where everything is and how to use it." Full reasoning in
`docs/specialist-logs/features.md`.

**The tutorial (app tour) is a real tutorial now.** 14 one-per-page
stops became **24 steps** that walk the app in the bottom bar's order:
six on the Dashboard (Today, Needs attention, the six actions, Business,
then **Getting around** -- which points at the phone bar *or* the
desktop sidebar, whichever is on screen -- and **Search anywhere**),
then one step per tab on Jobs, Invoices, and Finance, and one each for
the More-sheet pages. A tab step switches to that tab first
(`onShow`), so the thing being described is the thing on screen; the
card shows "7 / 24"; the copy says what you do there, not what the page
contains. Walking all 24 steps in a real browser at phone and desktop
widths surfaced two real bugs, both fixed: on the Runway Dashboard the
phone bottom bar covered the tour card's Next button (its copied tour
CSS never had the bottom-nav offset), and on Settings the highlighted
button could scroll back off screen when late-rendering sections
pushed it down (the tour now re-checks and scrolls again).

**The search box is also the launcher.** Ctrl+K / the round search
button now lists every place you can go and everything you can start
before you type -- New job, Calendar, Contacts, Create invoice, New
quote, Quick charge, Log expense, Log income, Profitability, Plan a
route, New contract, Send review request, Look up a part, Runway,
Settings, Replay the tour -- and typing filters them ("expen" -> Log
expense) ahead of the usual record matches. Gated ones follow the same
permission checks the nav uses.

**Every tab is a link.** `invoice-generator.html#invoice|#quote|#pos|
#recent`, `finance.html#cost|#profitability|#income|#expenses|
#inventory`, `job-tracker.html#jobs|#contacts|#notes|#calendar|#add-job`
open that tab on load *and* on a same-document hash change, which is
what lets the launcher and the tutorial point at exact spots. Finance
now reopens on the tab you used last (hash > memory > Cost Lookup),
like Jobs and Runway.

**Six daily actions on the Dashboard.** Quick charge and Log expense
joined New job / Create invoice / Find client / Calendar; three per row
on a phone, so the strip is no taller than the old 2x2. The Dashboard
help and the Settings tour blurb describe the new pieces.

Verified: suite green, `check-consistency` (whose tour health check now
resolves comma-separated selectors and classes injected by the nav /
search scripts), `check-undefined-vars`, `lint`; real Chromium at
390x844 and 1440x900 (23/23): the full 24-step walk at both widths with
every highlighted element on screen, Ctrl+K -> "expen" -> Enter landing
on Finance/Expenses, tab memory, same-document hash changes on Finance,
Invoices, and Jobs, and the phone strip at two rows.

## What changed, 2026-09-22 -- Workspace IA round 3: search-first Appliance Wiki, Runway remembers its tab, login return paths

Closes the last items the two IA passes below left open ("finish it in
one big pass"). Small, but each one removes a repeated tap.

- **Appliance Wiki opens ready to type.** The search box is now the
  first thing on the page and takes focus on load (except when a
  `?search=` deep link already filled it, or the app tour is running);
  pinned / recent chips sit directly under it. The pre-loaded-links
  disclaimer that used to occupy the top of the page moved into the
  help modal.
- **Runway Dashboard remembers its tab** per device (`th_runway_tab`),
  and honors a `#personal` / `#business` / `#networth` / `#runway` hash,
  the same way Job Tracker remembers List / Board / Calendar. Splitting
  its four tabs into separate pages -- the other option on the old
  list -- was declined: it would add pages the day after two were
  removed, and the page is deliberately self-contained.
- **Login return paths** now include `clients.html` and `pos.html`, so
  a logged-out visit to either lands back on it after signing in
  instead of on the dashboard.

## What changed, 2026-09-21 -- Workspace IA round 2: POS folded into Invoices, tablets get the nav bar, one less header button

Follow-up to the IA pass directly above, on the owner's instruction
"do the pos merge and whatever else you think is good, we want maximum
efficiency." Three changes, each finished end to end; the two items
the previous entry left "for later" are both closed here.

**1. POS is the Quick charge tab inside the Invoice Generator.**
`pos.html` was a whole page, nav destination, and tour stop for one
form (email, amount, description, charge) that shares its permission
(`can_manage_invoices`) and its purpose -- getting paid for a job --
with the invoice page. The form, its CSS, and its script moved into
`invoice-generator.html` verbatim as a fourth tab: **Invoice | Quote /
Estimate | Quick charge | Recent Invoices**, deep-linkable as `#pos`
(the email field is focused on arrival, the way New job focuses its
title). A Quick charge is still explicitly *not* an invoice: no line
items, no due date, no portal record -- one card charge plus the Income
entry `create-pos-charge`'s webhook already logs. The one real cost the
earlier entry flagged -- putting Stripe.js on the invoice page -- is
avoided: `js.stripe.com/v3/` is injected only when someone actually
enters a *new* card (charging a saved card is a plain server call), so
the Invoice and Quote tabs load nothing extra; the page's CSP allows
Stripe's script, iframe, and API. `pos.html` is a redirect stub to
`invoice-generator.html#pos`; POS left the sidebar / More sheet and the
tour (the Invoices step mentions Quick charge instead).

**2. Tablets get navigation.** The bottom bar stopped at 720px and the
sidebar starts at 1024px, so an iPad or a half-screen desktop window had
*no* navigation on any tool page -- the only way out was the browser's
back button (a gap `docs/ARCHITECTURE-NOTES.md` had recorded). The bar,
its More sheet, and the body padding that clears it now run to 1023px,
so the two navs are complementary and exactly one is on screen at every
width; in the 721-1023px band the five items cluster at the centre and
the More sheet is a centred card instead of a full-bleed drawer. Mirrored
in `runway-dashboard.html`'s own copy of the nav CSS, as that page
requires. A new test (`tests/design/tablet-nav-band.test.js`) parses the
breakpoints out of both files and asserts bar-max + 1 == sidebar-min.

**3. One less header button.** With Home always one tap away in the bar
or the sidebar, the header's back-to-Workspace arrow on eleven pages
(and Runway's text "Back to Workspace" link) was a third copy of the
same link. One shared rule hides it wherever the nav shell is present;
the markup stays, so a page that ever loads without the shell keeps its
way home, and real "up one level" arrows (Job Detail -> Job Tracker,
Site Content -> Dev Tools) are untouched.

### Before / after

| | Before | After |
|---|---|---|
| Real tool pages | 18 | 17 (`pos.html` is a stub) |
| Sidebar / More destinations | 13 | 12 |
| Tour steps | 15 | 14 |
| Widths with no navigation | 721-1023px on every page | none |
| Header buttons on a tool page (phone) | help + back-arrow | help |
| Charging a saved card, from the dashboard (phone) | More -> POS -> email -> Charge (4 taps, page load) | Invoices -> Quick charge -> email -> Charge (4 taps, page load) or 3 via the `#pos` link |
| Stripe.js on the invoice page | never loaded (separate page) | loaded only when a new card is entered |

Verified in a real headless Chromium (served over local HTTP, not
`file://`) at 390x844, 820x1180, and 1440x900 with a fake Supabase and a
mocked `create-pos-charge`: the `#pos` deep link and the `pos.html`
redirect, the saved-card path (check -> one-tap Charge -> success card
with the amount), the new-card path (authorization box before the card
button, name required, Stripe.js tag injected only at that moment, card
element mounted, confirm -> success), the blocked-Stripe.js error path
re-enabling the button, tablets showing the bar and a centred More sheet
on Job Tracker, Runway, and Invoices with no sidebar, desktop showing
the sidebar with no bar, the arrow hidden at every width, and Job
Detail's real back arrow still visible. Full suite 2631/2631,
`check-consistency`, `check-undefined-vars`, `lint`, `check-links.py`,
and `check-visual-snapshot` all clean.

## What changed, 2026-09-21 -- Workspace IA: a Today-first dashboard, Calendar folded into Job Tracker

Direct request: the tool suite "feels like a lot -- too many pages,
too much chrome, too many clicks." Diagnosed as an information-
architecture problem, not paint, and fixed as two changes done fully
rather than six done partly. Full reasoning in
`docs/specialist-logs/features.md`; summarized here.

**1. The dashboard is a Today screen, not a filing cabinet.**
`workspace.html` used to open on a 170px greeting card, a chip row
duplicating the section headings right below it, seven collapsed
drawers, and a 13-tile Tools grid that repeated the sidebar / bottom
bar a third time -- five navigation layers on one page, with the ops
inbox (leads, bookings, requests, unpaid invoices) hidden behind a
count badge. Now:

- The greeting is one band. Next Job starts inside the first phone
  screen; so does the first **Mark paid** button.
- **Route today** on the Next Job card: one Google Maps directions link
  through every address on today's active jobs (same URL shape Route
  Planner builds, de-duplicated, capped at Google's 10 stops).
- **Money Owed** lists every unpaid invoice, overdue first with
  "N days overdue", current ones with "Due in N days", each with
  two-tap Mark paid. Six shown, the inbox has the rest.
- **Needs attention** (was Action Items) sits directly under the daily
  actions, open by default. Empty respond-lane groups hide themselves;
  one "Nothing waiting on a response" line stands in when all four are
  empty. The Income lane leads with unpaid invoices and folds paid /
  received history under one summary line.
- The chip row and the Tools grid are gone (the sidebar and bottom bar
  + More already list every destination, and `tools-nav-pwa.js` hides
  the gated ones). Business Snapshot, Analytics, Compliance &
  Documents, and Gallery Queue sit under one **Business** label,
  collapsed. Backup & Restore moved to Settings as real buttons; the
  old `#backup` link redirects there.
- Daily strip: New job / Create invoice / Find client / **Calendar**
  ("Today's schedule" pointed at the hero directly above it).

**2. Calendar is a Job Tracker view, not a page.** `calendar.html` was
a second page over the same `th_tracker_jobs` data, and it filtered on
a per-job "Show on Calendar" checkbox -- so it disagreed with the
dashboard's own Today hero (which never applied the flag) and hid
work by default. Job Tracker's Board/List toggle is now a three-way
**List / Board / Calendar** switch, persisted in the same
`th_tracker_view` key; the Calendar shows every dated job (done jobs
gray, unconverted bookings purple), honors the same search box,
keeps swipe-to-change-month, day detail, and Add to Phone (`.ics`).
The merged view reads the same local job list as the views beside
it -- one page, one source -- so the relational-read pilot that page
carried (`fetchJobsFromRelational`) stays in `sync.js` for Route
Planner and is documented as superseded in `CONTINUE-HERE.md`. The
checkbox and card toggle are retired; new jobs still write
`showOnCalendar: true` so the relational mirror stays consistent.
`calendar.html` is a redirect stub to `job-tracker.html#calendar`
(same pattern as `job-cost-lookup.html`), the PWA "Calendar"
shortcut and the tour follow it, and the bottom bar is now
**Home / Jobs / Clients / Invoices / Finance / More** -- Clients took
the slot (client history is a daily lookup and was buried in More).

### Before / after

| | Before | After |
|---|---|---|
| Real tool pages | 19 | 18 (`calendar.html` is a stub) |
| Sidebar / More destinations | 14 | 13 |
| Navigation layers on the dashboard | 5 (bar/sidebar, chip row, strip, tile grid, "Today's schedule" chip) | 2 (bar/sidebar, strip) |
| Dashboard drawers | 7 collapsed | 1 open inbox + 4 collapsed under Business |
| First phone screen (390x844) | header, search, greeting card, Next Job; Money Owed and its Mark paid below the fold | Next Job with Route today, Money Owed with the first Mark paid, all in the first screen |

### Click paths (from the dashboard, phone)

- **Mark a current (not yet overdue) invoice paid:** Action Items chip
  -> tap heading to expand -> scroll to Income -> Mark paid -> confirm
  (4 taps) -> Mark paid -> confirm (2 taps). Overdue ones were already
  2 taps; unchanged.
- **Open today's route in Google Maps:** More -> Route Planner -> Pull
  Today's Jobs -> Open Full Route (4 taps, one page load) -> Route
  today (1 tap).
- **See what needs a response:** chip -> expand heading (2 taps) ->
  0 taps; it is open.
- **Look up a client:** Find client / search box at the top (unchanged),
  and Clients is now 1 tap in the bar instead of More -> Clients (2).
- **Download a backup:** Settings -> Go to Backup -> (Dashboard opens,
  drawer expands) -> Download (3 taps, two pages) -> Settings ->
  Download backup (2 taps, one page).
- **Log a job:** New job -> form open, title focused (unchanged).
- **Open the calendar:** 1 tap from the dashboard strip (was 1 tap from
  the bar); from any other page, Jobs then the Calendar button (2 taps,
  remembered per device so it is 1 after that).

Verified in a real headless Chromium at 390x844 and 1440x900 (served
over local HTTP, not `file://`): the first-screen contents above, the
two-tap Mark paid from the hero (invoice recorded paid, card
re-rendered), the Route today URL, New job landing with the form open
and the title focused, the Calendar deep link, the `calendar.html`
redirect, the More sheet's eight destinations, Settings' backup
buttons, and every other tool page loading with the same nav and no
console errors. Full suite 2615/2615, `check-consistency`,
`check-undefined-vars`, `lint`, `check-links.py`, and
`check-visual-snapshot` all clean. New tests:
`tests/tools/dashboard-today-first.test.js`,
`tests/tools/job-tracker-calendar-view.test.js`.

Deliberately not done in this pass, noted for later: merging POS into
the Invoice page (same permission, plausible tab, but adds Stripe.js to
the invoice page's CSP -- a separate decision), and the 721-1023px
tablet band that shows neither the bottom bar nor the sidebar
(pre-existing; the 720px breakpoint is asserted by several tests).
Both were done the same day in round 2 -- see the entry above.

## What changed, 2026-09-22 -- "Resend invoice" was silently sending nothing; quotes now have the same Resend that invoices do

The Resend button on `tools/clients.html`'s Portal invoices panel
always reported "Sent!", but for a genuine resend of an
already-synced invoice it was actually sending no email at all -- it
called `sync-invoice-to-portal`, whose notification trigger only fires
for a genuinely new invoice, and the button never checked whether an
email had actually gone out, only whether the (harmless, no-op)
database upsert succeeded. Fixed by calling `send-invoice-notification`
directly instead. Also added the equivalent for quotes, which had no
resend option at all: a new "Portal quotes" panel with the same
search + list + Resend shape as invoices. Full detail in
`docs/specialist-logs/features.md`.

## What changed, 2026-09-22 -- a reported bug plus a fresh usability pass across Workspace

A specific report ("the Invoice Type field's text is covered by two
icons") plus a general request to click through the whole suite again
now that four rounds of IA changes had landed. Everything below was
reproduced and re-checked in a real headless Chromium served over local
HTTP (never `file://`), not just read from the source.

**The reported bug.** The "search" and "warning" icons in the
screenshot were not decorations on the Invoice Type field itself --
they were `.th-cmdk-btn` (the search/command-palette launcher) and
`.th-flag-btn` ("flag this page"), two buttons that float at a fixed
distance above the mobile bottom nav on every tool page. That fixed
band sits at the same place on screen regardless of scroll position,
and on any 761-853px-tall phone (iPhone 12/13/14 among them) it lines
up with wherever a short page's first content happens to fall --
`invoice-generator.html`'s "Invoice Details" card is exactly that
height, so the search icon covered the first letters of the field's
value on load. Shrinking the buttons was ruled out (they are already
at this app's own documented 44px minimum touch target, and the real
gap between the field and the nav on that viewport is under 44px, so
no fixed offset can avoid the overlap entirely). Fixed instead in
`tools/tools-nav-pwa.js` (`updateFabTopFade()`): both buttons fade out
only while a scrollable page is still at its very top, and fade back
in the moment it scrolls past 24px -- enough to carry whatever was
covered out of the band, since search and flag are rarely the first
thing needed on a freshly opened page. A page that isn't tall enough to
ever clear the band keeps both buttons visible throughout. Mirrored
into `runway-dashboard.html`'s own copy of this CSS, same as every
prior nav change.

**Usability pass findings, all fixed:**
- `tools/client-detail.html` loads the Supabase JS SDK from
  `cdn.jsdelivr.net` for its realtime subscription, but its CSP never
  got that domain added when every other realtime-using page did back
  on 2026-08-14 -- its own security policy was silently blocking its
  own script, so this page's live updates have never worked. Added
  `https://cdn.jsdelivr.net` to `script-src` and `connect-src`, matching
  the pattern already used everywhere else.
- `tools/job-tracker.html`'s subtitle had no punctuation between the
  "Finance &rarr;" link and the dynamic sync-status text appended right
  after it, so a real sync error read as one run-on sentence: "...are on
  Finance &rarr; Cloud sync issue at 6:49 AM (network: Failed to
  fetch)." Every other page using this same `#syncStatusText` pattern
  ends its static sentence with a period first; this one didn't. Added
  the missing period.
- `tools/parts-reference.html`'s brand cards labeled and counted
  "N appliance types" using the number of individual **models**, not
  distinct types, and listed each model's type name without
  deduplicating -- a real, live example: Admiral (3 washer models) read
  "3 APPLIANCE TYPES: Washer, Washer, Washer," implying three different
  kinds of appliance. Now shows the real distinct-type count and a
  deduplicated list, plus the model count alongside it (nothing lost --
  "1 APPLIANCE TYPE &middot; 3 MODELS: Washer").
- `tools/job-detail.html` and `tools/client-detail.html` hide their
  entire view -- including the header -- until an async record lookup
  resolves, with zero loading indicator in between. On a slow or
  currently-unreachable connection (a real scenario this app is built
  for -- a job site with poor signal) that lookup can take several real
  seconds, during which the page was completely blank: no header, no
  message, nothing. Added a small "Loading job&hellip;" / "Loading
  client&hellip;" element visible from first paint on both pages,
  cleared the moment the lookup resolves either way. This does not
  change when the existing found/not-found views themselves show or
  hide (`tests/sync/detail-pages-realtime.test.js` pins that toggle for
  the live-deletion case) -- it only covers the gap before that
  decision has been made.

**Looked at and deliberately left alone:** several role-gated pages
(`dev-tools.html`, `site-content.html`, and `finance.html`'s tab
content) show the same "blank until the permission check resolves"
gap as the two detail pages above, once the underlying role fetch is
slow. Fixing all of them the same way is a real, worthwhile follow-up,
but it touches seven pages' gating logic rather than two isolated
loading states, which is bigger than a seam-finding pass should take on
in one sitting -- left for a dedicated pass.

Verified in a real headless Chromium at 390x844 and 1440x900: the
Invoice Type field fully visible on load with both floating buttons
faded out, both buttons fading back in after a small scroll on that
same page, both staying visible the whole time on pages short enough
never to scroll past the threshold, desktop unaffected (the flag button
already lived in a free corner there, the search button is already
`display:none` above the sidebar breakpoint), client-detail.html's
Supabase script loading under its corrected CSP, and both detail pages
showing their loading text immediately instead of a blank screen. Full
suite 2642/2642, `check-consistency`, `check-undefined-vars`, `lint`,
and `check-links.py` all clean.

## What changed, 2026-09-22 (later the same day) — a quick PWA/ergonomics pass, not the gesture rework

Explicit scope: "quick PWA and ergonomics wins," not the bigger gesture/
animation pass that's deliberately deferred to a later, separate sitting.
Audited the manifest, safe-area handling, and tap ergonomics against what
was already shipped before touching anything -- most of it turned out
already done well (see the "PWA (installable app icon)" and mobile
touch-target sections of the `tripleh-business` skill, and the extensive
`env(safe-area-inset-*)` coverage already in `styles-tools.css`), so this
pass is genuinely small.

**Checked, found already correct, no change made:**
- `/tools/manifest.json` -- `display: standalone`, `start_url:
  /tools/workspace.html` (the real Today-first dashboard, confirmed
  against the current IA), dark theme colors matching the app
  (`#0a0a0a`), real `icon-192.png`/`icon-512.png`/`apple-touch-icon.png`
  at the correct pixel dimensions (192, 512, 180 -- verified by opening
  each file, not trusting the filename), and 3 app shortcuts with
  correct `/tools/`-prefixed URLs.
- Every tool page's `<head>`: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`,
  `theme-color`, and `viewport-fit=cover` on the viewport meta tag --
  confirmed present and correct on all 23 tool pages, not just a sample.
- Safe-area insets: `.th-bottom-nav`, `.th-flag-btn`, `.th-cmdk-btn`, the
  onboarding tour card, the install banner, the photo lightbox, and every
  sticky header already pad/offset for `env(safe-area-inset-*)` --
  this has clearly been iterated on across several prior sessions and
  needed nothing further.

**Real bug found and fixed: `.small-btn` was rendering at 40px on every
phone, not the 44px the app has documented as its own minimum touch
target since 2026-08-01.** Two rules both target `.small-btn` at phone
widths -- `body .small-btn { min-height: 40px; }` inside the `max-width:
720px` block, and `.small-btn { min-height: 44px; }` inside a separate
`max-width: 760px` block written later. Both apply at any width <=720px,
and `body .small-btn` (specificity 0,1,1) always beats the bare
`.small-btn` (0,1,0) regardless of which one comes later in the file --
so the 40px rule silently won on every real phone, undoing the touch-
target fix. This is the Advance Status / Photos / Delete button on every
Job Tracker job card, so this was a real, live regression, not a
theoretical one. Fixed by matching the value in the higher-specificity
rule (40px -> 44px) rather than trying to out-rank it, which removes the
conflict outright. Confirmed with a real `getBoundingClientRect()`
measurement in headless Chromium at 390x844: 44px, both before and after
adding jobs to the page.

**Two more sub-44px controls fixed while auditing the same class of
issue:** the full-screen job-photo lightbox's close button (38x38 ->
44x44) and its prev/next buttons (42x42 -> 44x44) -- both circular
buttons on a full-viewport overlay with plenty of room to size up with
no layout cost.

**Two "feels like a website, not an app" tells fixed, both pure CSS,
`tools/styles-tools.css` and mirrored into `runway-dashboard.html`'s own
self-contained copy (it doesn't load the shared stylesheet):**
- The browser's default grey tap-highlight flash on every link/button
  press -- every interactive element in this suite already has its own
  `:active`/`:hover` state, so `-webkit-tap-highlight-color: transparent`
  loses no feedback.
- The ~300ms double-tap-to-zoom delay browsers add to tappable elements
  -- `touch-action: manipulation` removes it while leaving real
  pinch-zoom untouched. Deliberately did **not** set `user-scalable=no`
  on the viewport meta tag (already present without it) -- that would
  disable pinch-zoom entirely, which fights WCAG 1.4.4 and is a
  different, unwanted tradeoff from what was asked for.

**One test broken by the first attempt, caught by the suite, fixed
immediately:** the first pass added a standalone `html { ... }` rule for
the tap-highlight fix. `tests/design/desktop-layout.test.js` greps the
file for the *first* `html { ... }` block and asserts it's the ambient
background gradient rule -- the new rule appeared earlier in the file and
was a false match. Fixed by folding `html` into the existing comma-
separated selector list instead of giving it its own rule, which stopped
matching that regex while keeping the same effect.

**Explicitly not touched, per the brief:** gesture navigation, swipe
actions, page transition animations, pull-to-refresh, bottom-sheet
modals -- all deferred, as agreed, to a later dedicated pass.

Verified in a real headless Chromium at 390x844 (served over local HTTP,
never `file://`, with a fake-but-shaped `th_auth_session` in
`localStorage` so the pages render past the login gate): `workspace.html`
(Today dashboard), `job-tracker.html`, and `invoice-generator.html` all
load cleanly, the fixed floating search/flag buttons still fade
correctly at page-top per the fix earlier today, `.small-btn` measures
44px in the DOM, and `-webkit-tap-highlight-color`/`touch-action` read
back correctly on real buttons via `getComputedStyle`. Full suite
2642/2642, `check-consistency`, `check-undefined-vars`, `lint`, and
`check-links.py` all clean.

## What changed, 2026-09-22 (later the same day) -- internal /tools/ accounts get real two-factor authentication

A real, standalone security gap, not part of the IA/UX work earlier
the same day: internal Owner/Developer/Employee accounts
(`account_roles`/`role_definitions`) had zero MFA option, even though
the client portal shipped real TOTP MFA for client-facing accounts on
2026-09-16. Closed with the same proven Supabase Auth TOTP mechanism,
adapted to this app's own conventions rather than copied wholesale.

**What was built:**
- `tools/auth.js` gained raw-`fetch()` MFA helpers (enroll, challenge,
  verify, unenroll, list) against the real Supabase Auth REST
  endpoints -- no `@supabase/supabase-js` load added to `login.html`,
  matching this file's existing no-new-dependency convention (the
  client portal's equivalent flow loads that SDK; internal `/tools/`
  does not and still doesn't need to).
- `tools/login.html` is the single chokepoint: `signIn()` gained a
  `skipPersist` option so a correct password never writes a session to
  storage on its own -- an already-enrolled account is always
  challenged for its code (or a recovery code) before a session is
  persisted, and an account whose real permissions require MFA
  (`requiresMfaForRole()`, keyed to the actual `account_roles`
  booleans, not the `role_name` label) is routed into the same
  enroll-then-verify flow right there on login if it has no factor
  yet, with one-time recovery codes generated and shown immediately
  after. None of the other 22 tool pages needed touching.
- `tools/settings.html` gained a "Two-Factor Authentication" card for
  self-serve enroll/disable and regenerating recovery codes, mirroring
  `portal/settings.html`'s shape with the same raw-`fetch()` helpers.
- Recovery codes are a new, custom table + `SECURITY DEFINER`
  functions (`sql/security/add_internal_mfa_recovery_codes.sql`), not
  Supabase's own native recovery-codes API -- that API exists in the
  SDK's source but is gated behind an experimental flag this project
  has no live access to confirm is deployed on its hosted project.
- `tools/workspace.html` shows a dismissible-per-session (not
  permanent) nag banner for an already-signed-in, mandatory-tier
  account with no factor enrolled yet, covering the real transition
  gap for a session created before this shipped.
- Mandatory for any account whose real, current permissions require it
  (both real accounts today, Owner and Developer); optional-but-
  encouraged for a bare account with none of those.

**Verified:** 30 new tests (`tests/tools/internal-mfa.test.js`)
alongside the full existing suite. Real headless Chromium via
Playwright, served over local `python3 -m http.server`, with every
Supabase call mocked (this environment cannot reach `*.supabase.co` at
all): enrollment with a real QR image, correct/wrong-code login,
valid/invalid recovery-code login, an unenrolled optional account
signing in normally, and the Settings enroll/disable/regenerate flow --
a real UI-ordering bug (recovery codes flashing then disappearing) was
caught and fixed by this same Playwright run. **Not verified live**:
actual TOTP against a real authenticator app and the live Supabase
project (no live access from this environment), and the new SQL
migration has not been applied to the live database yet -- both need a
human with real access before this is fully in production. Full
reasoning and the complete verify/couldn't-verify breakdown:
`docs/specialist-logs/security.md`'s 2026-09-22 entry.

**Update, same day:** the migration above (`sql/security/add_internal_mfa_recovery_codes.sql`)
has now been applied live via the Supabase MCP tools, with user
authorization, and verified directly against the live database --
`internal_mfa_recovery_codes` exists with RLS enabled and zero
policies (deny-all by design), and all 4 `SECURITY DEFINER` functions
(`generate_internal_recovery_codes`, `verify_and_consume_internal_recovery_code`,
`count_unused_internal_recovery_codes`, `delete_internal_recovery_codes`)
exist and are grant-restricted to `authenticated` only. TOTP against a
real authenticator app is still unverified (needs a human logging in
live) -- that's the only piece of this feature still open.

## 2026-09-22 -- `scripts/check-links.py` external-link coverage hole closed

`PUBLIC_PAGES` was a hand-maintained subset that had drifted well
behind `sitemap.xml` -- missing `locations/handyman-st-george-ut.html`,
4 of the 7 service pages, `about.html`, `careers.html`, `our-work.html`,
`booking.html`, the entire `blog/` (index + 10 posts), and
`terms.html`/`privacy.html`. All of those got zero external-link
checking despite being real, crawled, indexed pages. Rebuilt the list
directly from the sitemap with a comment to keep the two in sync going
forward. Internal-link check (which does cover every HTML file
already) stays clean across all 88 pages. Flagged by the Watcher on
2026-09-17, picked up here.

## What changed, 2026-09-22 (later the same day) -- Finance and Runway Dashboard's invoice numbers now come from the real relational table, not the blob

Continuing the relational-tables migration from 2026-09-08/09-17:
`tools/finance.html`'s Job Profitability tab and
`tools/runway-dashboard.html`'s Accounts Receivable / Runway panels
now read invoices through the same shared `getInvoicesForRead()` cache
`workspace.html`'s Income list and `invoice-generator.html`'s Recent
tab already used, instead of reading the `workspace_sync` blob
directly. Both pages had exactly one function that reads invoices
each, so this changed those two functions' internal source only --
every one of their call sites (the Job Profitability tab render, the
Accounts Receivable panel, `renderRunway()`'s ~11 callers across the
page) stayed synchronous and untouched, matching how `auth.js`'s
`_cachedRoleInfo` already avoids turning a widely-called synchronous
accessor into an async one. `tools/dev-tools.html` was investigated
too and deliberately left alone -- its own reads of the same
localStorage keys are diagnostics about this device's own blob state
(a data-quality check, a raw snapshot viewer, and a delete-undo
"graveyard" that writes straight back into the blob on purpose), not a
business-data display, so pointing them at the relational table would
have been wrong, not just unnecessary.

No new database migration was needed -- the `invoices` table was
already in the real-time publication from the 2026-09-17 slice, and
neither page needed any column that slice didn't already provide.
Verified in a real headless Chromium (served over `python3 -m
http.server`, every Supabase call mocked): both pages show a
deliberately different, "fresher" relational total once the cache
resolves, and correctly fall back to the older blob total when the
relational fetch is made to fail, proving the offline-first behavior
survived the change. Full suite (2682 tests), `check-consistency`,
`check-undefined-vars`, `check-links.py`, and `lint` all clean. Full
reasoning, including what was deliberately NOT touched and why:
`docs/specialist-logs/features.md`'s 2026-09-22 entry (invoices slice
B) and `CONTINUE-HERE.md`'s "relational tables Phase 2" section.

## 2026-09-22 (later still) -- Dev Tools' Client errors log stopped resurrecting after Clear

Reported directly: clearing the log worked, but the same old entries
kept coming back even though there had been no real errors in weeks.
`th_client_errors` was the one record type in the whole sync system
with no delete-tracking (every real record type -- clients, jobs,
invoices, etc. -- has its own `*_tombstones` array); a stale device
that still had old entries in its own localStorage would silently
re-inject them into the shared log on every sync, no matter how many
times the log was cleared elsewhere. Added `th_client_errors_cleared_at`,
a synced cutoff timestamp `mergeClientErrorLog()` now filters against --
any entry at or before the cutoff is dropped, but a genuinely new error
logged after the clear always survives. Full reasoning:
`docs/specialist-logs/bugfix.md`'s 2026-09-22 entry.

## 2026-09-22 (later still) -- "Make it feel like a native app," round 1: haptic + long-press coverage

Direct request to push the tools suite further toward feeling like a
phone app. Every underlying system was already built (pull-to-refresh,
swipe-back, haptics, long-press bottom sheets, app badge, etc.) -- the
gap was coverage: `haptic()` and the shared long-press quick-action
sheet were wired into only 1-2 of ~19 tool pages. Added `haptic('success')`
at real success moments across `invoice-generator.html`, `finance.html`,
`job-tracker.html`, and `workspace.html`, plus centralized it into
`tools-effects.js`'s shared `celebrateCompletion()` so every completion
moment (current and future) gets it for free. Extended the long-press
quick-action sheet to income/expense rows (`finance.html`), Contacts
tab client cards (`job-tracker.html`), and the contract log
(`contract-generator.html`). Full reasoning, including a real
regression the existing test suite caught (an unguarded `attachLongPress`
call broke 2 pre-existing `finance.html` load tests) and what's queued
for round 2: `docs/specialist-logs/visual.md`'s 2026-09-22 entry.

## 2026-09-22 (later still) -- "Make it feel like a native app," round 2: badge freshness + a course-correction

Added `setAppBadgeDelta()` (`tools-effects.js`) so the OS home-screen
badge stays honest without needing `workspace.html` open -- it's the
only page that computes the real cross-page Action Items total, so
rather than duplicating that fetch/count logic everywhere (a proven
source of drift in this codebase before), other pages nudge a cached
copy of the total by a known relative amount instead. Wired into
`invoice-generator.html`'s mark-paid/unpaid toggle. Also re-checked
round 1's planned "swipe-reveal on invoice/quote rows" before building
it -- turned out Mark Paid is already a directly visible button there,
unlike Job Tracker's hidden-until-swipe Done button, so the gesture
would have added real complexity for no actual gain. Substituted the
long-press quick-action sheet on the invoice log instead, which does
save something real. Full reasoning: `docs/specialist-logs/visual.md`'s
2026-09-22 entry.

## What changed, 2026-09-22 (later still) -- internal MFA: "Could not generate recovery codes" fixed, 2FA setup polished, backup/restore moved to Dev Tools

Three related pieces, all touching the same-day internal `/tools/` MFA
feature above.

**Bug fixed: recovery codes now regenerate correctly even after the page
has sat open a while.** Root cause: `getAuthToken()` in `tools/auth.js`
falls back to the Supabase anon key whenever the stored access token has
expired, without refreshing first -- `tools/settings.html`'s MFA/
recovery-code handlers called it directly, with no `ensureFreshToken()`
first (unlike `loadCurrentUserRole()` elsewhere in `auth.js`, which
already does this). An expired token meant the RPC went out as anon,
`auth.uid()` resolved to null, and the database's own "not authenticated"
error got buried under a generic catch-all message. Fixed in all six
Settings-page MFA handlers, not just the one named in the report, plus
`generateRecoveryCodes()`/`verifyRecoveryCode()` in `auth.js` now surface
the real error detail instead of only ever the generic fallback. New
test: `tests/tools/mfa-recovery-token-refresh.test.js`. Verified live in
headless Chromium with every Supabase call mocked: an expired-but-
refreshable session now succeeds at regenerating codes, and a genuine
mocked RPC failure now shows its real error text in the UI. Full
reasoning: `docs/specialist-logs/security.md`'s 2026-09-22 entry.

**2FA setup made easier and more polished**, on both `tools/settings.html`
and `tools/login.html`: the manual-entry secret and the recovery codes
each gained a real Copy button (not just text to hand-select); the
one-time recovery-codes warning is now visually unmissable, not just
present; the 6-digit code inputs gained `pattern="[0-9]*"` alongside the
existing `inputmode="numeric"`, strip non-digits as you type, and
auto-submit once a full valid code is entered; the code input on
login.html got its own explicit focus state; and an optional-tier
(Employee) account now gets one honest line on Settings explaining why
turning 2FA on is worth the extra step, shown only when it's actually
off. Full detail: `docs/specialist-logs/visual.md`'s 2026-09-22 entry.

**"Your Data" (full account backup/restore) moved from Settings to Dev
Tools.** A regular Employee account has no real use for a full JSON
export/restore of the entire account's data -- it's an admin/dev
capability, and Restore is destructive. Landed in Dev Tools' Session
tab, Developer-only (`dev-owner-hidden`), matching the existing rule that
an Owner-role account only sees the Access tab at all (per the
2026-08-21 change) -- not a new, one-off restriction invented for this
feature. A straight relocation, not a rewrite: same key list, same
functions, same backup file shape, same confirm text. Both of `#backup`'s
existing deep-links (the Dashboard's and Settings' own, from the
2026-09-21 move) now go straight to `/tools/dev-tools.html#backup`.
Verified live that an Owner-shaped account sees neither the Session tab
nor the panel at all, and that a Developer-shaped account reaches a
working panel directly via the hash link. Full reasoning:
`docs/specialist-logs/visual.md`'s 2026-09-22 entry.

Verified: full suite (2700 tests), `check-consistency`,
`check-undefined-vars`, and `lint` all clean; `check-links.py` clean
except the known sandbox-proxy limitation (images.unsplash.com and this
site's own domain, both pre-existing and unrelated to this change).

## 2026-09-22 (later still) -- the recovery-codes fix above wasn't the real fix: pgcrypto lives in `extensions`, not `public`

The owner tested "Generate new codes" live right after the token-refresh
fix above and got the exact same "Could not generate recovery codes"
error -- a real, independent bug underneath it, not a deploy-timing
issue. Reproduced directly against the live database by simulating an
authenticated call to `generate_internal_recovery_codes()`:
`ERROR: function gen_random_bytes(integer) does not exist`.

Root cause: `generate_internal_recovery_codes()`/
`verify_and_consume_internal_recovery_code()` both declare
`set search_path = public`, but `create extension if not exists
pgcrypto;` installs pgcrypto into the `extensions` schema on this
Supabase project -- Supabase's own standard convention, not `public`.
A `SECURITY DEFINER` function's explicit `search_path` fully replaces
the caller's own (that's the point -- it's what prevents a search-path-
hijack attack), so `extensions` was never in scope. Every single call
to either function has failed at the database level since the feature
shipped, for every account, regardless of token freshness -- the
token-refresh bug fixed earlier the same day was real, but it was never
the actual reason generation failed.

Fixed live via the Supabase MCP tools (with the owner's authorization,
same as the original migration's own application) and in
`sql/security/fix_internal_mfa_recovery_codes_search_path.sql`:
`set search_path = public, extensions` on both affected functions.
`count_unused_internal_recovery_codes()`/`delete_internal_recovery_codes()`
call no pgcrypto function and were correctly left untouched. Verified
directly against the live database, before and after: reproduced the
exact error pre-fix, confirmed real codes generate and a just-generated
code verifies correctly post-fix, then deleted the test codes so no
stray live rows were left behind. New regression test in
`tests/tools/internal-mfa.test.js` asserts the corrected search_path
going forward.

## 2026-09-22 (later still) -- "Make it feel like a native app," round 3: the last real haptic gaps + voice dictation

A fresh audit (not assuming rounds 1-2 covered everything) found 3
more silent success moments and fixed them: `invoice-generator.html`'s
Quick Charge success (the highest-frequency "money in hand" moment in
the suite, silent even though this file's other success moments
already fire a haptic), and `review-request.html`'s `logSentRequest()`/
`setRequestStatus()` (the latter only for the positive "Left a review"
outcome). Also extended `attachVoiceDictation()` -- a fully built mic-
dictation utility previously wired to exactly 1 field across ~23 tool
pages -- to `contract-generator.html`'s 3 long-form scope-description
textareas, the textbook case for dictating instead of typing at a job
site. Checked several other candidates first and correctly declined to
build anything for them (long-press on already-visible review-request
buttons, a couple of pages with no real gap on inspection). Full
reasoning: `docs/specialist-logs/visual.md`'s 2026-09-22 entry.

## What changed, 2026-09-22 (later still) -- a physical, drawn signature everywhere a client used to just type their name

Requested directly: "Currently they just type a name, i want a
physical signature." The client portal, POS, and every other place a
client authorizes saving a card now capture a real drawn signature
(same canvas-signature pattern `portal/contracts.html`'s client
e-signature already used), not just a typed name -- across POS Quick
Charge, single + bulk invoice payment, and Settings' Add a Card.
Signature capture logic was extracted into a new shared file,
`signature-pad.js`, and `portal/contracts.html` itself was refactored
onto it too. The typed name is kept alongside the drawn signature (for
search/display/dispute correlation), not replaced by it; existing
authorization records are unaffected. Full reasoning, including a
deploy near-miss caught and fixed within the same session:
`docs/specialist-logs/features.md`'s 2026-09-22 entry.

## What changed, 2026-09-22 (later still) -- Workspace rework, part 1: an app shell with one Create button

First of a series of merged PRs reworking the Workspace suite into one
app rather than a set of tool pages (the brief: "make this the most
app-like, easy-to-use, efficient handyman hub it can be"). This part is
the shell every page shares; the pages themselves come next. Full
reasoning in `docs/specialist-logs/features.md`.

**The phone bar is Home · Jobs · ( + ) · Clients · Money.**
- **( + ) opens a Create sheet** -- job, invoice, quote, quick charge,
  expense, income, contact, contract, review request -- from any page.
  Every tile deep-links into the form that already exists and already
  opens itself from its hash (`#add-job`, `#invoice`, `#quote`, `#pos`,
  `#expenses`, `#income`...), so there is no second copy of any form.
  Tiles follow the same permission checks as the nav. The ( + ) is a
  lifted orange hexagon; while the sheet is open it turns into an x in
  place and closes it again.
- **Money is one tab for Invoices and Finance.** It opens whichever of
  the two you used last on this device (`th_money_last`), and on both
  pages a two-segment **Invoices | Finance** switch takes the title's
  place in the header, so the pair reads as one section. Someone who can
  see only one of the two gets that one and no switch.
- **More, Search, and Help moved into the header.** A grid button at the
  top right opens the More drawer (now an app grid: Route Planner,
  Runway, Contracts, Reviews, Wiki, Dev Tools, Settings, plus "How this
  page works" and "Flag this page for later" rows). The magnifier next to
  it opens search. Nothing floats over page content on a phone any more:
  the floating search button is gone and the flag button is a drawer row
  (it keeps its corner on desktop), which retires the same-day
  fade-at-top workaround those buttons needed.
- **One header row on every page.** The ? button gives way to the
  drawer's help row on phones, the dashboard's sync badges shrink to
  their coloured dots, long titles end in an ellipsis, and three titles
  now match their nav label (Invoices, Contracts, Reviews).

**Desktop** keeps the sidebar and gains an orange **New** button at the
top (and the **N** key) that opens the same Create sheet as a centred
dialog. The tablet band (721-1023px) gets the bar and centred sheets.

**Tour** (now 25 steps): a new "Create anything" step, the Search step
points at the header button, "Getting around" describes Money and the
header menu, and two stale steps were corrected (Quick charge now
mentions the drawn signature; Settings no longer lists Backup &
Restore, which moved to Dev Tools). The dashboard help modal was
updated to match, including the same stale Backup line.

Runway Dashboard, which keeps its own copy of the shell CSS, got the
mirror -- plus a `--bg-panel` alias, since the command palette CSS
already copied there referenced a variable that page never defined (it
rendered see-through).

Verified in a real headless Chromium (local HTTP, fake Supabase): all
nine Create tiles land on the right form or tab (including a same-page
hash change), Money remembers Finance and the switch hops back, the
header is one row on all 14 real pages at 360 and 390px, the full
25-step tour at 390 and 1440 with every highlight on screen and Next
clickable, light mode, the tablet drawer, and the desktop dialog, with
no console errors. New tests: `tests/tools/app-shell-v2.test.js`.

## What changed, 2026-09-22 (later still) -- Workspace rework, part 2: the Clients tab is a real client list

The bar's **Clients** tab opened the client-portal admin console:
portal accounts, portal invoices, email lists, bug reports. It never
showed a list of clients. `data-layer.js`'s own comment on
`thGetAllClientsWithTotals()` says it was written to back "the Clients
hub page", and that page was never built. It is built now. Full
reasoning is in `docs/specialist-logs/features.md`.

**`clients.html` now opens on your client list**, with the portal
console one tap away under a **Portal** tab (`#portal`).
- Every client in the shared registry is listed, and each row shows
  initials, the next or last job ("Job today", "Next job Sep 25", "Last
  job Sep 20"), the phone, and what they owe. The amount is an orange
  pill, and turns into a red "$285.00 due" once it is overdue. The
  money rules match the Dashboard's Money Owed card, including partial
  payments and terms. The phone button calls the client.
- **Search** matches name, email, or street, and phone digits however
  they are typed. **Recent** (the default) puts upcoming and recent
  activity first. **Owes you** puts overdue balances first. **A–Z**
  adds letter headers. A search with no match offers to add that name.
- **Tap** a row to open the client. **Hold** a row for Call, Text,
  Email, Directions, New job, or Invoice without opening it.
- Nobody is entered twice. The registry backfill now runs on every
  load, so a name typed on any job, invoice, quote, contact, or
  contract shows up here. It still never recreates a deleted client,
  and it now skips records already linked by `clientId`, so a job whose
  name text drifted cannot spawn a duplicate. **Add**, the Create
  sheet's new **Client** tile, and the search's "Add a client" all go
  through `thEnsureClient()`.
- The portal panels load only when the Portal tab first opens. The
  daily client list no longer fires nine admin requests just to render.
  The Portal tab hides for an account whose role says it cannot manage
  invoices, the same permission that used to hide the whole page. Since
  the list is the same local data Job Tracker already shows every
  account, **Clients is in everyone's nav now**.

**The client page (`client-detail.html`) is a real profile.** It shows
Call / Text / Email / Directions buttons and "Owes $X · $Y overdue". It
also has **New job**, **Invoice**, and **Quote** buttons. These open
the form with the client and their phone, email, and address already
filled in, via new `?client=` handling on `job-tracker.html#add-job`
and `invoice-generator.html#invoice|#quote` (fill-only, dropped from
the URL once applied). Other fixes on this page:
- Jobs open the job's own page instead of a filtered list.
- "Last Job" no longer shows a future date. It says "Next Job" when
  one is booked.
- A real back arrow leads to Clients.

**Global search** gets a Clients group first; a name opens that
client's page. Job results open the job itself.

**Fixed along the way (all real, all pre-existing):**
- `?search=` on the invoice page was ignored. Client and job pages had
  linked to it for months with a hash that doesn't exist (`#tab-recent`).
  The hash is `#recent` now, and the Recent tab is filtered on arrival.
- On desktop, twelve pages' own `padding-top: 75px` never applied: plain
  `body` lost to the shared `body.th-tool-page` rule, so their content
  started under the fixed header's bottom edge. One shared rule
  restores it. Sticky tab bars on desktop also stuck 44px below the
  header, using the phone's notch offset; they now stick right under it.
- The Clients page's init-error banner passed its error as the page
  label.
- The Clients page now loads supabase-js, so its list follows changes
  made on other devices live (a test caught that the new realtime call
  would otherwise never connect).

**A shared list row** (`.th-row`, `.th-row-avatar`, `.th-pill`,
`.th-icon-btn`, `.th-chips`, `.th-search-field` in `styles-tools.css`)
means a client, a job, or an invoice can read the same way on every
page. It is the first real piece of ARCHITECTURE-NOTES' "shared UI
components" backlog item. `attachLongPress` gained an opt-in
(`data-long-press-target`) for rows whose whole body is a link: a tap
opens the record, a hold opens the sheet, and the click after a hold is
swallowed so it doesn't navigate.

Verified in a real headless Chromium (local HTTP, fake Supabase), at
390px and 1440px:
- The list, the filters, phone-digit search, and the Owes-you ordering.
- A hold opens the sheet without navigating; a tap opens the client.
- Profile → New job opens the add form with the client, phone, and
  address filled in and the title focused. Profile → Invoice fills the
  client, email, and address.
- `?search=` lands on a filtered Recent tab.
- Create → Client → the add form → the new profile.
- The desktop layout on Clients and Finance.
- No console errors.

New tests: `tests/tools/clients-directory.test.js` (19).

## What changed, 2026-09-22 (later still) -- Workspace rework, part 3: the Jobs list reads like an app

Part 3 of the Workspace rework (after the app shell and the client
list). Full reasoning in `docs/specialist-logs/features.md`.

**A job card on a phone or tablet is Done, Call, Directions, and ⋯.**
Before, each card carried six controls: Done, a status dropdown,
Photos, Create Invoice, Edit, and Delete. Now it shows Done plus round
**Call** and **Directions** buttons (built from the job's own phone and
address, shown only when those exist) and a **⋯** button. The ⋯ button
and a long-press on the card open the same sheet: Mark Done, Start (In
Progress) or Back to Not Started, Open job, Photos, Create invoice,
Send confirmation email (when it hasn't gone yet), Log Expense, Edit,
and Delete. Nothing was removed. The full row still renders, and the
desktop table is unchanged. The desktop board's narrow columns use the
compact row too.

**Cards say when, the way a person does.** "Today", "Tomorrow",
"Friday", "Sep 30"; the full date is in the tooltip. The phone number
gives way to the Call button, and the address gets its own line. On a
phone, only badges that say something unusual stay: High priority
(every card's left border already shows its priority), In Progress,
margin, and warranty.

**The date-sorted list is grouped:** Overdue (red), Today (orange),
Tomorrow, Next 7 days, Later, No date. A past date reads "Earlier" once
the job is done, or whenever done jobs are in view. Sorting by priority
shows the plain list.

**Lighter toolbar on phones.** The collapsed Add a Job bar gets a +.
Templates' ? sits beside its title. The filter row scrolls sideways
instead of squeezing "Not Started" onto two lines. Compact view leaves
the phone toolbar, since display density lives in Settings.

**Job Detail gets a one-tap row:** Call, Text, Directions, Invoice
(`?jobRef=`), and Expense (`finance.html?job=`), each shown only when it
can do something. It also gets the priority and status badge styling
it never had (they rendered as plain words). Job Detail stays
read-only; status changes still go through Job Tracker's
`setJobStatus()`, which also handles the relational mirror and the
review prompt.

**Fixed along the way:** the job long-press sheet passed the raw job
title to `showQuickActionSheet()`, which renders it as HTML. It's
escaped now.

Verified in a real headless Chromium (local HTTP, fake Supabase):
- 390px: the grouped list; the ⋯ sheet's contents; Call and Directions
  hrefs; High and In Progress badges only.
- 820px: the same card in the tablet band.
- 1440px: the board with compact cards and the table unchanged.
- Job Detail's action row and badges.
- No console errors.

New tests: `tests/tools/jobs-list-app.test.js` (8).

## What changed, 2026-09-22 (later still) -- Workspace rework, part 4: Money opens on who owes you

Part 4 of the Workspace rework (after the app shell, the client list,
and the Jobs list). Full reasoning in `docs/specialist-logs/features.md`.

**Invoices opens on the invoice list, not a blank form.** The Money tab
used to land on the New invoice form, and the list of what you had
billed sat in a fourth tab that was off the screen on a phone. Now the
first tab is **Invoices**:
- Three numbers at the top: **Owed to you**, **Overdue**, and what you
  billed this month. Tap Owed or Overdue to show just those invoices.
- Search, then chips: All / Unpaid / Overdue / Paid, with counts. The
  choice is remembered on this device.
- One row per invoice, newest first, in the same row style as the
  Clients list. Each row shows what is still owed and when it is due
  ("Due Oct 19", "25 days overdue" in red, "$50 of $160 paid"), plus a
  Paid / Unpaid / Part paid / Overdue pill.
- Tap a row, or hold it, for one sheet: **Mark Paid** first, then
  Resend to client, Open client, Open job, and Delete. On a computer,
  Resend / Mark Paid / Delete also stay at the end of each row.
- Quotes are underneath in the same rows, with one pill: Invoiced,
  Approved, Declined, Awaiting reply, or Pending. A decline reason and
  a client's open questions still show under the row.

The forms keep their tabs, renamed **New invoice**, **New quote**, and
**Quick charge**. Their deep links still work: `#invoice`, `#quote`,
`#pos`. A link that brings something to invoice still opens the form:
a job's Create invoice (`?jobRef=`) and a client's Invoice button
(`?client=`). The Dashboard's **Create invoice** now goes to `#invoice`.
The + button already did.

**Fixed: Mark paid did half the job on each page.**
- The Dashboard's Mark paid (in Money Owed and Needs attention) never
  told the client portal. An invoice marked paid there for cash or
  check stayed payable online, so the client could pay it twice. It now
  makes the same `set-invoice-paid` call the Invoices page made. The
  call is now one shared helper, `pushInvoicePaidToPortal()` in
  `sync.js`.
- The Invoices page's Mark Paid flipped only the old `paid` flag. The
  Dashboard, the database copy, and the overdue push all read
  `paidAmount` first. So an invoice marked paid on the Dashboard and
  then unpaid here stayed paid everywhere else, and one marked paid
  here after a partial payment stayed owed everywhere else. It also
  never updated the database copy, which the list reads once it loads,
  so a refresh could put the old status back. It now writes
  `paidAmount` with the flag, mirrors the invoice, and earns a pending
  referral credit, the same as the Dashboard.
- The invoice sheet's title (a client name) went into
  `showQuickActionSheet()`, which renders HTML, unescaped. It's escaped
  now.

Verified in a real headless Chromium (local HTTP, fake Supabase):
- 390px and 1440px: the tiles, chips, and rows.
- Tap and long-press each open one sheet.
- Mark Paid updates the tiles and posts both the database mirror and
  `set-invoice-paid`.
- Filters stick.
- `?jobRef=`, `?client=`, `?client=…#quote`, `#pos`, `?search=…#recent`,
  and `#invoice` each open the right tab with the right fields filled.
- No console errors.

New tests: `tests/tools/invoices-list-first.test.js` (13).

## What changed, 2026-09-22 (later still) -- Workspace rework, part 5: nothing slips between Done and Paid

Part 5 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**Every job now knows where its money is.** A job is Booked, Working,
To invoice, Invoiced, Overdue, Paid, or No charge. The stage is worked
out from records that already exist: the job's status, the invoices
carrying its `jobRefId`, and any payment logged against it by hand in
Finance. The one new stored field is `noInvoice`, for "No charge". See
`thJobMoneyStage()` in `data-layer.js`.

**Finished jobs nobody billed are caught.**
- **Dashboard:** Needs attention's Income lane gets **Ready to invoice**.
  It lists jobs finished in the last 60 days with no invoice and no
  payment logged, oldest first, each with an **Invoice** button that
  opens the form filled from the job. Rows a week old or more are
  highlighted. The ⋯ sheet covers the two honest reasons a finished job
  has no invoice: it was paid another way (it opens Finance's income
  form filled for that job), or there's no charge (a warranty callback,
  a favor; undoable). The Money Owed card gets a **To invoice · N jobs**
  line that jumps there. The count also joins the Income lane, the
  Needs attention badge, and the app icon badge.
- **Jobs:** a new **To invoice** filter with a count, and `#to-invoice`
  deep links to it. Finished cards wear a money pill: an orange **To
  invoice** link, or Invoiced, Overdue, Paid, or No charge. An unbilled
  finished card is no longer dimmed like history. On a phone, a
  finished card's badges wrap under the title, and the redundant Done
  badge is hidden.
- **Marking a job done** now opens a Job done sheet: **Create
  invoice** first while nothing is billed, then the review request,
  then **No charge**. It used to be a single "Send a review request?"
  confirm, and the invoice was left to memory. Bulk mark-done is
  unchanged.
- **Job Detail** shows the job's track: Booked → Working → Done →
  Invoiced → Paid, filled up to where it is, with a ring on the next
  step. When paid it turns green. One line under it says what's next,
  with the button for it: "Done, not invoiced yet" with Create invoice
  and Paid another way, "$285.00 owed · 25 days overdue" with Follow
  up, "Paid in full", or "Booked for tomorrow".
- **Client Detail** lists each job with the same money pill.

**Fixed along the way:**
- **Job Detail's expense rows** read `description` / `category`, fields
  expenses have never had (they're `desc` / `vendor` / `type`), so every
  row said just "Expense".
- **Job Detail's invoice rows** said Paid or Unpaid from the old `paid`
  flag. They now use `paidAmount` first, like every other money view,
  and can say Part paid or Overdue.

Verified in a real headless Chromium (local HTTP, fake Supabase):
- 390px and 1440px: the Dashboard's Ready to invoice group and its ⋯
  sheet, and the Money Owed line.
- Jobs' To invoice filter via `#to-invoice`, and the pills on finished
  cards and on the desktop table.
- The Job done sheet on a real Done tap (confetti still first).
- Job Detail's track for a to-invoice, an overdue, a paid, and a booked
  job.
- No console errors.

New tests: `tests/tools/job-money-pipeline.test.js` (15).

## What changed, 2026-09-22 (later still) -- Client portal: see your visits, know when we replied, and a Home that knows you

Portal-only (`portal/*`, plus the SQL/edge function behind it). Three
rounds from a direct audit of the pages and the live schema.

**Your visits.** A client could not see an appointment they booked
themselves: quote- and check-up-scheduled visits (and `booking.html`
bookings) live in `th_bookings`, which clients can't read, and the
quote card only ever said "Job scheduled." A new read-only RPC,
`get_my_portal_visits()`, returns just the signed-in client's own
bookings. Home's "Next appointment" now shows every kind of visit with
a calendar date tile, **Add to calendar** (a real `.ics` file), and
**Reschedule or cancel** (the existing `manage-booking.html` page), plus
an "Also coming up" list. Quote cards show the actual appointment, or
that it was cancelled with a "Pick a new time" button. Check-up banners
show a visit that's already booked instead of offering to book it
again. `schedule-quote-job` (deployed, v11) now allows rebooking only
when every booking for that quote was cancelled -- and ships the
double-booking race guard the repo had but live never did.

**Unread messages.** Nothing recorded whether a client had seen a
reply. New `client_portal_thread_reads` table and two RPCs drive "N new"
badges on each Messages button and on the Request/Jobs tabs, a "New"
divider in the thread, and a Home item that only appears for a real
unread reply ("New message from Triple H -- About: Leaky faucet") and
opens that thread. Both message threads now share one chat renderer
(day dividers, times, a composer that can't double-send), which also
fixes `jobs.html` printing "Invalid Date" under every message.

**Staff-side fix (SQL only).** `client_portal_jobs` and
`client_portal_invoices` only let the client read their own rows, so the
`tools/clients.html` panels that read them -- Portal job messages,
Portal invoices, Portal accounts counts, client search -- were silently
empty. Both now also allow internal accounts to read.

**Home.** Greets the client by name ("Good evening, Jane" -- it always
said "Welcome"), adds a Recent Activity timeline of the last five real
events, and a failed contracts lookup now shows as an error instead of
"Nothing yet". Request Work prefills the phone and address the client
already gave us.

Verified: full suite, `check-consistency`, `check-undefined-vars`,
lint, `check-links.py`; RPCs and policies tested live with simulated
sessions in rolled-back transactions; pages checked in headless
Chromium at phone and desktop widths. New tests:
`tests/portal/portal-visits.test.js`, `tests/portal/unread-messages.test.js`,
`tests/portal/home-greeting-activity-prefill.test.js`,
`tests/edge-functions/schedule-quote-job-rebook.test.js`. Full detail:
`docs/specialist-logs/features.md` and `visual.md` (2026-09-22 entries),
`docs/CLIENT-PORTAL.md` (Database section).

## What changed, 2026-09-22 (later still) -- Workspace rework, part 6: the invoice writes itself from the job

Part 6 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**From this job.** Open an invoice from a job and a panel above the
line items offers everything already logged against it, as
ready-to-bill lines. That covers the job's Create invoice, Ready to
invoice on the Dashboard, the Job done sheet, or picking the job in the
form.
- **Labor.** The hours on the job at your last labor rate. If no hours
  were logged (most jobs), the line asks "How long did it take?" with an
  hours box, plus a rate box the first time. Typing the hours ticks it.
- **Parts.** One line per receipt logged against the job in Finance, at
  cost (add your markup in the price), with the part number when there
  is one.
- **Mileage.** All the job's logged miles on one line, at your last
  billing rate, untaxed like **+ Add Mileage**.
- **An unbilled quote.** If the client has one for this job, **Bill the
  quote** comes first. It copies the quote's lines and discount and
  links the quote, so saving the invoice marks the quote converted, the
  same as Convert to Invoice. The logged lines are still there, unticked,
  as the alternative.

Nothing goes in until **Add**. The untouched starter row is replaced
(anything typed by hand is left alone), every line stays an ordinary
editable row, and **Undo** puts the form back as it was: rows, discount,
quote link. **Not now** hides the panel for that job.

**Fixed along the way:** invoice and quote rows put a line's description
and part number into `value="..."` unescaped. A saved job type, a quote
line, or now a receipt with a quote mark in it broke out of the
attribute. Quantity inputs also took whole numbers only (`step="1"`), so
2.5 hours or 14.3 miles showed as invalid; they now take any decimal.

Verified in a real headless Chromium (local HTTP, fake Supabase):
- 390px (dark and light) and 1440px: a job with hours, two receipts,
  and mileage adds 4 lines ($251.49), and Undo restores the form.
- A job with an unbilled quote copies its lines and $20 discount and
  sets the quote link.
- A job with nothing logged asks for hours and a rate, bills 1.5 h ×
  $85, and remembers the $85.
- A fuel receipt not linked to the job stays out.
- No console errors.

New tests: `tests/tools/invoice-from-job.test.js` (9).

## What changed, 2026-09-22 (later still) -- Workspace rework, part 7: quick add, by typing or talking

Part 7 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**Say it the way you'd text it.** The Create sheet (the orange **+**, or
**N** on a computer) now leads with one field and a microphone. As you
type or talk, a preview card shows what it understood; **Enter** or the
button opens that page's own form filled in. You check it and save it
there, exactly as before.
- **"Sink leak for Sarah tomorrow 2pm"** → a new job: title *Sink leak*,
  client *Sarah Miller* (a known client, so her phone and address come
  along), due tomorrow, "Time: 2:00 PM" in the notes.
- **"Replace garbage disposal at 88 Sunset Blvd for Tom Friday at
  2:30"** → address, client, the coming Friday, and 2:30 PM.
- **"urgent water heater leaking 435-555-0199 for Jen Park"** → high
  priority, the phone number, and a new client name.
- **"invoice sarah $150 dishwasher repair"** → the invoice form with
  Sarah, a first line of *Dishwasher repair* at $150, and her matching
  job linked. Part 6's From this job panel then offers the rest.
- **"quote Dave Carter drywall patch 420 next tuesday"** → the quote
  form.
- **"expense $48.12 Home Depot drain pump for Bill"** → Finance's
  expense form with the amount, vendor, description and Bill's job,
  opened at the receipt photo it still requires.

It understands:
- **Dates:** today, tomorrow, weekday names, next Friday, in 2 weeks,
  9/30, Sep 30.
- **Times, phone numbers, street addresses, amounts,** and urgent / ASAP.
- **Clients:** known clients by full or first name (only when the first
  name is unambiguous and plainly a name, so "will need parts" isn't
  "Will Parker"), and new names after "for".

On a phone the words appear while you talk, and the preview builds
itself. Search (**Ctrl+K**, or the magnifier) offers the same thing as
its top result when what you typed reads like something to create, not
a name search.

**Fixed along the way:**
- Opening an invoice from `?jobRef=` stripped the *whole* query string,
  so any other parameter on the same link was gone before anything read
  it. It now removes only `jobRef`.
- Closing search left focus in its hidden input, so pressing **N** right
  after did nothing.

Verified in a real headless Chromium (local HTTP, fake Supabase):
- 390px: the preview for each example.
- Enter, or the button, lands on the Jobs form (title, client, phone
  and address from the registry, date, time), the invoice form (client,
  line, price, job), the quote form, and the expense form (amount,
  vendor, description, job, form open).
- 1440px: the search suggestion; N opens Create focused on the field.
- No console errors.

New tests: `tests/tools/quick-add.test.js` (12).

## What changed, 2026-09-22 (later still) -- Client portal: a real desktop layout, and Settings you can take in at a glance

Both asked for directly: "The computer version looks like your looking
at a phone on a monitor screen" and "i want the settings reworked and
less packed full of things."

**Desktop.** From 1024px the portal gets a fixed left sidebar (brand,
Home/Request/Quotes/Invoices/Jobs, Contracts + Settings, and a Call/Text
box) instead of a 900px column with the phone's tab bar floating
mid-screen, and content fills the space beside it. From 1200px Invoices,
Jobs and Request split into a list and a side column, Home puts the
account cards and help beside the feed, and quote/contract cards sit two
across. Phones are unchanged -- the sidebar wrapper is invisible to
layout below 1024px, so the bottom tab bar is exactly what it was.

**Settings.** Eleven stacked cards became a six-row menu -- Profile,
Payment, Notifications, Sign-in & security, Refer a friend, App -- each
with a live status line ("Visa ending 4242", "2 of 3 emails on",
"Two-factor on") so most visits need no tap. A row opens just that
section; on a phone the browser's Back closes it, and each section has
its own link (`/portal/settings.html#security`). On desktop the menu
and the section sit side by side. One Sign out, at the foot of the
menu. Also fixed: the Add to Home Screen card never actually hid on
desktop (an inline style beat the stylesheet); desktop Chrome/Edge now
get a real one-tap "Install app" there instead.

Verified: full suite, `check-consistency`, `check-undefined-vars`,
lint; pages checked in headless Chromium at 390, 1100 and 1440px. New
tests: `tests/portal/desktop-app-shell.test.js`,
`tests/portal/settings-menu-and-sections.test.js` (replaces
`settings-collapsible-sections.test.js`). Full detail:
`docs/specialist-logs/features.md` and `visual.md` (2026-09-22 entries),
`docs/CLIENT-PORTAL.md` ("Phone vs desktop").

## What changed, 2026-09-22 (later still) -- Client portal: never miss a reply

The Request and Jobs tabs showed a badge when Triple H replied, but the
page opened on a blank request form (or the check-up list) with the
conversation somewhere below. Now a **"Triple H replied"** bar sits at
the top of both pages, one row per conversation with an unread reply;
tapping it opens that conversation.

The portal also stops going stale while it's open. Every signed-in page
re-checks for new replies when you come back to the tab and every 90
seconds while it's on screen (every 20 seconds while a conversation is
open), so badges, Home's "New message" item and the reply bar catch up
without a reload -- and a reply to the conversation you have open
appears in it, without losing anything you were typing. No checks run
while the tab is hidden, and a failed check changes nothing.

Verified: full suite, `check-consistency`, `check-undefined-vars`,
lint; exercised in headless Chromium at 390 and 1440px (notice, open
from notice, a reply arriving mid-draft, badges clearing on another
page). New tests: `tests/portal/reply-notice-and-live-unread.test.js`.
Detail: `docs/specialist-logs/features.md` and `visual.md` (2026-09-22
entries), `docs/CLIENT-PORTAL.md` (thread reads section).


## What changed, 2026-09-23 -- Workspace rework, part 8: a client's text becomes a job

Part 8 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**Most jobs arrive as a text message. Now the message is the job.**
Part 7's quick add understood short, typed sentences. It now also takes
a client's whole message, and you can get the message into it without
retyping a word:
- **Android: Share → Triple H.** Long-press the text in Messages, tap
  Share, pick Triple H. The app opens with the Create sheet up and the
  message already in quick add. (The installed app is now a share
  target, via `manifest.json`.)
- **iPhone, or anywhere: Paste a client's text.** A chip under the
  field (where the browser can read the clipboard) drops a copied
  message in. It steps aside once there's text.
- **Any link or iPhone Shortcut: `?quick=<text>`** on any tools page
  opens the same thing. A Shortcut that takes the shared text and opens
  `…/tools/workspace.html?quick=[text]` gives an iPhone the same
  one-tap share Android has.
- **Home-screen shortcut:** long-press the app icon → **Quick add**
  opens straight into an empty field.

**A long message titles itself.** "Hi, this is Sarah. My kitchen sink
is leaking under the cabinet again. Can you come tomorrow around 2?"
becomes:
- title *My kitchen sink is leaking under the cabinet again* (the
  greeting and the ask are skipped),
- client Sarah Miller (her phone and address come along),
- tomorrow, 2:00 PM,
- and the whole message saved in the job's notes, after the time, so
  nothing she said is lost.

When the only sentence is the ask ("Can you come look at our water
heater?"), the title is what's being asked about (*Water heater*). A
very long sentence is cut at a word, with an ellipsis.

**Reads more of how people write:**
- "around 2", "at 9", "about 4": a bare hour after at / around / about
  is a time (1 to 6 means the afternoon). "fix the 2 doors" stays two
  doors.
- "this weekend" (the coming Saturday), "next weekend" (the one after),
  "next week" (its Monday).
- Punctuation after a word ("tomorrow?", "Friday,") no longer hides it.

**Fixed along the way:**
- A shared message or `?quick=` link opened on Finance or the job list
  (pages that load the shell late) crashed quick add. The link is now
  read one tick later, once the whole file has run.
- A message shared in before your role had loaded said "Your account
  can't create invoices" and stayed that way. The preview now rebuilds
  when the role arrives.
- A long title filled in on the Jobs form showed its end. It now shows
  its start.

Verified in a real headless Chromium (local HTTP, fake Supabase):
- 390px: a share (`?share_text=`) opens the sheet with the preview;
  Enter lands on the Jobs form with the title, Sarah's phone, tomorrow,
  and the whole message in the notes.
- `?quick=invoice tom $220 disposal install` on Finance lands on the
  invoice form with Tom, a *Disposal install* line at $220, and his
  job linked.
- `#quick-add` opens an empty field with the Paste chip.
- 1440px: Paste with real clipboard permission fills the field and the
  preview (Tom, Friday).
- The served manifest carries `share_target` and the new shortcut.
- No console errors.

New tests: `tests/tools/quick-add-anywhere.test.js` (7).


## What changed, 2026-09-23 (later) -- Workspace rework, part 9: On the clock

Part 9 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**Time the job as you work it, and the invoice bills the time.** Most
jobs never had their hours logged, so the invoice's Labor line (part 6)
usually asked "How long did it take?" Now:
- **Start the clock** on the job's page, on its card in Jobs (the More /
  long-press sheet now leads with it), or on the Dashboard's Next Job.
  Starting it moves a Not started job to In progress.
- **A bar follows you everywhere** while it runs: above the bottom bar
  on a phone, bottom-right on a computer. It shows the job, the client,
  the time ticking, and **Stop**. Tap it for the job. It survives
  closing the app, and a clock started on the phone shows on the
  computer once it syncs.
- **Stop saves the time at once** (rounded to 0.1 h; under a minute
  counts as a mis-tap and adds nothing), then asks what's next:
  - **Done — create the invoice** marks the job done and opens the
    invoice, with its Labor line filled from the hours.
  - **Mark it done.**
  - **Keep the clock running** (stopped by mistake: undoes the stop).
  - **Not done yet** (the time is already saved).
- **The job's page** shows a big live clock while it runs, and a **Time**
  section listing every visit (day, from–to, hours).
- **One clock at a time.** Starting another job's clock stops the first
  and keeps its time. **Mark Done** on a running job stops its clock
  first, so no time is lost.

**Fixed along the way:** a job's page that re-rendered (live sync, and
now Start / Stop) turned its Photos grid back into "Loading..." for
good. The loaded photos are now kept.

Verified in a real headless Chromium (local HTTP, fake Supabase):
- 390px: Start on the job's page (the job moves to In progress and the
  big clock ticks); the Dashboard shows the bar clear of the bottom bar,
  ticking.
- Stop after 1 h 24 min: the sheet, then **Done — create the invoice**,
  lands on the invoice with "Labor 1.4 h logged"; the job is Done with
  1.4 h and one visit.
- The Jobs sheet leads with **Start the clock**, and the card then says
  **On the clock**. The job's page lists the visit under Time.
- 1440px: the bar sits bottom-right, and Next Job reads **On the clock**
  with **Stop the clock**.
- No console errors.

New tests: `tests/tools/job-clock.test.js` (15).


## What changed, 2026-09-23 (later still) -- Workspace rework, part 10: Get paid

Part 10 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**A late invoice now has a one-tap reminder, already written.** Chasing
money used to mean writing the same awkward text yourself.
- **Remind** shows wherever an invoice is due or late:
  - Money Owed on the Dashboard, beside Mark paid;
  - **Send a reminder** in the invoice's sheet on Invoices;
  - an overdue job's line on its page.
- **The message writes itself:** their first name, the invoice number,
  what's still owed (after any part payment), and when it was due. For an
  invoice on the client portal (one with a client email), it also says
  where to pay by card online.
- **Every reminder is a notch firmer than the one before,** and never
  gentler than how late it is:
  - Friendly ("Just a friendly reminder...").
  - Following up ("...now 25 days past due. If anything about the bill
    looks wrong, just reply"). Two weeks late starts here.
  - Firm ("Please arrange payment this week"). A month late starts here.
- **You can edit it,** then **Text** (the phone number comes from the
  invoice, the client, or the job), **Email** (with a subject line), or
  **Copy**. It goes out from your own phone's Messages or Mail. Nothing
  is sent from the app.
- **It's logged on the invoice.** Money Owed, the invoice row, and the job
  all say "Reminded 3 days ago", so a second nudge the next morning is a
  choice, not an accident.

Verified in a real headless Chromium (local HTTP, fake Supabase), at
390px:
- Money Owed shows **Remind** only on the late invoice, not the one due
  in 27 days.
- The sheet opens as "Following up" for a 25-day-late invoice, with the
  portal link and Text Bill (his phone from the client list), Email and
  Copy.
- After sending: "Reminded today" on the Dashboard row, the invoice row,
  and the job. The invoice sheet reads "Send a reminder (reminded
  today)", and the next reminder opens as "Firm reminder · reminder 2".
- No console errors.

New tests: `tests/tools/payment-reminders.test.js` (9).


## What changed, 2026-09-23 (evening) -- Workspace rework, part 11: Your week

Part 11 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**A scoreboard for the week, right under the daily actions.** Part 9's
clock records every visit, so the Dashboard can now show how the week is
going:
- **Seven bars, Monday to Sunday**, of the hours on the clock each day.
  Today's is picked out in orange and grows while a clock runs; days to
  come are dashed outlines.
- **On the clock** (with a pulsing dot while one runs), **Jobs done**,
  and **Billed**, each with last week's figure under it. It's a plain
  figure rather than an up or down arrow, because on a Tuesday a full
  last week would always "win".
- **Billed** is invoices dated this week plus income logged by hand. It
  doesn't include the income log's own copy of each invoice, and it's
  shown only to accounts that can see finance. It isn't "collected": a
  card payment through the portal has no local payment date to count by.
- Before any clock time exists, a line says how to fill it in.

On a phone the card stacks (bars on top, the three figures in a row). On
a computer the chart spreads across the card with the figures beside it.

Verified in a real headless Chromium (local HTTP, fake Supabase), at
390px and 1440px:
- Monday 2.5 h and Tuesday 6 h from logged visits, plus Wednesday 0.8 h
  from a clock started 50 minutes earlier, came to 9.3 h, with last
  week's 3.2 h beside it.
- 1 job done this week and 1 last week, and $640 billed against $160.
- No console errors.

New tests: `tests/tools/your-week.test.js` (6).


## What changed, 2026-09-23 (evening) -- Workspace rework, part 12: texts that write themselves

Part 12 of the Workspace rework. Full reasoning in
`docs/specialist-logs/features.md`.

**The texts you send every day, already written.**
- **On my way** is a new button on the Dashboard's Next Job. The job
  page's **Text** button and a **Text <name>** item in the Jobs sheet
  open the same sheet.
- **The texts follow the job:**

  | The job | Texts offered, in order |
  |---|---|
  | Booked for today | On my way, Running late, Confirm the visit |
  | Booked for a later day | Confirm the visit first |
  | Under way | Running late, Parts run, All done |
  | Done | All done |

- **Each text is written from the job:** the client's first name, the
  street ("confirming your appointment tomorrow at 123 Red Cliffs Dr"),
  and for On my way, Running late and Parts run, a time you pick: 10, 20,
  30 or 45 minutes.
- **Edit it, then Send.** It opens your own Messages with the text in
  place. Copy works everywhere else.
- **The job remembers the last text it got**, so the sheet says "On my
  way sent 12 min ago" before you send another.

Verified in a real headless Chromium (local HTTP, fake Supabase), at
390px:
- Next Job reads Open Job / On my way / Start the clock / Route today.
- On my way opens the sheet on that text for Sarah, with 20 minutes
  picked; choosing 30 rewrites it.
- Send logs it on the job, and the job page's Text then shows "On my way
  sent just now".
- No console errors.

New tests: `tests/tools/client-texts.test.js` (7).

## What changed, 2026-09-23 (evening) -- Client portal: service history PDF, cancels that tell Triple H

**Service history PDF.** Jobs has a "Download PDF" card: every job
Triple H has done for the client -- date, what was done (from the
invoice), invoice number, amount, any unpaid balance, a still-running
labor warranty, and their check-up plan -- on one branded PDF. The
record someone hands over when they sell the house or file a claim.

**Cancelling a request now tells Triple H.** Clients could already
cancel a request Steve hadn't started on, but it was silent -- it just
left his queue. Now the client can say why (optional), and the cancel
posts a note on the request's thread, which emails the team like any
reply. The cancel also can no longer overwrite a status change Steve
makes at the same moment. Once work has started, "Need to cancel?"
sends a cancellation request in the thread (instead of "call or text
us"), and Steve confirms.

**Home cards.** The five account cards no longer leave an empty slot at
laptop widths (3 + 2 across), and on a phone the fifth spans the row.

Deployed: `cancel-work-order` v3 (live source matches the repo; the
current portal page keeps working with it -- no reason is sent, so the
note just says the request was cancelled). Verified: full suite,
`check-consistency`, `check-undefined-vars`, lint; headless Chromium at
390/1024/1440 (cards, both cancel flows, the PDF downloaded and
rendered, including a 4-page history). New tests:
`tests/portal/service-history-pdf.test.js`; additions to
`tests/portal/work-order-cancel.test.js`. Detail:
`docs/specialist-logs/features.md` and `visual.md`,
`docs/CLIENT-PORTAL.md` (edge function table).

## What changed, 2026-09-22 (later still) -- Booking flow, round 1: see every open day at once, and a "you're booked" worth the name

Public booking pages only: `booking.html`, `manage-booking.html`, and
the triage tool's Book link on `index.html`. No Supabase or
edge-function changes. Full reasoning: `docs/specialist-logs/features.md`
and `visual.md` (2026-09-22 entries).

**Picking a time.** The date strip now loads all 14 days in one request
(new `js/booking-flow.js`) instead of one request per tapped day.
- Every day says "3 open", "Full" or "Closed" before anyone taps it.
- Full days can't be picked.
- The picker opens on the first day that has room. It used to open on
  today, which is usually empty after the 2-hour lead time.
- Switching days is instant.
- A link to a day that has since filled lands on the next open day and
  says so.
- While the times load, a skeleton shows instead of "Loading times...".

If the new file ever fails to load, both pages fall back to the old
one-day-at-a-time picker.

**From "it won't heat" to booked, less typing.** Tap "Dryer", then
"Runs but won't heat" in the homepage triage tool, and "book a visit
online" opens straight on Appliance Repair's dates. The symptom is
already in the notes.

**Step 3 is shorter.** It shows name, phone, address, email and
"What's going on?". "Who referred you?" and "How did you hear?" sit
behind one tap, and open by themselves when a referral link filled them
in. Email now says why it's worth giving: the confirmation and the
reschedule link.

**The confirmation moment.** It's a sequence now, not a page swap:
1. The check draws.
2. A ring pulses out and a burst of brand-orange flecks fires.
3. The headline rises.
4. The appointment card lands like a stamp.
5. The next steps arrive one by one.

On a phone it now plays on screen; it used to happen above the scroll
position. New **Add to calendar** (a calendar file with reminders the
day before and 2 hours before) and **Google Calendar** buttons. Reduced
motion gets the calm version.

**Rescheduling.** `manage-booking.html` uses the same two-week strip.
Tapping a time now asks "Move your visit to Friday at 3:00 PM?" before
anything moves; one mis-tap used to move a real appointment. It also
has:
- green-check success screens
- Add to calendar for the current time and the new one
- an inline error instead of a browser `alert()`

Verified: full suite (the only failure is the known `check-links.py`
sandbox-proxy test), `check-consistency`, `check-undefined-vars`, lint,
`check-links.py` (internal links clean). Driven in headless Chromium at
390px and 1440px through book, confirm, reschedule and cancel, with
Supabase intercepted: no page errors, no horizontal overflow. New tests:
`tests/booking/booking-flow-picker-and-confirm.test.js` (33).

## What changed, 2026-09-23 -- Client portal: Face ID instead of the 2FA code, and two-factor stays optional

Requested directly: "facial recognition AND two factor is way too much.
Make it pick facial over two factor for the portal, also make two factor
optional for the portal." Full reasoning:
`docs/specialist-logs/security.md`.

**Before:** a client with both turned on signed in with their password,
then typed the 2FA code, then got a Face ID prompt the moment the portal
opened. That was three steps.

**Now:**

| Setup | Sign-in steps |
|---|---|
| 2FA on, Face ID on this device | Password, then **Face ID instead of the code**. One prompt. "Use my 2FA code instead" is one tap away if Face ID fails. |
| 2FA on, anywhere else (new device, browser without Face ID set up) | Password, then the code, as before. |
| 2FA off | Password only. |

- **No lock straight after sign-in.** The Face ID lock doesn't prompt
  again right after a fresh sign-in; it comes back only when the app is
  opened again later.
- **Two-factor is optional.** It stays off unless the client turns it on,
  and Settings now says so and explains that Face ID replaces the code on
  a Face ID device.
- **Turning two-factor off** from a session where Face ID stood in for
  the code asks for the code once. Supabase only removes a factor from a
  session that proved the code.

**Fixed along the way (security): the 2FA code could be skipped by
refreshing.** It was only asked for by login.html's own pop-up. After a
correct password the session already existed, so one refresh (or opening
any portal page directly) went straight in with no code. This was
confirmed on main in a real browser. Every signed-in page, Settings
included, now checks whether the session still owes its second step and
asks for it: Face ID on a Face ID device, otherwise back to the code.

Verified in a real headless Chromium against the real portal pages
(local HTTP, Supabase auth mocked, a virtual authenticator standing in
for Face ID):
- 2FA plus Face ID: password, then 1 Face ID prompt and 0 codes; no lock
  after, and none on the next page.
- 2FA without Face ID: password, then the code; no lock after.
- Refreshing on the code, or opening home.html directly, still asks for
  the code.
- Face ID failing: "Use my 2FA code instead" works.
- 2FA off: no Face ID right after the password, and a reopened app asks
  once.
- Settings: "Turn off two-factor" from a Face ID sign-in asks for the
  code, then removes it.

New tests: `tests/portal/face-id-over-2fa.test.js` (10). Updated:
`biometric-unlock.test.js` and `settings-mfa-disable-confirm.test.js`
(the lock and the unenroll each moved into their own function).

## What changed, 2026-09-22 (later still) -- Booking flow, round 3: every booker can reschedule online, and the page remembers the visit

`booking.html`, `manage-booking.html` and one new SQL function
(`sql/booking/add_create_booking_rpc.sql`). Full reasoning:
`docs/specialist-logs/features.md` and `visual.md` (2026-09-22 round 3
entries).

**A manage link for everyone.** Rescheduling or cancelling online used
to need the link in the confirmation email. Anyone who booked with only
a phone number had to call. Bookings now go through
`create_booking()`, which makes the same booking (same checks, same
alerts, same double-booking guard) and hands back the visit's private
manage link:
- The confirmation screen shows "Plans change? Reschedule or cancel
  this visit anytime."
- The calendar file and Google Calendar event include the link too.

`create_booking()` is also stricter than the old direct insert:
- It always creates a confirmed booking.
- It can't be used to set internal fields.
- It rejects impossible times, visits in the past, and a blank name.

If the function is ever missing, the page quietly falls back to the old
insert.

**The page remembers.** Come back to the booking page on the same phone
and it says "You're already booked: Appliance Repair, Wednesday at
2:00 PM", with a Reschedule or cancel link, instead of a blank form that
invites booking twice.
- It checks the visit with the server first, so a visit cancelled some
  other way never shows up.
- Past visits drop off by themselves.
- "Forget this device" clears it.
- Only the link and the time are stored, never a name, phone or
  address.

Verified: full suite (the only failure is the known `check-links.py`
sandbox-proxy test), `check-consistency`, `check-undefined-vars`, lint.
The SQL function was exercised live in rolled-back transactions.
Driven in headless Chromium at 390px and 1440px. New tests:
`tests/booking/booking-manage-link-round3.test.js` (12).

## What changed, 2026-09-22 (later still) -- Booking flow, round 4: scheduling from the client portal, as easy as the booking page

Booking-specific portal code only: scheduling an approved quote's job
(`quotes.html`), booking a due check-up (`jobs.html`), and picking a
preferred time on a request (`work-orders.html`). Full reasoning:
`docs/specialist-logs/features.md` and `visual.md` (2026-09-22 round 4
entries).

**One picker, three places.** All three now use the same date picker
as the public booking page (new `createBookingPicker()` in
`js/booking-flow.js`) instead of three separate copies of the old one:
- the whole two weeks load at once, and every day says "3 open",
  "Full" or "Closed"
- it opens on the first day with room
- switching days is instant
- if it can't load, it says so with a Try again button

If the new file ever fails to load, each page quietly uses its old
picker. Nothing about what gets booked, or how, changed.

**A double-booking slip, fixed.** With two quotes (or two check-ups)
open at once, a time tapped in one could be booked by the other's
Confirm button. Picking a time in one now withdraws the other's choice.

**A moment when it's booked.** After scheduling a quote's job or a
check-up:
- the new booked card slides into view
- it gets the same burst of brand-orange flecks as the booking page's
  confirmation
- a "confirmation email is on its way" note appears

**"No times", not "Full".** Late in the day, today used to say "Full"
even with nothing booked. It now says "No times", on the booking page
too.

Verified: full suite (the only failure is the known `check-links.py`
sandbox-proxy test), `check-consistency`, `check-undefined-vars`, lint,
visual snapshot. Driven in headless Chromium at 390px and 1440px on all
three pages, and again with the new file blocked. New tests:
`tests/portal/booking-picker-round4.test.js` (27).

## What changed, 2026-09-23 -- Booking flow, round 2: every change reaches the guest, reminders follow a moved visit, and push notifications stay private

Server side only: edge functions and two SQL files. No page changes. Full reasoning: `docs/specialist-logs/features.md` and `security.md` (2026-09-23 round 2 entries).

**Guests hear about every change.** Rescheduling or cancelling used to send nothing, so the guest's inbox kept showing the old time. Now:
- Moving a visit emails "Your visit has moved", with the old time struck through and a fresh calendar file.
- Cancelling emails "Your visit is cancelled".
- Steve and Connor get a matching "Booking moved" or "Booking cancelled" email.

**Reminders follow the visit.** A visit moved after its day-before reminder went out now gets a new reminder for the new day. It used to get none. The reminder also:
- carries a calendar file and a Google Calendar link
- sends a phone notification to clients who use the portal

**Notifications stay private.**
- Team alerts (new leads, bookings, overdue invoices, the weekly digest) now go only to Triple H's own accounts. They would otherwise have reached any client who turned on notifications in the portal.
- Client notifications (a new invoice, quote, contract or message) could have gone to whichever account signed up most recently. They now go to exactly the right person.

Neither problem had happened yet: every device with notifications on belongs to Steve or Connor.

**Locked down.** The booking email, the reminder and the push notification service now only accept calls from Triple H's own server.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, lint, visual snapshot
- all nine functions syntax-checked
- the database changes exercised live in rolled-back transactions
- every caller of the push service checked before its lock went on

New tests: `tests/edge-functions/booking-notifications-round2.test.js` (23).

## What changed, 2026-09-23 -- Service pages: the "Recent Notes" cards had giant icons

Public site only. Found in a visual audit by loading the pages in a browser.

**What was wrong.** Four service pages (plumbing, drywall & painting, general handyman repairs, assembly & installation) have a "Recent Notes From the Shop" card linking to one blog post. The card's styles live in `blog/blog.css`, and those four pages never loaded it. So the card's two small icons stretched to fill the page: 820×820px on a computer and 327px on a phone. That's about 1,500px of giant toilet, wrench and arrow shapes in the middle of each page. It had been live since the section was added on 2026-09-16.

**The fix.** Each page now loads `blog.css`, the same one line the other four service pages already had. Nothing else on the pages changes. With the stylesheet switched on and off, every computed style outside the card was compared, and only the section's height moved (each page is now about 1,535px shorter).

Verified:
- **Card sizes:** icon 22px, badge 42px, arrow 12px on all four pages, the same as the washer & dryer page, which was always right.
- **Screenshots:** desktop and phone, light and dark mode, and reduced motion.
- **Accessibility:** WCAG 2.2 AA scan clean on all four pages in both themes.
- **Layout shift:** unchanged from before the fix.
- **Checks:** full suite 3173/3174, the only failure being the known `check-links.py` sandbox-proxy test (Unsplash is blocked here). Also clean: `check-consistency`, `check-undefined-vars`, lint, visual snapshot.

New test in `tests/design/blog-index-cards.test.js`: any public page that uses the card markup must load `blog.css` at the blog's own version. The test fails against the old pages.

## What changed, 2026-09-23 -- Pages no longer jump when the fonts load

Public site. Only `styles.css` changes what visitors see; the rest is a checker fix and tests.

**What was wrong.** The site's four fonts (Anton, Oswald, Newsreader, Archivo) load from Google a moment after the page first appears. Until then the browser shows a stand-in font. The 2026-09-10 fix sized the stand-ins by letter *height*. But Anton and Oswald are narrow typefaces, so the stand-ins came out far too *wide*. On a first visit from Windows or a Mac:
- the homepage headline showed on 4 lines, then snapped to 2 once Anton arrived;
- everything below it jumped;
- desktop layout shift (CLS) was 0.22–0.29, where Google's "poor" line is 0.25.

On Android, Linux and ChromeOS the stand-ins never applied at all. The rule named only `local('Arial')`, and those systems have no font by that exact name.

**The fix (`styles.css`).**
- Each stand-in is now sized by measured text *width*, at the weights and letter case the site really uses. Examples: Anton 71.8% of Arial, Oswald 80%.
- Each family now has two stand-ins:
  - an Arial-metric one: Arial on Windows, Mac and iPhone; Liberation Sans on Linux; Arimo on ChromeOS;
  - a Roboto one for Android.
- Roboto has to be named `'Roboto Regular'`; `local('Roboto')` matches nothing (checked in the browser).
- The city/service hero paragraph is capped at `640px` instead of `64ch`. The two are identical once Newsreader loads. But `ch` is measured from whichever font is showing, so the cap itself changed width at the swap.
- Arrows (→) aren't in Oswald at all, so they're drawn by the stand-in even after load. They keep their old size, so they look the same as before.

**Measured** in headless Chromium, holding the font files back until the page has painted:

| | Before | After |
|---|---|---|
| 8 page types × 6 widths, Windows/Mac fonts | CLS 2.953 in total, worst 0.313 | **0.260**, worst 0.087 |
| Same, Android fonts | 2.133, worst 0.297 | **0.204**, worst 0.051 |
| Homepage at 51 widths (360–1440px): widths with CLS above 0.1 | 28 | **2** |

**Once the fonts have loaded, nothing moves.** A pixel comparison against production matched exactly under Windows/Mac conditions, on 9 page types in both themes at desktop and phone widths. On Linux and Android the only visible changes make them match Windows and Macs: arrow glyphs, and the homepage estimate form's Service dropdown (39px → 46px tall, as Windows and Macs already show it).

**Also fixed: the cache-bust checker had stopped seeing 16 pages.** The city and service pages moved into `locations/` and `services/` on 2026-09-21. `scripts/check-consistency.js` only scanned the root, `tools/`, `portal/` and `blog/`, so `npm run fix-versions` would have left those 16 pages on a stale `styles.css`. That's the first thing this change would have hit. Both folders are scanned now.

Verified:
- full suite 3182 of 3183 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars` and `eslint` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites (403), no internal link broken;
- checked at 375px and desktop, dark and light, and with reduced motion on.

New tests:
- `tests/design/fallback-font-metrics.test.js` (7): condensed faces shrink, every stand-in names fonts that resolve, overrides match the real metrics, stack order, the arrow carve-out, and the lede cap.
- `tests/site-wide/global-stamp-scan-dirs.test.js` (2): the checker scans both folders, and every city/service page's stamp is current.

## What changed, 2026-09-23 -- The top banners no longer push the page down, and fit on phones

Public site: the homepage, the 7 city pages and the 8 service pages, which are the 16 pages that show the WELCOME15 and "we're hiring" banners.

**What was wrong.**
- **Desktop.** Both banners were filled in by scripts that ran only after the page had painted. On every first visit, the header and hero jumped down 85px a moment after appearing. That's a layout shift (CLS) of 0.059 on its own, before anything else on the page.
- **Phones.** Each banner wrapped its close button (×) onto a line of its own under the text, making each one 89px tall. Together they took 178px of the first screen. The × was a 21×20px target.

**The fix.**
- The two banner scripts now run the instant their empty boxes are read, before the header exists. The first paint already has the banners at full size, so nothing below them moves. Visitors who dismissed a banner never see it flash.
- `hiring-banner.js` now has a cache-bust stamp like every other shared script, and `npm run fix-versions` tracks it. Without the stamp, the service worker would have fetched it from the network before every page view. With it, return visits load both banners from the service worker's cache (checked).
- Phone layout: text on the left, the × on the right on the same row, and a 44×44px tap target. The text is unchanged. The one tweak is that "$35–$100+" no longer breaks across two lines.
- A banner set in **Tools > Site Content** still replaces the promo text and looks exactly as before.

**Measured** in headless Chromium, throttled (150ms latency, 1.6 Mbps, 4× CPU) with the fonts delayed 1s:

| | Before | After |
|---|---|---|
| Desktop first visit, service page: CLS from the banners | 0.059 | **0.0006** |
| Hero text first painted, same runs (3-run average) | 2.10s | 2.01s: no slower |
| Banner height at 375px / 320px | 89px / 89px | **47px / 47px** |
| Both banners at 375px | 178px | **94px** |
| Close button | 21×20px, on its own line | **44×44px**, beside the text |

The banner scripts now block rendering, but the page doesn't paint later. On some runs the banner text paints on its own about 0.5s before the rest, which makes raw first-contentful-paint look faster than it really is. The hero row is the fair comparison.

Desktop banners are 45px tall instead of 43px. Nothing else on desktop changes. Checked on the homepage, a service page and a city page, for first visit, both dismissed, and one dismissed, at 1440, 375 and 320px, in dark and light themes with reduced motion. axe finds no target-size, contrast or button-name issues.

Verified:
- full suite 3206 of 3207 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites (403), no internal link broken;
- CSP untouched: the scripts are same-origin, so `script-src 'self'` covers them;
- no SEO metadata or JSON-LD touched.

New test: `tests/design/site-banner-no-layout-shift.test.js` checks:
- placement and stamps on all 16 pages;
- parse-time behaviour for first visit, both dismissed, and one dismissed;
- that the Site Content override still wins;
- the one-row CSS.

`promo-banner.test.js` and `hiring-banner.test.js` now expect the synchronous, stamped tags.

## What changed, 2026-09-23 -- "Reduce motion" now stops every animation on the public site

Public site: `styles.css`, the homepage's back-to-top button, and `js/triage.js`.

**What was wrong.** Visitors who turn on "reduce motion" (iOS, Android, macOS and Windows all have the setting) are supposed to get a still page. The site's rule for that only reached ordinary elements, not the decorative `::before`/`::after` layers. So for those visitors:
- the green "open now" dot on the homepage kept pulsing forever;
- the "how it works" timeline line and the blog/about heading underlines still drew themselves in, over about a second;
- the service-area diagram's lines and city dots stayed hidden for up to 1.15s and then popped in, because the rule zeroed animation lengths but not their start delays;
- the back-to-top button and the "what's wrong with it?" answer still scrolled smoothly, because a smooth scroll requested in script overrides the page-wide setting.

**The fix.**
- The reduced-motion rule now covers `::before`/`::after` and zeroes delays too.
- Back-to-top and the triage answer jump instead of gliding when reduced motion is on.
- Nothing changes for everyone else.

**Measured** in Chromium with reduced motion emulated:
- perceptible animations on the homepage went from 5 to **0**;
- about, a service page, a city page and a blog post are all at **0**;
- screenshots of the settled pages are pixel-identical to before, apart from one strip of live text that also differs between two loads of the old build;
- with reduced motion off, every animation still plays.

One smooth scroll is left for the booking lane: the service pop-up's jump to the schedule form. It's logged in `docs/specialist-logs/features.md`.

Verified:
- full suite 3211 of 3212 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites, no internal link broken;
- CSP, SEO metadata and JSON-LD untouched.

New test: `tests/design/reduced-motion-coverage.test.js` (5) covers:
- the rule's selectors, and zeroed durations and delays;
- that the pseudo-element animations it has to reach still exist;
- every explicit smooth scroll on the public site, which must have a reduced-motion fallback;
- the triage and back-to-top scrolls, run in JSDOM with and without reduced motion.

Four of the five fail against the old code.

## What changed, 2026-09-23 -- Keyboard users can skip the menu on every page, and the 404 page is fixed

Public site: about, our-work, the 11 blog pages and the 404 page.

**What was wrong.**
- **Missing skip links.** Most public pages have a hidden "Skip to main content" link that appears on the first Tab press, so keyboard and screen-reader users can jump past the menu. About, our-work and every blog page didn't have one. On desktop that meant 12-13 Tab presses through the header before reaching the content.
- **404 page.** It had no main-content landmark, so screen readers had nowhere to jump. Its big orange "404" was a smeared, fake bold: the heading font (Anton) comes in one weight only, and the page never told the browser not to thicken it.

**The fix.**
- Those 13 pages get the same skip link the rest of the site uses.
- The 404 page's content now sits in a `<main>`, and the "404" uses Anton's real weight.

**Checked:**
- On all 13 pages, the first Tab shows the link, and Enter then Tab lands on the first link in the content. Tested in dark and light, at desktop and phone widths.
- axe: the 404's `landmark-one-main` and `region` failures are gone, and the other pages now pass its `skip-link` rule.
- Screenshots match main pixel for pixel, apart from the "404" digits.

**Not changed:** `careers.html` still has no skip link, because the careers/privacy scope question is still open. The booking pages belong to the booking lane.

Verified:
- full suite 3246 of 3247 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites, no internal link broken;
- no CSS, SEO metadata or JSON-LD touched, apart from the 404 page's own inline style.

New test: `tests/design/skip-link-and-main-landmark.test.js` checks every public page that has a header:
- a skip link before `<header>`;
- that the link targets the page's single `<main>`, whose id is unique;
- the 404 page's `<main>` and its heading weight.

Excluded pages each carry their reason. 15 of the tests fail against the old pages.

## What changed, 2026-09-23 -- The phone menu looks right in light mode, and its sub-lists read as sub-lists

Public site: the mobile (hamburger) menu, on every page that has one. CSS only.

**What was wrong.**
- **Light mode.** The phone menu stays dark in both themes, but its dividers, arrows and theme switch followed the light theme. So light mode drew bright white lines across the dark menu, dimmed the Services/Areas arrows, and turned the Dark Mode switch into a light pill.
- **Both themes.** The Services and Areas sub-lists were meant to be smaller, normal-case, dimmer links indented under their heading. A later rule overrode that styling, so they looked exactly like the main links (all caps, full size), each with its own uneven underline. Their tap areas also overlapped.
- **Short dividers.** The line under the Services and Areas rows stopped short of the arrow.

**The fix.**
- The menu now uses the dark theme's colours in both themes. The dividers are a see-through white, so they show as the same faint line on the menu's slightly different dark in each theme.
- The sub-links get their intended style back, as full-width 44px rows.
- The Services and Areas dividers run the full width.

**Measured** with the menu open at 375px:
- **Dividers, light mode:** 10.6:1 against the panel before (a bright line); 1.5:1 after, a hairline like dark mode's 1.4:1.
- **Arrows, light mode:** 3.5:1 before, 7:1 after, the same as dark mode.
- **Sub-links:** 51px boxes overlapping at a 31px pitch before; 42px rows at a 44px pitch after, full width, with no sideways scroll at 320px.
- **Menu closed:** pages are pixel-identical to before in both themes.

Verified:
- full suite 3250 of 3251 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites, no internal link broken;
- CSP, SEO metadata and JSON-LD untouched.

New test: `tests/design/mobile-menu-dark-panel.test.js` (4; all fail against the old CSS). It checks:
- every themed colour token the menu reads is pinned to its dark value (the list is worked out from the CSS itself);
- the divider is translucent;
- the row divider spans the arrow;
- the sub-link rule out-ranks the general menu-link rule.

## What changed, 2026-09-23 -- The 404 page's buttons match the rest of the site

Public site: `404.html` only.

**What was wrong.** On 2026-09-07 the site retired its glossy gradient buttons (U01): one flat orange button for the main action, with a quieter outlined partner. The 404 page keeps its own copy of the button styles, so it can still show if the main stylesheet fails to load, and that copy was never updated. It still showed two glossy gradient buttons of equal weight: blue "Back to Home" and orange "Call".

**The fix.**
- "Call (435) 414-1667" keeps its orange, now as the site's flat orange button with the solid offset shadow.
- "Back to Home" becomes the quieter outlined button. That's the same pairing as the homepage's Schedule and Call buttons.
- Hover, press and keyboard-focus feedback now match the rest of the site, and the hover lift is turned off for visitors who ask for reduced motion.

**Checked** at desktop and 375px, including hover and keyboard focus, next to the homepage hero buttons:
- the orange, shadow and outline all match the rest of the site;
- button text contrast is 7.5:1 (Call) and 7.9:1 (Home).

Verified:
- full suite 3254 of 3255 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites, no internal link broken.

New test: `tests/design/404-button-language.test.js` (4; all fail against the old page). It checks:
- no gradients;
- exactly one filled primary (Call) and one outlined partner (Home);
- the orange fill and shadow use `styles.css`'s own colours;
- the outline, focus ring and reduced-motion styles match the rest of the site.

## What changed, 2026-09-23 -- Tapping on a phone no longer leaves things "stuck" highlighted

Public site: `styles.css` only. Desktop looks and behaves exactly as before.

**What was wrong.** Phones treat the last thing you tapped as "hovered" and keep it that way until you tap somewhere else. So after a tap:
- homepage service cards stayed raised with a blue border;
- review cards did the same, and they aren't even buttons;
- the Call button in the phone's sticky Call/Book bar stayed tinted;
- the photo viewer's next/previous arrows stayed highlighted.

It looked as if those items were selected.

**The fix.**
- Hover effects that change a surface (lifts, shadows, borders, backgrounds, photo brightness) now only apply on devices with a real mouse or trackpad.
- On touch, the filter chips, "what's wrong" pills, service-area links, gallery photos and chat bubble now shrink slightly while you press them. Buttons already did this.
- Text-link colour changes and the desktop Services dropdown work as before; iPads open that dropdown by tapping.

**Checked** in Chromium:
- **Desktop:** mouse-hovering 18 kinds of card, chip, button and link gives exactly the same styles as before.
- **Touch:** after a tap, none of them keeps a hover look (service cards and review cards did before).
- **Press feedback:** the new press states apply (checked with a mouse press, because headless Chromium doesn't simulate touch presses).

Verified:
- full suite 3258 of 3259 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites, no internal link broken.

New test: `tests/design/touch-no-sticky-hover.test.js` (4; all fail against the old CSS). It checks:
- no hover rule that changes a surface is left outside `@media (hover:hover)`;
- the card, chip and button hovers are all guarded;
- keyboard focus styles still apply everywhere;
- the new press states exist.

## What changed, 2026-09-23 -- Blog cards no longer stay highlighted after a tap

Public site: `blog/blog.css`, plus its version stamp on the 22 pages that load it. Desktop is unchanged.

**What was wrong.** The same phone quirk as the previous entry, on the one set of cards it didn't reach. On the blog index, and in the "Recent Notes" cards on 8 service pages, a tapped card kept its blue border, deeper shadow and orange title.

**The fix.** The card's hover effect now only applies on devices with a mouse or trackpad. Keyboard focus keeps exactly the same highlight.

**Checked** on the blog index and a service page:
- mouse hover and keyboard focus look identical to before on desktop;
- after a tap in touch emulation, the card no longer keeps the hover look.

Verified:
- full suite 3259 of 3260 passing; the one failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing outside sites, no internal link broken.

Tests:
- `touch-no-sticky-hover.test.js` now also scans `blog/blog.css` (its new check fails against the old file);
- `blog-index-cards.test.js` checks the hover and focus rules separately.

## What changed, 2026-09-23 -- Shift clock, part 1: Start my day / End my day (the data behind it)

The first of three parts. It adds a whole-day punch clock, like
Paylocity, **beside** the job clock from rework part 9. This part is the
storage, sync and rules only; the buttons (part 2) and the Dashboard's
hours card (part 3) come next. Nothing on screen changes yet. Full
reasoning in `docs/specialist-logs/features.md`.

**Two clocks, two questions.** The job clock says how long a job took,
and fills the invoice's Labor line. The shift clock says how long you
worked today, driving, estimates and the time between jobs included.
They're independent: a job clock never needs you clocked in, and ending
your day never stops a job clock. The job clock works exactly as before.

**How it works:**
- **Each person has their own shift**, by the account they're signed in
  with. Steve and a helper punch in and out separately, and it syncs to
  every device like jobs do.
- **Hours round like the job clock** (0.1 h; under a minute is a mis-tap
  and counts nothing) and count on the day the shift started, so a late
  call that runs past midnight counts on the day it began.
- **Forgot to clock out?** A shift still open after 14 hours stops
  counting and needs an end time. Ending it asks when you finished, and
  suggests when the last job clock that day stopped, instead of
  recording 24 hours. Starting the next day asks the same first.
- **Forgot to clock in?** Start my day can offer to start from when you
  started the first job clock that day.
- **Typed-in times are checked:** the end after the start, nothing in the
  future, no more than 24 hours, and no overlap with your other shifts.
- A deleted shift can be restored from Dev Tools' Graveyard, and stays
  deleted when an old device syncs.

Verified:
- full suite 3300 of 3301 passing; the one failure is the known
  `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars` and `eslint` clean;
- `check-links.py`: the only failures are the sandbox proxy refusing
  outside sites, no internal link broken.

Tests: `tests/tools/shift-clock.test.js` (18). The job clock's and Your
week's tests are unchanged and pass.

## What changed, 2026-09-23 -- Shift clock, part 2: the Start my day / End my day button

Part 2 of 3. Part 1 was the data behind it. Full reasoning in
`docs/specialist-logs/features.md`.

**Clock in for the day, clock out at the end, from any page.**
- **On a phone or tablet,** a clock button sits at the top right, before
  Search and More:
  - plain when you're off;
  - a **green pill with your start time** while you're on shift;
  - an **amber dot** when a shift needs an end time.
- **On a computer,** the same thing is a row under **New** in the
  sidebar: "Start my day", or "On shift, since 7:42 AM".
- It stays still (no ticking seconds), so it never gets confused with
  the job clock's orange bar at the bottom. The two run independently.

**Tap it and one sheet does the rest:**
- **Start my day:** now; or from when you started the first job clock
  today, if you forgot to clock in; or from a time you type.
- **End my day:** now, with an **Undo**; or at a time you type. If a job
  clock is still running it says so, and leaves it running.
- **Forgot to clock out?** The next time you open it, it asks "When did
  you finish?" and suggests when your last job clock stopped that day.
  Save that, and it goes straight on to starting today. A shift started
  by mistake can be deleted from there (it's kept in Dev Tools'
  Graveyard).
- A time that can't be right (before the start, in the future,
  overlapping another shift) is explained in plain words and nothing is
  saved.
- On pages that don't load the job data (Route Planner, Appliance Wiki,
  Settings, Runway), the button shows your status and opens the sheet on
  the Dashboard.

Checked in headless Chromium (local HTTP, fake Supabase), no console
errors:
- **390px:** all three header states and all three sheets.
  - Start from the job-clock suggestion, then End with Undo.
  - A typed end time before the start shows its error and saves nothing.
  - The forgotten clock-out: save the suggested end time (8.8 h), then
    start today.
  - Delete with its confirm.
  - Settings and Runway hand off to the Dashboard with the sheet open.
- **1440px:** the sidebar row, next to a running job clock's bar.

Verified:
- full suite 3321 of 3322 passing; the one failure is the known
  `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and
  `check-visual-snapshot` clean.

Tests: `tests/tools/shift-clock-shell.test.js` (14). The job clock's
tests are unchanged and pass.

## What changed, 2026-09-23 -- Shift clock, part 3: Hours worked on the Dashboard

The last of three parts. Full reasoning in
`docs/specialist-logs/features.md`.

**A new card under Your week: Hours worked.**
- **Your day, with one button:** "Not clocked in" with **Start my day**;
  "On shift since 7:42 AM, 2 h 18 min so far" with **End my day**; or,
  if you forgot to clock out, "Your shift from Tue needs an end time"
  with **Fix it**. Each opens the same sheet as the clock button at the
  top of the page.
- **This week in green bars,** Monday to Sunday, then Today and This
  week, with last week under it. It counts whole shifts: driving,
  estimates and the time between jobs. Your week, just above, still
  shows time on the job clock, in orange. The two are separate.
- **Everyone's hours,** for accounts that can see finance (Owner and
  Developer by default): who's on shift, and each person's hours today,
  this week and last week. A forgotten clock-out shows as "Shift needs
  an end time" and counts nothing, so it can't inflate anyone's week.
  Everyone else sees only their own. Who gets to see the team is listed
  in `docs/ACTION-ITEMS.md` for Steve to confirm.

Checked in headless Chromium (local HTTP, fake Supabase), no console
errors: the card off, on shift and waiting on an end time, and the team
table (you on shift, Connor off, a helper with a forgotten clock-out).

Verified:
- full suite 3367 of 3368 passing; the one failure is the known
  `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, `eslint` and
  `check-visual-snapshot` clean.

Tests: `tests/tools/shift-hours-card.test.js` (8). Your week's and the job
clock's tests are unchanged and pass.

## What changed, 2026-09-23 -- Booking flow, round 2 is live, plus a gentler scroll on the homepage

Round 2 (the entry "Booking flow, round 2: every change reaches the guest…" above) was built and merged earlier today, but not yet switched on. It is now live. Full results: `docs/specialist-logs/features.md` and `security.md` ("round 2 is live" / "round 2 deployed").

**What's switched on now:**
- Guests get an email when they move or cancel a visit, and the day-before reminder follows a moved visit.
- Team alerts go only to Triple H's own accounts, and client notifications go to exactly the right person.
- The booking email, the reminder and the push service only accept calls from Triple H's own server.

**How it was checked.** Every server function was downloaded again after it went live and compared line by line with the reviewed code: identical. Each one was also called twice. Once with the public site key, which must be refused, and it was. Once the way the real triggers call it, which must work, and it did. The new "booking moved or cancelled" trigger was run end to end on a practice booking inside a transaction that was then undone, so nothing was sent. It queued exactly the right emails and notifications and re-armed the reminder.

**One small hardening.** The new trigger is locked down the same way as every other trigger in the database: nothing but Triple H's own server can run it directly. This was tested first to confirm it can't stop the trigger from firing.

**Homepage.** Visitors who ask their device for reduced motion now jump straight to the booking form after "or schedule online" in a service card, instead of getting an animated scroll.

Verified:
- full suite 3262 of 3263 passing; the only failure is the known `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars`, lint and visual snapshot clean;
- Supabase security advisors: nothing new.

New test: `tests/booking/booking-entry-reduced-motion.test.js` (2; both fail against the old scroll). Updated with reasons: `booking-notifications-round2.test.js` now expects the trigger lockdown, and its lookup-SQL check uses plain text matching (this closes a CodeQL warning).

## What changed, 2026-09-23 -- Booking: one safe way in, the symptom tool books from every page, tidier portal styles

The loose ends from today's booking work. Full reasoning: `docs/specialist-logs/features.md` ("booking-flow follow-ups"), plus `security.md` and `visual.md`.

**Bookings only come in the safe way now.** The online booking page has used a checked, server-side booking step since earlier today. The old back door, which let anyone holding the site's public key write a booking row directly, is now closed. Through it, a booking could be created already cancelled, linked to someone else's job, or marked "reminder sent" so no reminder ever went out. Guests book exactly as before. The Dev Tools booking test still works, and so does portal scheduling. This was tested on the live system before and after, and no booking was created.

**The "is it worth fixing?" tool books from every page.** On the homepage, tapping an appliance and a symptom and then "or book a visit online" already opened the booking page with Appliance Repair picked and the symptom in the notes. The same tool on the 8 city pages and 4 appliance service pages now does the same thing.

**Portal styles in one place.** The styles for the portal's appointment picker were copied onto three pages; there's now one copy. Nothing looks different: every style of every picker element was compared in a browser before and after.

**Checked and dropped:** adding the picker's script to the portal app's offline cache. It turned out it wouldn't be used, and it would have made installed apps show an update prompt every time that script changes.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, lint, visual snapshot;
- the database change was tested live, before and after, for every kind of caller;
- Supabase security advisors: nothing new.

New tests:
- `tests/booking/booking-direct-insert-lockdown.test.js` (6);
- the triage hand-off on all 13 pages that carry the tool (in `booking-flow-picker-and-confirm.test.js`; all fail against the old script).

Updated with reasons: the round 1 hand-off tests and the round 4 page-style test.

## What changed, 2026-09-23 -- Dev Tools: the booking test explains the emails it sends

Tools only (the Dev Tools page). When you run the booking notification test, moving and cancelling the test booking now also send the team a "Booking moved" and a "Booking cancelled" email. That's the round 2 booking work. The test's description and its step-by-step results now say so, so those emails don't look like a surprise. They also note that the test booking has no email address, so no guest email is sent.

Verified: full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, lint, visual snapshot. New test: `tests/dev-tools/booking-test-copy.test.js` (3).

## What changed, 2026-09-23 -- Tests: no more booking exception in the reduced-motion check

Tests only, no change to the site. The check that every smooth scroll on the public site respects "reduce motion" had one exception: the homepage's "or schedule online" scroll, which the booking work has since fixed. The exception is removed, so the check now covers every page with no exceptions.

Verified: full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, lint, visual snapshot. Putting the old scroll back makes the check fail.

## What changed, 2026-09-23 -- Deleted inventory parts no longer come back after a sync

Finance's Inventory tab, and Dev Tools' Graveyard. Nothing else changes.

**What was wrong:**
- **Deleted parts came back.** Deleting a part recorded that it was
  deleted, but the sync never checked that record for inventory (it
  does for every other kind of item). So an older copy on another device
  put the part back the next time it synced.
- **A deleted part couldn't be restored.** It went to Dev Tools'
  Graveyard, where it showed as "inventory: Deleted item", and Restore
  said "Unknown record type".

**The fix:**
- Sync now skips inventory parts that were deleted, the same way it
  already does for jobs, invoices, expenses and the rest.
- The Graveyard lists a deleted part by name and part number, and
  Restore puts it back.
- A new test reads the app's own lists, so any future kind of item that
  records deletions, or goes to the Graveyard, can't be missed the same
  way.

**Found, not fixed yet** (details in `docs/specialist-logs/bugfix.md`):
- Restoring anything from the Graveyard is undone by the next sync.
- Deleted notes and "Flag this page" items can come back from an older
  device.

Verified:
- full suite 3372 of 3373 passing; the one failure is the known
  `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars` and `eslint` clean.

Tests: `tests/sync/tombstone-coverage.test.js` (new); 3 more in
`tombstones-extended.test.js` and `graveyard.test.js`. All of them failed
before the fix.

## What changed, 2026-09-23 -- Restoring from the Graveyard now sticks

Dev Tools' Graveyard, and sync. Nothing else changes.

**What was wrong.** Restoring anything from the Graveyard (a job, an
invoice, a client, a part, a shift, an Appliance Wiki entry) only lasted
until the next sync. Then the record was deleted again, and it showed up
in the Graveyard again. The same happened to "Delete permanently". So
with cloud sync on, Restore didn't really work.

**Why.** Restoring erased this device's record that the item was deleted,
but the cloud copy still had that record. The next sync brought it back,
and the item was deleted again.

**The fix:**
- **Restoring keeps the deleted record and marks it restored**, and that
  mark travels to every device.
- **Deleting the same item again later still works**, because a newer
  delete wins over an older restore.
- **The Graveyard hides entries that were restored or permanently
  deleted**, and they stay hidden after a sync.

Verified:
- full suite 3406 of 3407 passing; the one failure is the known
  `check-links.py` sandbox-proxy test;
- `check-consistency`, `check-undefined-vars` and `eslint` clean.

Tests: `tests/sync/graveyard-restore-sync.test.js` (new: two devices and a
cloud copy, restoring, deleting again, and the Graveyard list). All 7
failed before the fix.

## What changed, 2026-09-23 -- Your week and Hours worked are now one Dashboard card

Dashboard only. The two cards showed almost the same thing and took two
screens on a phone, so they're merged into Your week.

**What the card shows now:**
- **Your day at the top:** Start my day, "On shift since 7:42 AM" with
  End my day, or Fix it for a shift that needs an end time.
- **One bar per day:** green for the hours you worked, with a narrower
  orange bar for the time on the clock on jobs. A small key says which
  is which. If you haven't used Start my day this week, the bars are the
  same orange job-clock bars as before.
- **The totals:** Worked, On the clock, Jobs done, and Billed (for anyone
  who can see finance). They sit two by two on a phone.
- **Everyone this week:** the team's hours are a fold-away list under the
  totals, closed until you tap it. It's still only for people who can see
  finance.

Nothing about the job clock changes.

Verified:
- full suite passing apart from the known `check-links.py`
  sandbox-proxy test;
- `check-consistency`, `check-undefined-vars` and `eslint` clean;
- checked in a browser at phone and laptop width.

Tests: `tests/tools/shift-week-card.test.js` (9, new) replaces
`shift-hours-card.test.js`. `your-week.test.js` passes unchanged apart
from its fake page element.

## What changed, 2026-09-23 -- Start my day: the time field no longer overlaps its button on a real phone

Workspace tools only. On a real iPhone, the "Start my day" sheet's "STARTED EARLIER?" time field and its "Start from then" button could overlap -- reported directly with a screenshot. Local testing in Chromium never showed it: real iOS Safari's native time picker has a minimum width that CSS can't shrink, wide enough to overflow that row next to the button, while Chromium's own (narrower) time input hid the problem. Fixed by stacking the field above the button on phone-width screens instead of trying to out-shrink the native control.

Verified: full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`. Checked visually at 390x844 with the sheet open -- the field and button now sit on separate rows. No test file references these classes, so no test changes were needed.


## What changed, 2026-09-23 -- Site content: a safe editor with real undo, and the Google rating + review count move into it

Tools (`tools/site-content.html`), the public homepage, booking page, and the fridge, dishwasher, and washer/dryer repair pages. Nothing looks different on the public site.

**Updating the reviews is now:** open Dev Tools &rarr; Content, change the number, press **Review &amp; publish**, check it, publish. Live within a few seconds. No branch, no PR, no deploy.

**What the editor does now:**
- **Plain labels and the right input for each field.** Star rating (1.0 to 5.0, one decimal), number of reviews (a whole number), two banners (up to 200 characters, character-limited), hours per day (Open with time pickers, Closed, or custom text), phone, and email.
- **Mistakes are caught as you type.** A rating of 6, a review count of 0, a phone number missing a digit: each shows a plain-English error and blocks publishing.
- **Nothing goes live without a review step.** Each change shows what's live now next to what it becomes, with warnings for things that are allowed but unusual: a review count going down, an email address typed into a banner (that exact mistake went live for 6 seconds on 2026-08-16), a banner hiding the WELCOME15 offer.
- **Undo.** The top of the editor always shows the last save with an **Undo this save** button. Each field keeps its recent changes, with a button to put back any earlier value.
- **No more silently overwriting someone else's edit.** The old "Save all" wrote every field every time, so a tab left open could quietly undo a newer change. Now only the fields you touched are sent. If someone changed one after you opened the page, nothing is published and you're shown the latest value. An undo is refused the same way if the field has changed again since.

**The database enforces it, not just the page** (`sql/site-content/cms_safe_publish_and_undo.sql`, applied live):
- A check refuses a bad rating, review count, phone, email, or oversized text from any source, even with this page bypassed.
- Publishing is all-or-nothing through `cms_publish_content()`; undo goes through `cms_undo_content()`. Both run as the signed-in user, so the existing "Site content" permission still decides who can write.
- Every change is logged with which save it belonged to, so a whole save can be undone together. New fields and deletions are logged now too.
- Tested live in a transaction that always rolls back: 7 &rarr; 8 &rarr; undo &rarr; 7, a stale edit refused, a 6.0 rating refused, a stranger's account refused. Security advisors: nothing new.

**Rating and review count** used to be typed into 11 places across 5 pages. They now come from `site_content` (seeded with today's 5.0 and 7) through the new `js/review-stats.js`: every "5.0 from 7 Google reviews" line, the two homepage stats, and the homepage's search data (`aggregateRating`). The HTML keeps the real values as a fallback if the fetch fails. Below a 5.0 rating, the stats label becomes "Real Google Reviews" instead of "Real 5-Star Reviews", and the stars round.
- **Proven identical:** 20 element screenshots of every spot, before and after, in real Chromium, with and without reduced motion, are byte-for-byte the same, and so is the search data. A first version wrapped the numbers in new spans. That shifted the text after them by a fraction of a pixel on the booking page (348 pixels differed), so the numbers are now rewritten inside the existing text instead.

**Left in code on purpose:** booking hours (they control the real booking slots; the editor says so) and the policy amounts ($25 trip fee and referral credit, $50 cancellation). Changing those is a policy change, not a text edit.

**Access is unchanged:** the page gate, the database permission, two-factor login, and the dev password all still apply.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`;
- the migration run for real in the test suite and live;
- before/after screenshots.

New tests, 106 in all, most of them against the real migration SQL running in Postgres-in-WASM (PGlite, a new dev dependency):
- `tests/site-content/cms-safe-publish-db.test.js` (41);
- `tests/site-content/site-content-editor.test.js` (29): the real page script against that database, including save &rarr; undo &rarr; the original value back exactly;
- `tests/site-content/review-stats-public.test.js` (36).

Updated with reasons: `tests/design/homepage-stats-bar.test.js` (allows the new hook classes).

## What changed, 2026-09-23 -- Graveyard restore: three gaps closed after #393

Dev Tools' Graveyard and the Appliance Wiki's sync. Follows the earlier "Graveyard Restore now survives the next sync" fix (#393).

- **The Appliance Wiki's sync now merges before it sends.** It used to replace the server's copy with whatever the device had. A device that hadn't picked up a restore, or someone else's new Wiki entry, could erase it. It now merges first, the same way the main sync does.
- **Restoring works on a device that never saw the delete.** Restore used to mark only a "deleted" note already on the device. If there wasn't one, the server's note won and the record disappeared again. Now the device writes its own "restored" note.
- **A restored client no longer blocks recreating that client by name** when client records are rebuilt from jobs.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`.

Tests:
- `tests/sync/graveyard-restore-every-type.test.js` (22, new): every Graveyard type, plus the 3 fixes above, which fail without this change.

## What changed, 2026-09-23 -- Cron Health: stopped flagging things that aren't cron failures

Dev Tools only. Cron Health was showing a run of "HTTP call failed -- status 401" alerts, reported directly with a screenshot. Checked the actual pg_cron job history: every real cron job run in that window succeeded, and the alerted timestamps didn't line up with any job's schedule. The watchdog was scanning every HTTP call this project's database ever makes -- including the notification triggers (new lead, booking changes, portal messages, etc.), which call the same Postgres extension cron jobs do -- and treating any non-2xx response as a cron failure, whoever actually made the call.

Fixed by having each cron job record which job made a given HTTP call before it fires, so the health check can only ever alert on a response to a call a cron job actually made. The alert now also names which job failed, instead of a bare "HTTP call failed." The already-open false-positive alerts were marked resolved; a real cron failure still alerts exactly as before.

Verified: full suite (3522/3523, the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, and a fresh admin re-run of the health check against the live database confirmed 0 open alerts. New tests: `tests/dev-tools/cron-health-scoped-to-cron.test.js` (8).

## What changed, 2026-09-23 -- Website in the tools menu for whoever edits the site

The site content editor (`tools/site-content.html`: Google rating and review count, banners, hours, phone, email, FAQ, Terms) now has its own **Website** row in the tools menu: the desktop sidebar and the phone/tablet More drawer, between Appliance Wiki and Dev Tools. Until now the only way in was Dev Tools &rarr; Content, which still works.

- **Only for accounts that can edit the site.** The row uses the same check the editor page uses (`canManageSiteContent()`, the "Site content" permission, `account_roles.can_manage_site_content`). Owner and Developer accounts (Steve, Connor) see it. Anyone else never does.
- **Hidden until confirmed.** The other permission-gated rows are drawn visible and hidden once the account's permissions arrive. This one works the other way: it starts hidden and appears only after the permissions confirm it. So it never flashes up for someone who can't use it, and it stays hidden if the permissions can't be checked (offline, for example).
- **Nothing else changed.** The editor keeps all its own access checks. The row is a shortcut, not a new way past them.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint` on the changed files;
- `npm run fix-versions` re-stamped `tools-nav-pwa.js` where it loads and bumped the tools service worker's cache name.

Tests:
- `tests/tools/website-nav-entry.test.js` (8, new): a site-content manager sees the row. Anyone without the permission never does: not before the permissions load, not after, not with every other permission. Two of the tests run the real `auth.js` against an `account_roles` response. All 8 fail without this change.
- `tests/tools/app-shell-v2.test.js`: the More drawer's row list now includes Website (hidden for that test's account).
- `tests/tools/job-tracker-calendar-view.test.js`: the sidebar now has 13 destinations, not 12.

## What changed, 2026-09-23 -- Tests no longer fail every evening and night

Tests only; nothing on the site or in the tools changed. Five tests depended on the time of day, so from late afternoon (Denver time) until about 10 PM, CI failed on main and on every open PR:
- **Three booking tests** tapped the second or third time slot of the first day with room. Late in the day that day is today, with only one slot left. They now tap the last slot shown:
  - `tests/portal/booking-picker-round4.test.js`;
  - `tests/booking/booking-manage-link-round3.test.js`;
  - `tests/booking/booking-flow-picker-and-confirm.test.js`.
- **Two Start my day / End my day tests** (`tests/tools/shift-clock-shell.test.js`) built shifts that started "3 hours ago". From midnight to 3 AM UTC (CI runs in UTC) that start was yesterday, so they failed. That file now runs in a fixed-offset time zone where it's always about midday.
- **A failing test there also hung CI for 40+ minutes** instead of failing. Its open page kept the test run alive. Every page that file opens is now closed after each test, pass or fail.

## What changed, 2026-09-23 -- Tools: page changes no longer flash, and going back Home no longer looks like the app starting up

Tools (`tools/`) only: `styles-tools.css`, `tools-nav-pwa.js`, `workspace.html`, and `runway-dashboard.html`'s own copy of the shell CSS. No page's data or logic changes.

**Checked first:** a real in-place page swap (an SPA-style app shell) was weighed and turned down on 2026-09-21, because every tool page relies on a full unload to clean up its realtime channels, timers, and page state (`docs/specialist-logs/features.md`). What shipped then was the cross-document view transition. It was supposed to hide the reload, but it didn't, for the reason below. No other app-shell work exists in any branch or PR. So this fixes the transition rather than replacing it.

**Why it flashed.** The transition captures the new page at its first frame. On every tool page, that frame arrived before `tools-nav-pwa.js` had built the bottom bar, sidebar, header buttons, and page padding, because the script waits in line behind supabase-js, sync.js, and five other scripts. Measured in Chromium at 4x CPU slowdown, the shell was missing at that first frame on 15 of 15 navigations and arrived 150-220ms later. So the old bar faded out with nothing under it, and then the new one popped in.

**What changed:**
- **The old screen holds until the new one is complete, then crossfades.** It's pure CSS: nothing blocks rendering, and the new page keeps loading underneath. The hold ends when the shell is in, or after 1.2s at most; past that, the page shows the way it used to. The bottom bar and sidebar stay solid the whole way, so the shell never dips.
- **The tab you tap lights up immediately.** If the next page takes longer than 150ms, a thin orange line runs along the top until it arrives, so short hops never show it. The line clears if you come back with the back button, or if you answer "Stay" on Site content's unsaved-changes prompt.
- **"Welcome back" shows once per session.** The full-screen card with the logo used to appear on every return to the Dashboard. It showed up after the page had loaded and took every tap for 1.7s. It now appears on the first open of the session, and again when a different person signs in.
- **The Dashboard's first frame is a skeleton, not wrong numbers.** It used to open on "Good morning." and "0 jobs today" whatever the time and the real count, with empty cards that jumped to full height once the sync finished. Next Job, Money Owed, Rest of Today, and the greeting now open on the same shimmer used by the Finance, Invoices, and Contracts lists.
- **Reduced motion** follows the site's standard. Everything that moves happens instantly, but the hold still applies, so the cut goes straight to a finished page. The loading line becomes a still line.

Nothing waits longer than before. In the same measurement, a complete first frame arrived as early as it used to or earlier, and the link itself behaves exactly as it did.

**Not tested here:** Safari. The hold is standard CSS (view transitions, `:has()`, `:only-child`) that Safari 18.2+ supports, but only Chromium could be run here. Browsers without view transitions navigate exactly as before.

Verified:
- full suite: the only failure is the known `check-links.py` sandbox-proxy test. The clock-dependent booking and shift-clock tests that failed overnight were fixed in #404, which merged first;
- `check-consistency`, `check-undefined-vars`, `check-visual-snapshot`, `eslint`;
- frame-by-frame screencasts in Chromium at 390px and 1440px, in dark and light themes, with and without reduced motion.

Tests:
- `tests/tools/page-handoff.test.js` (18, new): the hold rules and their reduced-motion override in both stylesheets, the shell adding its class in one synchronous pass, the tap feedback and loading line in jsdom (including back-button restores and a cancelled leave), the once-per-session welcome, and the Dashboard skeletons, which the first render always replaces.

## What changed, 2026-09-23 -- The WELCOME15 offer and the hiring notice can be changed or turned off from the editor

Public site banners and Tools &rarr; Site Content. With nothing changed in the editor, the banners look exactly as before.

**What was wrong:**
- The WELCOME15 offer and the "We're hiring" notice were written into the code, so changing the offer or ending the hiring push needed a code change.
- The editor's "Banner 1" and "Banner 2" silently took over the same two spots, dropping the close button and the usual styling, and only on some pages.
- 17 pages had the banner spots but never showed anything in them: About, Our Work, Careers, Terms, Privacy, the blog, and the St. George page.

**Now, in Tools &rarr; Site Content &rarr; "Banners at the top of the site":**
- Each banner has three choices: the built-in wording, **My own message** (up to 200 characters, with an optional link to Book online, the Careers page, or Our Work), or **No banner**.
- Your own message looks exactly like the built-in banners, close button included. Someone who closed an old message still sees a new one.
- Picking "My own message" without typing one is flagged and can't be published. The review step shows each change next to what's live, with warnings (turning off the offer, replacing the hiring notice).
- **Undo this save** puts all of it back, the same as every other field.
- Banners now show on all 33 public pages that have the spots. The hiring notice skips the Careers page itself.

**Why a change shows from the next page:** the banners are drawn before the rest of the page, so they can't wait for the internet. Each page shows what that visitor's browser saw last time, then checks for changes. A change that would make the page jump waits for the next page they open. Pages never jump under a visitor (that jump was fixed earlier today).

**Database** (`sql/site-content/cms_site_banners.sql`, applied live):
- Adds `banner1Mode`/`banner2Mode` (built-in, custom, or off) and `banner1Link`/`banner2Link`.
- The database refuses any other choice, or any link that isn't one of the three pages.
- Both modes start on built-in, which is what the site shows today.
- Tested live in a transaction that always rolls back: a custom message with a link, plus the hiring notice off, saved as one change; undo put back exactly the built-in banners; a made-up link or mode was refused.

**Proof it looks the same:** 64 screenshots of both banners, taken before and after the change on the 16 pages that had them, at desktop and phone size in real Chromium, are byte-for-byte identical. The header doesn't move, and layout-shift scores are unchanged.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`;
- the migration run for real in the test suite and live;
- before/after screenshots.

New tests:
- `tests/site-content/cms-site-banners-db.test.js` (10), against the real SQL;
- `tests/site-content/site-banners-public.test.js` (50): the first frame, the "never jump" rule, dismissing, safe text and links, and the wiring on all 33 pages;
- 9 new banner flows in `tests/site-content/site-content-editor.test.js`, including save &rarr; undo &rarr; exactly the built-in banner again;
- a guard in the same file that no function name is declared twice in the page. The FAQ/Terms editor, built alongside this, had its own `cmsShort()`, and a second declaration silently replaces the first.

Updated with reasons:
- `tests/design/promo-banner.test.js`, `hiring-banner.test.js`, and `site-banner-no-layout-shift.test.js`: pointed at the new `js/site-banners.js`, with every original check kept and the exact old markup pinned;
- `tests/design/reduced-motion-coverage.test.js`: the file list;
- `tests/site-content/site-content-editor.test.js`: its banner warning test picks "My own message" first.

## What changed, 2026-09-23 -- The booking, manage-booking, and not-found pages follow the saved phone number

Public site (`booking.html`, `manage-booking.html`, `manage-job.html`, `404.html`) and `tools/site-content.html`. Nothing looks different today.

**Before:** changing the phone number in Dev Tools &rarr; Content left these four pages on the built-in (435) 414-1667, and the editor told the owner to ask Connor to change them by hand.

**Now they follow it, like the other pages.** That covers the header number, the confirmation screen's "call or text" line, the 404 Call button, every Call link, and the error messages these pages show ("Please call us at ..."). If the fetch fails, each page keeps the built-in number exactly as before.
- Only classes were added to the existing links. No new elements, since an extra `<span>` once shifted the booking page's text by a fraction of a pixel.
- The number is rewritten inside the link's own text, so the header's phone icon and the 404 button's "Call" stay put. Nothing is rewritten at all when the saved number is the built-in one.

**Proven identical in real Chromium, desktop and phone:**
- 27 element screenshots of every spot on the four pages, including the confirmation screen, the error messages, "Nothing open online", and the 404 hover state;
- 18 whole-screen screenshots of the same states, so a spot that moved on the page would show too.

Main and this change are byte-for-byte the same with the fetch failing, with today's saved values, and with reduced motion (135 of 135). So are each spot's position, text, and link. With a different saved number, all 27 spots show it and none shows the old one.

**The editor's "Phone and email" note** no longer names these four pages. It now names the spots that still keep the built-in number, found while doing this:
- every "text us" link;
- some Call buttons and sentences on the homepage, About, Our Work, Careers, blog, and appliance-repair pages.

A new test fails if that list of pages changes, so the note stays accurate. Details are in `docs/specialist-logs/bugfix.md`; fixing them is a separate change.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`;
- `fix-versions` bumped the service worker's cache name.

Tests:
- `tests/site-content/contact-hooks-public.test.js` (36, new; 32 fail on main): the real script on the real pages. Today's values and every kind of failed answer leave each page byte-for-byte unchanged. A new number reaches every spot and nothing else; the error messages and "Nothing open online" are driven end to end.
- `site-content-editor.test.js` (+1): the rendered "Phone and email" note. Its built-in-fallback check now covers the four pages too.
- Updated with reasons:
  - `review-stats-public.test.js`: booking's wider fetch;
  - `404-button-language.test.js`: the Call button's new classes;
  - `skip-link-and-main-landmark.test.js`: a script may follow 404's `<main>`, nothing that renders;
  - the "no token" tests in `manage-booking.test.js` and `manage-job.test.js`: still no RPC call without a token, but the public phone/email read now happens.

## What changed, 2026-09-24 -- Dev Tools: regrouped so the thing you need is quick to find

Tools only (the Dev Tools page). A layout and cleanup pass: no check, button, or list works any differently.

The page had 32 panels under 6 tabs, and several tabs mixed panels that didn't belong together (Known issues, Graveyard, and Flagged pages under Notifications; Storage browser under Deploy; Client registry under Access). Each panel now sits with the others that answer the same question:

- **Health** -- is anything broken right now? Run full health check (moved here from above every tab), then Uptime monitoring, Cron health, and Client errors, which load by themselves, plus Live consistency check and Advisor health.
- **Data** -- is the business data clean, and can it come back? Data quality check and Data integrity check; the Graveyard and Backup & restore; and what's stored: Client registry, Appliance Wiki health, Storage browser.
- **Sync** -- this device: Session & sync, Sync conflicts, Local data snapshot, Service worker & cache, Device info.
- **Notifications** -- the push and booking tests, Push notification history, Recent bookings.
- **Ops** -- Deploy history, Regression checker, What's new; the to-do lists (Known issues, Flagged pages); Trigger workflows and Quick links.
- **Reports** is unchanged. **Access** is now just Account permissions.

Inside each tab:

- **Named sections.** Each tab is split into a few labelled groups, such as "Live status" and "Run a check", instead of one stack of identical cards.
- **Live panels are cards, tools are rows.** Panels that show live information stay open. Tools you only reach for now and then are collapsed one-line rows with a short hint, such as "Data quality check: Duplicate client names, jobs missing a date or client". Click a row to open it. It stays open for the rest of the browser session. Four panels that used to be always open are now rows: Appliance Wiki health, Local data snapshot, Service worker & cache, and Device info.

Also:

- **Steve's view.** An account without "Dev Tools (full technical)" now sees two tabs: Data (Client registry only) and Access (Account permissions). Both panels used to share the Access tab.
- **Links keep working.** `#backup` (from Settings and the Dashboard) now opens the Data tab at Backup & restore. The old `#nav-content` link still goes to the site content page.
- **Phones.** The tab bar used to stick out 2px past each screen edge, so the page could be dragged sideways. It now fits.
- The page's own help text, two panels' "?" texts, and the Dev Tools locations in `DISASTER_RECOVERY.md` now match the new layout.

Verified:

- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`;
- in headless Chromium, dark and light, desktop and 390px: every tab, the Owner view, and `#backup`. Clicked through the old and new pages side by side (full health check, a data check, a "?" on a collapsed row, the permissions editor, backup download, the Graveyard list): same results on both;
- `npm run fix-versions` re-stamped `dev-tools-shared.js` where it loads and bumped the tools service worker's cache name.

Tests:

- `tests/dev-tools/dev-tools-regroup.test.js` (9, new): the exact tab, section, and panel layout; all 32 panels present once; every element a panel writes into still on the page; the full health check on the Health tab; `#backup` landing on Data; every row wired the same way; no empty section heading for an Owner; no `<section>` elements; the phone tab bar width. 8 of the 9 fail against the old page. The 9th (every element still present) is a guard and passes on both.
- `tests/dev-tools/dev-tools-tabs.test.js` and `tests/dev-tools/dev-tools-reports.test.js`: updated for the new tab names and order, and for the Owner now seeing Data and Access.

## What changed, 2026-09-24 -- CI no longer fails on Mondays or from October on, and a stuck test run stops after 20 minutes

Tests and CI only; nothing on the site changes. Follows #404, which fixed the evening failures.

- **The Dashboard week-card test failed all day every Monday.** In UTC, the timezone CI runs in, that's roughly 8 PM Sunday to 8 PM Monday Mountain. The test starts a shift "2 hours ago" and expected Monday to show only an earlier, finished shift. On a Monday the new shift counts toward Monday too. The file now runs on a pinned Thursday-morning clock (`tests/fixed-clock.js`), so it gives the same answer any day.
- **Two Job Tracker calendar tests would have started failing on Sep 30 at 6 PM Mountain, and never stopped.** They meant to show September 2026, where their sample jobs are, but only ever saw the current month. They passed only because they were written in September. They now step to September 2026 with the calendar's own month arrows.
- **The CI `test` job now stops after 20 minutes.** A normal run takes about 7. A test that never finished used to hold the job, and block the PR, for GitHub's 6-hour default.

Verified:
- the week-card test fails on `main` on Mondays (Sep 28, Oct 5, Nov 2) and passes with the fix at every time checked;
- the calendar tests fail on `main` in every month but September 2026 (checked through September 2027) and pass with the fix in all of them;
- the whole suite, run under a faked clock at 18 moments, has nothing else that depends on the hour, day or month. Those moments cover every day of the week, a month boundary, the Nov 1 time change, New Year 2027 and March 2027;
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`.

## What changed, 2026-09-24 -- The booking picker test taps the second time again

Tests only. Nothing on the site changed.

The "Tests no longer fail every evening and night" change above (#404) fixed `tests/portal/booking-picker-round4.test.js` by tapping the last open time instead of the second. This puts the second time back, which is what the test was written to check, without the evening failure:

- The file's picker windows now run on a fixed clock, the suite's shared weekday morning from `tests/fixed-clock.js` (Thursday, October 1, 9 AM Mountain), so the time of day no longer matters. On the real clock, today has one time left from 5:30 to 6 PM Mountain (3:30 to 4 PM on Sundays), which is why a second time couldn't be tapped.
- If the picker's first day ever has fewer than two times, the test now says so plainly instead of failing with "Cannot read properties of undefined".

Verified:
- the original failure reproduced on the real clock at 5:40 PM MDT, and with the clock pinned to 5:45 PM on a weekday and a Saturday and 3:45 PM on a Sunday. The fixed file passes at those times, at every half hour from 1:15 to 10:45 PM on a Wednesday and a Sunday, and on the real clock inside the window;
- full suite on the branch merged with main (3703/3704 on the real clock at 8:49 to 8:56 PM MDT; the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint` on the changed file.

## What changed, 2026-09-23 -- FAQ and Terms: review before publishing, and a real undo

Tools only (`tools/site-content.html`); the public FAQ and Terms look exactly the same.

**What was wrong:**
- **Every save replaced the whole list.** It deleted every question and added them all back, so every save changed every item's id. The history filled up with deletes and re-adds, and "Restore this value" usually pointed at an item that no longer existed.
- **A blank answer quietly deleted the question.** Clearing a question or answer by accident took it off the live site with no warning.
- **A tab left open could wipe out someone else's newer edits** when it saved.

**Now:**
- **Review & publish** lists every change before anything goes live: questions added, edited, removed, and moved. Each shows what's live next to what it becomes, and removals get a warning.
- A blank or too-long field, or two questions with the same wording, is flagged on the item and blocks publishing. The database refuses these too.
- Saving changes only what you changed. Edited questions keep their identity, so history lines up.
- If the list changed since you opened the page, nothing is published. You're shown the latest version with your edits still in place.
- **Undo this save** puts the whole list back the way it was, including order and anything removed. It's refused if something in that save has changed again since. "Restore this value" in the history goes through the same review step.

**Database** (`sql/site-content/cms_faq_terms_safe_publish.sql`, applied live):
- History keeps full before/after copies, grouped by save.
- Checks refuse blank, untrimmed, or oversized text.
- `cms_publish_faq`/`cms_publish_terms` and `cms_undo_faq`/`cms_undo_terms` run as the signed-in user, so the "Site content" permission still decides.
- Tested live in a transaction that always rolls back: move and edit an FAQ, undo restores all 15 items exactly, a stale save is refused, a blank answer is refused. Security advisors: nothing new.

Verified:
- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`.

Tests (31 new, against the real SQL in PGlite):
- `tests/site-content/cms-faq-terms-db.test.js` (21);
- `tests/site-content/faq-terms-editor.test.js` (10): the real page script, including edit + add + delete + move, then undo, with every row back exactly.

Updated with reasons:
- `tests/security/site-content-and-private-buckets-rls.test.js`: every CMS write is now a `cms_*` RPC sent with the session token, and the test now also fails if a direct table write comes back;
- `tests/tools/escape-attr-audit.test.js`: FAQ and Terms share one row template, so it pins that template's `escapeAttr` calls.

## What changed, 2026-09-24 -- Every Call, Text, and Email spot on the public site follows the saved phone number and email

Public site (homepage, About, Our Work, Careers, all 11 blog pages, the 3 St. George appliance-repair pages, plus booking/manage-booking/manage-job/404) and `tools/site-content.html`. Nothing looks different today.

**Before:** changing the phone number or email in the site content editor missed some spots. The editor's "Phone and email" note listed them:
- some Call buttons showed the new number but dialed the old one (the homepage's two, About, Our Work, Careers, every blog page, the homepage's "Call Now" and the chat's "Call Instead");
- the "Call (435) 414-1667" buttons at the end of About, Our Work, and the blog posts didn't change at all;
- neither did the same-day FAQ answer on the dishwasher, fridge, and washer/dryer St. George pages, or the Careers "Call or text ... or email ..." line;
- no "Text us" link followed.

**Now all of them follow.** If the fetch fails, every page keeps the built-in number and email exactly as before.
- **Classes only, on the elements that already hold the number.** No new elements.
- **Only the number itself is rewritten**, inside the button's or sentence's own text, so "Call " and the rest of a sentence stay put. Nothing is rewritten at all when the saved number is the built-in one.
- **Text links keep their pre-filled message.** Only the number before `?body=` changes.
- **Google's copy of those FAQ answers changes with them,** so search results never show a different number than the page (the same approach as the Google rating).
- **Also fixed:**
  - the homepage chat panel's "Prefer to text? Message us from your phone at ..." note never followed (few visitors see it: the panel is hidden for a mouse pointer);
  - the Careers form's error message always showed the built-in number and email;
  - the "text" link in the booking pages' "Nothing open online" message used the built-in number.

**The editor's "Phone and email" note** now says every Call, Text, and Email button follows. It names the only two places that don't: the client portal, and the business details Google reads behind the scenes on each page.

**Proven identical in real Chromium** at desktop (1280&times;800), phone (390&times;844) and touch-tablet (820&times;1180) sizes:
- **Every spot on the 22 pages:** 98 of them. That's 263 close-up screenshots and 263 whole-screen screenshots, plus the rendered page at each size (every element, attribute, and text, leaving out only class names and script code).
- **Opened states too:** the homepage's service pop-up and chat panel, the St. George FAQ answers, the phone menu, and booking's confirmation screen after a real booking.
- **Repeatable:** fonts come from a local cache, `Math.random` is seeded, and the page clock is paused and moved forward in fixed steps. Scrolling and the cookie notice settle first, and each shot is retaken until two captures match.

Result:
- 657 of 658 files are byte-for-byte the same as a run of the old pages, and so is the confirmation screen (35 of 35).
- The one other file is a whole-screen shot whose top strip, under the sticky header's blur, varies between runs of the old pages too (6 of 658 did). Retaken, the new pages gave the old bytes exactly.
- The rendered page is identical at all 66 page sizes, so nothing but the added classes changed.
- **With a different saved number and email,** every spot at every size (263 captures) showed the new ones and called, texted, or emailed them. None kept the old ones.
- **After merging main** (which brought the banner change into the same pages), 7 of the pages were re-shot against current main at all 3 sizes, confirmation screen included: 264 of 265 files identical. The other was the same header strip, and main's own runs produced both versions of it.

Verified:
- full suite after merging main: 3786 of 3787 pass. The only failure is the known `check-links.py` sandbox-proxy test.
- `check-consistency`, `check-undefined-vars`, `eslint`: clean.
- `fix-versions` bumped the service worker's cache name.

Tests:
- `tests/site-content/contact-hooks-public.test.js` (now 119; 39 fail on the previous commit):
  - today's values and every failed answer leave all 22 pages byte-for-byte unchanged;
  - a new number and email reach every shown spot and every Call/Text/Email link, and nothing else changes;
  - new tests cover each spot above, plus the rule that a hook on a whole button or sentence only goes where the number-only rewrite runs;
  - the list of pages with unhooked spots is now empty, and the check includes Text links.
- `site-content-editor.test.js`: the new note; the built-in-value check covers every public page.
- Updated: `conversion-polish-sticky-sms-faq.test.js` (the sticky Text button's new class).

## What changed, 2026-09-24 -- Clients: a Delete button on the client page

Tools only. A client can now be deleted from their own page (Clients &rarr; a client), which was only possible before from Dev Tools' Client registry.

- **Where:** the last block on the page, after Contracts, set apart with a red border. It is deliberately not next to Call, Text, or New job.
- **What it removes:** only the client record. Their jobs, invoices, quotes, and contracts stay exactly as they are. The confirm says what stays ("Their 1 job and 1 invoice stay on file."). This is the same delete Dev Tools already used, so the client stays gone after a sync and isn't rebuilt from their jobs.
- **Undo:** after deleting, the page shows "was deleted" with **Undo** and **Back to Clients**. Undo brings back the same client, still linked to their jobs. Later, Dev Tools &rarr; Data &rarr; Graveyard can restore them.
- **Graveyard fixed:** Dev Tools' Graveyard list was always blank because nothing drew it when the page opened, so there was no Restore button. It now shows every deleted record with Restore.

Verified:

- full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`;
- in headless Chromium at 430px, dark and light: the button (44px tall), the confirm (Cancel focused), delete, Undo, and a reload of Clients showing the deleted client gone while their job stays;
- `npm run fix-versions` bumped the tools service worker's cache name.

Tests:

- `tests/tools/client-delete.test.js` (8, new; all fail without this change).

## What changed, 2026-09-24 -- Needs Attention: the Delete button no longer runs off the screen on a phone

Dashboard only. Reported directly with a screenshot: on a real phone, a New Lead or New Applicant card's Handled/Delete buttons could get pushed off the right edge of the screen when the name, phone, and email didn't fit next to them. The row never wrapped and its button group never shrinks, unlike every other list row on this page that already handles this correctly. Fixed to match that same proven pattern: the buttons now drop to their own line, and a long email address can break instead of forcing the row wider than the screen.

Verified: full suite (only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, and a Playwright render at phone width with the same name/email from the report, confirming the Delete button now sits fully on-screen. New tests in `tests/tools/workspace-ops-inbox.test.js` (3).

## What changed, 2026-09-24 -- Finance's Income tab: the active tab no longer overlaps the header

Workspace tools only. Reported directly with a screenshot: on Finance's Income tab, the active tab's label bled up behind the sticky header once scrolled. Confirmed live: the mobile header is 109px tall (its content row is a full 44px, since every header button is a 44px tap target), but `.tabs.tabs-sticky`'s sticky position was set 4px above that, on every page sharing this tab bar (Finance, Job Tracker, Invoice Generator, Clients, Review Request). Fixed by correcting the offset to match the header's real height. `#mainContent`'s "skip to main content" scroll offset had the identical stale assumption and got the same fix.

Verified: full suite (only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, and a live Playwright render confirming the tab bar now sits flush against the header with no gap or overlap. New test in `tests/workspace/finance-split.test.js` proves the arithmetic holds, so this can't silently drift again if the header's own padding or content height ever changes.

## What changed, 2026-09-24 -- The "update available" banner only shows for a real update, and has its own card

Workspace tools only. Reported directly: the "A new version of Triple H is available" banner came up nearly every time the app was opened, and it looked like the plain Add to Home Screen bar.

- **Why it showed every time:** the app's offline cache name changes whenever a cached file changes. In the two weeks before this fix that happened 5 to 22 times a day, so almost every open found a new version and the banner fired. But the page that had just opened had already loaded that new version from the network, so tapping Update reloaded the same thing. Checked in real Chromium, closing and reopening the app between steps: a reopen with nothing deployed never showed the banner, and a reopen after any deploy always did.
- **Now:** a new version arriving only starts a check. The app compares the scripts and styles this page is running with the live copy of the page, and shows the card only when the page on screen is actually behind. Cache-only changes, and updates the page already picked up when it opened, stay silent. Offline, or if the check fails, nothing shows.
- **Caught more reliably:** an installed app is usually resumed rather than reopened, so coming back to it now checks for a new version (at most every 5 minutes). That is the case where a page really can be out of date.
- **One card per page:** a second deploy doesn't stack a second banner, and after Later or X the page doesn't ask again. The next page you open is fresh anyway.
- **Still never automatic:** nothing reloads until you tap Update, so a half-filled form or unsaved notes are never lost.
- **New look:** an "Update ready" card with the brand hex mark and a refresh icon that turns once as the card rises in. It tells you to save your work first and has Update and Later buttons. It clears the phone bottom nav, sits in the lower-right corner on desktop above the Flag button, and on reduced motion it just fades. The Add to Home Screen bar is unchanged and moves out of the way while the card is up.

Verified: the full test suite, `check-consistency`, `check-undefined-vars` and `eslint`. In headless Chromium with a profile closed and reopened between 12 steps, the card appears only when a real change ships while a page is open. Also looked at in dark and light, at 320px, 390px and 1280px. `npm run fix-versions` bumped the tools service worker's cache name.

Tests: `tests/tools/app-update-card.test.js` (11, new; 9 fail on the previous code). One device, several opens: repeat opens with nothing deployed, the first install, an open right after a deploy, a cache-only bump, a real change while open, an inline-script-only change, resuming the app, offline, and Update/Later/X.

## What changed, 2026-09-24 -- Every client PDF now shares one branded letterhead

Invoices, estimates, receipts, portal quotes, job sheets, contracts, the portal service history and the dispute account summary are all drawn by one shared file, `js/pdf-layout.js`. It moved from `tools/` so the portal can load it without any internal tool script. The four portal/Clients PDFs that had hand-copied mastheads now use it too.

- **Print-first design.** A white letterhead replaces the old solid black band: logo, two-tone wordmark, "Handyman & Appliance Repair", tagline, and a contact block. Then a big Anton title with a number/date/due/terms grid, one wrapping table, a totals block that never splits from its subtotal, boxed notes for payment/warranty/estimate terms, and a footer with "Page X of Y" on every page. Page 2+ gets a compact running header.
- **Brand fonts embedded.** Anton, Oswald Medium and Archivo (regular/semibold), Latin subsets in `fonts/pdf/` (~98 KB, OFL). Fetched once per page load; if that fails the PDF falls back to Helvetica with the same layout. The Workspace service worker precaches them.
- **Stamps.** Portal receipts get a PAID stamp and approved/declined portal quotes an APPROVED/DECLINED one. The stamp is drawn in reserved space beside the totals, so it can't cover text. This replaces the fixed-position circle and its `y >= 255` workaround.
- **Invoices show a Due date** computed from the terms (`thInvoiceDueDate`).
- **Long text wraps.** Job descriptions, addresses and line-item descriptions used to be drawn as a single line and could run past the margin.
- **No street address on any document.** The registered address is the owner's home. Contracts used to print it; now every document shows the city line only. Business Compliance keeps it internally.
- **The "not attorney-reviewed" note is no longer printed on contracts.** It was a note to the owner, not the client. It stays on the Contract Generator page itself.
- Checked by rendering every document type with real jsPDF from the real page code and inspecting the output, including a 3-page invoice, 2-page contracts and a 3-page service history.

## What changed, 2026-09-25 -- Work-order photo uploads are limited to the uploader's own folder

Security, LOW (ACTION-ITEMS #17, from the 2026-09-23 audit). The `work-order-photos` Storage bucket's only upload policy checked the bucket name and nothing else. Any signed-in account, including a stranger who signed up, could upload any file of any size at any path. A rolled-back probe against the live policy confirmed a client could write `anything/evil.exe`, or into another client's folder. Nobody could read files back (staff only) or overwrite them (no update policy), so this was spam and storage cost only.

- **Why the path is scoped to the account, not the work order:** `portal/work-orders.html` uploads photos *before* the work order row exists. Clients have no update policy on work orders, so photos can't be attached afterwards. At upload time there's no work-order id to check against. The old path, `submissions/<time>-<random>/<n>.<ext>`, had nothing tied to the caller at all.
- **The page** now uploads to `submissions/<your user id>/<time>-<random>/<n>.<ext>`, and uploads nothing if the session is gone.
- **The policy** (`sql/security/scope_work_order_photo_uploads_to_own_folder.sql`) only accepts that exact shape, with the second folder equal to the caller's own `auth.uid()`. Any other path is an RLS denial: another account's folder, the old unscoped shape, the folder root, or extra depth.
- **The bucket** takes images only, up to 8 MB, the same limits the page already enforced in the browser. Before this it had neither.
- **Unchanged:** staff still see every photo in Clients (the one existing photo, uploaded under the old path, still opens). There's still no client read, overwrite or delete.
- **Deploy order:** the page went live first, then the migration. The old policy already accepted the new path, so no real upload ever failed.
- **Still open:** any signed-in account can fill its own folder. Turning signup off (ACTION-ITEMS #11) removes strangers from that.

Verified:

- the full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`;
- a dry run of the new policy against the live database, in a transaction that rolled back: the caller's own folder was allowed (two clients and a staff account); another client's folder, the old shape, an arbitrary path, the folder root, extra depth and a wrong prefix were all RLS denials (42501);
- the live results after deploy are in `docs/specialist-logs/security.md` (2026-09-25).
- `npm run fix-versions` bumped the portal service worker's cache name.

Tests:

- `tests/security/work-order-photos-upload-scope.test.js` (9, new). It runs the page's real `uploadSelectedPhotos()` against a port of the policy. Two fail on the old page code.

## What changed, 2026-09-25 -- Three new blog posts for symptoms the "Is it worth fixing?" tool lists

Public site only. The symptom tool (`js/triage.js`) lists 20 symptoms across 5 appliances. Only 5 had a blog post, one per appliance, always the first symptom in the list. This adds three more, picked for search intent and so they don't compete with an existing post:

- **`blog/washer-leaking-water.html`**: "Washer Leaking Water? Where the Puddle Is Tells You What Failed." Door seal, hose connection, or pump, and how where and when the water appears points to which one. What to do until it's fixed (shut off the supply valves), and what looks like a leak but isn't (a backed-up standpipe, too much detergent).
- **`blog/dryer-wont-turn-on.html`**: "Dryer Won't Turn On? It's Usually a Switch or a Fuse, Not a Dead Dryer." Breaker, plug and control lock first, then the door switch, thermal fuse and start switch. A hum with no drum movement points elsewhere.
- **`blog/dishwasher-not-draining.html`**: "Dishwasher Not Draining? Standing Water Is Usually Just a Clog." Filter first, then where it drains to: a new disposal's knockout plug, a clogged sink drain, a kinked hose, the air gap. Don't pour drain cleaner in.

Each post says what that symptom's triage entry says (the `v` and `a` text) and adds general repair knowledge. No prices, no percentages, no claims about call volume. Same template as the existing posts: `.blog-diagram` lead image, Article + BreadcrumbList JSON-LD dated 2026-09-25, one in-body link, a Call CTA, two "More from the shop" links. Like every existing post, booking is reached through the shared nav and footer. No post links to the symptom tool.

Where they're listed: the blog index (13 cards now), the "Recent Notes From the Shop" lists on `washer-dryer-repair.html`, `washer-dryer-repair-st-george-ut.html` and `dishwasher-repair-st-george-ut.html`, and `sitemap.xml`. `washer-wont-drain.html` and `dishwasher-not-cleaning.html` each gained one in-prose link to the new post their text already mentioned.

Images: the washer post uses the reserved bathroom-laundry photo from `docs/ACTION-ITEMS.md`. The dryer and dishwasher posts reuse their sibling posts' photos, because this environment can't reach any image CDN. Swap them in if better photos turn up. ACTION-ITEMS.md also gets a Search Console "request indexing" item for the three URLs.

Verified:
- full suite 3866 of 3867 passing; the one failure is the known `check-links.py` sandbox-proxy test, which fails the same way on main here;
- `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` clean;
- `check-links.py`: every internal reference resolves across all HTML files. The only external failures are the sandbox proxy refusing every Unsplash image, including the 10 existing posts' images;
- rendered the dryer post at 390px and 1280px (no horizontal scroll, "September 25, 2026 · 3 min read") and the blog index's new cards.

Tests: the new pages are added to the hard-coded page lists in `blog-index-cards`, `analytics-events`, `mobile-nav-collapsible` and `privacy-policy-page`. The public-page counts go from 33 to 36 in `site-banner-no-layout-shift` and `site-banners-public`, and the Call-button page count from 12 to 15 in `contact-hooks-public`. `check-links.py`'s `PUBLIC_PAGES` gets the three new URLs.

## What changed, 2026-09-25 -- Turning on two-factor in Settings no longer forgets "Remember me"

Bug fix (found by the security lane while working on server-side MFA enforcement). After turning on two-factor from Settings, a "Remember me for 30 days" sign-in ended as soon as the browser closed.

- **Cause:** Settings stores the new session Supabase issues after the code checks out with `persistSession({...}, undefined)`, meaning "keep it where it already is". `persistSession()` in `tools/auth.js` passed `!!rememberMe` to `storeSession()`, and `!!undefined` is `false`. So `storeSession()` treated it as an explicit "don't remember": the session moved from localStorage to sessionStorage and lost its `remember_until`.
- **Fix:** `persistSession()` now passes `undefined` through. `storeSession()` already handles `undefined` by keeping the current store and `remember_until`, as it does for a silent token refresh. The 30-day cap keeps its original date; turning on two-factor doesn't restart it.
- **Unchanged:** login.html always passes a real true/false from the checkbox, so sign-in behaves as before. Unchecked still goes to sessionStorage and clears an old remembered session.
- `npm run fix-versions` bumped `auth.js?v=` on every tool page and the Workspace service worker's cache name.

Verified: the full suite (the only failure is the known `check-links.py` sandbox-proxy test), `check-consistency`, `check-undefined-vars`, `eslint`.

Tests:

- `tests/tools/mfa-settings-remember-me.test.js` (5, new). It runs the real settings.html and login.html, with the real auth.js, against a stubbed Supabase. It checks where the session ends up after turning on two-factor in Settings (remembered and this-session-only) and after an MFA sign-in with the box checked, unchecked, and unchecked over an old remembered session. The remembered Settings case fails on the old code.

## What changed, 2026-09-25 -- A short Stripe payment no longer marks an invoice paid

`stripe-webhook` used to mark an invoice paid on any successful Stripe payment, without checking the amount. A payment page left open from before the invoice was raised could still pay the old, smaller amount, and the invoice showed as paid in full. (Security audit 2026-09-23, finding #7; ACTION-ITEMS #16.)

- **Paid short:** the invoice stays unpaid in the portal and the Invoice Log, and staff get a push ("Invoice paid short") naming the invoice, the client, and both amounts. `reconcile-stripe-payments` also flags it daily for the week after the payment. Collect the difference, then mark it paid by hand.
- **Overpaid** (the invoice was lowered after Pay was opened, or part of a bulk payment was already marked paid by hand): the invoice is covered, so it's marked paid as before, and staff get an "Invoice overpaid" push to check whether the extra needs a refund.
- **Exact amount:** unchanged. The owed amount is computed the same way `create-payment-intent` and `create-bulk-payment-intent` compute the charge, so a normal payment always matches to the cent. The tests feed each create function's real charge back into the webhook to prove it.
- The alert uses Send-Push's existing staff-only `stripe-reconciliation-alert` type. A failed push never fails the webhook.
- 24 tests run the real webhook handler; 9 fail on the old code. **Needs a deploy:** `stripe-webhook` (with `verify_jwt` off, as now).

## What changed, 2026-09-25 -- Service pages: real, service-specific FAQs and two more blog links

Public site, content only. No layout or CSS changes. Audited all 5 service pages in `services/` side by side. The root-level copies are redirect stubs.

- **The gap was FAQ depth, not blog links.** Each of the 4 thinner pages (plumbing, drywall, handyman, assembly) has linked one on-topic post since #257. Their schema-paired FAQ, though, held the same 5 policy answers as each other and the homepage, word for word. Each "Common Questions" block also ended with the same generic pricing entry.
- **3 new questions per page, all from copy already on the site.** Two replace the generic pricing entry in Common Questions. One leads the schema-paired FAQ, so each page's FAQPage JSON-LD now covers its own service. Sources: the flapper, crack, TV-mount and to-do-list blog posts, and Terms section 6. Local detail comes from the same posts: St. George's hard water, Hurricane well water, St. George's temperature swings, Mesquite open-plan builds. No new prices or policies.
- **Cancellation policy added to all 5 service pages.** None of them stated it before. It uses the homepage's $50 same-day wording plus the reschedule/cancel link `booking.html` sends when an email is given. The trip-fee answer keeps the site-wide sentence verbatim and adds what the city pages already say: most St. George addresses are inside the 15-mile radius, and the Cedar City/Mesquite fee is confirmed before booking.
- **Two blog links added**, cards copied from `blog/index.html`. `assembly-installation.html` now also links "The Small Jobs Everyone Forgets", whose wire-management section covers the cables half of TV mounting. `plumbing-repairs.html` now also links "Dishwasher Not Draining?" (new today on main), whose disposal and sink-drain section is the plumbing page's Drains & Disposals work. The other suggested matches (the TV-mount post on drywall, the new washer-leak post on plumbing, and others) were checked and left out as weak. Reasons are in `docs/specialist-logs/content.md`.
- **No triage tool added.** `js/triage.js` holds appliance data only. A plumbing version is proposed in `docs/specialist-logs/features.md`, not built.
- **Depth:** words that appear on no other service page went from about 270 to about 490 per thin page (washer/dryer: 755).

Verified: full suite 3,903/3,904 (after merging main). The one failure is the known `check-links.py` sandbox-proxy test, which also fails before this change. `check-consistency`, `check-undefined-vars`, `eslint` and `check-visual-snapshot` are all clean. `check-links.py` resolves every internal reference across 91 files; its only failures are Unsplash images the sandbox proxy blocks. Schema text was also checked against visible text on all 5 pages, and every new answer against the blog post, Terms section or page it came from.

Tests: `tests/seo/service-page-faq-depth.test.js` (28, new; 16 fail on the previous commit). It checks that schema text equals visible text, each page has at least one schema question of its own, the cancellation and trip-fee policies match the Terms, no Common Questions entry is copied across pages, and assembly and plumbing link their posts.

## What changed, 2026-09-25 -- A Graveyard sync test no longer fails on a fast CI runner

Tests only. `tests/sync/graveyard-restore-sync.test.js` ("deleted again after a restore") failed once in CI on #426 and passed on a re-run of the same commit.

- **Cause:** `tombstoneCounts` in `tools/sync.js` counts a delete only when `deletedAt > restoredAt`. The strict `>` is on purpose: Restore adds already-lifted tombstones with both stamps equal. The test restores on one device and deletes again on another a few calls later. On a fast runner both stamps land in the same millisecond, the delete ties the restore, and it doesn't count.
- **Fix:** the test waits for the clock to reach the next millisecond before the second delete. A person can't restore and delete again within 1 ms, so the app code is unchanged. No other sync test deletes again after a restore.

Verified: with the devices' clocks frozen, the old test fails every time with CI's assertion and the fixed one passes. Full suite 3,932/3,933. The one failure is the known `check-links.py` sandbox-proxy test. `check-consistency`, `check-undefined-vars` and `eslint` are clean.
