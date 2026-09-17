# Reports specialist log

Started 2026-09-16, alongside the `tripleh-reports` skill. See `README.md`
in this directory for how these logs work.

One seed entry, carried over from before this log existed: the site's
review-count schema/stat intentionally counts only *visible, written*
review quotes, not a raw Google review total — Google can (and does) have
star-only reviews with no text, which don't get a card. Any report that
cites "N reviews" for this business should say which N it means (Google's
total vs. quotes actually shown), since the two have genuinely diverged
here more than once.

## 2026-09-16 — first real business health report

Built a Supabase-sourced business health report ("Triple H Pulse" artifact)
covering cash flow, job pipeline, site reliability, and open issues. Notes
for next time:

- **`workspace_sync` is the real source of truth, and it matches the
  normalized tables.** The `jobs`/`invoices`/`invoice_line_items` SQL
  tables mirror `th_tracker_jobs`/`th_invoices` inside the single-row
  `workspace_sync.data` JSON blob — cross-checked both this run and they
  agree. Either is fine to query; the SQL tables are much easier to read
  (real columns vs. doubly-JSON-encoded strings inside the blob), so
  prefer those unless something looks off, then fall back to the blob to
  see the full picture (tombstones, graveyard, client_errors, flagged
  items, compliance) — none of that has a normalized-table equivalent.
- **"Income logged" is not "cash collected."** `th_income_log` records an
  invoice's full total as income the moment the invoice is created,
  regardless of whether `invoices.paid` is true. Don't report the income
  log total as revenue without cross-checking each entry's invoice `paid`/
  `paid_amount` — this run, 1 of 5 logged income entries ($268.23) turned
  out to be still-unpaid on the books.
  - **New wrinkle this run**: sometimes `paid_amount` reaches the invoice
    total while `paid` itself is still `false` (see bugfix log,
    2026-09-16) — so "unpaid" per the flag isn't automatically "not
    collected" either. Check `paid_amount` against `total` per invoice,
    not just the boolean.
- **No GA4/analytics connector is available in this session's tool list.**
  Said so plainly in the report rather than estimating traffic — worth
  checking at the start of a future reports session whether one's been
  added before assuming it's still missing.
- Business is genuinely early-stage (7 jobs, 3 invoices, ~7 weeks of
  tracker history as of this report) — a future report's baseline for
  "normal" volume should stay calibrated to that, not read a quiet week
  as a red flag.

## 2026-09-16 (evening) — scheduled "weekly" refresh landed same-day

A routine fired hours after the morning's business-health report asking
for a fresh weekly snapshot. Worth recording since it'll happen again:
the trigger doesn't check whether a meaningful amount of time/data has
actually passed since the last report -- it just fires on its own
schedule. Rather than silently re-deriving the same numbers from the
same underlying data and presenting them as a new data point, said so
plainly in the report itself (a "this is a same-day refresh, not a new
week" note) and focused the update on what had genuinely changed since
the morning (the invoice-alert bug fix landing in production, and the
automation-reliability finding) rather than restating unchanged
business-volume figures as if they were freshly measured. Updated the
existing "Triple H Pulse" artifact in place (same URL) rather than
publishing a new one, since a recurring snapshot should read as one
evolving page, not a new link every time it fires. Re-checked
`ListConnectors` for a GA4/analytics connector before repeating last
time's "not available" -- still genuinely not connected, not just
assumed absent.

## 2026-09-17 — GitHub Watcher research pass (PRs, CI, repo hygiene)

Research-only inventory of `carwash2020/webpagehosting` for a standing
GitHub Watcher bot. No production merge. Playbook committed as
`docs/github-watcher-ops.md`.

**Board at time of write:** 0 open PRs. `main` at `0b0751a` (#276),
CI green (2289/2289 tests, undefined-vars 57 pages, consistency
16+10, visual snapshot 6/6). Pages built. One leftover remote branch:
`cursor/ga4-booking-trust-ctas-2cba` (squash leftover of #269 plus a
commit already shipped as #272) — delete only with Connor (gate).

**Closed same-day, not lost forever:** #262 (docs verify job-messaging
+ remember-me) closed for a README changelog conflict during a
hygiene sweep; the close-out did **not** land (`CLIENT-PORTAL.md`
still lists Remember me). #263 (portal partial payments) closed on
purpose as a schema+deploy item.

**Do not trust README structure tables** without checking
`sitemap.xml`: 8 city pages (not 5), 11 blog HTML files / 10 posts
(not 3), 30 sitemap URLs (not 12; `portal/login.html` is no longer
listed), 10 portal HTML files, 37 edge-function snapshots. Live
Supabase: 38 functions (incl. orphan `send-push`), 42 public tables,
10 cron jobs. Private backup still misses `client_portal_contracts`
and `client_portal_job_messages`.

**Review lock (verified in tests + `index.html` JSON-LD):**
AggregateRating `5.0` / `4`. Google's raw total can be higher
because of star-only reviews; do not inflate.

<!-- Add new entries above this line -->
