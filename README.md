# Triple-H-Enterprise-Webpage

Source for the live website at **[www.triplehenterprisesllc.biz](https://www.triplehenterprisesllc.biz)**
— Triple H Enterprises LLC, handyman & appliance repair, St. George, UT.
Hosted on GitHub Pages, deployed automatically on push to `main`.

This repo actually serves **two separate things** from the same domain:

1. **The public marketing site** — homepage + 5 city landing pages, meant for customers and search engines.
2. **An internal Workspace tool suite** — Job Tracker, Invoice Generator, Route Planner, Review Request Sender, and a Dashboard, at `/workspace.html`. Not linked from the public site, not indexed, but hosted on the same domain and repo since it's all static files anyway.

They share one stylesheet (`styles.css`) and are otherwise independent.

## Public site — file structure

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
| `security.txt` / `.well-known/security.txt` | RFC 9116 security contact file |
| `favicon.ico` | Multi-resolution icon (16/32/48/64px) — **must stay at repo root**, not inside `images/` |
| `CNAME` | Custom domain config for GitHub Pages — don't touch unless the domain changes |

## Internal tools — file structure

| File | Purpose |
|---|---|
| `workspace.html` | **Dashboard** — the entry point for the whole suite. Business metrics (revenue, expenses, mileage, outstanding/overdue invoices), Leads inbox, Due Soon jobs, Invoices list, Website Gallery Queue, Analytics, tool links, Backup & Restore. Bookmark this one. |
| `job-tracker.html` | Jobs, Cost Lookup (with sales tax), Expenses (receipt required), Contacts (with client history), Notes — five tabs, one page. |
| `invoice-generator.html` | Invoice + Quote/Estimate tabs. Tax-aware, per-line "Taxable" toggle. Convert a Quote to an Invoice with one tap. Generates a branded PDF with your Venmo QR built in. |
| `route-planner.html` | Multi-stop Google Maps route links + a fuel-cost/sales-tax "to and from" cost analyzer. |
| `review-request.html` | Generates a review-request text message; deep-linkable with a client name/job pre-filled. |
| `contact-card.html`, `job-cost-lookup.html`, `expense-logger.html` | Retired — now just redirect stubs into `job-tracker.html`'s tabs, kept so old bookmarks don't 404. |

## Shared files (used by BOTH the public site and internal tools)

| File | Purpose |
|---|---|
| `styles.css` | **One shared stylesheet for all 12 pages** — public site AND internal tools. Edit once, applies everywhere. Has grown large; internal-tools-specific rules are appended near the bottom, clearly commented. |
| `sync.js` | The entire cloud-sync engine — push/pull to Supabase, real-time subscriptions, Leads fetch/update/delete, Job Photos and Receipts upload/delete. Supabase credentials live here (anon/public key only — never the secret key). |
| `tools-common.js` | Shared behavior: help-modal open/close, and the custom confirm/alert dialog system (`showConfirm()`/`showAlert()`) used everywhere instead of the browser's plain native popups. |
| `images/` | Logos, favicons, gallery photos, OG share image, Venmo QR code |

## Backend

The internal tools sync through a **separate Supabase project belonging to Triple H only** — never shared with any other business. See `DISASTER-RECOVERY-AND-RESTORE-GUIDE.md` at the repo root for the complete setup (every table, every bucket, every SQL statement).

## ⚠️ Do not delete

- **`google0b12c450e3945a19.html`** and **`google523d668a9a330d64.html`** — Google Search Console ownership verification files, one per domain variant. Deleting either breaks Search Console verification for that property.
- **`favicon.ico`** — must stay at repo root.

## Known open item

`index.html`'s homepage logo is still embedded as an inline base64 string in a `<script>` block, rather than referencing a plain external file the way the 5 landing pages and all the internal tools pages do. A real standalone file exists at `images/logo-signature.png` / `images/logo-signature-orange.png`, but the homepage doesn't reference it yet. This has been a known item across several rounds of work and is still genuinely unfixed — low priority, but worth doing in one pass eventually rather than leaving the homepage on a different pattern than every other page in this repo.

## Deploying changes

No build step, no CI/CD. Push to `main`, GitHub Pages redeploys automatically (usually within a minute or two). If uploading files via GitHub's web UI, navigate **into** the target folder first — dragging from the repo root flattens folder structure and breaks image paths.

After any change, hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) before assuming it's live — browsers cache aggressively, and this has caused real confusion more than once on this project (see the disaster-recovery guide's "worth knowing" notes).
