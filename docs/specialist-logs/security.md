# Security specialist log

Started 2026-09-16, alongside the `tripleh-security` skill. See `README.md`
in this directory for how these logs work.

## What changed, 2026-09-16 -- proactive audit, two real gaps found and closed in the same-day invoice/quote automation

Ran a full proactive pass per this specialist's brief: `mcp__Supabase__get_advisors`
(security) against the live project, a repo-wide grep for committed secrets
(none found -- the only hits were env-var *names* referenced correctly via
`Deno.env.get`), and a close read of the two client-facing edge functions
added earlier the same day (`send-payment-reminder`, `send-quote-followup`).

**1. `check_cron_health()` was callable by anyone with the public anon key.**
Added the same day in `add_cron_watchdog.sql`, this `SECURITY DEFINER`
function was flagged by the advisor as executable by both `anon` and
`authenticated` via `/rest/v1/rpc/check_cron_health`. Its only legitimate
caller is the `cron-watchdog` pg_cron job itself (runs as its owner, bypasses
grants) -- nothing in the app calls it over REST (the `send-push-index.ts`
"cron-health-alert" branch only *receives* the push payload it sends
outbound, never calls it). Fixed with `revoke execute ... from anon,
authenticated` -- except that alone was a no-op, since Postgres grants
EXECUTE to `PUBLIC` by default on function creation and every role
implicitly inherits from `PUBLIC`. The real fix needed `revoke execute ...
from public` too; confirmed directly afterward via
`information_schema.routine_privileges` (only `postgres`/`service_role` keep
EXECUTE now) and a fresh advisor re-scan. Recorded in
`sql/infra/revoke_check_cron_health_public_execute.sql`. The `rls_enabled_no_policy`
finding on `cron_watchdog_state` is intentional deny-all, already documented
inline in `enable_rls_cron_watchdog_state.sql` -- left alone.

**2. `send-payment-reminder` and `send-quote-followup` had no auth check on
incoming requests at all -- a same-day regression of a bug class this repo
already fixed once.** `uptime-alert-index.ts` had this exact issue fixed
2026-09-15 (see its own `uptime-alert-auth.test.js`): Supabase's platform-level
`verify_jwt` only checks a JWT's signature, not its role, so the public anon
key embedded in every page's HTML validly passes it. Without an app-level
check, anyone holding that key could POST directly to either function and
fire real payment-reminder or quote-followup emails at real clients on
demand, ahead of the intended daily cron schedule. Both crons
(`add_payment_reminder_emails_cron.sql`, `add_quote_followup_email_cron.sql`)
already authenticate their own call with the service-role key -- the gap was
purely that the function body never checked it. Added the identical
`Authorization: Bearer` vs. `SERVICE_ROLE_KEY` check (401 otherwise) that
`uptime-alert-index.ts` uses, renamed the unused `_req` parameter to `req`
accordingly, and added matching auth tests
(`payment-reminder-auth.test.js`, `quote-followup-auth.test.js`) plus fixed
the now-stale `_req` regex in the two pre-existing test files for these
functions. Full edge-function test group (33 tests) passes; ran the full
suite before and after (109 pre-existing, unrelated failures on baseline --
booking/tour/CSS-layout areas, nothing touching these files -- vs. 107 after,
the 2-test improvement being exactly these two auth fixes) to confirm nothing
else broke.

Both edge-function fixes still need `supabase functions deploy
send-payment-reminder` and `send-quote-followup` to actually take effect in
production (same open deploy caveat already tracked in
`docs/ACTION-ITEMS.md` for these two functions from when they were first
added) -- the SQL grant fix is already live (applied directly via the
Supabase MCP migration tool and confirmed).

**Why this class of bug matters at this company's actual scale**: a
two-person shop with real client PII and payment data still has a public,
by-design anon key on every page. That key being usable to trigger arbitrary
client-facing emails or off-schedule internal monitoring runs is a real,
concrete impact (reputational -- unexpected emails to real clients; and
operational -- spoofed internal alerts) even though nothing here touches
payment card data directly. Prioritized both fixes over anything lower-impact
because both are trivially exploitable by anyone who views page source, not
just a theoretical risk.

## What changed, 2026-09-16 (later the same day) -- hub-dispatched audit: job-messages pre-deploy review + Stripe pass, both clean

Two-part assignment from a scheduled "Hub dispatch: security audit" routine.
No fixes needed this round -- both areas checked out solid, recorded here so
the "clean" result itself is on record, not just fixes.

**1. `client_portal_job_messages` / `notify-job-message-email` (pre-deploy
review).** The table and its `on_job_message_send_email` trigger are already
live in the database (schema pushed ahead of the edge function itself, which
doesn't exist yet -- genuinely "pending deploy," not present in this repo or
any open branch/PR, confirmed via `search_code` and checking all 3 open PRs'
diffs). Checked real `pg_policies` (not assumed): INSERT requires
`sender_email = auth.email()` AND (a client inserting requires the target
`job_id` to resolve to a `client_portal_jobs` row with their own
`client_email`, OR an internal account inserting requires
`current_user_has_any_role()`) -- a client can neither spoof another
client's messages, post into a job that isn't theirs, nor forge an
`internal`-sender message. SELECT mirrors this exactly. Real FK
(`job_id -> client_portal_jobs(id) ON DELETE CASCADE`) and check constraints
(`sender_type` restricted to `client`/`internal`, message can't be blank) back
this up at the schema level, not just RLS. This is a verbatim copy of the
already-reviewed `client_portal_work_order_messages` pattern (same column
shapes, same policy structure) -- whoever built this followed the established
template exactly. The trigger function `notify_job_message_email()` is
`RETURNS trigger`, same verified-benign class as `notify_new_work_order_email()`
et al. already documented in `SECURITY.md` -- Postgres refuses to invoke it
outside a trigger context regardless of grants, confirmed by that same prior
audit's direct test, not re-tested here since the class is already settled.
**No gap found; safe to deploy the edge function whenever that's ready.**

**2. General Stripe/payment pass** (since the 2026-09-08 independent RLS/grant
pass documented above -- no dedicated Stripe-focused pass had been logged
before this one). Read the full source of `stripe-webhook`,
`create-payment-intent`, `create-bulk-payment-intent`, `manage-saved-card`,
and `create-pos-charge` end to end, plus `pg_policies` on `stripe_customers`,
`card_authorizations`, and `stripe_pos_charges_logged`.

- `stripe-webhook`: real `Stripe-Signature` verification via
  `constructEventAsync` before anything else runs (the official pattern for
  Deno's async crypto environment, not the sync version that's a documented
  footgun there); raw body read via `.text()`, never re-serialized JSON, so
  signature verification can't be broken by re-parsing. POS and invoice
  paths are both idempotent on the PaymentIntent id (a real Postgres primary
  key + `on_conflict=do-nothing`, not a check-then-act race against a JSON
  blob).
- `create-payment-intent` / `create-bulk-payment-intent`: the real
  authorization boundary is explicit and checked directly against the
  database, not inferred from the JWT alone -- every invoice being paid must
  belong to the caller's own verified session email (case-insensitively),
  checked invoice-by-invoice for the bulk case, never trusting an invoice id
  alone. Charge amount is computed server-side from the invoice's own
  stored `total`, never accepted from the client request body -- a client
  altering the request can't pay a different amount than what's actually
  owed.
- `manage-saved-card`: `list` and `create_setup_intent` are scoped to the
  caller's own Stripe Customer (looked up server-side by session email,
  never a client-supplied customer id); `remove` re-verifies the target
  payment method's own `customer` field matches the caller's real customer
  id immediately before detaching, not just trusting an earlier `list` call
  -- a client can't detach another client's card by guessing a
  `payment_method_id`.
- `create-pos-charge`: correctly gated on `callerIsInternalAccount()`
  (a real `account_roles` row), matching this being an internal-initiated
  charge with no invoice to anchor a client-ownership check to. The
  client-supplied `amount` here is intentional and correct, not a gap --
  POS has no invoice to derive an amount from; the trust boundary is "is the
  caller a real internal account," which is checked before the amount is
  even read.
- Underlying tables: `stripe_customers` and `stripe_pos_charges_logged` are
  internal-view-only (`current_user_has_any_role()` / an `account_roles`
  EXISTS check); `card_authorizations` lets a client view only their own
  rows. None of the three has an INSERT/UPDATE/DELETE policy at all --
  writes only ever happen via the service-role key inside the edge
  functions above, confirmed by the actual `pg_policies` rows, not assumed
  from table naming.

**No gap found.** Also re-ran `get_advisors` (security) as part of this pass
-- same already-triaged finding set as before (the intentional
`cron_watchdog_state` deny-all, and the booking/job token-RPC + trigger-only
functions already confirmed intentional in the audit log above); nothing new.

## What changed, 2026-09-17 -- hub-dispatched handoff: Send-Push had no auth check; verified and corrected two claims in the handoff itself

Hub dispatch handed off three items. Per this specialist's own brief and the
standing instruction to verify against live source rather than trust prior
notes, checked each claim directly before acting on it -- two held up, one
didn't, and one broke down into two separate real facts.

**1. `Send-Push` (capitalized, the real deployed function, v50) had no
app-level auth check -- confirmed independently, both in the repo's
`edge-functions/send-push-index.ts` and in the live deployed source via
`get_edge_function`. Same regression class already fixed for
`uptime-alert-index.ts` (2026-09-15) and `send-payment-reminder`/
`send-quote-followup` (2026-09-16 earlier entry) -- Supabase's
`verify_jwt: true` only checks JWT signature, not role, so the public
anon key shipped in every page's HTML could call it directly: spam an
arbitrary `user_id` via the `client-notification` branch, or broadcast
fake "site is down" / cron-health / stripe-reconciliation alerts. This
one had been missed in both the 2026-09-16 sweeps that caught the
sibling functions -- worth noting since it's the highest-traffic of the
three (13+ distinct call sites: two DB triggers, two crons, and every
other Edge Function that pings it for an internal or client alert).

**The handoff's claim that a fix already existed locally, uncommitted, at
this exact path was false** -- `git status` showed a clean tree and no
local diff existed anywhere in this checkout. Did not treat that claim as
established fact (per this session's standing instruction to verify
background-task/hub claims against live source, not prior-session notes);
wrote the actual fix instead of assuming one was already there. Verified
every real caller (`sql/leads/notify_new_lead_use_vault_secret.sql`,
`sql/booking/add_booking_{notifications,cancellation,reschedule}.sql`,
`sql/security/fix_cron_job_use_vault_secret.sql`,
`sql/infra/add_weekly_digest_and_notification_archive_cron.sql`,
`sql/infra/add_cron_watchdog.sql`, and `uptime-alert-index.ts`) already
sends the literal service-role key as its bearer token (the
`send_push_service_role_key` Vault secret is that exact value, per
`fix_cron_job_use_vault_secret.sql`'s own comment on its origin) before
writing the fix, so the same `token !== SERVICE_ROLE_KEY` check
`uptime-alert-index.ts` uses is safe for every existing caller. Added the
check, a matching `send-push-auth.test.js` (same shape as
`uptime-alert-auth.test.js`/`payment-reminder-auth.test.js`, plus an
extra assertion that every real caller SQL file authenticates with the
service-role key), and ran the full suite: 1951 tests, 107 failing --
identical count and identical failure list (booking/design/tour/jsdom
areas, none touching push/edge-functions) to the pre-existing baseline
already on record in this log's 2026-09-16 entry, confirming no
regression. Opened a PR rather than deploying -- per this session's
standing instruction, the edge function fix needs a human sign-off
before it goes to production.

**2. `uptime-alert`'s deploy gap is real, independently confirmed.**
Read the live deployed source via `get_edge_function` (not the repo
copy) and compared it directly against `edge-functions/uptime-alert-
index.ts`: the deployed v11 has no auth check at all -- the repo's fix
from 2026-09-15 was never actually shipped. This is a genuine, separate
gap from item 1 (the source has been correct for two days; only the
live function is stale) and needs its own deploy decision, flagged to
the hub rather than deployed here.

**3. The orphaned lowercase `send-push` function (v8, id
`aaa21126-3451-4bd2-a8e3-97d4f95bbf5a`)** -- re-confirmed still live via
`list_edge_functions`, consistent with the 2026-09-16 finding already on
record (`docs/ACTION-ITEMS.md` #9). Recommendation to the hub: decommission
rather than patch. It's missing three generations of real fixes the live
`Send-Push` has (business-timezone handling, partial-payment-aware overdue
checks, `checkPendingReviewReminders`), nothing in the repo or live database
calls it, and patching a dead duplicate just doubles future maintenance
burden for a function that should be deleted, not kept current. Deletion
still needs a human with dashboard/CLI access per the existing action item
-- not something this fix touches.

**Why this class of bug matters at this company's actual scale**: same
reasoning as the 2026-09-16 entry above -- a public, by-design anon key
shipped to every page visitor being usable to trigger arbitrary
client-facing pushes or spoofed internal alerts is a real, concrete
impact (reputational and operational) at any company size, not just a
theoretical risk, since it requires nothing beyond viewing page source.

## 2026-09-21: Merged a duplicate-permissive-policy finding on client_account_codes

Found by running Supabase's own performance advisor as a proactive
check (no user report), while looking for anything safely actionable
after two blocked feature requests (address autocomplete, SMS
confirmation both need external API accounts I don't have). Real,
if minor, finding on my own recent work: `client_account_codes`
(shipped in PR #310) had two separate permissive RLS policies both
matching `role=authenticated, action=SELECT` -- the staff "FOR ALL"
policy's implicit SELECT, plus a dedicated "portal client can view
their own row" SELECT policy. Postgres evaluates every matching
permissive policy per query, so every SELECT against this small
table did twice the RLS work for zero behavior difference -- the
exact `multiple_permissive_policies` class this project has fixed
before on other tables.

Fixed via `sql/infra/merge_client_account_codes_select_policies.sql`:
dropped both original policies, replaced with one merged SELECT
policy (`staff OR own row`) and three single-action write policies
for staff (insert/update/delete -- Postgres has no "FOR ALL except
SELECT" shorthand). Verified live, not just by re-reading the
advisor: inserted two real rows, set `request.jwt.claims` to
simulate a portal client's own JWT and confirmed they saw only their
own row, then simulated a real internal account's JWT and confirmed
they saw both -- then deleted the test rows. Re-ran the advisor
afterward and confirmed the finding is gone.

Updated `tests/referrals/account-codes.test.js`'s RLS test to check
the new merge file (the actual live policy set) rather than only the
original schema file, and extended it to assert all three write
policies exist.

Verified: full suite **2577/2577** passing. `check-consistency`/
`check-undefined-vars`/`check-links.py` all clean.

## 2026-09-21: Closed two real findings from an external Cursor security audit

Acted on the "Fix these first" bucket of a security punch list a user
pasted from a Cursor session. Picked the two items that were actual code/
schema fixes I could verify and apply directly (the rest need a human:
MFA enrollment is a dashboard action for the owner's own account, the
lowercase `send-push` deletion has no MCP tool reachable, both already
tracked in `docs/ACTION-ITEMS.md`; the payment/quote-reminder "prove it
sent" item is just waiting on tomorrow's 15:00/16:00 UTC cron runs).

**1. `resync_cron_service_role_key(text)` was genuinely still
anon/authenticated-callable**, despite `sql/infra/resync_cron_service_role_key.sql`
already containing `revoke all ... from public` from when it was
written. Verified live via `pg_proc`/`has_function_privilege` before
touching anything -- confirmed the advisor was right, not a stale
finding. Root cause: Supabase auto-grants EXECUTE to `anon`/
`authenticated` as separate explicit per-role grants at function-creation
time, and revoking from the `public` pseudo-role doesn't remove an
already-granted role's own privilege -- the earlier fix's `revoke ...
from public` line never actually closed this. This one was real risk:
anyone holding the page's own public anon key could have overwritten the
Vault secret every cron reminder job authenticates with. Fixed with an
explicit `revoke ... from anon, authenticated`, then re-ran
`get_advisors` and confirmed the finding is gone.

Also re-flagged in the same audit list: `guard_last_role_manager_permission()`
and 6 `notify_*` functions. Re-verified live (not assumed from the prior
2026-09-10 note that only checked 3 of these 7) that all 7 are `RETURNS
trigger` -- Postgres refuses to call a trigger-return-type function
outside an actual trigger fire regardless of grants, so these were never
actually exploitable via `/rest/v1/rpc/...`. Revoked EXECUTE from them
anyway (zero functional cost, since triggers don't need role-level
EXECUTE to fire) purely to stop the advisor re-flagging them every run.

**2. `job-photos` Storage bucket policies only checked `bucket_id`, not
ownership** -- confirmed live via `pg_policies`, matching what
`get-job-photo-urls-index.ts`'s own comments already documented but had
left "out of scope" for that feature. Any authenticated session
(a client portal account included, not just staff) could call Storage's
own sign/upload/delete endpoints directly for any job's photos. Grepped
every portal code path first and confirmed clients never call Storage
directly for this bucket -- `portal/jobs.html` always goes through the
ownership-checked edge function -- so the only real caller is internal
staff via their own session in `job-tracker.html`. Restricted all three
policies to `current_user_has_any_role()` (this project's standing
internal-vs-client check), which closes the gap with zero effect on real
usage.

Both fixes recorded in `sql/security/` (mirroring the live migrations,
per this repo's convention) and re-verified against a fresh
`get_advisors` call afterward -- both findings are gone; everything
remaining is already-reviewed intentional public access (token-based
`*_by_token` RPCs, `get_booking_availability`, `current_user_has_any_role`
itself, `next_invoice_number`/`next_quote_number` which already
self-check `current_user_has_any_role()` internally).

Did not touch: MFA enrollment (owner's own account, not a repo change),
deleting the orphaned lowercase `send-push` function (no MCP delete tool
for Edge Functions exists -- confirmed again this session, still needs
dashboard/CLI), or the cron "does it actually send" item (nothing to
verify until tomorrow's scheduled runs happen).

## 2026-09-22: Internal /tools/ MFA -- closing the real, standalone gap ACTION-ITEMS and CLIENT-PORTAL.md both flagged

**The gap, verified against live code before building anything.** Read
`tools/login.html`, `tools/auth.js`, and `account_roles`/
`role_definitions` directly rather than trusting the prior notes at
face value (this project's own stated lesson -- these lists have gone
stale before). Confirmed: internal accounts authenticate with a bare
Supabase Auth password grant (`tools/auth.js`'s `signIn()`, raw
`fetch()` against `/auth/v1/token?grant_type=password`) with zero MFA
option anywhere in that path, while client-portal accounts got real
TOTP MFA on 2026-09-16. This is a real, standalone security gap, not
part of the recent IA/UX work -- the two highest-privilege accounts in
this whole system (Owner and Developer, with Dev Tools access, POS
card-charging, invoice/finance visibility, and role management) had
only a password between them and full access.

**Why this wasn't done alongside the 2026-09-16 portal work, and why
that was the right call at the time, not an oversight left to rot:**
the portal's MFA is scoped to a UI (`portal/settings.html`,
`portal/login.html`) that already loads the `@supabase/supabase-js`
client for other things. `tools/auth.js` deliberately does NOT load
that SDK anywhere -- it's raw `fetch()` throughout, a conscious choice
recorded in its own comments ("matching the existing pattern in
sync.js rather than introducing a new dependency on every page"). Internal
accounts also needed a real mandatory-vs-optional decision per role
(the portal's MFA is opt-in for every client, with no equivalent
"this tier must have it" concept) and a lockout/recovery story the
portal never needed to build. Bundling all of that into the
2026-09-16 session would have meant rushing exactly the kind of
architecturally non-obvious decision this project's own history
warns against rushing (three separate prior sessions on this repo
lost real work to a skipped-planning-step race, a merge conflict, and
a duplicate-tag bug). Treating it as its own dedicated piece of work
was the right call, not neglect -- and both docs that mentioned it
(`docs/ACTION-ITEMS.md` #2, `docs/CLIENT-PORTAL.md`'s "still pending"
item 3) said so explicitly rather than silently dropping it.

**Architecture decisions, and why:**

- **Raw `fetch()` against the same Supabase Auth REST endpoints the
  SDK's `mfa.*` methods call internally, not a loaded `supabase-js`
  client.** Confirmed the exact endpoint shapes by installing
  `@supabase/supabase-js@2` in a scratch directory and reading its own
  `GoTrueClient.ts` source directly (this repo has no live Supabase
  project access to test against, so the SDK's own source was the most
  reliable ground truth available) -- `POST /factors` to enroll,
  `POST /factors/:id/challenge` then `POST /factors/:id/verify` to
  verify (a raw `challenge_id`+`code` body, returning a whole new
  session), `DELETE /factors/:id` to unenroll, and the verified
  factors live on the plain `GET /auth/v1/user` response (`user.factors`,
  filtered client-side by `factor_type`/`status`) rather than a
  separate `/factors` list endpoint. This keeps `login.html` and
  `settings.html` on the same zero-new-dependency footing as the rest
  of `auth.js`, rather than adding a CDN script load to the one page
  (`login.html`) where a failed/blocked third-party script load would
  be most damaging (it would break signing in entirely, not just one
  feature on an already-loaded page).
- **The chokepoint is `login.html` itself, not a per-page gate.**
  `signIn()` gained a `skipPersist` option: a correct password no
  longer writes anything to `localStorage`/`sessionStorage` by
  itself. `login.html` holds the freshly-issued (aal1) tokens in a
  page-local variable, decides whether a challenge or mandatory
  enrollment is required, and only calls `persistSession()` once that
  clears. This matters for a real reason, not just tidiness: Postgres/
  PostgREST has no native concept of "aal1 vs aal2" -- that
  distinction only exists in the JWT's own `aal` claim and is only
  meaningful to whoever chooses to check it. If a session were
  persisted the moment the password checked out, that access token
  would already be fully valid against every RLS policy in the
  database even before the login PAGE had shown a code prompt. Because
  every one of the 23 tool pages' `requireAuth()`/role checks reads
  from that same stored session (`hasValidSession()`/`getAuthToken()`
  in `auth.js`), gating this one spot means none of those pages needed
  touching individually -- exactly the kind of shared chokepoint (like
  `loadCurrentUserRole()`/`th-role-loaded` already is for role-gated
  UI) this project's own conventions call for instead of a 23-page
  sweep.
- **Mandatory for any account whose REAL permissions require it, not
  by `role_name` label.** `requiresMfaForRole()` checks the actual
  `account_roles` booleans (`can_manage_roles`, `can_access_dev_tools`,
  `can_access_dev_tools_full`, `can_manage_site_content`,
  `can_manage_invoices`, `can_manage_contracts`, `can_view_finance`,
  `can_view_runway`, `can_manage_reviews`) rather than `roleName ===
  'Owner' || roleName === 'Developer'`. This matches how the
  permission system itself already works -- the 2026-09-02 redesign
  made `role_name` "just a display label... nothing reads it to decide
  what an account can actually do anymore" (per `auth.js`'s own
  comments), so gating MFA on the label instead of the real booleans
  would have silently stopped working the first time someone's
  permissions were hand-tuned away from a stock preset. A bare account
  with every boolean false (a genuinely minimal Employee) is left
  optional-but-encouraged -- reasonable for this business's real
  risk profile: a small owner-operator shop where the account that
  can't touch finances, Dev Tools, invoices, or roles has a much
  smaller blast radius if its password alone were compromised than the
  two accounts that currently exist (Steve/Owner, Connor/Developer),
  both of which DO trip this check today and are forced through
  enrollment on their next fresh sign-in.
- **The enrollment gate is self-service, not a hard lockout.** A
  mandatory-tier account with no factor enrolled is routed into the
  exact same enroll-then-verify flow `settings.html` offers
  optionally, right there on the login page, using the still-valid
  (never-persisted) password-verified session -- there is no scenario
  where this change could lock Steve or Connor out of their own
  accounts with no path back in, which would have been a real,
  unacceptable risk to take with two people's only access to running
  their actual business. Recovery codes are generated and shown
  immediately after that first verification succeeds.
- **Recovery codes are a custom table + `SECURITY DEFINER` functions
  (`sql/security/add_internal_mfa_recovery_codes.sql`), not Supabase's
  own native recovery-codes API.** That native API exists in the
  `@supabase/supabase-js` source (`client.auth.mfa.recoveryCodes.*`,
  confirmed while reading `GoTrueClient.ts` for the endpoint shapes
  above) but is gated behind an `experimental` client flag
  (`assertRecoveryCodesExperimentalEnabled`), and this repo has no
  live Supabase MCP/dashboard access to confirm the hosted GoTrue
  server on this specific project even has that endpoint deployed.
  Shipping a "lost your phone" recovery path that might silently 404
  in production would be worse than not shipping recovery at all, so
  this built a small, fully self-contained alternative instead: one
  table (`internal_mfa_recovery_codes`, RLS enabled with zero
  policies -- default-deny, table grants to `anon`/`authenticated`
  explicitly revoked too, matching the belt-and-suspenders pattern
  this log already documented was NEEDED for
  `resync_cron_service_role_key` on 2026-09-21) plus four
  `SECURITY DEFINER` functions that are the only way in or out
  (`generate_internal_recovery_codes`, keyed to `auth.uid()`, replaces
  the caller's whole set on regenerate; `verify_and_consume_internal_recovery_code`,
  one-time use via bcrypt/`pgcrypto` comparison; `count_unused_internal_recovery_codes`;
  `delete_internal_recovery_codes`, called when MFA is turned off so
  old codes can't outlive the factor they belonged to). Every function
  is keyed to the calling JWT's own `auth.uid()` -- none takes a
  caller-supplied user id, so broad `EXECUTE` grants to `authenticated`
  can't be used to touch another account's codes.
- **A real, honest transition-period gap, closed with a nag, not
  silence.** A `localStorage`-remembered session created BEFORE this
  shipped has no reason to re-authenticate for up to 30 days
  (`REMEMBER_DAYS` in `auth.js`) -- login.html's new gate only fires on
  a fresh sign-in. Rather than leave that as a silent hole until
  natural expiry, `workspace.html` now checks on every dashboard load
  whether the signed-in account requires MFA and has none enrolled,
  and shows a visible banner linking straight to Settings if so.
  Dismissal is `sessionStorage`-only (not `localStorage`) so it
  resurfaces on the next real visit rather than being silenced
  forever by one click -- deliberately more persistent than a typical
  dismissible banner, because the thing it's nagging about is a real
  security requirement, not a feature announcement.

**What was verified live, and what genuinely couldn't be:**

- Full Node test suite (`tests/tools/internal-mfa.test.js`, 30 new
  tests covering `auth.js`'s helpers, `requiresMfaForRole()` executed
  directly against real account shapes, `login.html`'s gate/challenge/
  recovery/cancel logic, `settings.html`'s enroll/disable/regenerate
  flow, the SQL's deny-all-by-default and one-time-use guarantees) --
  all passing alongside the full existing suite (2,681 tests; the 4
  pre-existing failures on baseline are unrelated to this change, all
  in a booking/design/tour area this session never touched -- verified
  by name against a pre-change run before starting, matching this
  project's own stated verification discipline).
- **Real headless Chromium via Playwright, served over local
  `python3 -m http.server` (never `file://`), with every Supabase
  network call mocked** (this environment cannot reach `*.supabase.co`
  at all -- the same fundamental limitation already documented for
  this project's real-time-sync work): enrollment with a real QR
  image rendered, correct-code login success, wrong-code rejection
  with no session ever persisted, a valid recovery code recovering a
  locked-out login, an invalid/reused recovery code rejected, and a
  non-enrolled optional-tier account still signing in exactly as
  before -- plus the settings.html self-serve enroll (QR shown,
  recovery codes shown exactly once), reload-persistence of the
  enrolled state, and confirmed disable, with a genuine UI-ordering
  bug (the just-shown recovery codes were being immediately re-hidden
  by a follow-up UI refresh call) actually caught and fixed by this
  same Playwright run rather than only reasoned about.
- **What this could NOT verify, and why:** the actual live TOTP
  verification against a real authenticator app and a real Supabase
  project -- this environment has no live Supabase access
  (confirmed the same way every prior session here has: no
  management-API/project-creation/live-query tool reaches
  `csvfqdjuobylgafgolho.supabase.co`'s Auth endpoints from this
  sandbox). Every REST endpoint shape used here was taken directly
  from the official `@supabase/supabase-js` SDK's own source rather
  than guessed, and the client portal's own MFA (built the same way,
  against the same live project, and independently confirmed working
  since 2026-09-16) uses the identical underlying Supabase Auth TOTP
  mechanism -- but this session cannot claim to have exercised the
  real GoTrue server itself, only a faithful mock of its documented
  behavior. **A human should do one real live enrollment/login on
  each of Connor's and Steve's actual accounts before relying on this
  as the only thing standing between a stolen password and full
  access** -- this is exactly the kind of thing this project's
  standing instructions ask to be flagged plainly rather than
  papered over.
- Also could not apply the new `sql/security/add_internal_mfa_recovery_codes.sql`
  migration to the live database -- no live Supabase MCP access in
  this session, same as every other SQL file in this repo's history
  that shipped as a file for the next session (or a human) with
  access to run. It needs to be applied before the recovery-code
  UI in Settings/login.html will actually work end-to-end; until
  then, TOTP enrollment/challenge itself works fine (that part is
  pure Supabase Auth, no new schema needed) but "Generate new codes"/
  the recovery-code login path will fail closed (a network/RPC error,
  never a false "valid") since the functions won't exist yet.

## 2026-09-22 (later the same day): "Could not generate recovery codes. Please try again." -- expired-token gap in the Settings-page MFA handlers

Diagnosed root cause, confirmed by reading the code before touching
anything (not re-derived from scratch): `getAuthToken()` in `tools/auth.js`
falls back to sending the Supabase **anon key** as the bearer token
whenever `hasValidSession()` returns false -- it does NOT refresh first.
`tools/settings.html`'s MFA/recovery-code handlers all called
`getAuthToken()` directly, with no `await ensureFreshToken()` first --
unlike `loadCurrentUserRole()` elsewhere in `auth.js`, which already does
this for the identical reason (see its own 2026-08-16 comment). Net
effect: if the stored access token had expired since Settings loaded
(normal after enough time on the page), every recovery-code RPC went out
authenticated as anon, `auth.uid()` resolved to null inside the
`SECURITY DEFINER` function, it raised "not authenticated", PostgREST
returned a non-ok response, and `generateRecoveryCodes()`'s generic
catch-all error message covered up what had actually gone wrong.

**Audited the whole MFA section, not just the obviously-named
handlers** -- found the same missing-refresh pattern in six places, not
two: `renderMfaSettingsCard()`, `handleStartMfaEnrollSettings()`,
`handleVerifyMfaEnrollSettings()`, `handleCancelMfaEnrollSettings()`
(which also had to become `async` -- it was a bare synchronous function
calling `getAuthToken()` directly), `handleDisableMfaSettings()`, and
`handleRegenerateRecoveryCodes()` (the one actually named in the bug
report). Fixed by adding `await ensureFreshToken();` before the first
`getAuthToken()` call in each.

**Separately fixed the error-swallowing itself**, since a generic
fallback message is what made this bug a dead end to diagnose in the
first place: `generateRecoveryCodes()` and `verifyRecoveryCode()` in
`auth.js` now surface `data.message || data.error_description || data.msg`
(PostgREST's RPC error shape is `{message, details, hint, code}`, a
different shape than the GoTrue/Auth-endpoint `{error_description, msg}`
shape `mfaUnenroll()` a few lines above already handles correctly --
both are now checked). `countRemainingRecoveryCodes()` doesn't surface a
message to the UI by design (its caller only ever shows a plain "Could
not check." on any failure), so instead of changing its return shape it
now logs the real detail via `logClientError()` on failure, so a genuine
problem there is diagnosable in Client Errors/the console next time
instead of a silent `null`. `deleteRecoveryCodes()` was left untouched --
it's deliberately best-effort per its own existing comment (called when
turning MFA off; never blocks that flow on its own success), so there's
no caller-visible message to fix.

**New test**, `tests/tools/mfa-recovery-token-refresh.test.js`: a static
check that all six Settings-page MFA handlers await `ensureFreshToken()`
before their first `getAuthToken()` call (and that
`handleCancelMfaEnrollSettings` is actually `async`), plus a runtime
check (via the same `vm.createContext` + extracted-function-body
technique this repo's `realtime-retry-resilience.test.js` already uses)
that `generateRecoveryCodes()`/`verifyRecoveryCode()` surface the real
PostgREST error message on a mocked failure response instead of only
ever the generic fallback, while still succeeding normally on a real
2xx response. One real snag while writing it: the extraction helper's
first version stripped a leading `async` off `async function
generateRecoveryCodes(...)`, since a bare `indexOf('function NAME(')`
lands right after it -- silently turning every `await` inside the
extracted body into a syntax error when run standalone. Fixed by
checking for and including a leading `async ` before the match.

**Verified live in headless Chromium** (Playwright, served over
`python3 -m http.server`, never `file://`, every Supabase call mocked --
this sandbox cannot reach `*.supabase.co`): a stored session shaped so
`hasValidSession()` returns false (an `expires_at` an hour in the past)
but with a real `refresh_token` present, with the refresh endpoint
mocked to succeed -- "Generate new codes" now correctly refreshes first
and succeeds, where before this fix it would have gone out as anon and
failed. Separately, mocked a genuine RPC failure (`401` with
`{message: 'not authenticated'}`) and confirmed the real error text now
surfaces in `#mfaSettingsMsg` instead of the old generic fallback.

## 2026-09-22 (same day, later still): the token-refresh fix above wasn't the actual bug -- pgcrypto lives in `extensions`, not `public`

The owner tested "Generate new codes" live right after the fix above
shipped (still on an unmerged branch, not yet deployed) and reported
the exact same error. Rather than assume it was just a not-yet-deployed
situation, checked directly against the live database first -- and
found a real, second, independent bug: simulating an authenticated call
to `generate_internal_recovery_codes()` (`set local role authenticated;
set local request.jwt.claims = '{"sub":"...")`) reproduced `ERROR:
function gen_random_bytes(integer) does not exist` immediately.

Both `generate_internal_recovery_codes()` and
`verify_and_consume_internal_recovery_code()` declare `set search_path
= public`. `create extension if not exists pgcrypto;` installs it into
the `extensions` schema on this project -- confirmed directly
(`select ... from pg_extension e join pg_namespace n ...`) --
Supabase's own standard convention, not `public`. A `SECURITY DEFINER`
function's `search_path` completely replaces the caller's own (the
entire point of setting one explicitly, to block a search-path-hijack
attack), so `extensions` was never reachable from inside either
function. This has been broken since the feature's original migration
was applied -- the token-refresh bug was real and worth fixing, but the
RPC was never actually going to succeed either way, since it would fail
on `gen_random_bytes` the moment a request DID reach the database
authenticated.

**Fixed live via the Supabase MCP tools** (with the owner's
authorization, same basis as the original migration's own live
application) and captured in
`sql/security/fix_internal_mfa_recovery_codes_search_path.sql` --
`set search_path = public, extensions` on both affected functions.
`count_unused_internal_recovery_codes()`/
`delete_internal_recovery_codes()` call no pgcrypto function and were
correctly left untouched -- confirmed by reading each function's body,
not assumed. Followed this project's own established convention (per
`resync_cron_service_role_key.sql`) of fixing a previously-applied
migration with a new file, not editing the original in place.

**Verified directly against the live database, both directions**:
reproduced the exact pre-fix error, then confirmed
`generate_internal_recovery_codes(3)` returns real codes post-fix and
`verify_and_consume_internal_recovery_code()` correctly accepts one of
them, then deleted the test rows (`delete from
internal_mfa_recovery_codes where user_id = ...`) so no stray live data
was left in the real table from this verification.

**New regression test** in `tests/tools/internal-mfa.test.js`: asserts
both functions' `search_path` in the fix file includes `extensions`,
that the exact original-bug shape (`search_path = public;` alone)
doesn't reappear, and that the two unaffected functions weren't
needlessly redefined.

**Lesson for next time a live-only report contradicts a just-shipped
fix**: don't assume "not deployed yet" explains it away -- check the
live system directly first. A code fix and a live-only bug can coexist
in the same feature, and this one did.

## 2026-09-23: Portal -- Face ID stands in for the 2FA code; the code could be skipped by refreshing (fixed)

**The ask.** "Facial recognition AND two factor is way too much. Make it
pick facial over two factor for the portal, also make two factor
optional." Two-factor was already opt-in (Settings only; nothing forces
enrollment). What was "too much" was the sequence for a client with
both on: password, then the TOTP code, then the Face ID lock as soon as
home.html loaded.

**What Face ID is here** (unchanged, see portal-app.js's biometric
header). It's a local-only WebAuthn platform-authenticator check in front
of an existing session; nothing is verified server-side. Letting it stand
in for the code therefore means a Face-ID-approved session stays at
Supabase aal1 (password only) from the server's point of view.

**Why that's acceptable, and what it does and doesn't weaken:**
- No portal RLS policy, RPC or edge function has ever checked `aal`
  (grepped `portal/`, `sql/`, `edge-functions/`: no `aal2` anywhere
  outside login.html). The server-side posture is identical before and
  after.
- On a device without this account's Face ID credential (the realistic
  stolen-password case), the TOTP code is still required.
- Face ID itself needs the real platform authenticator with user
  verification. A copied localStorage key doesn't pass
  `navigator.credentials.get`.

**The real finding: the code could be skipped by refreshing.**
- `signInWithPassword` persists an aal1 session before the code overlay
  appears. login.html's on-load `getSession()` then redirected any
  session straight to home.html, and no portal page checked `aal`.
- So after a correct password, one refresh (or opening
  /portal/home.html directly) went straight in with no code.
- Reproduced on main in a real browser: after the password, a reload
  landed on home.html with 0 codes verified.
- Impact: 2FA gave no protection against someone who knew the password,
  even without API skills.
- **Fixed:** `portalRequireSecondStep()` runs before every signed-in page
  renders (via `portalGuardWithBiometricLock`, and directly in Settings).
  An aal1 session on an account with a verified factor must pass Face ID
  on a Face ID device, or goes to `login.html?step=code`. login.html's
  on-load check now stays for the code instead of redirecting.
  Settings is included, so it isn't a way around the step.

**Still open, not fixed here (needs the owner's decision).** All of this
is enforced in the browser. Someone with the password who calls the REST
API directly with the aal1 token still gets whatever RLS allows. Real
enforcement would be two changes:
1. RLS on client-data tables requiring `(auth.jwt()->>'aal') = 'aal2'`
   whenever the user has a verified factor.
2. That only works together with Face ID becoming a server-verified
   factor (Supabase WebAuthn MFA or passkeys); otherwise every Face ID
   sign-in would be locked out.

Both are schema/auth-config changes. They're left for Connor rather
than done quietly.

**Supabase detail worth remembering.** Unenrolling a verified factor
requires an aal2 session. A Face-ID-approved session is aal1, so Settings
now asks for one code before "Turn off two-factor" (it would otherwise
fail with insufficient_aal).

Tests: `tests/portal/face-id-over-2fa.test.js`, plus an end-to-end
browser run with a CDP virtual authenticator and mocked Supabase auth
(scenarios in README's entry).

## 2026-09-23: Cross-stack audit, round 3 -- open signup turned "authenticated" into "anyone"

A fresh full pass across auth, RLS, storage, edge functions, Stripe,
MFA, and secrets, run against the **live** project (`get_advisors`,
`pg_policies`, `get_edge_function`, `function_edge_logs`, and probes
inside rolled-back transactions using simulated JWTs), not only the
repo. The two earlier rounds (2026-09-16/17/21, above) are not
re-reported here.

### The root cause behind most of this round

**Public signup is enabled.** The live `/auth/v1/settings` (read from
inside the database with `net.http_get`, since this sandbox can't reach
`*.supabase.co`) returns `disable_signup: false`,
`mailer_autoconfirm: false`. Anyone with a working mailbox can create an
account, confirm it, and hold a real `authenticated` JWT. Nothing in the
repo calls `signUp`; portal clients are created by `send-invite` with
the service role. Several policies and edge functions were written when
"authenticated" meant "Connor or Steve" (SECURITY.md said so in as many
words). It stopped meaning that when portal accounts shipped, and with
open signup it means *anyone*.

**Needs a human, dashboard only:** Authentication -> Sign In / Providers
-> turn off "Allow new users to sign up". Invites keep working.

### Findings, by severity

Status as of the first pass. Current status is in the follow-up entry below ("round 3 follow-up").

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | CRITICAL | Any authenticated session (so, any stranger) could edit `site_content`/`site_faq`/`site_terms`, read the CMS history tables, and read/upload/delete every file in `secure-documents` (business-formation, insurance, tax) and `receipts` | **Fixed live + PR #361 (merged)** |
| 2 | HIGH | 8 trigger/cron-only edge functions had no caller check; the public anon key could drive them. Worst: `notify-job-message-email` / `notify-work-order-message-email` email a real client (looked up by sequential id) branded text of the caller's choosing -- a phishing relay on Triple H's own domain | **PR #363**. `notify-job-message-email` deployed + verified live. Other 7 **pending deploy approval** |
| 3 | HIGH | Deployed `Send-Push` (v50) has no auth check -- the 2026-09-17 repo fix (`00338ad1`) was merged but never deployed. Anyone can push arbitrary title/body **and URL** to staff devices or to any client `user_id`, and both service workers `openWindow()` any URL on tap | Repo fix exists; **pending deploy approval**. SW same-origin guard: not started |
| 4 | HIGH | Internal MFA is enforced only by `login.html`. A password-only (`aal1`) token -- which anyone with the password gets by calling `/auth/v1/token` directly -- passes every RLS policy and every edge-function internal check. Proven live for the enrolled Developer account | **Design proposed, owner decision needed** |
| 5 | MEDIUM | Double charge: each "Pay" mints a new PaymentIntent and overwrites the stored id; paying two tabs charges twice, the second webhook returns `already_processed`, and `reconcile-stripe-payments` skips paid invoices, so nothing ever flags it | Written up, not fixed |
| 6 | MEDIUM | `manage-saved-card` `create_setup_intent` needs only a signed-in session: with open signup, strangers can mint Stripe Customers + SetupIntents on the client-cards account (card-testing risk) | Closing signup removes the stranger path; not fixed |
| 7 | LOW-MED | `stripe-webhook` marks invoices paid without comparing `pi.amount_received` to their totals; a stale smaller PaymentIntent can settle a raised invoice | Written up, not fixed |
| 8 | MEDIUM | `send-booking-email` (and LOW: `send-appointment-reminder`) lack the same caller check as #2 | **Deferred: booking lane**, see below |
| 9 | LOW | `role_definitions` and `th_uptime_checks` SELECT `true` for any authenticated; `work-order-photos` INSERT on `bucket_id` alone (no read-back, no overwrite -- upload spam only); the 4 MFA recovery-code RPCs are anon-EXECUTE-able (harmless -- all key on `auth.uid()`) | Not fixed; hygiene migration drafted in this entry's "next steps" |

### 1. CRITICAL -- CMS writes and private buckets open to any session (fixed)

Reproduced live before touching anything: a simulated stranger JWT (no
`account_roles` row, no client rows) and an invited portal client's JWT
could both see all 6 `secure-documents` objects and both receipts,
insert into both buckets, and UPDATE/INSERT every CMS row; properly
scoped tables (`th_leads`, `invoices`, `workspace_sync`, `job-photos`,
`invoice-pdfs`) returned 0. Every real caller is an internal `/tools/`
page; the portal and edge functions never touch these tables/buckets.

Fix (`sql/security/restrict_site_content_and_private_buckets_to_internal_accounts.sql`,
applied live after a full dry run): CMS writes need
`account_roles.can_manage_site_content` (the exact column
`canManageSiteContent()` reads, so the UI and DB agree); history reads
and both buckets need `current_user_has_any_role()`. Re-probed after
applying: stranger/client 0 rows and denied; Steve and Connor full
access; anon public reads unchanged (13/15/16 rows); zero open policies
left; advisor clean. The public pages render CMS values with
`textContent`/escaping, so this was defacement + lead hijacking
(swapping the site-wide phone number) + document exposure, not XSS.

### 2. HIGH -- trigger-only edge functions callable with the anon key

Same class as uptime-alert/send-payment-reminder/send-quote-followup
(fixed in earlier rounds), missed for these 8:
`notify-job-message-email`, `notify-work-order-message-email`,
`notify-work-order-scheduled-email`, `notify-new-work-order-email`,
`send-lead-email`, `send-job-application-email`,
`send-job-status-change-email`, `reconcile-stripe-payments`.

Before adding a strict `token !== SERVICE_ROLE_KEY` check, verified it
can't break the real callers (the thing that bit this project on
2026-09-16): every live trigger body and `cron.job` command sends the
Vault secret `send_push_service_role_key`, and the two functions that
already enforce this exact check returned **200** on their real cron
runs on 2026-09-22. So the Vault secret matches, and **ACTION-ITEMS
#7-9 are resolved**. Open PR #362's new cancel path inserts a message
row with the service role, and the trigger forwards it with the Vault
key, so it passes too.

PR #363's test runs each real handler (types stripped, `Deno`/`fetch`
mocked): anon key -> 401 with zero outbound calls; service key ->
reaches the function's own logic. Against the unpatched code, all 32
security assertions fail.

**Deploy state.** No workflow deploys edge functions, so a merge alone
closes nothing live. Reproduced live first with a harmless probe
(anon key + `{"type":"AUDIT_PROBE"}` -> `400 Unknown type`, meaning the key
got past the auth layer; nothing is sent). Deployed
`notify-job-message-email` v3 after confirming the live source
matched `main`, then re-probed: anon -> **401**, Vault key -> 400
(past the check). The session's permission policy then blocked further
production deploys, so the other 7 wait for the owner's go-ahead.

### 3. HIGH -- Send-Push still live without auth

`get_edge_function` on `Send-Push` v50 (deployed 2026-09-16 22:45 UTC)
has no caller check; the repo fix landed at 2026-09-17 02:29 UTC and
was never deployed. The anon-key probe returns `400 Unknown type`
(accepted). Impact is higher than the 2026-09-17 entry assumed because
`client-notification` takes a caller-supplied `url`, and both
`service-worker.js` and `portal/service-worker.js` pass it straight to
`clients.openWindow()`: a branded Triple H push that opens any site.
Fix: deploy `main`'s `send-push-index.ts`; separately, restrict
`notificationclick` to same-origin paths in both service workers
(defense in depth; wasn't started while #362 had `portal/service-worker.js`
open).

### 4. HIGH -- internal MFA is a login-page gate, not a server gate

`tools/auth.js`'s `skipPersist` comment says it makes MFA "a real gate
rather than a UI-only speed bump." That's true only for someone using
the login page. Zero of the 102 live policies check `aal`, and no edge
function does. Proven: a simulated `aal1` JWT for the MFA-enrolled
Developer account reads invoices, jobs, the whole `workspace_sync`
blob, leads, `stripe_customers`, the secure documents, and
`account_roles` (which that account can also edit). The portal session
reached the same conclusion for client accounts independently (its
2026-09-23 "Face ID stands in for the 2FA code" entry in this log); for
internal accounts the blast radius is everything.

Proposed fix, **not applied, needs the owner** (real lockout risk for
the only two people who run the business):
1. `current_user_has_any_role()` also requires `aal2` whenever the caller
   has a verified factor. Because `account_roles`' own SELECT policy uses
   that function, every inline `EXISTS (select 1 from account_roles ...)`
   policy and `current_user_can_manage_roles()` go dark for an `aal1`
   session too -- one change, all internal RLS. Portal-client policies
   are unaffected (so Face ID sign-ins aren't locked out).
2. The 15 internal-gated edge functions (`callerIsInternalAccount()`
   reads `account_roles` with the service role, bypassing RLS) need the
   same `aal` check, and each needs a deploy.
3. Recovery-code sign-in currently leaves an `aal1` session; with (1)
   that session would see nothing. Consuming a recovery code must also
   delete the lost factor server-side (a small service-role edge
   function), after which `login.html`'s mandatory-enrollment gate takes
   over.
4. Existing remembered `aal1` sessions for an enrolled account lose
   internal access at rollout and must sign in again with the code.

### 5-7. Stripe money-correctness (not attacker-for-profit, but real)

- **Double charge (#5):** `create-payment-intent` should reuse the
  stored PaymentIntent while it's still `requires_payment_method` and
  the amount matches, instead of minting a new one; the webhook should
  alert (not silently 200) when a succeeded PaymentIntent lands on an
  already-paid invoice; `reconcile-stripe-payments` line 195 should
  report that case instead of `continue`.
- **Underpayment (#7):** the webhook should compare
  `pi.amount_received` against the sum of the unpaid rows' totals (in
  cents) and alert instead of marking paid on a mismatch.
- **SetupIntents (#6):** require a real portal relationship (an
  invoice, quote, or job on the caller's email) before minting one.
All three need deploys of the live payment path and deserve their own
careful PR with Stripe test-mode verification; not rushed into this
round.

### Deferred because another lane owns it

`send-booking-email` and `send-appointment-reminder` are booking-lane
functions. `send-booking-email` also carries an undeployed 2026-09-19
change of the booking session's in the repo, so redeploying it would
ship their work too. Patch for whoever owns it: the same guarded check
PR #363 adds, placed first in `Deno.serve`. For `send-booking-email`
this is defense in depth only -- the same confirmation email is
reachable through the anonymous INSERT on `th_bookings` anyway, so real
relief there needs form rate limiting.

**Second-pass review of open PR #366's new `create_booking(jsonb)`**
(SECURITY DEFINER, anon-executable, booking lane), per this file's
"RLS/grant changes get a second pass" rule: **sound.** `search_path` is
pinned; only allowlisted columns are read from the payload, so
`status`, `cancel_token`, `quote_id`/`checkup_id`/`job_id` and the
reminder/reschedule fields can't be set; it returns only the caller's
own new row's id and token; validation is stricter than the direct
insert (end after start, 8-hour cap, no past starts, required name,
length caps). The advisor will list it under lints 0028/0029 --
expected, same class as the other booking token functions. The weaker
path is the pre-existing one it deliberately leaves open: the direct
INSERT policy "Anyone can submit a booking" (`with check (true)`)
still accepts any column values, e.g. an arbitrarily long booking that
blocks the calendar through the exclusion constraint. LOW; for the
booking lane to tighten once `create_booking` is the only path the page
uses (a `with check` mirroring the function's rules, or dropping the
direct-insert fallback).

### Looked suspicious, checked, fine (don't re-investigate)

- **Advisor's 11 anon / 15 authenticated SECURITY DEFINER findings:** the
  booking/job token RPCs are keyed on unguessable UUID tokens and return
  only what that token's holder should see; `get_my_portal_visits` keys on
  the caller's *confirmed* auth email, so open signup can't claim someone
  else's bookings; `next_*_number` self-check internal; the recovery-code
  RPCs key on `auth.uid()` (null for anon). Codes are 32 random bits,
  bcrypt-hashed, one-time.
- **No table in `public` has RLS off**; no views or materialized views.
- **Secrets:** the whole tree and full git history (after unshallowing)
  contain only `anon` JWTs; every `sk_live_` hit is a
  documentation placeholder. Nothing to rotate.
- **Every edge function except `stripe-webhook` runs with
  `verify_jwt: true`** (confirmed via `list_edge_functions`), which is what
  makes the functions' `decodeJwtPayload()` (no signature check of its
  own) safe. Keep it that way: deploying any of them with
  `--no-verify-jwt` would let a forged token pass every internal gate.
- **The orphaned lowercase `send-push` function is gone** from the live
  project (ACTION-ITEMS #10 resolved).
- **Public CMS rendering** (FAQ, Terms, banners, phone/email) escapes
  everything; the JSON-LD rebuild uses `textContent`.

### Lessons for the next round

1. **"authenticated" is not a trust level on this project.** Grep new
   policies for `using (true)` / `with check (true)` / bucket-only
   checks, and new edge functions for "any signed-in session is
   enough".
2. **The repo is not what's running.** Three separate fixes (uptime-alert
   on 2026-09-15, Send-Push on 2026-09-17, and this round's) were
   merged but not deployed, because nothing deploys edge functions. A
   cheap deploy-drift check (compare `get_edge_function` output
   against `main` for every slug) would have caught Send-Push a week
   ago. Worth building.
3. **Prove the caller path before tightening.** The Vault-key check
   (a strict check that has 200s on real cron runs) is what made
   finding #2 safe to fix in one pass.

## 2026-09-23 (booking lane): push broadcasts scoped to staff, client-push lookup fixed, booking functions require the service role

Cross-logged from `features.md` (round 2 of the booking-flow pass). It closes the 2026-09-23 audit's **#8** (`send-booking-email` / `send-appointment-reminder` caller check) and ships the already-merged **#3** fix (Send-Push caller check) together with the change that needed Send-Push redeployed anyway.

- **Internal broadcasts reached every subscriber.**
  - Send-Push's `sendToAllSubscriptions` read all of `push_subscriptions`, the same table portal clients write to. It now uses `get_internal_push_subscriptions()`, which matches subscriptions to `account_roles` by account email, and it fails closed.
  - Latent: all 6 live rows belong to the 2 internal accounts. It would have leaked lead and booking names, client names on overdue invoices and the revenue digest to the first client who enabled push.
- **Client pushes could reach the wrong person.**
  - Six functions used `GET /auth/v1/admin/users?email=`, which GoTrue ignores. The first page of all users came back, and `users[0]` (the newest account) received another client's invoice, quote or message notification.
  - They now use `get_auth_user_id_by_email()`: exact, case-insensitive, null when absent.
- **Both lookup functions are SECURITY DEFINER** (they read `auth.users`), `search_path=public`, and EXECUTE-able by service_role only (revoked from public, anon and authenticated). They were verified live in rolled-back transactions: anon and authenticated get permission denied; service_role gets the 6 internal subscriptions and exact/case-insensitive matches.
- **`send-booking-email` and `send-appointment-reminder`** check `!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY` before `req.json()`. Send-Push's existing check gained the same empty-key guard.
- **Pre-deploy check:** every live Send-Push caller authenticates with the service role (4 trigger functions and 2 cron jobs via the Vault `send_push_service_role_key`, edge functions via `SUPABASE_SERVICE_ROLE_KEY`). Nothing in any page's JavaScript calls it.

## 2026-09-23 -- note from the visual lane: `frame-ancestors` in a `<meta>` CSP does nothing

Seen during the public-site visual audit. Not fixed there, since it's this lane's call.

- Every public page's CSP `<meta>` ends with `frame-ancestors 'none'`. Browsers ignore that directive when it arrives in a `<meta>` tag rather than a response header (CSP3 spec), and Chromium logs "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element" on every page load.
- `SECURITY.md` ("Content-Security-Policy, on the public site") says the site "can [not] be embedded" because of it. GitHub Pages can't send response headers, and there's no `X-Frame-Options` either, so as far as I can tell the public pages *can* currently be framed.
- Options for this lane: accept and correct the doc, or add a frame check (e.g. `if (top !== self)`) where clickjacking would matter (booking, the lead forms).

## 2026-09-23 (security lane, later): round 3 follow-up -- every merged fix is live, push privacy certified, four more fixed

Follow-up to "Cross-stack audit, round 3" above. That entry's table is
the first pass; this is where each finding stands now.

| # | Sev | Finding | Status now |
|---|---|---|---|
| 1 | CRITICAL | CMS + `secure-documents`/`receipts` open to any session | Fixed live (PR #361) |
| 2 | HIGH | 8 trigger/cron-only functions took the anon key | **All 8 deployed from `main` and verified live** (below) |
| 3 | HIGH | `Send-Push` had no caller check; any URL opened on tap | **Live** (v52 from this lane, v53 from the booking lane, same code). Service-worker same-origin guard merged (PR #381) |
| -- | HIGH | Push privacy: team alerts reached any device with a subscription | **Certified and fixed live**, see "Push notifications" below |
| 4 | HIGH | MFA enforced in the browser only | **Still needs an owner decision.** One more piece found, below |
| 5 | MEDIUM | Double charge on one invoice | **Fixed (PR #386), deployed and verified**: `create-payment-intent` v17, `create-bulk-payment-intent` v15, `reconcile-stripe-payments` v9 |
| 6 | MEDIUM | `manage-saved-card` SetupIntents for any signed-in session | Open. Needs a product call, below |
| 7 | LOW | Webhook doesn't compare `amount_received` to the invoice total | Narrowed by #386. Open, LOW |
| 8 | MEDIUM | `send-booking-email` / `send-appointment-reminder` caller check | Fixed and deployed by the booking lane (#369, #383) |
| 9 | LOW | `role_definitions` / `th_uptime_checks` readable by anyone signed in; anon EXECUTE on recovery-code RPCs | **Fixed live + PR #384.** `work-order-photos` INSERT on `bucket_id` alone is still open (upload spam only) |

### Deploys, and how each was checked

Nothing in this repo deploys edge functions on merge. Each function
below was deployed from `main` exactly as merged, with `verify_jwt` on
as before. Each was then called twice from inside the database
(`net.http_post`) with a harmless `{"type":"AUDIT_PROBE"}` body:

- **With the public anon key:** must return 401.
- **With the Vault key the real triggers send:** must return
  `400 Unknown type`. That means it got past the new check and then
  stopped before sending anything.

| Function | Live | anon | Vault key |
|---|---|---|---|
| `notify-work-order-message-email` | v14/v15 | 401 | 400 |
| `notify-work-order-scheduled-email` | v11/v12 | 401 | 400 |
| `notify-job-message-email` | v5 | 401 | 400 |
| `notify-new-work-order-email` | v10 | 401 | 400 |
| `send-lead-email` | v23 | 401 | 400 |
| `send-job-application-email` | v3 | 401 | 400 |
| `send-job-status-change-email` | v4 | 401 | 400 |
| `reconcile-stripe-payments` | v7, then v9 with #386 | 401 | 200 `{"ok":true,"checked":0,…}` (one real run, on v9) |

- **Reproduced first.** Before the four still-unfixed trigger functions
  were replaced, the anon key reached their payload check (400, not 401)
  on the live versions.
- **Why reconcile got a real run instead of a probe.** It has no payload
  to reject, so the Vault-key call runs a real reconciliation. That's
  read-only, and its alerts are de-duplicated, so it was run once after
  #386 deployed.
- **Only verified main code was deployed.** Before each deploy, `git log`
  confirmed `main` differed from the live copy only by #363 (or #369).
  The booking lane was deploying the same `main` code at the same time;
  every version either of us left live was re-fetched and matches
  `main`.
- **No real caller was rejected.** After the deploys, the only 401s in
  `net._http_response` were the probes: this lane's, plus one pair from
  the booking lane on `send-booking-email`. The hourly and half-hourly
  crons kept returning 200.

### Push notifications -- certified

Asked directly: "right now all push notification go to all clients
including ones we would want only internal, certify that and if so fix."

- **The code bug was real.** `Send-Push`'s team broadcast
  (`sendToAllSubscriptions`) read every `push_subscriptions` row. A
  client who turned on portal push would have got every internal alert:
  lead details, uptime, reconciliation messages with client emails and
  amounts.
- **No client had received one yet.** At the time all 6 live
  subscriptions belonged to internal accounts.
- **Fixed live.** The broadcast now reads
  `get_internal_push_subscriptions()`, which joins to `account_roles`,
  is service-role only and fails closed.
  - The read-only `audience-check` type returns `{"internal":6,"total":6}`.
  - A rolled-back probe added a client-owned subscription and one with
    no user. Neither was counted, and the audience stayed at 6.
- **A second bug, also fixed live.** Client pushes looked up the user id
  with GoTrue's admin list endpoint and a nonexistent `email` filter. That
  endpoint ignores the filter, so `users[0]` was simply the newest
  account, and a client's push could land on someone else's phone.
  - All six client-push functions now use `get_auth_user_id_by_email()`,
    an exact, case-insensitive, service-role-only match.
  - Each live copy was re-fetched to confirm it:
    `notify-work-order-message-email`, `notify-work-order-scheduled-email`,
    `notify-job-message-email`, `send-invoice-notification`,
    `send-quote-notification`, `send-contract-notification`.
- **Service workers.** Both now only open same-origin pages on a
  notification tap (PR #381). Browsers pick up the change on their next
  service-worker update check.

### Fixed in this pass

- **Service workers (PR #381).** `safeNotificationUrl()` resolves the
  payload URL against the worker's origin and falls back to the default
  page for anything else: another host, `//host`, an http downgrade,
  `javascript:`, `data:`. The test runs each real worker file in a
  sandbox: 16 of 23 cases fail on the old handlers. Every sender in the
  repo uses a same-origin path, which one test also pins.
- **DB hygiene (PR #384, applied live).**
  - `role_definitions` and `th_uptime_checks` reads now need
    `current_user_has_any_role()`: a stranger sees 0 of 3 and 0 of 227
    rows, and Steve and Connor still see all of them.
  - Anon lost its auto-granted EXECUTE on the four recovery-code RPCs;
    authenticated keeps it.
  - The only browser readers are three `dev-tools.html` fetches, and all
    send the session token.
- **Double charge (PR #386).**
  - `create-payment-intent` and `create-bulk-payment-intent` now look up
    the PaymentIntent the invoice(s) already point at, expanding
    `latest_charge`.
  - Succeeded, processing or requires_capture, and not fully refunded
    → 409 "…refresh this page before paying again".
  - Still open for the same amount, currency, customer and invoice set
    → the same `client_secret` is handed back.
  - Any lookup failure → a new PaymentIntent, as before, so the guard
    can't block a real payment.
  - `reconcile-stripe-payments` alerts once per set ("Possible double
    charge") on any invoice with two or more succeeded PaymentIntents.
  - The easiest double charge was not two tabs. `portal/dashboard.html`
    re-renders 1.8s after a successful payment, so "Pay now" is still
    showing until the webhook lands.
  - 38 tests run the real handlers against a routed fake Stripe and
    Supabase: 14 fail on the old code, and every legitimate path passes
    both before and after.
  - Deployed from `main` after merge. Each live copy was checked against
    `main` first, to be sure it held nothing newer.
  - Both create functions answer the anon key with 401 "Must be signed
    in."
  - reconcile's real run returned 200: no invoice payments in the
    lookback window, so nothing to flag.
  - The guard's own paths (409, reuse) can only be exercised with a real
    client session, so they rest on the tests, and on the fallback that
    leaves any Stripe lookup failure behaving exactly as before.

### Still open

- **#4, MFA (HIGH), owner decision.** One more piece:
  `generate_internal_recovery_codes()` works on a password-only
  (`aal1`) session. Someone holding a stolen password can therefore
  delete the account's codes and mint fresh ones, then use
  `verify_and_consume_internal_recovery_code()` on the login page's
  recovery path. The server-side fix should require `aal2` for
  generating codes whenever the account already has a verified factor.
  Recovery itself (aal1 plus a valid code) has to stay possible, or a
  lost phone locks the owner out.
- **#6, SetupIntents (MEDIUM).**
  - Turning signup off (ACTION-ITEMS #11) removes the stranger path
    entirely.
  - A server-side "must be a real portal client" gate needs a decision
    on what counts. `client_account_codes` is empty for all 3 current
    non-internal accounts, so it can't be the marker. A "has an invoice,
    quote, job, contract or checkup" check would stop a client who only
    has a self-submitted work order from adding a card in Settings.
- **#7, webhook amount (LOW).** #386 only reuses a PaymentIntent whose
  amount matches the current total, so a raised invoice gets a fresh,
  correct one. The old, smaller one stays payable from a stale tab, and
  if it's paid the webhook still settles the invoice short. Either
  cancel the superseded PaymentIntent in create-payment-intent, or
  compare `amount_received` in the webhook and alert.
- **`work-order-photos` INSERT (LOW).** Checks `bucket_id` alone.
  Upload spam only: there's no read-back and no overwrite.

### Lessons

- **Check what's live before deploying.** Two lanes deploying the same
  functions at once is harmless only if both deploy `main`. Re-fetching
  after deploy, and before trusting a version bump, is what showed it.
- **A version bump doesn't mean the code changed.** Several functions
  gained versions with the same entrypoint bundle.
- **Refunds don't change a PaymentIntent's status**, so any guard or
  alert keyed on `succeeded` has to look at the charge.

## 2026-09-23 (booking lane): round 2 deployed; the new trigger function gets the same EXECUTE lockdown

Cross-logged from `features.md` ("booking-flow round 2 is live"). What that means for security:

- **Deployed and verified:**
  - Send-Push, the six client-push lookups, `send-booking-email` and `send-appointment-reminder` are live.
  - Each was diffed against `main` after deploy.
  - Every function with a service-role check answers the public anon key with 401 and lets the Vault key through. Audit items #3 and #8 are closed live, not just in `main`.
- **`notify_booking_change_email()` is postgres/service_role only,** like every other trigger function in `public` since `revoke_public_execute_on_internal_only_functions` (2026-09-21).
  - The migration as first written left it EXECUTE-able by anon/authenticated, the schema's default privileges. That was based on an old note that a revoke once broke lead notifications.
  - Postgres only checks EXECUTE on a trigger function at CREATE TRIGGER, never when it fires. So the lockdown can't stop a trigger. Proven live in a rolled-back block: a trigger whose function had EXECUTE revoked still fired for an insert running as `authenticated`.
  - Trigger functions can't be called over the API anyway, so the default grant wasn't exploitable. Revoking it keeps the convention uniform, and keeps the next audit from having to reason about it.
- **Advisors after deploy:** no new finding. The remaining anon/authenticated SECURITY DEFINER warnings are pre-existing:
  - the booking RPCs (`create_booking`, `get_booking_availability`, and the token-gated get/cancel/reschedule), which are public on purpose;
  - the MFA recovery-code functions, which are this lane's.

## 2026-09-23 (booking lane): th_bookings no longer accepts direct inserts from the public

Cross-logged from `features.md` ("booking-flow follow-ups"). It closes the round 2 audit's LOW note on `with check (true)`.

- **Dropped.** "Anyone can submit a booking" (anon + authenticated, `with check (true)`). A direct insert with the public anon key could set any column (`status`, `job_id`, `quote_id`, `checkup_id`, `reminder_sent_at`) and skipped `create_booking()`'s validation. Since public signup is on, "authenticated" included strangers too.
- **Added.** "Staff can add bookings directly": authenticated, with an `account_roles` email, the same test as the table's SELECT/UPDATE/DELETE policies. It exists for the Dev Tools booking test. The public books through `create_booking()` (SECURITY DEFINER, allowlisted columns, validated times).
- **Verified live,** before and after, in rolled-back blocks:
  - anon and non-staff direct inserts → 42501;
  - the RPC works for both;
  - staff and the service role can still insert.
  - A real anon HTTP insert → 401 RLS violation.
  - No rows were created.
- **Advisors:** nothing new.

## 2026-09-25 (from the reports lane, not fixed): what `.nojekyll` also publishes

`.nojekyll` is deliberate (so `.well-known/security.txt` is served), but it
means GitHub Pages serves every repo file: `/docs/`, `/sql/`, `/backups/`,
`/tests/`, `/scripts/`, `/edge-functions/`, `README.md`, and `/.claude/`.
robots.txt disallows only `/.claude/` (and the 5 AI answer-bot groups don't
inherit even that). Nothing links to these paths. Whether this matters depends
on the repo's own visibility. Security lane's call.

## 2026-09-25: server-side two-factor enforcement for internal accounts (ACTION-ITEMS #13, audit round 3 finding #4)

The owner gave the go-ahead for #13 with three conditions: a dry run
first, both real accounts tested before and after enforcement, and a fast
way back in. This entry records what was built, the calls that differ from
the round-3 proposal, and what is still waiting on people.

### What the live data said before anything was built

- **Connor (Developer):** one verified TOTP factor (enrolled 2026-09-22),
  5 live sessions, **all aal2**, 10 unused recovery codes. Enforcement
  would not have blocked a single real session of his.
- **Steve (Owner):** **no factor at all.** One remembered aal1 session from
  2026-09-03, refreshed today. So "opt-in, then enforced" changes nothing
  for Steve, including protection. His password alone still opens
  everything until he enrolls. That is the biggest residual risk in the
  system now. It is logged as ACTION-ITEMS #18 and was not buried in this
  entry.
- **One chokepoint really does cover RLS.** `account_roles`' only SELECT
  policy is `(select current_user_has_any_role())`. Every inline
  `exists (select 1 from account_roles ...)` policy, the CMS publish
  functions (SECURITY INVOKER), and `current_user_can_manage_roles()`
  (INVOKER) read through it. The only SECURITY DEFINER functions reading
  account_roles directly are the gate itself, a service-role-only
  function, and a trigger. `next_*_number()` call the gate. This was
  checked across all 104 live policies (88 public, 14 storage) and every SECURITY DEFINER function
  EXECUTE-able by `authenticated`.
- **15 internal edge functions**, all the same shape: `claims.role`/`email`,
  then an account_roles lookup with the service role, which bypasses RLS.

### Design, and why

- **One rule, `internal_mfa_session_ok(user, aal)`:** aal2, or the account
  has no verified factor. It is called from `current_user_has_any_role()`
  (RLS), `check_internal_mfa_for_edge_function()` (service-role only; the
  edge functions pass their gateway-verified claims) and
  `internal_mfa_session_status()` (the tools pages).
- **A single-row switch, `internal_mfa_enforcement.mode`:** `log` / `enforce`
  / `off`. A missing row reads as `enforce`, so deleting it can't quietly
  disable protection. The break-glass is one UPDATE from the dashboard SQL
  editor, which uses a separate login that this change can't lock.
- **Dry-run logging had to be split.** RLS runs inside PostgREST's
  read-only GET transactions, where nothing can be inserted. Making the
  gate VOLATILE to insert would also have changed planning for every
  policy. So the RLS path uses `RAISE WARNING`; `log_min_messages` is
  `warning` on this project, and it was confirmed that the warnings land
  in `postgres_logs`. Edge functions, pages and recovery write rows to
  `internal_mfa_gate_log`, de-duplicated per session/source/outcome per
  10 minutes. In `log` mode the edge check also records `allowed`, so the
  dry run positively shows the check ran on real traffic rather than
  proving it only by absence.

### Two calls that differ from the round-3 proposal

1. **Recovery is a SQL function, not a service-role edge function.**
   `redeem_internal_recovery_code()` consumes the code, deletes the
   account's `auth.mfa_factors`, deletes its other unused codes, and
   deletes every other `auth.sessions` row, all in one transaction. So a
   code is never spent without the account being let back in, or the
   other way round, and there is no extra function to deploy or drift.
   `postgres` has DELETE on both auth tables (checked). Challenges and
   refresh tokens cascade. Signing other devices out is new relative to
   the proposal: a lost phone is exactly the device most likely to still
   hold a remembered aal2 session.
   - The old RPC name now delegates to it, so a cached old login page
     can't burn a code and leave a session the server refuses.
   - It refuses non-internal accounts. Otherwise a portal client's password
     plus a code could strip their portal authenticator.
2. **Minting recovery codes requires aal2 in every mode, not dry-run
   first.** With redemption now able to remove a factor, "mint codes on
   a password-only session, then redeem one" would have been a
   persistence path for a password thief during the dry run: a new hole
   this change itself would have created.
   - It cannot lock anyone out. Sign-in, the authenticator and existing
     codes are untouched.
   - Every real caller already qualifies: login.html generates with its
     verify's aal2 session, settings.html stores the aal2 session before
     generating, and "Generate new codes" only shows with a factor.
   - Deleting codes on a password-only session with a live factor is
     refused for the same reason. Settings' turn-off path still works,
     because it deletes after the unenroll.

### Browser side

- **login.html's recovery branch:** redeem, then re-check the factor.
  - If it's gone and the permissions require MFA, show the existing
    mandatory-enrollment step, reworded "Set up a new authenticator".
  - If the factor is still there (the rollback's consume-only world),
    carry on as before, with no doomed second enroll that GoTrue would
    refuse at aal1.
- **auth.js `requireAuth()`** fires `checkInternalMfaSession()` without
  awaiting it. An aal2 token costs nothing. Otherwise one RPC runs, and
  only a server-confirmed `blocked` clears the session and sends it to
  `login.html?reason=mfa`. Any failure leaves the page alone.
- **`redeemRecoveryCode()` replaces `verifyRecoveryCode()`.** It falls back
  to the old RPC name only on a 404, so deploy order can't break the one
  way back in.

### Verified

- **PGlite** runs the real migration files over the live policy text and
  both accounts' real shapes (`tests/security/internal-mfa-enforcement-db.test.js`,
  27 tests). Covered:
  - the gap, reproduced pre-migration;
  - log, enforce and off modes;
  - a missing switch row;
  - a read-only transaction;
  - strangers and portal clients;
  - minting and deleting codes in every mode;
  - redemption, including other sessions revoked, case and whitespace,
    reuse, wrong codes, a portal client, and the old RPC name;
  - the edge check and the page check;
  - grants;
  - de-duplication;
  - the rollback file.
- **All 15 real edge handlers** were run with fetch mocked
  (`tests/edge-functions/internal-mfa-gate.test.js`, 92 tests: 76 fail on
  the old code). Covered: refused leads to 403 `mfa_required` with no side
  effects; allowed carries on; fail-closed on 500, 404, a bad body or a
  network error; non-internal callers never reach the gate; the gate is
  ordered before the body is read.
- **login.html + auth.js in jsdom** against a fake Supabase that enforces
  GoTrue's aal2 rule for a second factor and the new aal2 rule for minting
  (`tests/tools/internal-mfa-server-enforcement.test.js`, 13 tests: all 13
  fail on the old code).
- **Live rehearsal** on production, inside a transaction forced to roll
  back. It ran the full migration and probed 12 internal tables, the
  secure-documents bucket, 4 functions and a write, for Connor aal2,
  Connor aal1, Steve and a stranger, in log and enforce modes, plus the
  whole recovery path with Connor's real user and session ids.
  - Every result was as designed.
  - The md5 of all 10 function bodies matched the committed file.
  - Afterwards the objects were confirmed absent and Connor still had his
    factor, 5 sessions and 10 codes.

### Not done yet, on purpose

- **The edge functions are not deployed.** Per this log's "deploy only
  `main`" lesson, they go after merge.
- **Drift was found.** The repo's `trigger-workflow` was *behind* live: it
  still listed the retired `backup-business-data.yml`. Deploying the repo
  copy would have broken Dev Tools' "Backup sensitive data" button. The
  repo was brought in line with live byte-for-byte first.
  `delete-portal-invoice` and `sync-job-to-portal` are behind `main` and
  will pick up merged fixes on deploy. Three others differ only in
  comments.
- **Enforcement is not flipped.** That needs the review window and both
  people's real-device tests (the checklist in
  `docs/INTERNAL-MFA-ENFORCEMENT.md`, including a terminal test of the
  actual stolen-password path). No session here can do a real TOTP
  sign-in as Steve or Connor, and it would be wrong to mint their sessions
  with the service role to fake one.

### Lessons

- **Check the target account's real state before designing a lockout
  guard.** Here the Owner had no factor at all. That turned "don't lock
  Steve out" into "Steve isn't protected yet", which is a different and
  more urgent message.
- **Read-only transactions change how a dry run can log.** Anything
  evaluated inside RLS can only RAISE, not INSERT.
- **A new recovery power is only as safe as the minting behind it.**
  Review "how are codes created" whenever "what a code can do" grows.

## 2026-09-25: Audit finding #7 closed in code -- the webhook checks the amount before marking an invoice paid

Follow-up to the 2026-09-23 round 3 audit, finding #7 (LOW), ACTION-ITEMS #16.

### The risk

`stripe-webhook` marked every invoice a succeeded PaymentIntent pointed at as paid, whatever the amount. `sync-invoice-to-portal` changes `total` in place and never touches `stripe_payment_intent_id`. So a client who opened Pay, then had the invoice raised, could still pay the old amount from that page, and the invoice read "paid" in both the portal and the Invoice Log. Not attacker-for-profit: the client needs a page left open across a raise, and the business can still chase the difference. But nothing would ever have told anyone. The daily reconcile only flags unpaid invoices, and this one was marked paid.

### Why the webhook check, not cancelling the old PaymentIntent

The action item offered both. Cancelling in `create-payment-intent` / `create-bulk-payment-intent` only helps when a second "Pay" mints a replacement. The likelier path has no replacement: one page, opened before the raise, paying the invoice's only PaymentIntent. Nothing gets superseded, so there's nothing to cancel. The webhook check covers both paths, touches one file, and never cancels a PaymentIntent a client may be confirming in another tab (3DS in progress).

### What it does

- **Owed** is `Math.round(sum(unpaid totals) * 100)`: the exact formula both create functions use. Rounding each row first would disagree by a cent for totals like 10.075 + 10.075. A test feeds each create function's real charge back into the webhook to pin this.
- **Paid short** (or `amount_received` missing): nothing is written, 200 to Stripe (a retry can't fix it), and a staff push "Invoice paid short". `reconcile-stripe-payments` then flags the unpaid invoice daily ("shows unpaid, but Stripe has a succeeded payment") for its 8-day lookback. That's the backstop if the push fails.
- **Overpaid:** marked paid as before, plus an "Invoice overpaid" push. This is a deliberate deviation from the audit's "alert instead of marking paid". An overpaid invoice is covered. Leaving it unpaid would show a paying client a false balance. And when a newer, still-open PaymentIntent exists, the double-charge guard hands it back, so they could pay a second time.
- The push reuses Send-Push's `stripe-reconciliation-alert` type, which only reaches internal subscriptions (certified 2026-09-23). The body names the PaymentIntent, invoice numbers, client email and both amounts, the same detail reconcile's alerts already carry. A push failure is logged and swallowed.
- **Tests:** `tests/edge-functions/stripe-webhook-amount-check.test.js` runs the real handler. The fake Supabase honors `select=`, so a lookup that forgot to read `total` fails there the way it would against PostgREST. 24 tests; 9 fail on the old code; every legitimate path passes both before and after.

### Deploy drift found (again)

`get_edge_function` shows live `stripe-webhook` v18 is the 2026-09-14 code. `main` has carried #213 and #217 (2026-09-15) for ten days without a deploy: the invoice-PATCH failure now returns 500 so Stripe retries it (live, a failed write is acknowledged with 200 and the paid status is lost), `workspace_sync` failures are logged, and POS income is dated in Denver time. So deploying this PR ships those too. All three are fixes, merged and tested, but the deployer should know. It's the third function found running behind `main` (after uptime-alert and Send-Push). The deploy-drift check from round 3's lessons is still worth building.

### Still open

- **Deploy** `stripe-webhook` from `main` with `verify_jwt: false` (unchanged). After deploy, confirm the live source matches `main`, and that the next real payment marks its invoice paid with no alert.
- **Duplicate alerts.** A redelivered event for a held invoice sends the push again. Stripe only redelivers on non-2xx or its rare duplicates, and reconcile nags daily anyway, so there's no dedup table for it.

<!-- Add new entries above this line -->
