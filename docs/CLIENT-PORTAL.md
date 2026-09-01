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

## Edge functions

All deployed and ACTIVE. Source backed up in `edge-functions/`.

| Function | verify_jwt | What it does |
|---|---|---|
| `sync-invoice-to-portal` | true | Writes to `client_portal_invoices`; then triggers `send-invite` (brand-new client) or `send-invoice-notification` (existing client, new invoice) |
| `send-invite` | true | Generates an invite link via the admin SDK, sends a branded Resend email, redirects to `set-password.html` |
| `send-invoice-notification` | true | "You have a new invoice" email to an existing client |
| `create-payment-intent` | true | Creates a Stripe PaymentIntent server-side, verifying the invoice actually belongs to the caller's email |
| `stripe-webhook` | **false** | Receives `payment_intent.succeeded`, marks paid in both `client_portal_invoices` and `workspace_sync`'s `th_invoices` |

Two non-obvious things worth not rediscovering the hard way:

- **`sync-invoice-to-portal` forwards the original caller's own auth
  token** to the downstream functions, not the service role key,
  because both of those require the `authenticated` role plus
  `can_manage_business_finances`.
- **`stripe-webhook` must be `verify_jwt: false`.** Stripe cannot
  send a Supabase JWT; the `Stripe-Signature` header is the only
  auth, verified with `constructEventAsync()` against the **raw**
  `.text()` body. Using `.json()` breaks signature verification.

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

## Ideas for where to take the portal next

Roughly ordered by likely value-to-effort, not committed to:

**Probably highest value**
- **Invoice PDF download.** Clients will ask for this for their own
  records or taxes. The internal `invoice-generator.html` already
  produces the layout, so the real work is making a client-facing
  read-only render, not designing something new.
- **Payment history / receipts.** Right now a paid invoice just moves
  to the Paid section. A client can't see *when* they paid or get any
  proof of it.
- **Real "pay all outstanding" option.** If a client has three unpaid
  invoices they currently pay them one at a time.

**Solid, moderate effort**
- **Job photos visible per invoice** (see pending item 7). Genuinely
  differentiating for a handyman business -- "here's what you paid
  for" is a real trust builder.
- **Quote approval.** Let a client accept or decline a quote in the
  portal rather than over text. Ties into the unification of quote
  and invoice already noted in `ARCHITECTURE-NOTES.md` item 3.
- **Service history.** A simple list of past jobs at that client's
  property. Useful for the client, and quietly useful for Triple H
  when a repeat call comes in.
- **Appointment self-scheduling from the portal**, reusing the
  existing booking flow, but pre-filled since the client is already
  known.

**Smaller polish**
- **"Remember me" / longer sessions.** Clients sign in rarely, so
  being logged out every time is more annoying here than in a tool
  used daily.
- **Partial payments** for larger jobs.
- **A client-visible "your next appointment" banner** if one's booked.
- **Email preferences** (invoice notifications on/off), which is also
  the honest thing to offer if notification volume ever grows.

**Worth considering but has real tradeoffs**
- **Auto-pay / saved cards.** Convenient, but meaningfully raises the
  stakes on the Stripe integration and on the security posture of
  the whole portal. Not something to add casually.
- **A messaging thread per job.** Sounds useful, but competes with
  text messaging, which is what clients actually use. Easy to build
  something nobody touches.
