# Feature specialist log

Started 2026-09-16, alongside the `tripleh-features` skill. See `README.md`
in this directory for how these logs work.

## 2026-09-16 -- one-click "Create Invoice" from a job

First real session under this skill. Read `README.md`'s tail and
`docs/ACTION-ITEMS.md` for open items before building anything, per the
skill's own instructions -- found the gap explicitly named in both:
"converting a recurring job template straight to an invoice (still
fully manual each time) remain[s] unbuilt."

Investigated before building: `invoice-generator.html` already had a
Job Ref dropdown (`autofillFromJobRef()`) that fills client
name/address/description once a job is picked manually. So the real
gap wasn't "no linking exists" -- it was "you have to navigate there
and find the job yourself." Fixed by adding a `?jobRef=<id>` deep link
from `job-tracker.html`'s per-job actions, and an `applyJobRefFromUrl()`
on `invoice-generator.html`'s existing `DOMContentLoaded` init that
reuses `autofillFromJobRef()` rather than duplicating its logic.

Decision: did NOT build a separate "convert template directly to
invoice" button that skips the job step. Templates intentionally create
a job first (`createJobFromTemplate()`) so the job still gets tracked,
scheduled, and shows up in job history/margin numbers -- a
template-to-invoice shortcut would let a recurring job dodge all of
that. The one-click "Create Invoice" on the resulting job closes the
same manual-effort gap without removing the job-tracking step.

Ran the full verification suite before finishing: found `jsdom` listed
in `package.json` but not actually installed in this container (111
pre-existing test failures, unrelated to this change) -- ran `npm
install` to fix the environment rather than skip those tests; full
suite (2189 tests) passed clean afterward, plus consistency/
undefined-vars/link checks.

## 2026-09-16 (later the same day) -- deep-dive audit, then a client-facing quote PDF

Asked to do a full deep-dive across the project and list what's next.
Read every open doc (`README.md`'s changelog tail, `docs/ACTION-ITEMS.md`,
`docs/CLIENT-PORTAL.md`, `docs/ARCHITECTURE-NOTES.md`, all five
specialist logs) rather than just this one, since "what's next" is a
whole-project question, not a features-lane-only one -- handed the
non-features items (visual polish, manual/SEO items) back to the user
as a categorized list rather than building them myself.

When asked to start on the list, checked Supabase directly before
assuming anything needed deploying: `send-payment-reminder` and
`send-quote-followup` (flagged in ACTION-ITEMS.md as blocked on
dashboard/CLI access I don't have) were both already `ACTIVE` with
source matching this repo exactly, and both crons were already
running. Someone deployed them between that doc being written and now
-- fixed the stale docs rather than re-deploying anything.

Considered building MFA enrollment for the internal `/tools/` staff
accounts next (confirmed via direct SQL against `auth.mfa_factors`
that nobody has it enabled) -- decided against doing this without
explicit confirmation first. `tools/auth.js` deliberately uses raw
`fetch()` against Supabase's Auth REST endpoints rather than the
Supabase JS SDK (a documented, intentional choice, not an oversight),
so adding MFA there means hand-rolling the enroll/challenge/verify
REST calls and reworking the core session/login gate that every
single internal tool page depends on -- unlike the client portal
(where a lockout is annoying), a bug here could lock Steve and Connor
out of the whole business's internal tools. That's exactly the kind
of hard-to-reverse, high-blast-radius change this project's own
guidance says to confirm before touching, not something to start
under a general "go ahead." Left it flagged for the user rather than
building it silently.

Built the standalone client-facing quote PDF instead -- self-contained,
additive-only, no schema/edge-function/auth changes, and a real gap
`docs/CLIENT-PORTAL.md` had already named. Deliberately copied
`portal/dashboard.html`'s `downloadInvoicePDF()` layout closely rather
than designing a new one, including its `loadImageAsDataURL()` helper
duplicated locally (matching that file's own stated reason: isolation
between portal pages, not an oversight to fix). Real differences from
the invoice PDF, not cosmetic ones: always labeled QUOTE (no paid/
unpaid state to distinguish RECEIPT vs INVOICE), status line reads
PENDING/APPROVED/DECLINED, total is "ESTIMATED TOTAL" not "TOTAL DUE",
and the footer states outright it's an estimate -- a client should
never mistake this for a bill.

Found along the way: `portal/` has its OWN service worker
(`portal/service-worker.js`, separate `CACHE_NAME` fingerprint scheme
from `tools/`'s) -- `npm run fix-versions` catches both, but worth
remembering when editing anything under `/portal/` that the tools-only
mental model of "bump the one CACHE_NAME" isn't complete.

## 2026-09-16 (still later) -- two more doc-drift finds, then job messaging

Continuing the same session. Before picking the next build, re-checked
two more "still pending" items in `docs/CLIENT-PORTAL.md` against
reality rather than trusting the doc: leaked-password protection
(item 4) and a standalone Terms page (item 5) were BOTH already done
-- `docs/ACTION-ITEMS.md` already recorded the first, and `/terms.html`
already existed in git history predating this session entirely. Third
stale-doc find this session. Pattern worth naming for whoever reads
this next: this project's specialist-log/changelog discipline is
strong, but a "still pending" list is exactly the kind of doc that
silently rots once the item it describes gets fixed somewhere else
(a different session, a different lane) without anyone circling back
to cross it off. Worth a deliberate sweep of ACTION-ITEMS.md/
CLIENT-PORTAL.md's open-items lists periodically, not just when
stumbled into while looking for the next thing to build.

Considered "change a client's portal email from inside the tools"
next -- decided against it, same reasoning as the MFA decision earlier
this session but for a different hazard. Email is the identity key
`docs/CLIENT-PORTAL.md`'s own "Client identity: one client, one email"
postpartum calls "the single highest-value fix... worth understanding
before touching any of these paths" -- every `client_portal_*` table,
`client_notification_preferences`, `stripe_customers`, AND the
internal `workspace_sync` blob's own separate copy of that email would
all need to move atomically, or the exact split-identity bug that
postmortem already fixed once would come back. Flagged for the user
rather than guessing at a migration strategy blind.

Built two-way messaging on a completed job instead -- additive, no
identity/money risk, and a real (if debatable-value) gap
`docs/CLIENT-PORTAL.md` named explicitly. Deliberately copied the
existing work-order-messaging pattern almost line for line (own table,
same RLS shape, same trigger-function-calls-edge-function wiring, same
internal reply UI shape in `tools/clients.html`) rather than
generalizing the two into one shared messages table with a
nullable/polymorphic parent -- two different parent tables sharing one
child table would need an "exactly one of these foreign keys is set"
constraint carried on every row forever, for a savings that's mostly
cosmetic (a few fewer files) against a real ongoing tax (every future
change to messaging touches a more complex, harder-to-reason-about
shape). Decided NOT to add a separate `notify_types` entry or
recipient list for this -- reused the existing `work_order`-tagged
`notification_recipients` list, since there's no UI today to configure
a second category and a client message needing a reply reads as the
same kind of alert regardless of which record it's attached to.

Applied the migration and deployed the edge function directly via the
Supabase MCP tools in this same session (both came back `ACTIVE`,
confirmed against the live project) -- worth remembering for a future
session that hits this file: unlike earlier this same day, Supabase
tool access was live and unblocked here, so this feature is actually
live end-to-end, not just committed code waiting on a manual deploy
step.

## 2026-09-17 -- partial payments for larger jobs

`docs/CLIENT-PORTAL.md`'s "Partial payments for larger jobs" item is
the one real, unbuilt gap in its "Smaller polish" list. Confirmed the
gap is real, not doc rot, before building anything: `client_portal_invoices`
has no `paid_amount` column at all (only boolean `paid` + `paid_at`),
and `create-payment-intent` always charges `Math.round(invoice.total *
100)` -- a client cannot pay less than the full invoice today. This is
genuinely bigger and money-sensitive enough (and sits directly in the
subsystem that had a real paid/paidAmount merge-conflict bug the day
before, see `bugfix.md`'s 2026-09-16 entry) that I sent it to the
`Plan` agent for a proper file-by-file design before writing any code,
rather than improvising schema/webhook changes to a payment-correctness
path solo.

Built it from that plan, but caught two real gaps the plan itself
missed -- worth recording since a future session redoing this kind of
change should check for the same shape of thing, not just trust a
plan's "no code change needed" calls at face value:

1. **`create-bulk-payment-intent` ("Pay All Outstanding") was a real,
   unguarded overcharge risk.** The plan correctly scoped partial
   payments to single-invoice only and said bulk needed "no code
   change, just a comment" -- but bulk always charges every covered
   invoice's FULL `total`, and its only existing guard rejected an
   invoice with `paid: true`, not one sitting at `paid: false` with a
   nonzero `paid_amount`. The moment single-invoice partial payments
   exist, an invoice partially paid that way and then swept into a
   bulk "Pay All Outstanding" batch would get charged its full total
   AGAIN -- a genuine double-charge, not a display bug. Fixed by
   rejecting a bulk batch containing any invoice with `paid_amount >
   0`, and narrowing the portal's own bulk-eligible set to match, so
   the UI never offers a combination that would 400 anyway.
2. **The `paid_amount` migration needed a backfill, not just a
   default.** `paid_amount numeric not null default 0` alone would
   leave every ALREADY-paid invoice reading `paid_amount: 0` the
   instant the column exists -- wrong data (not just unpopulated),
   since the portal's own payment-progress ring and chart now trust
   `paid_amount` over the `paid` boolean. Added `update
   client_portal_invoices set paid_amount = total where paid = true;`
   to the migration itself.

Also found, independent of Stripe: `tools/workspace.html`'s
`togglePaid()` (the internal cash/check partial-payment toggle) never
synced anything to `client_portal_invoices` at all -- only
`mirrorInvoiceToRelational()` (the internal-only relational mirror).
A client whose invoice Steve marked 40% paid by check would keep
seeing the full original balance in the portal indefinitely. Fixed by
having `togglePaid()` also call `sync-invoice-to-portal` with the new
`paid_amount` field, same fire-and-forget pattern
`invoice-generator.html`'s own simpler `toggleInvoicePaid()` already
uses for `set-invoice-paid`.

While updating tests for the API/behavior changes above (signature
additions to `startPayment`/`submitPaymentSignature`, the
`outstanding` -> `bulkEligible` split, the ledger replacing the
`invoice.paid` check in reconciliation), tripped one real isolation-
boundary test purely from a code COMMENT: writing an internal
filename in a `portal/dashboard.html` comment matched that file's own
check for keeping `/portal/` free of `/tools/`-only script references,
even though nothing was actually loaded. Worth remembering -- that
test greps raw page text, not just `<script src>` tags, so even a
comment mentioning an internal filename by its exact name can trip it.

Deliberately did NOT apply the migration or deploy any of the 6
updated edge functions myself -- staged in a PR instead, per this
session's governance (schema/deploy changes need a human decision).
Full write-up of the design in `README.md`'s 2026-09-17 entry; the
deploy steps and ordering (migration before functions -- both new
functions read/write columns the migration creates) are in
`docs/ACTION-ITEMS.md` item 11. 2221 tests passing (6 new/updated test
files), plus consistency/undefined-vars/link checks clean.

<!-- Add new entries above this line -->
