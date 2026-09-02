# Client Portal: architecture, decisions, and what's left

Everything about the client-facing portal at `/portal/`, built
2026-08-31 and extended 2026-09-01. Separate from `/tools/` (the
internal team suite) in almost every way that matters, deliberately.

For general project orientation start at `docs/GETTING-STARTED.md`.
For the backlog and settled decisions across the whole project, see
`docs/ARCHITECTURE-NOTES.md`. This file is the portal specifically.

## What it is

Three pages, letting a client sign in to view and pay their invoices:

| Page | Purpose | Indexed? |
|---|---|---|
| `portal/login.html` | Email + password sign in, plus forgot-password | Yes, on purpose |
| `portal/set-password.html` | Handles BOTH invite-acceptance and password-reset | No |
| `portal/dashboard.html` | Invoice list, split Outstanding/Paid, with Stripe payment | No |

There is **no public sign-up anywhere**. An account only ever exists
because Triple H invoiced that client first, which triggers an invite
email. A client can sign in or reset a password they already have,
never self-register.

`login.html` is indexable on purpose (changed 2026-09-01, requested
directly): it's an empty email/password form with zero client data on
it, and it's exactly what someone searching "Triple H client portal"
or "Triple H login" is trying to reach. The other two stay `noindex`:
`dashboard.html` is meaningless without a real session anyway, and
`set-password.html` is a one-time link flow nobody should reach from
search.

## Hard architectural boundary with /tools/

The portal deliberately loads **none** of the internal suite's
JavaScript: not `auth.js`, `sync.js`, `data-layer.js`, or
`tools-nav-pwa.js`. All of those are built around the internal team's
login (account_roles, Owner/Developer/Employee roles, Dev Tools
access), and none of it belongs on a page an external client can
reach. Only the shared stylesheets are reused, purely for visual
consistency with the brand.

The portal uses the official Supabase JS SDK (via jsDelivr CDN)
rather than hand-rolled REST calls, because it correctly handles
auth token parsing that isn't worth reimplementing.

## Database

**`client_portal_invoices`** -- separate table from `workspace_sync`,
not a view onto it. RLS: `(select auth.email()) = client_email`,
SELECT only. No insert/update/delete for the `authenticated` role at
all; writes happen only through edge functions using the service role
key. Unique constraint on `source_invoice_id` so syncing the same
invoice twice updates rather than duplicates. Has a `line_items`
jsonb column that flows through the whole pipeline.

**`portal_bug_reports`** (added 2026-09-01) -- feeds the "Report a
problem" feature. `client_email` is nullable **on purpose**: a login
problem has to be reportable before any session exists, so requiring
one would make the single most useful report impossible to submit.
RLS: anyone (anon or authenticated) can INSERT with a message between
1 and 2000 chars; only internal accounts (checked via `account_roles`)
can SELECT or UPDATE. A client can submit but can never read anything
back, including their own past reports.

**`client_portal_quotes`** (added 2026-09-02, phase 2) -- same shape
as `client_portal_invoices`: separate table from the internal
`th_quotes` (which lives in the `workspace_sync` JSON blob),
deliberately not two-way synced back into it. Unique constraint on
`source_quote_id`. RLS: clients see only their own quote; internal
accounts (via `account_roles`) can see every quote -- a SECOND
permissive SELECT policy on the same table, not a replacement for the
first. No insert/update/delete for the `authenticated` role at all;
writes happen only through `sync-quote-to-portal` and
`respond-to-quote`, using the service role key.

**`quote_questions`** (added 2026-09-02, phase 2) -- deliberately
narrower than an open-ended messaging thread (see "Worth considering
but has real tradeoffs" further down this file): a client can ask one
question tied to one specific quote. RLS: INSERT requires being
signed in (unlike `portal_bug_reports`, which must work pre-login) AND
the inserted `client_email` matching the caller's own session AND that
`quote_id` genuinely belonging to them. SELECT/UPDATE are internal-only,
same shape as `portal_bug_reports`.

**`client_portal_quotes.client_address` and `.scheduled_at`** (added
2026-09-02, phase 3) -- `client_address` mirrors the Quote form's
existing address field, added once scheduling needed a real visit
address rather than re-asking for one. `scheduled_at` is set only by
`schedule-quote-job` (service role), never by the client's own
session, so the portal knows not to show the scheduling flow again
once a job is booked.

**`th_bookings.quote_id`** (added 2026-09-02, phase 3) -- a REAL
foreign key to `client_portal_quotes(id)`, unlike `th_bookings`'
existing `job_id`, which is a deliberately loose, unenforced reference
(documented as such -- `th_jobs` lives only in the `workspace_sync`
blob and can't be a real FK target). `quote_id` can be a proper FK
because `client_portal_quotes` is a real table.

**`client_portal_jobs`** (added 2026-09-02, phase 4) -- mirrors
`client_portal_invoices`' simpler shape: no internal SELECT policy
needed here, unlike `client_portal_quotes` -- Steve already sees jobs
directly in `tools/job-tracker.html`, there's no separate client-driven
state change to observe via the portal. Only synced when a job is
marked `done` (the same moment the 30-day warranty clock starts) AND
a client email is on file. Deliberately does NOT store the internal
`jobNotes` field -- that's for internal use only, never something to
expose to a client. Warranty status is never stored, only computed
fresh from `job_date` in `portal/jobs.html`, using the exact same
30-day formula `tools/job-tracker.html`'s own `warrantyBadgeHtml()`
already uses -- duplicating the formula (not the data) so this page
can never show a stale warranty status that drifted from a stored
value nobody updated.

**`client_portal_jobs.photo_storage_paths`** (added 2026-09-02) --
raw Storage paths only, never signed URLs (a signed URL expires; a
stored one would go stale). `get-job-photo-urls` signs these fresh on
demand -- see that function's own notes on why this needed to be more
than a thin wrapper around Storage's sign endpoint.

**`client_portal_checkups`** (added 2026-09-02, phase 5) -- mirrors
`client_portal_jobs`' simple shape, surfacing Recurring Job Templates
(`th_job_templates`) data. Only syncs a template genuinely tied to one
specific client (the "applies to different clients each time" blank-
client templates never sync) whose name resolves to a real client
registry record with an email on file, AND only for a client who
already has some other portal presence -- a template being merely due
someday isn't a strong enough signal to create a brand-new portal
account. "Due" status is never stored, only computed fresh in the
portal from `interval_months`/`last_created_date`, using the exact
same formula `tools/job-tracker.html`'s own `templateDueInfo()`
already uses. Deletion is a real operation here (unlike the other
portal tables, which are pure one-way mirrors that only ever grow) --
deleting a template internally also removes its portal row, so a
stale reminder never lingers for a template that no longer exists.

**`th_bookings.checkup_id`** (added 2026-09-02) -- a REAL foreign key
to `client_portal_checkups(id)`, same reasoning as the existing
`quote_id`. Set by `schedule-checkup-visit` when a client self-
schedules a visit from a due reminder. Unlike a quote-scheduled
booking, a checkup-scheduled one has no "already scheduled" guard --
a recurring reminder can reasonably be requested again.

## Edge functions

All deployed and ACTIVE. Source backed up in `edge-functions/`.

| Function | verify_jwt | What it does |
|---|---|---|
| `sync-invoice-to-portal` | true | Writes to `client_portal_invoices`; then triggers `send-invite` (brand-new client) or `send-invoice-notification` (existing client, new invoice) |
| `send-invite` | true | Generates an invite link via the admin SDK, sends a branded Resend email, redirects to `set-password.html` |
| `send-invoice-notification` | true | "You have a new invoice" email to an existing client |
| `create-payment-intent` | true | Creates a Stripe PaymentIntent server-side, verifying the invoice actually belongs to the caller's email |
| `create-bulk-payment-intent` | true | "Pay All Outstanding" -- same as `create-payment-intent` but for 2+ invoices at once, one combined PaymentIntent |
| `stripe-webhook` | **false** | Receives `payment_intent.succeeded`, marks paid in both `client_portal_invoices` and `workspace_sync`'s `th_invoices` -- generalized (2026-09-02) to mark every invoice sharing a PaymentIntent id, not just one |
| `sync-quote-to-portal` | true | Writes to `client_portal_quotes`; same new-client-vs-new-item branching as `sync-invoice-to-portal`, triggering `send-invite` or `send-quote-notification` |
| `send-quote-notification` | true | "You have a new quote to review" email to an existing client |
| `respond-to-quote` | true | Client-only (no `account_roles` check, unlike the internal functions above) -- verifies the quote belongs to the caller's own email and is still `pending`, then sets `approved`/`declined` |
| `schedule-quote-job` | true | Client-only -- verifies the quote is `approved`, belongs to the caller, and isn't already scheduled; inserts into `th_bookings` (service role) with `quote_id` set, then marks `client_portal_quotes.scheduled_at` |
| `sync-job-to-portal` | true | Writes to `client_portal_jobs` when a job is marked `done` with a client email on file; no email-notification branch (unlike invoices/quotes) since a completed job isn't worth a dedicated notification -- `send-invite` still fires for a genuinely new client |
| `sync-checkup-to-portal` | true | Writes to `client_portal_checkups` for a client-linked Recurring Job Template, only if that client already has some portal presence; also handles deletion (`{ source_template_id, delete: true }`) when a template is removed internally |
| `get-job-photo-urls` | true | Client-only -- verifies the job belongs to the caller, then signs each `photo_storage_paths` entry fresh (service role bypasses the job-photos bucket's own looser RLS, safe only because ownership was already checked) |
| `schedule-checkup-visit` | true | Client-only -- no approval/already-scheduled guard (unlike `schedule-quote-job`); inserts into `th_bookings` with `checkup_id` set |
| `set-invoice-paid` | true | **Internal-only** (`account_roles` + `can_manage_business_finances`) -- marks a portal invoice paid/unpaid by hand, for the cash/check/Venmo payments that never touch Stripe. Keyed by `source_invoice_id`, not the portal row id, since the caller is the internal Invoice Log |
| `set-invoice-paid` | true | **Internal-only** (`account_roles` + `can_manage_business_finances`) -- marks a portal invoice paid/unpaid by hand, for the cash/check/Venmo payments that never touch Stripe. Keyed by `source_invoice_id`, since the caller is the internal Invoice Log |

Two non-obvious things worth not rediscovering the hard way:

- **`sync-invoice-to-portal` forwards the original caller's own auth
  token** to the downstream functions, not the service role key,
  because both of those require the `authenticated` role plus
  `can_manage_business_finances`. `sync-quote-to-portal` does the same.
- **`stripe-webhook` must be `verify_jwt: false`.** Stripe cannot
  send a Supabase JWT; the `Stripe-Signature` header is the only
  auth, verified with `constructEventAsync()` against the **raw**
  `.text()` body. Using `.json()` breaks signature verification.

**Deliberate difference from `stripe-webhook`'s pattern:**
`stripe-webhook` writes `paid` directly into `workspace_sync`'s
`th_invoices` blob -- an accepted, known risk (an unconditional
read-modify-write of the whole blob, no merge check against a
concurrent write from an active browser session) that was judged
worth it specifically because payment status is important enough.
`respond-to-quote` does **not** do the equivalent for quote approval
status -- there's no write back into `th_quotes` at all. Internal
visibility instead comes from a live, real-time read against
`client_portal_quotes`/`quote_questions`, surfaced inline in the Quote
Log in `tools/invoice-generator.html` (`refreshPortalQuoteStatuses()`),
the same place the existing Paid/Unpaid badge and "Resend Invite"
button already live for invoices -- not a separate Dev Tools panel,
since Dev Tools hides almost everything from Steve's Owner role.

**`schedule-quote-job` reuses `th_bookings`' existing conflict
detection rather than reimplementing it.** `th_bookings` has a real
Postgres `EXCLUDE` constraint on `padded_range` (the same one
`booking.html` already relies on, confirmed by its own `23P01`/
"exclusion" error handling) -- this function inserts and lets that
constraint be the actual source of truth for "is this time free,"
surfacing a conflict as a friendly message instead of a raw Postgres
error, exactly like `booking.html` does.

## Real bugs found by testing, worth not reintroducing

- **A hidden-but-still-`required` password field silently blocked the
  entire login form.** On the forgot-password toggle, hiding the
  password field with `display:none` while it still had `required`
  meant native HTML5 validation blocked submission before any of the
  page's own JS ran, with no visible error. Fix: toggle
  `required` and `disabled` alongside `display`.
- **The magic-link/invite redirect URL is a `?redirect_to=` query
  param, not a request body field.** Caught by testing the real SDK
  against a hand-rolled REST call.
- **Clicking an invite link creates an authenticated session BEFORE a
  password is ever set.** This is documented Supabase behavior, not a
  bug, which is why `send-invite` always redirects to
  `set-password.html` and never straight to the dashboard.
- **A bug-report POST needs BOTH `apikey` and `Authorization: Bearer`
  headers.** The first version had only `apikey` and failed live.

## CRITICAL security fix, 2026-09-01

Found during a deliberate portal audit, not by accident. Seven tables
(`notification_log`, `push_subscriptions`, `th_bookings`,
`th_job_photos`, `th_leads`, `workspace_sync`, `workspace_sync_wiki`)
had RLS policies checking only `auth.role() = 'authenticated'`, with
no check for whether the account was actually internal.

That was safe for as long as only Connor and Steve could ever be
authenticated at all. **It became a live vulnerability the moment
client portal accounts started existing**, because a client's own
legitimate session is also role `authenticated`. Any signed-in client
could have read, and in most cases written or deleted, the entire
internal business dataset via a direct REST call -- `workspace_sync`
most severely, since that's the whole workspace blob.

Fixed: every one of those policies now also requires
`exists (select 1 from account_roles where email = auth.email())`.
Verified in both directions with simulated JWTs before being
considered closed. Full SQL recorded in
`sql/security/fix_authenticated_only_rls_policies.sql`.

**No real client account had ever been created** at the time of the
fix, so this was very likely never exploited. But the general lesson
is the important part:

> Any time a new class of authenticated user is introduced to this
> project, audit every RLS policy that checks only
> `auth.role() = 'authenticated'` without a further restriction. That
> check silently widens to include the new user class the instant it
> exists.

### A related Postgres trap, learned the hard way the same day

A table's own SELECT policy **cannot** query that same table in its
`using` clause, even through a helper function, unless that function
is `SECURITY DEFINER`. Doing it directly causes infinite recursion
and breaks all access to the table, including for legitimate internal
accounts. This happened while tightening `account_roles`' own open
SELECT policy; it was reverted within about a minute and redone
correctly with a new `current_user_has_any_role()` SECURITY DEFINER
function.

Note that the pre-existing `current_user_can_manage_roles()` on that
same table is NOT security definer and works fine, but only because
it's called from `account_roles`' UPDATE/DELETE policies rather than
its own SELECT policy. That distinction is easy to miss.

## Still pending (not blockers, but real)

1. **Stripe is in test mode.** Three things needed to go live:
   - `STRIPE_SECRET_KEY` (`sk_live_...`) as a Supabase Edge Function secret
   - `STRIPE_WEBHOOK_SIGNING_SECRET` (`whsec_...`) from Stripe Dashboard -> Developers -> Webhooks, pointing at the `stripe-webhook` function URL
   - Replace `pk_test_REPLACE_ME` in `portal/dashboard.html`
2. **Stripe receipt emails** are a one-toggle setting in Stripe
   Dashboard -> Settings -> Emails. Not enabled yet.
3. **MFA is not enabled** for either Connor or Steve in Supabase Auth
   (confirmed `has_mfa = false` for both).
4. **Leaked password protection is off** in Supabase Auth. Dashboard-
   only toggle, can't be set via SQL or API.
5. **Terms & Conditions has no standalone page.** It exists only as a
   homepage modal, so `portal/login.html` links to `/` as a
   workaround. A real `/terms.html` would be better.
6. **The bug report flow was never confirmed end-to-end in a live
   browser.** The sandbox it was built in couldn't reach Supabase
   through a real browser request. Confidence rests on direct SQL-
   level RLS testing plus an exact header match to already-working
   code (`th_leads` insert in `index.html`). **Worth having someone
   actually click "Report a problem" on the live site once and
   confirm it appears in Dev Tools -> Health -> Portal bug reports.**
7. **Job photos on the portal** -- clients can't see photos from their
   own jobs. This is an unmade product decision, not an oversight.

## The full vision (recorded 2026-09-01, Connor's own framing)

The portal's end goal is a genuine one-stop hub for a Triple H client's
entire relationship with the business, not just invoice payment:

1. Steve creates a quote for a job. The client signs into the portal,
   reviews it, can ask questions, and can approve it.
2. Approving a quote lets the client schedule the job directly in the
   portal -- a more client-friendly version of the public booking
   flow, not a redirect to it.
3. The client can review and pay invoices in the portal (done --
   see above).
4. The client can review, and download, both invoices and receipts
   (done -- see above).
5. Warranty info shows up per job where applicable.
6. Return-service / check-up dates show up where applicable.

## Build order, and why it's ordered this way

Real dependencies, not preference, decide this order:

1. ~~**Invoices** (view, pay, PDF, receipts)~~ -- **done**, everything
   above this line in this file.
2. ~~**Quote review + questions + approval.**~~ -- **done** (2026-09-02).
   `client_portal_quotes` + `quote_questions` tables, `sync-quote-to-
   portal`/`send-quote-notification`/`respond-to-quote` edge functions,
   `portal/quotes.html`, and a `quoteClientEmail` field + auto-sync in
   the Quote tab of `tools/invoice-generator.html`. Deliberately scoped
   narrower than the full idea in two ways: no client-facing quote PDF
   yet (reusable from `portal/dashboard.html`'s jsPDF pattern whenever
   wanted), and questions are insert-only from the client side (Steve
   follows up by phone/text/email, not an in-portal reply).
3. ~~**Scheduling the job from an approved quote.**~~ -- **done**
   (2026-09-02). Deliberately after approval, not a standalone
   feature -- the real booking backend already existed and was reused
   as-is (`th_bookings` table, `get_booking_availability` RPC, the
   exact timezone/business-hours logic from `booking.html`, copied
   rather than shared since `booking.html` has no shared module of its
   own either). The portal version is simpler than the public flow on
   purpose: no service picker (already tied to one specific quote), a
   flat 120-minute default duration, and pre-filled with the
   already-known client identity/address -- not a generic anonymous
   slot picker. A new `schedule-quote-job` edge function centralizes
   both the `th_bookings` insert and the `client_portal_quotes.
   scheduled_at` write-back as one server-side operation.
4. ~~**Job history + warranty status.**~~ -- **done** (2026-09-02).
   New `client_portal_jobs` table (same sync-table pattern again, but
   simpler than quotes' -- no internal SELECT policy needed since
   Steve already sees jobs directly in Job Tracker) and a
   `jobClientEmail` field on the job form. Only syncs when a job is
   marked `done` with a client email on file -- the exact moment the
   30-day warranty clock starts. Warranty itself is already a real,
   computed rule internally (30 days from completion date -- see
   `tools/job-tracker.html`'s `warrantyBadgeHtml()`, and the same
   30-day figure in `tools/contract-generator.html` and the public
   Terms); `portal/jobs.html` recomputes the identical formula
   client-side from `job_date` rather than storing and risking a
   stale value.
5. ~~**Return-service / check-up reminders.**~~ -- **done**
   (2026-09-02). New `client_portal_checkups` table surfacing
   Recurring Job Templates data as a read-only banner on
   `portal/jobs.html`. Self-scheduling against a due reminder --
   originally flagged as a future step -- also shipped the same day
   (new `schedule-checkup-visit` edge function and `th_bookings.
   checkup_id`, reusing the exact scheduling UI already built for
   phase 3). "Due" status is computed fresh from the raw
   `interval_months`/`last_created_date` inputs using the identical
   formula `templateDueInfo()` already uses internally, same
   never-store-a-computed-value discipline as job warranty. This
   closes out all five phases of the original roadmap.

## Client identity: one client, one email (2026-09-02)

The single highest-value fix found in a full audit of how the internal
app, the client portal, and the public website fit together. Worth
understanding before touching any of these paths.

**What was wrong.** A client's email could be typed on four separate
forms -- Invoice, Quote, Job, Contract -- and three of the four never
wrote it back to the shared client registry (`th_clients`). Worse,
`thEnsureClient()` returned early whenever a client already existed,
silently discarding any newly-learned detail. Since a client almost
always DOES already exist by the time you're invoicing them,
`registry.email` was effectively **blank for everyone, permanently**.

Three real consequences, all now fixed:

1. **Check-up reminders were dead on arrival.** `sync-checkup-to-portal`
   reads exactly that blank field to decide whether a reminder can sync
   at all. Phase 5 could never have fired for anyone.
2. **A typo silently created a second portal identity.** Same real
   person, invoices under one email, quotes under another, nothing
   surfacing the split.
3. **The website threw the email away at the front door.**
   `booking.html` captures it into `th_bookings`, but
   `convertBookingToJob()` dropped it -- so the one place a client had
   already typed their own email correctly was discarded, and it got
   re-typed by hand later.

**The fix, both directions:**

- **Write side** -- `thEnsureClient()` now *enriches*: any detail in
  `extras` that the existing record is MISSING gets filled in and
  saved. Deliberately fill-only, never overwrite: a blank field being
  filled is unambiguously new information, but a differing non-blank
  value is a genuine conflict (a typo? a real change of address?) that
  shouldn't be silently resolved by whoever saved last. Same
  "first non-empty value wins" rule the backfill already used.
- **Read side** -- new `thAutofillClientFields()` in `data-layer.js`,
  wired to the Invoice, Quote (which had no autofill at all before),
  and Job forms. Type a known client's name and their details fill in
  from the registry. Also fill-only; never overwrites typed input.
- **Website side** -- `convertBookingToJob()` now passes
  `booking.email` into the registry and onto the job record.

Net effect: a client's email is typed **once, anywhere** -- including
by the client themselves on the public booking form -- and is then
available everywhere else automatically.

## How Connor and Steve actually manage this day to day

Written 2026-09-02, in answer to a direct question. The short version:
**almost nothing new to learn** -- portal management is deliberately
folded into the tools they already use, not a separate admin app.

| To do this | Go here |
|---|---|
| Give a client portal access | Just fill in the client email field on an Invoice, Quote, or Job. Sync + invite email happen automatically |
| See if a client approved/declined a quote | Quote Log in `invoice-generator.html` -- shown inline per quote |
| Answer a client's question about a quote | Same place, inline, with a "Mark answered" button |
| Mark a cash/check/Venmo payment paid | Invoice Log's Mark Paid toggle -- now syncs to the portal (`set-invoice-paid`) |
| Resend a client's invite | Dev Tools -> Health -> **Portal accounts**, search and press Resend invite |
| See what a client can actually see | Same Portal accounts panel -- counts of their invoices/quotes/jobs |
| See a portal-submitted problem report | Dev Tools -> Health -> Portal bug reports |
| See a portal-booked appointment | The normal booking views -- each one's note says where it came from ("Scheduled from approved quote #...", "Requested from check-up reminder: ...") |
| Show a client job photos | Nothing extra -- photos already uploaded to a job appear in the portal once that job is marked Done |

**Why Portal accounts lives in Dev Tools -> Health specifically:**
almost every Dev Tools panel is `dev-owner-hidden` (Developer-only).
Health and Access are among the only areas an **Owner** account can
see, so putting it there is what makes it usable by Steve at all.
Same reasoning as `portal_bug_reports` before it.

**Known remaining gaps** (not blockers, recorded honestly):

- The Quote tab has no "resend notification" equivalent -- the Portal
  accounts panel's Resend invite covers account access, but not
  re-sending a specific quote notification a client missed.
- No way to change a client's portal email from inside the tools. If a
  client's email changes, the registry updates fine, but their existing
  Supabase Auth account still has the old address -- that needs the
  Supabase dashboard directly. Worth building if it ever comes up twice.



Recorded during the same audit, while Stripe is still blocked on the
EIN. The instinct to "link everything through Stripe" is right for
some of this and actively wrong for the rest.

**Good fits -- Stripe is genuinely better at these:**
invoice numbering (today's `INV-YEAR-<random 4 digits>` is random, not
sequential, with a real collision risk that's exactly why
`checkDuplicateInvoiceNumber()` exists), PDF generation and hosting,
payment status as a single source of truth, receipt emails, payment
history, partial payments, and the hosted invoice page. Stripe
Invoices would replace a large chunk of `invoice-generator.html`'s PDF
code and all of `client_portal_invoices`' status tracking.

**Bad fits -- keep these ours:** quotes/estimates (Stripe Quotes are
B2B-contract-shaped, not handyman-estimate-shaped, and can't do the
approval + questions flow in phase 2), job tracking, warranty,
scheduling, and job photos. Also worth knowing before committing:
Stripe's own invoice PDFs are unbranded compared to what's already
built here.

**The trap to avoid.** Stripe as source of truth for invoices means
the internal Invoice Log becomes a *view* of Stripe, not its own
writable store. Keeping both writable would make the sync problem
strictly worse than it is today, not better. Note that today there are
already three places paid-status lives (`th_invoices`,
`client_portal_invoices`, Stripe) -- `set-invoice-paid` closed the
worst gap between them, but that's a patch over a design that
consolidation should actually fix.

## Smaller ideas not yet folded into a phase above

Roughly ordered by likely value-to-effort, not committed to. Quote
approval, scheduling, job history, warranty, and service history all
now live in the numbered roadmap above -- this list is what's left.

**Worth doing soon**
- ~~**Real "pay all outstanding" option.**~~ -- **done** (2026-09-02).
  New `create-bulk-payment-intent` edge function combines every unpaid
  invoice into ONE Stripe PaymentIntent; `stripe-webhook` generalized
  to mark ALL covered invoices paid (it already naturally looked up
  every row sharing a PaymentIntent id, it just used to assume there
  was only ever one). Only offered once there are 2+ unpaid invoices
  -- a single one already has its own "Pay now" button.
- ~~**Job photos visible per invoice / per job.**~~ -- **done**
  (2026-09-02). `client_portal_jobs.photo_storage_paths` stores raw
  Storage paths only, never signed URLs (those expire). New
  `get-job-photo-urls` edge function generates fresh signed URLs on
  demand -- this ended up being more than a convenience wrapper: the
  `job-photos` Storage bucket's own RLS policies (confirmed directly
  against `pg_policies`) only check `bucket_id = 'job-photos'` for the
  `authenticated` role with no owner scoping at all, meaning a
  client's own session could otherwise sign a path for ANY job's
  photos, not just their own. Routing every sign request through this
  function's explicit ownership check closes that gap for this
  feature specifically -- it does not fix the underlying bucket
  policy itself, which predates this feature.

**Smaller polish**
- **"Remember me" / longer sessions.** Clients sign in rarely, so
  being logged out every time is more annoying here than in a tool
  used daily.
- **Partial payments** for larger jobs.
- **Email preferences** (invoice notifications on/off), which is also
  the honest thing to offer if notification volume ever grows.

**Worth considering but has real tradeoffs**
- **Auto-pay / saved cards.** Convenient, but meaningfully raises the
  stakes on the Stripe integration and on the security posture of
  the whole portal. Not something to add casually.
- **A messaging thread per job.** Sounds useful, but competes with
  text messaging, which is what clients actually use. Easy to build
  something nobody touches. The quote-questions feature in phase 2 is
  deliberately scoped narrower than this -- questions on one specific
  quote, not an open-ended thread.
