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
has the same line under the subhead, linking to `/#reviews`. No new
reviews, and `aggregateRating.reviewCount` stays 4.

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
