-- Two-way messaging on a COMPLETED job (2026-09-16) -- closes the gap
-- docs/CLIENT-PORTAL.md flagged: phase 6 built messaging on WORK
-- ORDERS (a not-yet-assessed request), but a client with a question
-- about a job that's already done had nowhere to ask it except by
-- filing a brand-new work order under a different heading, or calling.
--
-- Deliberately its OWN table, not a reuse of client_portal_work_order_
-- messages with a nullable job_id -- the two threads have different
-- parents (client_portal_work_orders vs client_portal_jobs) and mixing
-- them under one FK would mean the "exactly one of these two is set"
-- constraint every row would need to carry forever. Mirrors that
-- table's shape and RLS pattern closely on purpose, though, so the
-- internal reply UI (tools/clients.html) and the notify edge function
-- can reuse the exact same code shape already proven there.
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact, same convention as every other file in sql/portal/.

create table client_portal_job_messages (
  id bigint generated always as identity primary key,
  job_id bigint not null references client_portal_jobs(id) on delete cascade,
  sender_type text not null,
  sender_email text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint job_message_sender_type_valid check (sender_type in ('client', 'internal')),
  constraint job_message_not_blank check (length(trim(message)) > 0)
);

alter table client_portal_job_messages enable row level security;

-- Clients see messages on their own jobs only, internal accounts see
-- all -- identical shape to client_portal_work_order_messages' own
-- "clients or internal accounts view work order messages" policy.
create policy "clients or internal accounts view job messages"
  on client_portal_job_messages for select
  to authenticated
  using (
    exists (
      select 1 from client_portal_jobs j
      where j.id = client_portal_job_messages.job_id
      and j.client_email = (select auth.email())
    )
    or current_user_has_any_role()
  );

-- A client may only post as themselves, on their own job, and only
-- ever with sender_type='client' -- never able to forge an 'internal'
-- reply. An internal account may only post as themselves too, gated
-- on actually holding a role rather than a specific permission (same
-- reasoning client_portal_work_orders' internal policies use: replying
-- to a client is core day-to-day work, not a restricted action).
create policy "clients or internal accounts send job messages"
  on client_portal_job_messages for insert
  to authenticated
  with check (
    (
      sender_type = 'client'
      and sender_email = (select auth.email())
      and exists (
        select 1 from client_portal_jobs j
        where j.id = client_portal_job_messages.job_id
        and j.client_email = (select auth.email())
      )
    )
    or (
      sender_type = 'internal'
      and sender_email = (select auth.email())
      and current_user_has_any_role()
    )
  );

create index client_portal_job_messages_job_id_idx
  on client_portal_job_messages (job_id, created_at);

-- Notification trigger -- fires notify-job-message-email on every new
-- message, in either direction, mirroring
-- on_work_order_message_send_email/notify_work_order_message_email
-- exactly (same Vault secret lookup, same net.http_post shape).
create or replace function notify_job_message_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_job_message_email: send_push_service_role_key not found in Vault; message email not sent for id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/notify-job-message-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'client_portal_job_messages',
      'record', row_to_json(NEW)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$function$;

create trigger on_job_message_send_email
  after insert on client_portal_job_messages
  for each row
  execute function notify_job_message_email();
