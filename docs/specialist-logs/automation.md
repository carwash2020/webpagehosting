# Automation specialist log

Started 2026-09-16, alongside the `tripleh-automation` skill. See
`README.md` in this directory for how these logs work.

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
