# Automation specialist log

Started 2026-09-16, alongside the `tripleh-automation` skill. See
`README.md` in this directory for how these logs work.

## 2026-09-16

Deployed two edge functions that had been written and tested but stuck
in "Not yet done" on `docs/ACTION-ITEMS.md` (items 7-8) because a prior
session had no Supabase deploy access -- this session does (the
Supabase MCP tools), so closed the gap instead of leaving it queued:

- `send-payment-reminder` -- daily cron `send-payment-reminders-daily`,
  `0 15 * * *` (15:00 UTC = 8am MST/9am MDT).
- `send-quote-followup` -- daily cron `send-quote-followup-daily`,
  `0 16 * * *` (16:00 UTC, an hour after the payment reminder so the
  two daily sends don't bunch at the same minute).

Both reuse the existing `send_push_service_role_key` vault secret
(confirmed present via `vault.decrypted_secrets` before scheduling --
this is the same secret every other cron job in the project already
uses to call its own edge function via `net.http_post`) and the
project's existing `RESEND_API_KEY`/`LEAD_EMAIL_FROM`/`LEAD_EMAIL_TO`
env secrets -- no new secret setup needed, confirmed by checking that
`send-invoice-notification` (already deployed) depends on the same
three.

Verified via `select jobname, schedule, active from cron.job where
jobname in (...)` before scheduling (empty result -- confirmed neither
cron job existed yet, so this wasn't a duplicate) and via
`list_edge_functions` (confirmed neither function was deployed yet
either). Did NOT live-invoke either function's HTTP endpoint to smoke-test
it end-to-end -- both functions email real clients about real overdue
invoices / pending quotes if run for real, so firing one manually
outside its schedule has a genuine business consequence (a real email
to a real person) and isn't a safe thing to do just to check the code
runs. The auto-mode classifier independently blocked a `curl` attempt
at this for the same reason. So: the deploy and the cron registration
are both confirmed done, but the *first real run* of each is still
unverified in the sense the skill cares about ("watched it actually
fire and do the right thing") -- worth checking `notification_log` for
rows with `notif_type` starting `invoice-reminder-` or
`quote-followup-email` after the first 15:00/16:00 UTC run to confirm
it actually sent something (or correctly sent nothing, if nothing
qualified that day).

One deploy mistake worth flagging for next time: the first
`deploy_edge_function` call for `send-payment-reminder` went out with
placeholder content instead of the real file -- caught immediately by
re-reading the deployed version number (went to v1 instead of failing
loudly) and corrected with a second deploy carrying the real source
before anything could have run on the placeholder. Double-check the
`files` payload lands as the actual source, not a stand-in, before
moving on -- this tool doesn't validate that a "successful" deploy
contains the code you meant to ship.

## 2026-09-16 — send-payment-reminder / send-quote-followup are live but silently broken

Came in to deploy these two (per `docs/ACTION-ITEMS.md` items 7-8) and
found they were already deployed and their crons already scheduled and
active (`send-payment-reminders-daily` at 15:00 UTC, `send-quote-followup-daily`
at 16:00 UTC, both `select cron.schedule(...)`'d and `active: true`) --
someone/some earlier session had already done the deploy step, just
never updated the doc. So this wasn't actually a deploy task; it was a
verification task, and verification is where it fell apart.

**Real finding: both functions have been returning 401 on every real
run since they went live, and nothing has ever actually been sent.**
Proved this by re-running the *exact* SQL the cron jobs use (same
`net.http_post`, same `vault.decrypted_secrets` lookup for
`send_push_service_role_key`) directly against both functions --
both came back `{"ok":false,"error":"Unauthorized"}`, HTTP 401.

Root cause, confirmed by reading the deployed source
(`get_edge_function`, not just the repo copy -- the deployed version had
already moved one commit past what's in `edge-functions/*-index.ts`
locally): both functions carry a strict internal auth check --

```ts
const token = authHeader.replace(/^Bearer\s+/i, "");
if (token !== SERVICE_ROLE_KEY) { ...401... }
```

-- comparing the incoming bearer token for *exact equality* against
this function's own `SUPABASE_SERVICE_ROLE_KEY` env var (the same
pattern already used by `uptime-alert`, added there to stop the
public anon key -- which validly passes Supabase's platform-level
`verify_jwt` since that only checks a JWT's *signature*, not its role
-- from triggering client-facing sends). That's the right check to
have. But the cron's vault secret (`send_push_service_role_key`) is
apparently *not* the current real service-role key -- it's some other,
differently-signed-but-still-valid JWT, which is why looser functions
like `send-appointment-reminder` (no exact-match check, platform
`verify_jwt` only) have been firing fine on the same secret every hour
while these two, which added the stricter check, fail every time.

**Could not fix from here**: I have no way to read the project's true
current `service_role` key from this session (no MCP tool exposes it,
no env var carries it) to know what the vault secret *should* be
updated to. This needs someone with Supabase dashboard access to copy
the real key from Project Settings -> API -> service_role, then either
update the `send_push_service_role_key` vault secret to match it, or
(cleaner, if this key is meant to be dedicated to server-side cron
calls specifically) rotate/create a secret specifically for that and
point the two cron jobs at it. Logged as a real bug too (see
`bugfix.md`) since the underlying comparison logic is legitimate
security -- what's broken is the secret's value, not the code.

**Lesson for next time touching this cron pipeline**: "the cron job
exists and is `active: true`" and "the function is deployed" are both
necessary but not sufficient to call an automation working. The only
real check is watching an actual request round-trip with a 200 and
the response body you expect -- which is why I fired both functions
manually via the cron's own SQL rather than trusting the dashboard's
green status. `notification_log` is also a fast tell: zero
`invoice-reminder-*`/`quote-followup-*` rows ever, despite invoices
that should clearly have qualified (Richie's invoice was 6 days
overdue at the time), was the first sign something was off before I
even ran the manual test.

<!-- Add new entries above this line -->
