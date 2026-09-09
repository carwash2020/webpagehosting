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
- [What changed, 2026-09-04 through 2026-09-07](#what-changed-2026-09-04-through-2026-09-07)
- [What changed, 2026-09-08](#what-changed-2026-09-08)

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
| `blog/` | **Blog** (added 2026-09-01). `index.html` lists the posts; three posts so far, each a standalone page with its own SEO metadata and Article structured data. `blog.css` extends the main site's brand tokens rather than introducing a separate design system (page headlines use Anton, matching the site's own h1; card-level headlines use Oswald, matching the service/contact cards). Photos are freely licensed Unsplash images, each individually verified before use — see the note under "Do not delete" about why there's no stock-photo shortcut here. |
| `portal/` | **Client portal** (added 2026-08-31, substantially extended through 2026-09-04) — 8 pages covering a client's entire relationship with the business, not just invoice payment: `login.html`, `set-password.html`, `home.html` (landing page, "Needs Your Attention" summary), `dashboard.html` (invoices + Stripe payment), `quotes.html` (review/questions/approval/self-scheduling), `jobs.html` (job history, warranty, check-up reminders), `work-orders.html` (Request Work form + two-way messaging), `settings.html` (saved cards, notification preferences). Deliberately shares NO JavaScript with `/tools/`. **Read `docs/CLIENT-PORTAL.md` before touching anything here** — it's the current, authoritative reference for every page and table; this row is a summary, not a substitute. Only `login.html` is indexable; every other page is `noindex` on purpose. |
| `sitemap.xml` | Lists all 12 live, indexable public pages: the homepage, `booking.html`, the 5 service-area landing pages, the blog index and its 3 posts, and `portal/login.html`. Deliberately excluded: `manage-booking.html` (token-gated, `noindex`), and the portal's `dashboard.html` / `set-password.html` (both `noindex`). Update this and resubmit in Google Search Console any time a page is added or removed. |
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

- `sql/` — every schema/migration/fix file actually run against Supabase, kept as a record of what was done and why. Organized into subfolders by feature area (`booking/`, `leads/`, `site-content/`, `security/`, `infra/`, `portal/`) as of 2026-08-26, since 27 flat files in one folder had stopped being easy to scan. Not meant to be blindly re-run; read each file's own comments first, since some are idempotent and some (the duplicate-cleanup fixes) are meant to run exactly once. **Note `sql/security/fix_authenticated_only_rls_policies.sql` (2026-09-01) in particular** — it documents a real vulnerability that affected seven tables and the general lesson behind it.
- `edge-functions/` — snapshots of every deployed Edge Function's source, for reference/disaster-recovery: `send-push-index.ts` (`Send-Push`, capitalized slug -- Supabase treats function names case-sensitively), `send-lead-email-index.ts` (`send-lead-email`, replaces Formspree), `send-booking-email-index.ts` (`send-booking-email`, added 2026-08-25 with the booking system), `uptime-alert-index.ts` (`uptime-alert`, added 2026-08-25 with uptime monitoring), `advisor-health-index.ts`, and `trigger-workflow-index.ts`. **The client portal's five functions** (`sync-invoice-to-portal`, `send-invite`, `send-invoice-notification`, `create-payment-intent`, `stripe-webhook`) are documented in `docs/CLIENT-PORTAL.md` rather than snapshotted here — including the two non-obvious constraints (`stripe-webhook` must run with `verify_jwt: false`, and `sync-invoice-to-portal` forwards the caller's own token rather than the service role key). Restoring any function for real requires the Supabase CLI plus re-adding that function's own secrets in Supabase's own dashboard -- none of those keys are ever stored in this repo.

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
- `backup-sensitive-data.yml` (2026-08-27, replaces the retired `backup-business-data.yml`) — daily, backs up `workspace_sync` (every job, invoice, contract, quote), `th_leads`, `th_bookings`, and every file in the 3 Supabase Storage buckets (`secure-documents`, `job-photos`, `receipts`) to a **separate, private** repo (`tripleh-private-backups`), not this one. Moved out of this repo specifically because `workspace_sync` was found to already contain real, exposed client PII (name/phone/address/email) committed to this public repo's history -- this repo being public was a real constraint the original `backup-business-data.yml` never accounted for. Storage files had no backup coverage anywhere at all before this (confirmed directly: neither the old workflow nor Supabase's own Pro-tier daily backups cover Storage, only database tables) -- see `scripts/backup-storage-bucket.py`, which recurses into the buckets' real subfolder structure (a flat, non-recursive list would have silently backed up zero files). Needs both `SUPABASE_SERVICE_ROLE_KEY` (already set) and a new `PRIVATE_BACKUP_REPO_TOKEN` repo secret -- see the workflow file's own header comment for the one manual setup step (a fine-grained PAT can't be minted via the API, has to be created by hand).
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

`npm test` runs the full suite (1538 tests as of 2026-09-08, all passing) — organized under `tests/` into subfolders (`booking/`, `sync/`, `dev-tools/`, `design/`, `content-quality/`, `tools/`, `workspace/`, `portal/`, `seo/`, `site-wide/`, `edge-functions/`, and more as new areas get covered) by what each test actually covers, rather than one flat folder of files. The script itself is just `cd tests && node --test`; Node's test runner auto-discovers every `*.test.js` file recursively with no arguments needed, so a new test file placed anywhere under `tests/` runs automatically — nothing to add to `package.json` by hand.

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
