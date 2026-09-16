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

<!-- Add new entries above this line -->
