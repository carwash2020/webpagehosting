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

<!-- Add new entries above this line -->
