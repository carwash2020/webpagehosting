-- Incident (found 2026-09-21, from a screenshot of Dev Tools' Cron
-- Health panel showing a recurring daily "HTTP call failed -- status
-- 401" alert): send-payment-reminder and send-quote-followup (both
-- added 2026-09-16, see add_payment_reminder_emails_cron.sql /
-- add_quote_followup_email_cron.sql) had been silently 401ing on
-- EVERY scheduled run since the day they shipped -- meaning every
-- client-facing overdue-invoice reminder and quote-followup email
-- this project ever claimed to send automatically had, in reality,
-- never gone out at all.
--
-- Root cause: every net.http_post cron job authenticates with
-- vault.decrypted_secrets['send_push_service_role_key'], a copy of
-- the service_role key saved into Vault on 2026-08-14 (see
-- fix_cron_job_use_vault_secret.sql). Sometime after that date, this
-- Supabase project's auto-provisioned SUPABASE_SERVICE_ROLE_KEY moved
-- to the newer `sb_secret_...` key format -- confirmed live via a
-- temporary diagnostic Edge Function that compared the vault-stored
-- value against Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") without
-- ever printing either secret. The vault copy was still the old
-- legacy JWT (219 chars, `eyJhbGci...`); the live env var was the new
-- 41-char `sb_secret_...` key.
--
-- Only send-payment-reminder/send-quote-followup ever noticed, because
-- they're the only two cron-driven functions that do a strict
-- `token !== SERVICE_ROLE_KEY` equality check (a deliberate security
-- fix -- see each file's own header, and uptime-alert-auth.test.js --
-- against Supabase's platform-level verify_jwt alone, which only
-- checks a JWT's signature, not its role, and would let the public
-- anon key through). Every other net.http_post caller (Send-Push,
-- reconcile-stripe-payments, send-appointment-reminder) either has no
-- such check or none at all, so the stale vault key -- still a validly
-- SIGNED JWT, since the project's JWT secret itself never changed --
-- kept passing the platform's own check and never surfaced this.
--
-- Fixed live via the diagnostic function calling
-- resync_cron_service_role_key() below with the correct live key read
-- directly from its own Deno.env -- the key's actual value was never
-- typed, logged, or returned in any tool response at any point.
--
-- This function is kept (not dropped) as a real maintenance utility:
-- if this project's key format ever changes again (another Supabase
-- migration, or a genuine key rotation), re-run it from any
-- authenticated internal context with the CURRENT live
-- SUPABASE_SERVICE_ROLE_KEY value as the argument to resync every
-- net.http_post cron job's auth in one place, without ever needing a
-- one-off diagnostic function again. It never reads or returns the
-- secret itself -- callers must already have the correct value in
-- hand.
create or replace function resync_cron_service_role_key(new_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_value is null or length(new_value) < 20 then
    raise exception 'resync_cron_service_role_key: refusing an implausibly short value.';
  end if;
  perform vault.update_secret(
    (select id from vault.secrets where name = 'send_push_service_role_key'),
    new_value
  );
end;
$$;

revoke all on function resync_cron_service_role_key(text) from public;
grant execute on function resync_cron_service_role_key(text) to service_role;
