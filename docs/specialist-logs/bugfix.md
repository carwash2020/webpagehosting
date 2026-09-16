# Bug-fix specialist log

Started 2026-09-16, alongside the `tripleh-bugfix` skill. See `README.md` in
this directory for how these logs work.

One seed entry, carried over from before this log existed: the full local
test suite has a known, pre-existing gap in
`tests/workspace/finance-split.test.js` — its "fix-versions actually
corrects a real mismatch" test deliberately writes a wrong version stamp
into the real `tools/workspace.html`, runs the real `fix-versions` script
against the real repo to fix it, then only restores `tools/workspace.html`
in its `finally` block — not the side effect that script run has on
`service-worker.js`'s own CACHE_NAME/fingerprint. Running the full suite
locally can leave `service-worker.js` genuinely modified (to a *correct*
value) afterward, and can make a handful of other "checks the real,
current repo" tests intermittently fail if they happen to run in that
window. Not a real bug in the app — just something to know before
concluding a full-suite failure is real: check whether it's one of the
"real, current codebase" self-check tests, and try it in isolation before
chasing it further.

## 2026-09-16 — two findings from a business-health report pass (reports specialist)

Surfaced while building a Supabase-sourced business health report (job/
invoice/finance data, no code changed). Both are real, verified against
live data, and handed off rather than fixed here:

1. **Invoice `paid` flag can desync from actual payment, causing a false
   overdue push.** Cody Grover's invoice (`INV-2026-0905`, id
   `1788658872274`) has `paid_amount: 125` against a `total` of
   `125.0025` in `th_invoices`/`invoices` — effectively paid in full
   (the ~$0.0025 gap is float/rounding noise from the tax calc, not a
   real balance) — but its `paid` boolean is still `false`. The daily
   overdue-invoice check reads `paid` directly and sent a fresh
   `invoice-overdue` push for it on 2026-09-16 (see `notification_log`).
   Whatever writes `paid_amount` (manual edit in the invoice generator,
   or a partial-payment path) isn't also flipping `paid` when the
   amount reaches the total. Worth checking whatever handler applies a
   payment against an invoice for a `paid_amount >= total` case that
   doesn't set `paid = true`.

2. **`workspace_sync` realtime channel repeatedly drops.** `th_client_errors`
   inside the `workspace_sync` blob logs many `CHANNEL_ERROR`/`TIMED_OUT`
   events for the `workspace_sync` (and once `th_bookings`) realtime
   channel between 2026-09-05 and 2026-09-08, across `job-tracker.html`,
   `invoice-generator.html`, and `workspace.html` — each note says
   "retrying quietly every 30s in the background" after foreground
   retries exhaust. Separately, `notification_log` shows a `sync-stale`
   notification fired again as recently as 2026-09-16, meaning this
   isn't fully resolved. Data still appears to be saving (the job tracker's
   REST-backed data is current), so this reads as a realtime-subscription
   reliability issue rather than data loss — but a multi-device user
   could be looking at a stale view without knowing it. Worth checking
   the Supabase realtime config/quota and whether the client's retry
   logic should surface a visible "reconnecting" state instead of only
   a background retry.

3. **Full test suite (`npm test`) shows intermittent, non-deterministic
   failures under `--test-concurrency=1` that don't reproduce when the
   same test files are run in isolation.** Found 2026-09-16 while
   verifying an unrelated visual fix (our-work.html gallery,
   styles.css). Two clean, non-overlapping full-suite runs on the same
   branch each produced the same 4 failing test names
   (`tests/content-quality/text-audit.test.js`'s `checkButtonHandlers`
   test, `tests/scripts/onclick-xss-consistency-rule.test.js`'s
   consistency test, and two others with the identical symptom) --
   all failing with `check-consistency.js` (run as a real subprocess
   against the live repo) reporting a `service-worker.js` precache-
   fingerprint mismatch. The suspicious part: the "recorded" and "real"
   hash values in the error differed between the two runs, and running
   any of the 4 failing test files alone (not as part of the full
   suite) passes clean every time. A control run of the exact same
   full suite against an untouched clone of `main` passed 2193/2193
   with zero failures. So this isn't a stable regression from any
   particular content change -- it looks like an ordering/timing
   sensitivity between test files that each spawn `check-consistency.js`
   as a subprocess and/or temporarily mutate a precached file
   (`service-worker.js`'s own self-check tests, `tools/dev-tools.html`'s
   fixture-injection tests) without full isolation between files.
   **Update: this matches the pre-existing gap already noted at the top
   of this log** (`tests/workspace/finance-split.test.js`'s
   fix-versions test leaves `service-worker.js` genuinely modified after
   a local full-suite run) -- same root cause, independently rediscovered
   from the other direction. Nothing further to chase here; both notes
   now point at the same known gap.

## 2026-09-16 (later the same day) — fixed finding #1 above: `paid`/`paidAmount` could diverge across a sync merge

Root-caused and fixed. The actual mechanism wasn't a missing write path —
`tools/workspace.html`'s `togglePaid()` already recomputes `paid` from
`paidAmount`/`total` (whole-cents comparison) every time it's called, and
no other UI call site writes `paidAmount` at all. The divergence comes
from `mergeRecordArrays()` in `tools/sync.js`, which resolves each
field's own 3-way-merge conflict independently: if one device's edit
changed only `paidAmount` (recording a payment) and a different, stale
device's edit changed only `paid` (e.g. an old "mark unpaid" click never
pulled since), the field-level merge can legitimately keep the first
device's `paidAmount` and the second device's `paid` — an internally
inconsistent result even though each field's own merge picked a
defensible value in isolation. `paid` is a *derived* field (must always
equal `paidAmount >= total`), and the generic per-field merge has no way
to know that two fields are coupled like this.

Fix: added `deriveInvoicePaid(inv)` to `sync.js` (same whole-cents
comparison as `invoicePaymentStatus()`), and call it from two places
instead of trusting a raw `paid` boolean: `mirrorInvoiceToRelational()`
(the actual write path the overdue-push check reads from) and a new
post-merge normalization pass on `th_invoices` inside `applySyncData()`
(so the local copy itself, and whatever it mirrors/pushes next, can't
stay inconsistent either). Regression test added:
`tests/sync/applysyncdata-malformed-json.test.js` reproduces the exact
conflict shape (base/local/remote with a real 3-way merge) and asserts
the merged record comes out both correct and consistent.

**Lesson for this codebase's merge system specifically:** `mergeRecordArrays()`
is a generic per-field 3-way merge with no concept of field coupling. Any
future field pair where one is logically derived from another (a status
flag derived from an amount, a computed total, etc.) needs the same
treatment — a post-merge normalization step — rather than assuming the
generic merge will keep them consistent on its own. Worth grepping for
other flag+amount pairs in the synced data model if this class of bug
needs auditing further (quotes' `status` vs. line items, jobs' warranty
status vs. completion date, etc. weren't checked this pass).

Finding #2 (realtime channel drops) is still open, unchanged from
above — no code touched for it this session.

<!-- Add new entries above this line -->
