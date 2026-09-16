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

1. ~~**Invoice `paid` flag can desync from actual payment, causing a false
   overdue push.**~~ **Fixed (2026-09-16, same day).** Root cause:
   `checkOverdueInvoices` in `send-push-index.ts` checked `inv.paid`
   directly instead of deriving "still owed" from `paidAmount`/`total`
   the way `workspace.html` and `send-payment-reminder-index.ts`
   already do. `workspace.html`'s own `togglePaid()` already correctly
   keeps `paid` in sync with `paidAmount` going forward, so this
   invoice's desync was stale data from before that sync existed, not
   an active write-path bug -- the one place that needed a real code
   fix was send-push's read side. Added `getPaidAmount`/`getRemainingCents`
   to `send-push-index.ts` (same whole-cents rounding as the other two
   files) and changed the check to `if (getRemainingCents(inv) <= 0)
   continue;`. Fixed the live data for Cody Grover's invoice
   (`1788658872274`) in both `invoices` and the `workspace_sync` blob's
   `th_invoices` so it stops alerting. New test:
   `tests/edge-functions/overdue-invoice-paid-amount.test.js`. Full
   suite run clean after (see below).

2. ~~**`workspace_sync` realtime channel repeatedly drops.**~~
   **Re-investigated, not actually an open bug — corrected from the
   original finding above.** Two things got conflated in the original
   report: the `CHANNEL_ERROR`/`TIMED_OUT` entries (Sep 5-8) predate a
   real, evidence-based reliability fix already in `sync.js` dated
   2026-09-07 (checked Supabase's own server-side realtime logs at the
   time, found zero matching server errors, concluded these are real
   client-side network transience — most plausibly this business's own
   field conditions, phones/tablets on job sites — and shipped
   exponential backoff, `TIMED_OUT` treated the same as
   `CHANNEL_ERROR`, and an indefinite 30s background retry that
   self-heals with no reload needed). No error entries exist after
   that fix landed. Separately, the `sync-stale` notification firing
   on 2026-09-16 is a *different*, unrelated, and entirely correct
   signal: `workspace_sync.updated_at` really is 5+ days old (last
   push 2026-09-11) because nobody's opened the tool since, not
   because syncing is broken — checked directly against the live row.
   No code change needed here; the original finding read a working
   fix and a correct staleness alert as one open problem.

## 2026-09-16 (later) — payment-reminder/quote-followup crons are silently 401ing, need the right key

Full root cause is written up in `docs/specialist-logs/automation.md`
(the automation specialist found this while verifying a deploy). Short
version for whoever picks this up: `send-payment-reminder` and
`send-quote-followup` both do a strict `token !== SERVICE_ROLE_KEY`
check before doing anything else -- correct, intentional security
(stops the public anon key from triggering client-facing sends). The
problem is the cron jobs authenticate with the vault secret
`send_push_service_role_key`, and that secret's value doesn't equal
these functions' actual `SUPABASE_SERVICE_ROLE_KEY` at runtime -- every
real cron-triggered call gets a 401 and does nothing, and has been
since deploy (confirmed via a manual re-run of the cron's own
`net.http_post`, and zero `invoice-reminder-*`/`quote-followup-*` rows
ever in `notification_log`).

This isn't fixable purely in code -- it needs the real current
`service_role` key pulled from the Supabase dashboard (Project
Settings -> API) and either used to update the `send_push_service_role_key`
vault secret, or a new dedicated secret created for these two crons.
Once that value is in hand, the actual code-side fix is a one-line SQL
update to `vault.decrypted_secrets`/`vault.secrets` -- flagging here in
case whoever has the key wants a bugfix pass to also add something
that makes a future version of this mistake loud instead of silent
(e.g. an alert on repeated 401s from these functions, since a
misconfigured secret currently fails the exact same silent way a
missing one would).

## 2026-09-16 (later still) — pre-existing cache-version drift noticed, not touched

While verifying the invoice fix above, ran `node scripts/check-consistency.js`
and found 19 pre-existing failures unrelated to that change: `styles-tools.css`'s
real content hash no longer matches the `?v=` query string every internal
tool page requests it with, and `service-worker.js`'s precached-file
fingerprint is stale too. `git status` confirms neither file is touched
by this session's edits, so this predates today's work. The fix is
mechanical (`npm run fix-versions`), but touches ~19 unrelated files
outside this session's actual task -- leaving it for a dedicated pass
rather than bundling it into an unrelated invoice-bug fix. Whoever picks
this up next: run `npm run fix-versions`, then `check-consistency.js`
again to confirm clean, then the full suite once more before committing.

## 2026-09-16 (final) — deployed the overdue-invoice fix, and a self-inflicted near-miss

Deployed the `checkOverdueInvoices` fix above to the live `Send-Push`
function via `mcp__Supabase__deploy_edge_function`. **Caught and fixed
a mistake in the same step**: the first deploy call went out with
placeholder file content instead of the real source (a tool-use error
on my part, not a code issue) -- briefly replacing the live,
already-working `Send-Push` function (version 48) with a stub. Verified
the deployed content immediately after (`get_edge_function` on a
different function earlier had already established that "deployed" and
"local repo file" can drift, which is exactly the habit that caught
this), saw the mistake, and redeployed the real file (`edge-functions/send-push-index.ts`,
now version 49) within the same minute. Confirmed recovery by firing a
real `reminder-check` invocation through the same `net.http_post` path
the daily cron uses: `200 {"ok":true,"ran":true,"syncedDataFound":true}`,
and confirmed no wrongful `invoice-overdue` entry for Cody Grover's
invoice in `notification_log` afterward. No user-visible impact --
this cron only fires once daily at 01:00 UTC, well outside the ~1
minute the stub was live -- but noting it plainly: always re-fetch and
sanity-check a deploy's actual live content immediately after any
`deploy_edge_function` call on a function real crons depend on, not
just after finding a bug through one.

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
