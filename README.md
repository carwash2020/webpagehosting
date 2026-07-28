# Triple-H-Enterprise-Webpage

Source for the live website at **[www.triplehenterprisesllc.biz](https://www.triplehenterprisesllc.biz)**
— Triple H Enterprises LLC, handyman & appliance repair, St. George, UT.
Hosted on GitHub Pages, deployed automatically on push to `main`.

## File structure

| File | Purpose |
|---|---|
| `index.html` | Main homepage — single-page site (services, reviews, about, areas, schedule, contact/FAQ/terms) |
| `handyman-hurricane-ut.html` | Dedicated landing page — Hurricane, UT |
| `handyman-washington-city-ut.html` | Dedicated landing page — Washington City, UT |
| `handyman-santa-clara-ivins-ut.html` | Dedicated landing page — Santa Clara & Ivins, UT |
| `handyman-cedar-city-ut.html` | Dedicated landing page — Cedar City, UT (by-request service area) |
| `handyman-mesquite-nv.html` | Dedicated landing page — Mesquite, NV (by-request service area) |
| `styles.css` | Shared stylesheet — **used by all six pages above.** Edit once, applies everywhere. |
| `images/` | Logos, favicons, gallery photos, OG share image |
| `sitemap.xml` | Lists all 6 live pages — update this and resubmit in Google Search Console any time a page is added or removed |
| `robots.txt` | Allows all crawlers |
| `404.html` | Custom not-found page (self-contained, own inline styles, doesn't use `styles.css`) |
| `security.txt` / `.well-known/security.txt` | RFC 9116 security contact file |
| `favicon.ico` | Multi-resolution icon (16/32/48/64px) — **must stay at repo root**, not inside `images/` |
| `CNAME` | Custom domain config for GitHub Pages — don't touch unless the domain changes |

## ⚠️ Do not delete

- **`google0b12c450e3945a19.html`** and **`google523d668a9a330d64.html`** — Google Search Console
  ownership verification files, one per domain variant (`triplehenterprisesllc.biz` and
  `www.triplehenterprisesllc.biz`). Deleting either breaks Search Console verification for that property.

## Known open item

The homepage (`index.html`) still embeds its logo as an inline base64 string
in a `<script>` block, rather than referencing a plain external file the way
the 5 landing pages do. A real standalone logo file already exists at
`images/logo-signature.png` / `images/logo-signature-orange.png`, but
`index.html` doesn't reference it yet. Low priority, but worth fixing in one
pass eventually rather than leaving the homepage on a different pattern than
every other page in this repo.

## Deploying changes

No build step. Push to `main`, GitHub Pages redeploys automatically
(usually within a minute or two). If uploading images via GitHub's web UI,
navigate **into** the target folder first — dragging from the repo root
flattens folder structure and breaks image paths.

After any change, hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) before
assuming it's live — browsers cache aggressively.
