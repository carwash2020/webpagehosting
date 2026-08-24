-- Adds email notifications for new leads, sent via Resend through the
-- new send-lead-email Edge Function -- the in-house replacement for
-- Formspree's email-on-submit behavior.
--
-- Deliberately a SEPARATE trigger from notify_new_lead() (which fires
-- send-push), not a second call bolted onto that existing function:
-- if Resend has an outage, push notifications keep working completely
-- unaffected, and vice versa. Same reasoning already applied elsewhere
-- in this codebase to keep independent failure modes independent.
--
-- PREREQUISITES (do these first, in the Supabase dashboard, not here):
--   1. Sign up at resend.com, verify the sending domain (adds a couple
--      of DNS records at your domain registrar -- one-time).
--   2. Create an API key in Resend, then in Supabase SQL Editor run:
--        select vault.create_secret('<the Resend API key>', 'resend_api_key', '...');
--   3. Deploy the Edge Function:
--        supabase functions deploy send-lead-email
--   4. Set these secrets on the function (Supabase dashboard -> Edge
--      Functions -> send-lead-email -> Secrets, or via CLI):
--        RESEND_API_KEY   -- same value as the vault secret above
--        LEAD_EMAIL_TO    -- e.g. steve@triplehenterprisesllc.biz
--        LEAD_EMAIL_FROM  -- must be on the verified domain, e.g. leads@triplehenterprisesllc.biz
--   5. Also store the service_role key in Vault, if not already done
--      for notify_new_lead() (reuses the same secret name/value):
--        select vault.create_secret('<the service_role JWT>', 'send_push_service_role_key', '...');

create or replace function public.notify_new_lead_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_new_lead_email: send_push_service_role_key not found in Vault; lead email not sent for lead id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-lead-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'th_leads',
      'record', row_to_json(NEW)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

drop trigger if exists on_new_lead_send_email on public.th_leads;
create trigger on_new_lead_send_email
  after insert on public.th_leads
  for each row
  execute function public.notify_new_lead_email();

-- Confirm: should show two independent triggers now on th_leads,
-- one for push (pre-existing) and one for email (this one).
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_table = 'th_leads';
