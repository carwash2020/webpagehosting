# Triple-H-Enterprise-Webpage

Source for the live website at **[www.triplehenterprisesllc.biz](https://www.triplehenterprisesllc.biz)**
— Triple H Enterprises LLC, handyman & appliance repair, St. George, UT.
Hosted on GitHub Pages, deployed automatically on push to `main`.

This repo actually serves **two separate things** from the same domain:

1. **The public marketing site** — homepage + 5 city landing pages, meant for customers and search engines. Lives at the repo root.
2. **An internal Workspace tool suite** — Dashboard, Job Tracker, Finance, Invoice Generator, Contract Generator, Route Planner, Calendar, Review Request Sender, Runway Dashboard, Appliance Wiki, Settings, Dev Tools, and Site Content, at `/tools/workspace.html` onward. Not linked from the public site, not indexed, but hosted on the same domain and repo since it's all static files anyway. **As of 2026-08-10, these live under `/tools/`, not the repo root** — see below.

The public site uses one shared stylesheet (`styles.css`, repo root). The tool suite has its own separate stylesheet (`tools/styles-tools.css`) — genuinely two files now, not one shared across everything; see "Shared files" below for what `styles.css` actually still covers.

## ⚠️ Read this before touching deployment at all

Two things on this specific repo have caused real, hours-long confusion before. Both are cheap to avoid if you know about them going in:

1. **`.nojekyll` must be named EXACTLY that — dot included — sitting at the repo root.** GitHub Pages runs every push through Jekyll by default, even plain static HTML, and Jekyll silently excludes anything starting with a dot (including `.well-known`, and anything similar added in the future). A file named `nojekyll` without the leading dot is a completely different, meaningless filename to GitHub — it will look right in a casual glance at the file list and still not work. If a dot-prefixed path ever 404s on this site, check this filename character-by-character before investigating anything else.
2. **The repo's file listing, and even a "Success" build status, are not reliable enough to confirm what's actually live.** The one source of truth that's never been wrong: **Actions tab → most recent run → Artifacts → download the `github-pages` file → unzip it → extract the `artifact.tar` inside it → look at the literal files.** That's the actual deployed output. Everything else (the repo listing, incognito browser testing, a green checkmark) is one inference away from it and has each individually given a misleading answer at some point on this project.

## Public site — file structure (repo root)

| File | Purpose |
|---|---|
| `index.html` | Main homepage — single-page site (services, reviews, about, areas, schedule, contact/FAQ/terms). Contact form posts to Formspree AND mirrors into the internal Leads inbox (see below). |
| `handyman-hurricane-ut.html` | Dedicated landing page — Hurricane, UT |
| `handyman-washington-city-ut.html` | Dedicated landing page — Washington City, UT |
| `handyman-santa-clara-ivins-ut.html` | Dedicated landing page — Santa Clara & Ivins, UT |
| `handyman-cedar-city-ut.html` | Dedicated landing page — Cedar City, UT (by-request service area) |
| `handyman-mesquite-nv.html` | Dedicated landing page — Mesquite, NV (by-request service area) |
| `sitemap.xml` | Lists all 6 live public pages — update this and resubmit in Google Search Console any time a page is added or removed |
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
| `tools/workspace.html` | **Dashboard** — the entry point for the whole suite, organized into 4 tabs: Snapshot (business metrics), Action Items (invoices/leads/due-soon jobs), More (Business Health: gallery queue, compliance, analytics, backup/restore — collapsed by default), and Tools (every internal tool, one tap away). Bookmark this one. |
| `tools/job-tracker.html` | Jobs, Contacts (with client history), Notes — 3 tabs, one page. Cost Lookup, Profitability, Income, and Expenses moved out to `finance.html` on 2026-08-20 (see below) — this page is jobs/contacts/notes only now. On a real desktop screen, the Jobs list also renders as a sortable table. |
| `tools/finance.html` | Cost Lookup (with sales tax), Profitability, Income, Expenses (receipt required, mileage rate shared with Route Planner's cost analyzer) — split out of `job-tracker.html` on 2026-08-20 once these four had grown into an entire bookkeeping system living inside a job list. |
| `tools/invoice-generator.html` | Invoice + Quote/Estimate tabs. Tax-aware, per-line "Taxable" toggle. Convert a Quote to an Invoice with one tap. Generates a branded PDF with your Venmo QR built in. |
| `tools/contract-generator.html` | Fill in a client/job, generate a branded contract PDF to email/text. Has two signature canvases — see the swipe-gesture note below if working on touch gestures anywhere near this page. |
| `tools/route-planner.html` | Multi-stop Google Maps route links + a fuel-cost/sales-tax "to and from" cost analyzer. |
| `tools/review-request.html` | Generates a review-request text message; deep-linkable with a client name/job pre-filled. Also has Google/Yelp QR code tabs. |
| `tools/calendar.html` | Shows jobs flagged "Show on Calendar" from Job Tracker. Doesn't manage its own data. |
| `tools/runway-dashboard.html` | Personal + business financial runway tracking — debts, income, expenses, month-by-month. Pulls revenue/expenses straight from Finance (`finance.html`), no double entry. |
| `tools/parts-reference.html` | **Appliance Wiki** — quick lookup for common appliance issues: what part it usually is, the part number, roughly what it costs. |
| `tools/settings.html` | Account info, Cloud Sync setup, notification preferences, Color theme — personal, per-device options that don't belong on any one specific tool page. |
| `tools/dev-tools.html` | Site diagnostics and maintenance utilities — see "Dev Tools panels" further down for the full list. Access is role-gated (`account_roles` table, see `DISASTER_RECOVERY.md`); as of 2026-08-21, an Owner-role account only sees Client Registry and Account Roles here, while a Developer-role account sees every panel. |
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
| `service-worker.js` | Shared PWA service worker. **Deliberately stayed at the repo root, not moved into `/tools/`**, even though it's mostly tool-related — confirmed it's also referenced by the public site's pages, and a service worker's scope defaults to wherever the file itself lives (not wherever it's registered from), so keeping it at root is what lets one service worker cover the whole site. Has a hardcoded `PRECACHE_URLS` list — if any page referenced in that list ever moves again, this list needs updating too, the same way it did during the `/tools/` move. |
| `images/` | Logos, favicons, gallery photos, OG share image, Venmo QR code. Should contain only actual image files — a past upload mistake once left duplicate copies of `index.html`, `job-tracker.html`, and `styles.css` sitting in here; if any stray HTML/CSS ever turns up in this folder again, it's a mistake, not intentional. |

## Files inside `/tools/` that are NOT shared with the public site

| File | Purpose |
|---|---|
| `tools/sync.js` | The entire cloud-sync engine — push/pull to Supabase, real-time subscriptions, Leads fetch/update/delete, Job Photos and Receipts upload/delete. Supabase credentials live here (anon/public key only — never the secret key). |
| `tools/data-layer.js` | Shared read/write path for jobs, invoices, expenses, and the client registry (`clientId`s, backfill migration from name-matching). Every page reading or writing this data should go through here rather than touching `localStorage` directly, so a fix (or a sync-push trigger) only needs to happen in one place. |
| `tools/styles-tools.css` | The tool suite's own stylesheet — everything specific to `/tools/` pages (sticky header, sidebar, bottom nav, badges, forms) lives here, separate from the public site's `styles.css`. Every page loading it must use the exact same `?v=` cache-bust version — the consistency checker (`scripts/check-consistency.js`) catches drift automatically. |
| `tools/tools-effects.js`, `tools/tools-dialogs.js`, `tools/tools-media-sharing.js`, `tools/tools-nav-pwa.js` | Shared tool behavior, split out of a since-retired `tools-common.js` (2026-08-20, once it had grown to 1,447 lines mixing everything together): completion celebration/help-modal content/icon-search; the custom confirm/alert dialog system (`escapeHtml` lives here specifically, not in `tools-effects.js` — worth double-checking before assuming which file has a given helper); photo lightbox/voice dictation/toasts; and the mobile bottom nav + desktop sidebar injection (sidebar added 2026-08-20), respectively. |
| `tools/auth.js` | Login/session handling, including the redirect-to-login-and-back-again flow, plus the account-roles system (`hasDevToolsAccess()`, `canManageRoles()`) that gates Dev Tools access. |
| `tools/push-notifications.js`, `tools/qrcode-lib.js`, `tools/manifest.json` | Push notification setup, QR code generation, and the internal-tools PWA manifest (separate from the public site's `site-manifest.json` at the root). |

## Backend

The internal tools sync through a **separate Supabase project belonging to Triple H only** — never shared with any other business. See `DISASTER_RECOVERY.md` at the repo root for incident runbooks, and `sql/` + `edge-functions/` for schema history and the deployed Edge Function's source.

- `sql/` — every schema/migration/fix file actually run against Supabase, kept as a record of what was done and why. Not meant to be blindly re-run; read each file's own comments first, since some are idempotent and some (the duplicate-cleanup fixes) are meant to run exactly once.
- `edge-functions/send-push-index.ts` — snapshot of the deployed `Send-Push` Edge Function's source (note the capitalized slug — Supabase treats function names case-sensitively, and this matters if you ever redeploy by hand), for reference/disaster-recovery. Restoring it for real requires the Supabase CLI plus re-adding the `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` secrets in Supabase's own dashboard — those keys are deliberately never stored in this repo.

## Automated jobs (2026-08-15)

Three independent layers of automation, each doing a different job:

**GitHub Actions** (`.github/workflows/`) — all added because they needed
to be added by hand in the GitHub web UI (creating/editing anything
under `.github/workflows/` requires the `workflow` OAuth scope, which
the assistant's GitHub token was never granted):
- `backup-cms-content.yml` — daily, backs up `site_content`/`site_faq`/`site_terms` to `backups/` using the public anon key (safe, since "Anyone can read site content" is already a real policy).
- `backup-business-data.yml` — weekly, backs up `workspace_sync` (every job, invoice, contract, quote) to `backups/`. Needs the `SUPABASE_SERVICE_ROLE_KEY` repo secret set (Settings → Secrets and variables → Actions), since `workspace_sync` requires a real authenticated session, unlike the 3 CMS tables. The key is referenced by name only in the workflow file — never written into it.
- `check-links.yml` — weekly plus on push, runs `scripts/check-links.py` (internal file references across every HTML file, external links on the 6 public pages only).
- `lighthouse.yml` — daily, scores the live public site against `.github/lighthouserc.json`'s thresholds. Runs on a schedule rather than directly on push, since Pages needs a little time to actually deploy after a push lands.
- `cleanup-artifacts.yml` — daily, keeps only the 3 most recent Actions artifacts of each name. Every push generates a full-site Pages deployment artifact; without this they pile up (275MB across 30 of them was the actual trigger for adding this). Uses the workflow's own built-in `GITHUB_TOKEN` with `permissions: actions: write` — no secret needed for this one specifically.

**Supabase `pg_cron`** (`select * from cron.job;` to see live state):
- `daily-reminder-check` — 1am daily, 11 business-condition checks (see the header comment in `edge-functions/send-push-index.ts` for the full list).
- `weekly-business-digest` — Monday mornings, one summary push (jobs completed, invoiced, new leads, outstanding balance) rather than a specific alert — trend awareness, not task nagging.
- `archive-old-notification-log` — monthly, deletes `notification_log` rows older than 3700 days. That number isn't arbitrary: two of the 11 daily checks use a 3650-day resend interval specifically to nudge only once, ever — retention has to stay longer than the longest resend interval in use, or a "one-time" nudge would silently start repeating once its log row got archived.

**Dev Tools panels** (`tools/dev-tools.html`, all 3 Developer-only as of 2026-08-21 — see the table above) — Storage browser (file counts/sizes across all 3 buckets), Data integrity check (job-photo records vs. actual files, in both directions, plus contact-less leads), and Trigger workflows (runs any of the 5 GitHub Actions workflows on demand via the `trigger-workflow` Edge Function — see below, never a GitHub token in this file).

## ⚠️ Do not delete

- **`google0b12c450e3945a19.html`** and **`google523d668a9a330d64.html`** — Google Search Console ownership verification files, one per domain variant. Deleting either breaks Search Console verification for that property.
- **`favicon.ico`** — must stay at repo root.
- **`.nojekyll`** — must stay at repo root, with exactly that filename (dot included). See the warning at the top of this document.

## Known open items

- A lead auto-responder (an automatic "we got your request" reply sent
  to the customer) was scoped but not built -- it needs a real email-
  sending provider (Resend, SendGrid, etc.) with its own API key, which
  doesn't exist yet for this project. Wiring the trigger up is quick
  once a provider is chosen; picking one is the actual open decision.
- An accidental second Edge Function exists with the lowercase slug
  `send-push` (the real one is `Send-Push`, capitalized) -- created by
  a deploy-tool mistake on 2026-08-15. It's empty and wired to nothing,
  but there's no tool available to delete it from the assistant side;
  remove it by hand from the Supabase dashboard's Edge Functions list.
- `trigger-workflow` Edge Function needs a `GITHUB_PAT` secret (Supabase
  dashboard -> Edge Functions -> Secrets) to actually work -- a
  fine-grained GitHub PAT scoped to ONLY "Actions: Read and write" on
  this one repo. **Confirmed working as of 2026-08-16** -- a real
  authenticated request (from Steve's account) triggered a real GitHub
  Actions run, verified via both the Actions run history and the
  Edge Function's own logs.
- `advisor-health` Edge Function needs a `MANAGEMENT_API_PAT` secret (same
  place as GITHUB_PAT above) to actually work -- a Supabase Personal
  Access Token, generated from account settings. Unlike the GitHub
  token, a Supabase PAT can't be scoped to a single project -- it's
  account-wide access to advisor data for every project the account
  can see, so treat it as more sensitive than GITHUB_PAT. Until it's
  added, the Advisor health panel in Dev Tools returns a clear
  "MANAGEMENT_API_PAT secret is not set yet" error rather than silently
  failing.
- Leaked-password protection is still off in Supabase Auth -- a
  dashboard-only toggle (Authentication → Policies), not something
  scriptable via SQL.



## Deploying changes

No build step, no CI/CD. Push to `main`, GitHub Pages redeploys automatically (usually within a minute or two).

**If uploading files via GitHub's web UI:**
- For a single new nested file (e.g. anything under `.well-known/`), use **Add file → Create new file** and type the full path directly into the filename box — this reliably creates the folder structure and avoids the flattening issue below.
- For moving/adding many files at once into a folder, drag the **entire folder itself** onto the upload area, not the individual files loose — dragging loose files that were meant to go into a subfolder can flatten them out to the root instead, which has happened on this repo more than once.

**After any change, don't trust how it looks and assume it's live.** Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) at minimum before drawing any conclusion — browsers cache aggressively. But for anything where it actually matters (a fix that's still not showing, confirming a folder move went cleanly), the reliable method is downloading and inspecting the actual `github-pages` build artifact from the Actions tab, described at the top of this document. See the disaster-recovery guide's "worth knowing" notes for more on caching specifically.
