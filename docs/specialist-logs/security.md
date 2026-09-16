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

<!-- Add new entries above this line -->
