# Triple-H-Enterprise-Webpage

Source for the live website at **[www.triplehenterprisesllc.biz](https://www.triplehenterprisesllc.biz)**
— Triple H Enterprises LLC, handyman & appliance repair, St. George, UT.
Hosted on GitHub Pages, deployed automatically on push to `main`.

This repo actually serves **two separate things** from the same domain:

1. **The public marketing site** — homepage + 5 city landing pages, meant for customers and search engines. Lives at the repo root.
2. **An internal Workspace tool suite** — Job Tracker, Invoice Generator, Contract Generator, Route Planner, Calendar, Review Request Sender, Runway Dashboard, and a Dashboard, at `/tools/workspace.html`. Not linked from the public site, not indexed, but hosted on the same domain and repo since it's all static files anyway. **As of 2026-08-10, these live under `/tools/`, not the repo root** — see below.

They share one stylesheet (`styles.css`) and are otherwise independent.

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
| `tools/workspace.html` | **Dashboard** — the entry point for the whole suite. Business metrics, Leads inbox, Due Soon jobs, Invoices list, Website Gallery Queue, Analytics, tool links, Backup & Restore. Bookmark this one. |
| `tools/job-tracker.html` | Jobs, Cost Lookup (with sales tax), Expenses (receipt required, now with an optional Part Number field), Contacts (with client history), Notes — tabs, one page. |
| `tools/invoice-generator.html` | Invoice + Quote/Estimate tabs. Tax-aware, per-line "Taxable" toggle. Convert a Quote to an Invoice with one tap. Generates a branded PDF with your Venmo QR built in. |
| `tools/contract-generator.html` | Fill in a client/job, generate a branded contract PDF to email/text. Has two signature canvases — see the swipe-gesture note below if working on touch gestures anywhere near this page. |
| `tools/route-planner.html` | Multi-stop Google Maps route links + a fuel-cost/sales-tax "to and from" cost analyzer. |
| `tools/review-request.html` | Generates a review-request text message; deep-linkable with a client name/job pre-filled. Also has Google/Yelp QR code tabs. |
| `tools/calendar.html` | Shows jobs flagged "Show on Calendar" from Job Tracker. Doesn't manage its own data. |
| `tools/runway-dashboard.html` | Personal + business financial runway tracking — debts, income, expenses, month-by-month. |
| `tools/login.html` | Auth entry point for the whole suite. |
| `tools/contact-card.html`, `tools/job-cost-lookup.html`, `tools/expense-logger.html` | Retired — now just redirect stubs into `job-tracker.html`'s tabs, kept so old bookmarks don't 404. |

## Shared files (used by BOTH the public site and internal tools — stayed at repo root deliberately)

| File | Purpose |
|---|---|
| `styles.css` | **One shared stylesheet for every page on the whole site**, public and internal alike. Edit once, applies everywhere. Referenced via the absolute path `/styles.css` from every page regardless of folder, so it never needed to move. |
| `service-worker.js` | Shared PWA service worker. **Deliberately stayed at the repo root, not moved into `/tools/`**, even though it's mostly tool-related — confirmed it's also referenced by the public site's pages, and a service worker's scope defaults to wherever the file itself lives (not wherever it's registered from), so keeping it at root is what lets one service worker cover the whole site. Has a hardcoded `PRECACHE_URLS` list — if any page referenced in that list ever moves again, this list needs updating too, the same way it did during the `/tools/` move. |
| `images/` | Logos, favicons, gallery photos, OG share image, Venmo QR code. Should contain only actual image files — a past upload mistake once left duplicate copies of `index.html`, `job-tracker.html`, and `styles.css` sitting in here; if any stray HTML/CSS ever turns up in this folder again, it's a mistake, not intentional. |

## Files inside `/tools/` that are NOT shared with the public site

| File | Purpose |
|---|---|
| `tools/sync.js` | The entire cloud-sync engine — push/pull to Supabase, real-time subscriptions, Leads fetch/update/delete, Job Photos and Receipts upload/delete. Supabase credentials live here (anon/public key only — never the secret key). |
| `tools/tools-common.js` | Shared tool behavior: help-modal open/close, the custom confirm/alert dialog system, row entrance/exit animations, the swipe-back-to-workspace gesture used by pages without their own tabs. |
| `tools/auth.js` | Login/session handling, including the redirect-to-login-and-back-again flow. |
| `tools/push-notifications.js`, `tools/qrcode-lib.js`, `tools/manifest.json` | Push notification setup, QR code generation, and the internal-tools PWA manifest (separate from the public site's `site-manifest.json` at the root). |

## Backend

The internal tools sync through a **separate Supabase project belonging to Triple H only** — never shared with any other business. See `DISASTER_RECOVERY.md` at the repo root for incident runbooks, and `sql/` + `edge-functions/` for schema history and the deployed Edge Function's source.

- `sql/` — every schema/migration/fix file actually run against Supabase, kept as a record of what was done and why. Not meant to be blindly re-run; read each file's own comments first, since some are idempotent and some (the duplicate-cleanup fixes) are meant to run exactly once.
- `edge-functions/send-push-index.ts` — snapshot of the deployed `send-push` Edge Function's source, for reference/disaster-recovery. Restoring it for real requires the Supabase CLI plus re-adding the `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` secrets in Supabase's own dashboard — those keys are deliberately never stored in this repo.

## ⚠️ Do not delete

- **`google0b12c450e3945a19.html`** and **`google523d668a9a330d64.html`** — Google Search Console ownership verification files, one per domain variant. Deleting either breaks Search Console verification for that property.
- **`favicon.ico`** — must stay at repo root.
- **`.nojekyll`** — must stay at repo root, with exactly that filename (dot included). See the warning at the top of this document.

## Known open items

`DISASTER_RECOVERY.md`, `sql/`, and `edge-functions/` are now committed
at the repo root as of 2026-08-14 -- they previously existed only as a
backup zip delivered directly to Connor, referenced here as if they were
already in the repo, but never actually were. That gap is closed.

## Deploying changes

No build step, no CI/CD. Push to `main`, GitHub Pages redeploys automatically (usually within a minute or two).

**If uploading files via GitHub's web UI:**
- For a single new nested file (e.g. anything under `.well-known/`), use **Add file → Create new file** and type the full path directly into the filename box — this reliably creates the folder structure and avoids the flattening issue below.
- For moving/adding many files at once into a folder, drag the **entire folder itself** onto the upload area, not the individual files loose — dragging loose files that were meant to go into a subfolder can flatten them out to the root instead, which has happened on this repo more than once.

**After any change, don't trust how it looks and assume it's live.** Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) at minimum before drawing any conclusion — browsers cache aggressively. But for anything where it actually matters (a fix that's still not showing, confirming a folder move went cleanly), the reliable method is downloading and inspecting the actual `github-pages` build artifact from the Actions tab, described at the top of this document. See the disaster-recovery guide's "worth knowing" notes for more on caching specifically.
