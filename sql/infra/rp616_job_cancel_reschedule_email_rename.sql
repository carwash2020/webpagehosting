-- Fix plan RP6.16 / D32 (2026-11-07): the job trigger calls the renamed
-- edge function send-job-cancel-reschedule-email (was
-- send-job-status-change-email, which overpromised by name: it only sends
-- on a client's cancel or reschedule request). Deploy the new function
-- BEFORE applying this. Same body as sql/infra/add_job_cancel_reschedule.sql
-- except the URL; the trigger itself is unchanged.
--
-- UNDO: re-run notify_job_status_change() from add_job_cancel_reschedule.sql.

create or replace function public.notify_job_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  is_cancellation boolean;
  is_reschedule_request boolean;
begin
  is_cancellation := (OLD.cancelled_at is null and NEW.cancelled_at is not null);
  is_reschedule_request := (OLD.reschedule_requested_at is null and NEW.reschedule_requested_at is not null);

  if not (is_cancellation or is_reschedule_request) then
    return NEW;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_job_status_change: send_push_service_role_key not found in Vault; notification not sent for job id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-job-cancel-reschedule-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'jobs',
      'record', row_to_json(NEW),
      'old_record', row_to_json(OLD)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;
