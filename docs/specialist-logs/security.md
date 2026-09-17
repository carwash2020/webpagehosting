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

<!-- Add new entries above this line -->
