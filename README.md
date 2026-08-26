# Triple-H-Enterprise-Webpage

<img src="docs/assets/repo-banner.svg" alt="Triple H Enterprises" width="100%">

[![Tests and consistency check](https://github.com/carwash2020/webpagehosting/actions/workflows/test.yml/badge.svg)](https://github.com/carwash2020/webpagehosting/actions/workflows/test.yml)
[![Check links](https://github.com/carwash2020/webpagehosting/actions/workflows/check-links.yml/badge.svg)](https://github.com/carwash2020/webpagehosting/actions/workflows/check-links.yml)

Source for the live website at **[www.triplehenterprisesllc.biz](https://www.triplehenterprisesllc.biz)**
— Triple H Enterprises LLC, handyman & appliance repair, St. George, UT.
Hosted on GitHub Pages, deployed automatically on push to `main`.

This repo actually serves **two separate things** from the same domain:

1. **The public marketing site** — homepage + 5 city landing pages, meant for customers and search engines. Lives at the repo root.
2. **An internal Workspace tool suite** — Dashboard, Job Tracker, Finance, Invoice Generator, Contract Generator, Route Planner, Calendar, Review Request Sender, Runway Dashboard, Appliance Wiki, Settings, Dev Tools, and Site Content, at `/tools/workspace.html` onward. Not linked from the public site, not indexed, but hosted on the same domain and repo since it's all static files anyway. **As of 2026-08-10, these live under `/tools/`, not the repo root** — see below.

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

## ⚠️ Read this before touching deployment at all

Two things on this specific repo have caused real, hours-long confusion before. Both are cheap to avoid if you know about them going in:

1. **`.nojekyll` must be named EXACTLY that — dot included — sitting at the repo root.** GitHub Pages runs every push through Jekyll by default, even plain static HTML, and Jekyll silently excludes anything starting with a dot (including `.well-known`, and anything similar added in the future). A file named `nojekyll` without the leading dot is a completely different, meaningless filename to GitHub — it will look right in a casual glance at the file list and still not work. If a dot-prefixed path ever 404s on this site, check this filename character-by-character before investigating anything else.
2. **The repo's file listing, and even a "Success" build status, are not reliable enough to confirm what's actually live.** The one source of truth that's never been wrong: **Actions tab → most recent run → Artifacts → download the `github-pages` file → unzip it → extract the `artifact.tar` inside it → look at the literal files.** That's the actual deployed output. Everything else (the repo listing, incognito browser testing, a green checkmark) is one inference away from it and has each individually given a misleading answer at some point on this project.

## Public site — file structure (repo root)

| File | Purpose |
|---|---|
| `index.html` | Main homepage — single-page site (services, reviews, about, areas, schedule, contact/FAQ/terms). Contact form inserts directly into `th_leads` (anon key) -- Formspree was removed 2026-08-24, replaced by a real, in-house Resend email pipeline (see "Booking system" below for the equivalent pipeline on the booking side). |
| `booking.html` | **In-house booking system** (added 2026-08-25, replacing Cal.com entirely -- subscription itself confirmed cancelled). 3-step flow: service → real open time slot → contact info. Phone number auto-formats live to `(XXX) XXX-XXXX` as the guest types; both phone and email get on-theme inline validation (native browser constraint validation was already enforcing a real `@`, this just makes it visible instead of a default tooltip). Redesigned 2026-08-25 with a real desktop layout (a sidebar builds up the appointment summary progressively) and a hexagon icon motif echoing the brand mark. See "Booking system" below for the full picture. |
| `manage-booking.html` | Guest self-service cancel/reschedule, reached via a unique token link in the confirmation email -- **not in the sitemap** (`noindex, nofollow`, deliberately unreachable except through that link). Same design system as `booking.html`. See "Booking system" below. |
| `handyman-hurricane-ut.html` | Dedicated landing page — Hurricane, UT |
| `handyman-washington-city-ut.html` | Dedicated landing page — Washington City, UT |
| `handyman-santa-clara-ivins-ut.html` | Dedicated landing page — Santa Clara & Ivins, UT |
| `handyman-cedar-city-ut.html` | Dedicated landing page — Cedar City, UT (by-request service area) |
| `handyman-mesquite-nv.html` | Dedicated landing page — Mesquite, NV (by-request service area) |
| `sitemap.xml` | Lists all 7 live, indexable public pages (`manage-booking.html` is deliberately excluded -- `noindex, nofollow`, token-gated, not meant for search discovery) — update this and resubmit in Google Search Console any time a page is added or removed |
| `robots.txt` | Allows all crawlers |
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
| `tools/workspace.html` | **Dashboard** — the entry point for the whole suite, organized into 4 tabs: Snapshot (business metrics), Action Items (invoices/leads/new bookings/due-soon jobs), More (Business Health: gallery queue, compliance, analytics, backup/restore — collapsed by default), and Tools (every internal tool, one tap away). Bookmark this one. |
| `tools/job-tracker.html` | Jobs, Contacts (with client history), Notes — 3 tabs, one page. Cost Lookup, Profitability, Income, and Expenses moved out to `finance.html` on 2026-08-20 (see below) — this page is jobs/contacts/notes only now. On a real desktop screen, the Jobs list also renders as a sortable table. |
| `tools/finance.html` | Cost Lookup (with sales tax), Profitability, Income, Expenses (receipt required, mileage rate shared with Route Planner's cost analyzer) — split out of `job-tracker.html` on 2026-08-20 once these four had grown into an entire bookkeeping system living inside a job list. |
| `tools/invoice-generator.html` | Invoice + Quote/Estimate tabs. Tax-aware, per-line "Taxable" toggle. Convert a Quote to an Invoice with one tap. Generates a branded PDF with your Venmo QR built in. Both logs support deleting an entry (added 2026-08-26, with real cross-device delete protection built in from day one -- see "Deletion resurrection / tombstones" in `DISASTER_RECOVERY.md`), separate from the invoice/quote PDF itself, which is unaffected either way. |
| `tools/contract-generator.html` | Fill in a client/job, generate a branded contract PDF to email/text. Has two signature canvases — see the swipe-gesture note below if working on touch gestures anywhere near this page. |
| `tools/route-planner.html` | Multi-stop Google Maps route links + a fuel-cost/sales-tax "to and from" cost analyzer. |
| `tools/review-request.html` | Generates a review-request text message; deep-linkable with a client name/job pre-filled. Also has Google/Yelp QR code tabs. |
| `tools/calendar.html` | Shows jobs flagged "Show on Calendar" from Job Tracker, **plus** (added 2026-08-25) unconverted online bookings from `booking.html` -- fetched once on load and merged in as job-shaped pseudo-objects, visually distinguished with a purple dot and a "Booked online" badge. A booking shows up here the moment it's made, without waiting for anyone to manually add it to Job Tracker. Also subscribed to `th_bookings` realtime changes -- a guest cancelling or rescheduling their own booking through `manage-booking.html` now shows up live here too, not just on the initial load. |
| `tools/runway-dashboard.html` | Personal + business financial runway tracking — debts, income, expenses, month-by-month. Pulls revenue/expenses straight from Finance (`finance.html`), no double entry. |
| `tools/parts-reference.html` | **Appliance Wiki** — quick lookup for common appliance issues: what part it usually is, the part number, roughly what it costs. |
| `tools/settings.html` | Account info, Cloud Sync setup, notification preferences, Color theme — personal, per-device options that don't belong on any one specific tool page. |
| `tools/dev-tools.html` | Site diagnostics and maintenance utilities, organized into 6 tabs (Health, Access, Session, Notifications, Deploy, Reports) as of 2026-08-25 -- replaced the old scroll-to-anchor nav, which no longer scaled once this page reached 22 panels (now 26, after Booking notification test and the 3 new Reports panels). Access is role-gated (`account_roles` table, see `DISASTER_RECOVERY.md`); an Owner-role account only sees the Access tab (Client Registry, Account Roles), while a Developer-role account sees all 6 tabs. Also supports swiping left/right between tabs on mobile, scoped to the panel content area so it doesn't fight with the tab bar's own horizontal scroll. |
| `tools/site-content.html` | Site Content / FAQ / Terms editing — split out of `dev-tools.html` on 2026-08-20. |
| `tools/client-detail.html` | Full history for one client (jobs, invoices, quotes, contracts) — reached from workspace.html or job-detail.html, not linked from the main nav directly. |
| `tools/job-detail.html` | Full detail view for one job (photos, linked invoices, margin) — reached from job-tracker.html or finance.html, not linked from the main nav directly. |
| `tools/login.html` | Auth entry point for the whole suite. |
| `tools/reset-password.html` | Password reset flow, reached from a Supabase auth email link. |
| `tools/contact-card.html`, `tools/job-cost-lookup.html`, `tools/expense-logger.html` | Retired — redirect stubs kept so old bookmarks don't 404. `contact-card.html` redirects into `job-tracker.html`'s Contacts tab (never moved); `job-cost-lookup.html` and `expense-logger.html` redirect into `finance.html`'s Cost Lookup/Expenses tabs (both moved there from Job Tracker on 2026-08-20). |

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

- `sql/` — every schema/migration/fix file actually run against Supabase, kept as a record of what was done and why. Organized into subfolders by feature area (`booking/`, `leads/`, `site-content/`, `security/`, `infra/`) as of 2026-08-26, since 27 flat files in one folder had stopped being easy to scan. Not meant to be blindly re-run; read each file's own comments first, since some are idempotent and some (the duplicate-cleanup fixes) are meant to run exactly once.
- `edge-functions/` — snapshots of every deployed Edge Function's source, for reference/disaster-recovery: `send-push-index.ts` (`Send-Push`, capitalized slug -- Supabase treats function names case-sensitively), `send-lead-email-index.ts` (`send-lead-email`, replaces Formspree), `send-booking-email-index.ts` (`send-booking-email`, added 2026-08-25 with the booking system), and `uptime-alert-index.ts` (`uptime-alert`, added 2026-08-25 with uptime monitoring). Restoring any of these for real requires the Supabase CLI plus re-adding that function's own secrets in Supabase's own dashboard -- none of those keys are ever stored in this repo.

## Cross-device sync — how it actually works (substantially extended 2026-08-25 through 2026-08-26)

Most business data (jobs, invoices, contracts, quotes, clients, expenses, income, contacts) lives as one JSON blob in a single `workspace_sync` row, kept in sync across devices by a **union merge** (`mergeRecordArrays` in `sync.js`) rather than a plain overwrite -- so two devices adding different new records at the same time don't clobber each other.

The real tradeoff that comes with a union merge: it can't tell "this record never existed here" apart from "this record existed here and was deliberately deleted," so a device that hasn't yet pulled a deletion can push its old copy right back and resurrect it. **Fixed with a tombstone per record type that supports deletion** -- every job, client, expense, income entry, contact, contract, invoice, and quote deletion now records one, and every sync pull filters against it. Full detail, the complete list of which record types are covered, and exactly how to extend this to a new one later: see "Deletion resurrection / tombstones" in `DISASTER_RECOVERY.md`.

Deleting something also snapshots it into a separate "Graveyard" (Dev Tools → Session & Sync), so a genuine mistake can actually be restored -- not just prevented from silently reappearing, which is all the tombstones above do. See "Graveyard" in `DISASTER_RECOVERY.md` for the full detail, including the one real limit (a deleted expense's receipt photo isn't recoverable, since that file is gone from cloud storage immediately).

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
- `backup-business-data.yml` — weekly, backs up `workspace_sync` (every job, invoice, contract, quote), plus `th_leads` and `th_bookings` (added 2026-08-25 -- both real, separate tables that had no backup coverage at all until then). Needs the `SUPABASE_SERVICE_ROLE_KEY` repo secret set (Settings → Secrets and variables → Actions), since none of these 3 tables have an anon SELECT policy. The key is referenced by name only in the workflow file — never written into it.
- `uptime-check.yml` — every 10 minutes, the in-house replacement for HetrixTools (requested directly). Checks the live site from GitHub's own network (deliberately external to Supabase -- a `pg_cron` job running inside the database can't wake a paused database back up to run itself), logs every check to `th_uptime_checks`, and calls the `uptime-alert` Edge Function on a real state change (up→down or down→up) only, never on every check during an ongoing outage.
- `check-links.yml` — weekly plus on push, runs `scripts/check-links.py` (internal file references across every HTML file, external links on the 6 public pages only).
- `lighthouse.yml` — daily, scores the live public site against `.github/lighthouserc.json`'s thresholds. Runs on a schedule rather than directly on push, since Pages needs a little time to actually deploy after a push lands.
- `cleanup-artifacts.yml` — daily, keeps only the 3 most recent Actions artifacts of each name. Every push generates a full-site Pages deployment artifact; without this they pile up (275MB across 30 of them was the actual trigger for adding this). Uses the workflow's own built-in `GITHUB_TOKEN` with `permissions: actions: write` — no secret needed for this one specifically.

**Supabase `pg_cron`** (`select * from cron.job;` to see live state):
- `daily-reminder-check` — 1am daily, 11 business-condition checks (see the header comment in `edge-functions/send-push-index.ts` for the full list).
- `weekly-business-digest` — Monday mornings, one summary push AND email (jobs completed, invoiced, new leads, outstanding balance, weekly uptime %) rather than a specific alert — trend awareness, not task nagging. The email half (`REPORTS_EMAIL_FROM` secret) is optional and gracefully skips if not configured, without ever blocking the push half.
- `archive-old-notification-log` — monthly, deletes `notification_log` rows older than 3700 days. That number isn't arbitrary: two of the 11 daily checks use a 3650-day resend interval specifically to nudge only once, ever — retention has to stay longer than the longest resend interval in use, or a "one-time" nudge would silently start repeating once its log row got archived.

**Dev Tools panels** (`tools/dev-tools.html`, organized into 5 tabs as of 2026-08-25 — see the table above) — Storage browser (file counts/sizes across all 3 buckets), Data integrity check (job-photo records vs. actual files, in both directions, plus contact-less leads), Trigger workflows (runs any GitHub Actions workflow on demand via the `trigger-workflow` Edge Function — never a GitHub token in this file), Uptime monitoring (current status, 24h/7d uptime %, recent incidents), and Recent bookings (last 20 bookings regardless of conversion status).

## ⚠️ Do not delete

- **`google0b12c450e3945a19.html`** and **`google523d668a9a330d64.html`** — Google Search Console ownership verification files, one per domain variant. Deleting either breaks Search Console verification for that property.
- **`favicon.ico`** — must stay at repo root.
- **`.nojekyll`** — must stay at repo root, with exactly that filename (dot included). See the warning at the top of this document.

## Known open items

- `trigger-workflow` Edge Function needs a `GITHUB_PAT` secret (Supabase
  dashboard -> Edge Functions -> Secrets) to actually work -- a
  fine-grained GitHub PAT scoped to ONLY "Actions: Read and write" on
  this one repo. **Confirmed working as of 2026-08-16** -- a real
  authenticated request (from Steve's account) triggered a real GitHub
  Actions run, verified via both the Actions run history and the
  Edge Function's own logs.
- Leaked-password protection is still off in Supabase Auth -- a
  dashboard-only toggle (Authentication → Policies), not something
  scriptable via SQL.

**Resolved since first written (kept here briefly for history, not
because they're still open):** the Cal.com subscription has been
cancelled (confirmed 2026-08-25); the accidental lowercase `send-push`
Edge Function no longer appears in the project's function list at
all; `advisor-health` is confirmed actually working (a real request
returned HTTP 200 in the function's own logs, and that function
returns a hard 500 whenever `MANAGEMENT_API_PAT` is missing, so a 200
means the secret is genuinely set and the Management API calls
succeeded).



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

`npm test` runs the full suite (456 tests as of 2026-08-26) — organized under `tests/` into `booking/`, `sync/`, `dev-tools/`, `design/`, `content-quality/`, and `workspace/` subfolders by what each test actually covers, rather than one flat folder of files. The script itself is just `cd tests && node --test`; Node's test runner auto-discovers every `*.test.js` file recursively with no arguments needed, so a new test file placed anywhere under `tests/` runs automatically — nothing to add to `package.json` by hand.

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
