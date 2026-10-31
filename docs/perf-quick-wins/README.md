# Speed quick wins -- synthetic before/after

**These numbers are synthetic, not production.** The pages are behind login and
the sandbox that produced them could not reach the live site or its CDNs, so
every page was served locally with a stubbed Supabase session/API (empty data),
local copies of supabase-js and jsPDF, a size-padded Stripe.js stub, and locally
mirrored Google Fonts. Lighthouse 12, default mobile profile (simulated
throttling), performance category only, median of 5 runs. Use them for the
*relative* change only; re-run on the PR preview / prod for real numbers.
The harness is in `harness/` (`stub-server.js` + `lh.js`; needs `lighthouse`,
`chrome-launcher`, `@supabase/supabase-js@2.112.3`, `jspdf@2.5.1`, `playwright`).

| Page | Score before -> after | FCP (ms) | LCP (ms) | Transfer (KB) |
|---|---|---|---|---|
| tools/workspace | 66 -> 66 | 3307 -> 3307 | 3906 -> 3907 | 261 -> 261 |
| tools/job-tracker (jobs) | 59 -> 67 | 3306 -> 1355 | 3905 -> 3609 | 258 -> 258 |
| tools/invoice-generator (invoices) | 79 -> 82 | 3310 -> 1385 | 4210 -> 4208 | 372 -> 372 |
| portal/dashboard (invoices) | 85 -> 90 | 3157 -> 2557 | 3456 -> 3106 | 218 -> 129 |
| portal/jobs | 91 -> 92 | 2560 -> 2556 | 2932 -> 2708 | 130 -> 130 |

Measured against `main` at 907e562 (Phase 4 included) vs this branch.

Run-to-run noise is real: portal/jobs LCP is bimodal (~2.7s / ~3.1s) in the
untouched baseline too, so that row is "no change" either way. Raw
runs: `lighthouse-before.json`, `lighthouse-after.json`.

390x844 screenshots (`before/`, `after/`) are byte-identical for all five pages.

## What changed (head tags only)

- Tools pages (15 post-login pages): Google Fonts stylesheet is no longer
  render-blocking (`preload` + `onload`, with a `<noscript>` fallback) -- the
  pattern portal/dashboard and portal/quotes already used. Login and
  reset-password pages untouched.
- Portal pages (7 post-login pages): supabase-js pinned from `@2` to
  `2.112.3` with SRI, the same tag the tools pages use (one version everywhere;
  immutable CDN caching). Not measurable in the harness.
- portal/dashboard, portal/settings: Stripe.js no longer blocks the parser; it
  starts 3s after `load`. (Starting it right at `load` made dashboard LCP
  worse in testing because it competed with the page's data requests.)
  Dashboard genuinely uses Stripe for card payment, so it is deferred, not removed.
- Service-worker cache versions bumped via `npm run fix-versions`.

## Checked and not changed

- Tools pages already `defer` their scripts and invoice-generator already loads
  Stripe lazily; no duplicate font loads and no page loads two supabase-js versions.
- **CSS is the remaining big cost**: `styles.css` (270KB) + `styles-tools.css`
  (262KB) block rendering for ~2s each in the simulation on workspace
  (portal-polish.css adds 129KB on portal). Fixing it needs critical-CSS /
  purging with a visual-diff gate -- a separate PR.
- workspace's blocking `business-hours.js` could be deferred but needs an
  audit of inline-script use; skipped.
- Known behavior note: Stripe starting 3s after load means a card sheet opened
  inside that window (requires picking invoices, signing and a server call
  first) is not realistically reachable, but it is a timing assumption.
