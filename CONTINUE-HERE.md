# Continue here

Pick-up notes for a fresh Claude Code session on this repo, from any
device. Read this first, then re-verify anything below against the actual
files before relying on it — this document goes stale, the code does not.

**Live site:** https://www.triplehenterprisesllc.biz
**Repo:** `carwash2020/webpagehosting`
**Deploy model:** GitHub Pages serves `main` directly, no build step.
**Merging to `main` is deploying to production.** Work on a branch, open
a PR, and get a human to look before merging.

There is a fuller original briefing in `CLAUDE-CODE-HANDOFF.md` (the
production-safety rules there still apply). This file covers what changed
after it was written.

---

## The three rules that will bite you

These are not style preferences. Each one has already caused a real
failure on this project.

### 1. Bump the stylesheet cache stamp, or your CSS never ships
Every public page references `/styles.css?v=TIMESTAMP`. GitHub Pages
sits behind Fastly, which caches per-URL independently of the browser —
a hard refresh and incognito both still get the old file. If you change
`styles.css` and do not bump that stamp in **every** referencing file,
your change is live on the server and reaching nobody.

Current value: `?v=202609070100` (10 public files + the portal pages).

This exact mistake cost a full round-trip earlier: a merged PR appeared
to do nothing, and the code was fine — nothing was fetching it.

### 2. Bump `CACHE_NAME` when a precached file changes
Both service workers serve any `?v=` URL **cache-first with no
revalidation**, and both precache `/styles.css`.

- `portal/service-worker.js` — currently `th-portal-v12`
- `service-worker.js` (Workspace/tools) — currently `th-workspace-v60`

If you change a file listed in that worker's `PRECACHE_URLS` and do not
bump its `CACHE_NAME`, **installed app users are pinned to the old copy
indefinitely.** Bumping the name purges every stale entry on activate.
This was violated repeatedly during the last session and is why
`portal/portal-update.js` exists (see below).

### 3. Tool page hashes drift on this machine
`tools/*.html` reference `styles-tools.css` and friends by **content
hash**. Git's CRLF conversion on checkout changes those files' bytes
after commit, moving the hash and failing `check-consistency`.

Fix: `npm run fix-versions`. Run it after touching any tools stylesheet,
then re-run `npm run check-consistency`.

---

## Checks to run before asking for a merge

```bash
npm install
npm run check-undefined-vars     # expect: clean, 42 pages
npm run check-consistency        # expect: clean, 16 tool pages
npm run check-visual-snapshot    # expect: 6/6 match baseline
python3 scripts/check-links.py   # expect: everything resolved
npm test                         # SEE BELOW
```

**`npm test` has many pre-existing failures** in `portal/`,
`edge-functions/`, `tools/`, `sync/` and `workspace/` — Stripe, POS, and
portal suites. They were failing before the last session started and are
unrelated to the public site. Do not treat a red `npm test` as caused by
your change without first confirming the same failures exist on `main`.

---

## What was added last session

Public site, all live:

| Thing | Where |
|---|---|
| Blueprint background, scroll-reveal, motto rail | `styles.css` |
| Exploded-appliance rebuild control (drag slider) | `index.html` + `styles.css` |
| "Is it worth fixing?" symptom triage | `triage.js` (homepage + 5 landing pages) |
| Service-radius diagram, focused per city | `index.html`, `handyman-*.html` |
| Repair-vs-replace honesty split | `index.html` |
| "How a visit actually goes" process line | `index.html` |
| Seasonal care note, live open/closed pill | `index.html` (uses `business-hours.js`) |
| Blog reading progress + reading time | `site-motion.js` |

Client portal, all live and **presentation-only except the update
feature**:

| Thing | Where |
|---|---|
| Whole visual pass (cards, badges, login card, empty states, focus) | `portal/portal-polish.css` |
| **"Update app"** for the installed PWA | `portal/portal-update.js` + Settings card |
| Request progress track (submitted→done) via `:has()` | `portal/portal-polish.css` |
| Print styles for invoices, quotes, work orders | `portal/portal-polish.css` |
| Safe-area insets for installed app (notch/home bar) | `portal/portal-polish.css` |

`portal/portal-polish.css` is loaded **last** in `<head>` on every portal
page on purpose. The portal cascade is already four layers deep, so a
sheet at the end wins ties without `!important` and can be removed by
deleting one `<link>`. Keep adding there rather than editing the earlier
layers.

---

## Not verified — worth doing on a real device

Nothing below is known broken. It is genuinely untested, because the
development environment could not test it.

- **Anything on a real phone.** The preview browser could not scroll
  reliably, and would not register a service worker at all.
- **The installed-app update cycle.** Open the portal on a phone,
  Settings → App version → **Update app**, confirm it reloads cleanly.
  This is the highest-value manual check available right now.
- **Print output** through an actual print dialog.
- **A live authenticated portal session.** Logged-in pages were verified
  by rendering the real markup through the real cascade in a harness, not
  by signing in.
- **Reduced-motion** on a real device.

---

## Things that look odd but are deliberate

- Cedar City and Mesquite are **by-request only**, shown dashed/orange
  everywhere including when focused on their own landing page. They are
  deliberately excluded from the main `areaServed` schema. Do not
  "fix" this.
- The Terms modal opens via the `/#terms` hash. Landing pages link there,
  not to `terms.html`.
- The lead form's `_gotcha` honeypot is real spam protection.
- Phone, email, hours, FAQ and Terms come from Supabase at runtime via
  the `.js-phone-text` / `.js-email-text` spans. Editing that text in the
  HTML alone will be overwritten at page load.
- Triage copy is deliberately qualitative — no prices, no percentages, no
  invented statistics — and every path ends in "we'd have to look at it."
  Keep it that way.

## Never
Re-introduce Square (the account was banned). Touch the lead form's
insert, the booking pages' logic, the JSON-LD, the GA4 snippet, or the
favicon links without a specific reason.
