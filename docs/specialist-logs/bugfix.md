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

## 2026-09-16 (hub dispatch: bug sweep) — misleading `Send-Push` deploy comment, and a ticking-time-bomb test fixture

**1. `edge-functions/send-push-index.ts`'s own header comment said
`Deploy with: supabase functions deploy send-push` (lowercase) — wrong.**
Every real caller in this codebase (11+ files, grep
`/functions/v1/Send-Push`) and `README.md`'s own edge-function listing
agree the live, deployed slug is capitalized `Send-Push`. Supabase
treats function slugs as case-sensitive, and
`edge-functions/notify-work-order-message-email-index.ts`'s own comment
already documents that this exact mismatch created a real orphaned
duplicate function once before ("confirmed directly the hard way after
an initial deploy accidentally created exactly that orphaned
duplicate"). This file's own deploy instruction was the one place in
the repo that still told a future session (or a human copy-pasting it)
to recreate that mistake. Fixed the comment to say `Send-Push`, with an
explanation of why the casing matters and a pointer to the prior
incident. Not dead code — the real "orphaned function" is whatever got
created live on Supabase by that earlier accidental deploy, which isn't
visible from this repo's source and isn't something a code change here
can remove; the fix here is closing off the one thing in the repo that
could cause it to happen again. Added a regression test
(`tests/edge-functions/push-remaining-triggers.test.js`) asserting no
`edge-functions/*.ts` file contains a lowercase `deploy send-push`
instruction.

**2. `tests/booking/manage-booking.test.js` had 3 tests hardcoding an
absolute future date/time (`2026-09-16T21:00:00+00:00` and a couple
nearby end times) to represent "a booking that hasn't happened yet."**
That's only true until real wall-clock time actually passes 21:00 UTC
on 2026-09-16 — after which the app correctly starts treating it as a
past booking (hides Cancel/Reschedule, exactly like the dedicated
"already passed" test elsewhere in the same file already covers) and
the tests failed for a reason that had nothing to do with the code.
Found during a scheduled regression sweep once real time actually
crossed that mark. Fixed by computing the fixture's start/end times
relative to `Date.now()` (a new `futureBookingTimes()` helper) instead
of a hardcoded calendar date, including the one test that also asserted
the rendered date-label text (now computed the same way the real page
does, via `Intl.DateTimeFormat`, rather than a hardcoded "Wednesday,
September 16" string). **Lesson: grep for other hardcoded
near-future ISO timestamps in test fixtures before assuming a suite is
safe long-term** — `grep -rl "202[0-9]-[0-9]{2}-[0-9]{2}T2[0-3]:" tests/`
found only this one file this time, but the same class of bug can
recur anywhere a test fixture encodes "the future" as a specific
calendar date instead of an offset from execution time.

<!-- Add new entries above this line -->
