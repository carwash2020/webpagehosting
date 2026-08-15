-- Moves the service_role key notify_new_lead() needs out of the
-- function body (where it was previously hardcoded in plaintext,
-- readable by any role with catalog access) into Supabase Vault.
-- Run 2026-08-14.

-- Prerequisite (run once, not repeated here since it contains the
-- actual secret value): 
--   select vault.create_secret('<the service_role JWT>', 'send_push_service_role_key', '...');

create or replace function public.notify_new_lead()
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
    raise warning 'notify_new_lead: send_push_service_role_key not found in Vault; push notification not sent for lead id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
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
