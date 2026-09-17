# Feature specialist log

Started 2026-09-16, alongside the `tripleh-features` skill. See `README.md`
in this directory for how these logs work.

## 2026-09-17 -- persistent mobile Call + Book bar

Public-site conversion UX, not a tools/portal feature. The homepage
already had a Call-only `.sticky-call` strip at max-width 760px; the
audit wanted Call AND Book always reachable while scrolling, plus
Schedule as the hero's primary action.

Decided to upgrade the existing strip rather than add a second fixed
element -- chat, back-to-top, and the cookie banner were already
offset for one bottom bar, and a second one would stack into a mess.
Book's href matches each page's header Schedule button (`#schedule` on
the homepage, `/booking.html` on city/service pages, `/#schedule` on
our-work/about/blog index) instead of inventing a third destination.

Did not inject the bar from JS (cookie-consent style). The site's
pattern is duplicated HTML, and a JS-injected bar would flash in after
paint. Did not put it on blog posts, legal pages, or booking.html --
those either already are the conversion, or are not the marketing
surface the audit named. `/tools/` and `/portal/` left alone.

Hero swap is the same pairing on city/service pages because they
already shared the Call-primary markup; leaving them Call-primary
while the homepage flipped would have been the inconsistent case.
Triage + service modal kept Call-primary: different context, and U01
already locked that pairing.

Scoped `body` padding and the cookie/chat/back-to-top lift with
`:has(.sticky-call)` so pages without the bar no longer inherit the
old global 70px bottom padding that assumed a bar they didn't have.

<!-- Add new entries above this line -->## 2026-09-16 -- one-click "Create Invoice" from a job

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

<!-- Add new entries above this line -->
