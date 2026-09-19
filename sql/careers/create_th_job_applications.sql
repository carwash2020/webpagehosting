-- Job application form (direct request, 2026-09-19), for the Part-Time
-- Handyman Helper posting on /careers.html.
--
-- Deliberately a simple, standalone table -- no idempotency key, no
-- on_conflict/upsert. Both of those were a real, hard-won lesson on
-- th_leads (sql/leads/fix_th_leads_conflict_index.sql): ON CONFLICT
-- requires SELECT access under RLS that a public-submission table
-- deliberately doesn't grant anon, and a partial unique index breaks
-- Postgres's own conflict matching. A job application has no
-- legitimate reason to need idempotency at the database level anyway
-- -- a double-submit from a double click is handled client-side
-- (careers.html disables the submit button after first click), and a
-- rare duplicate row is a cosmetic non-issue Steve can see and ignore,
-- not a correctness problem worth carrying that whole class of bug for.

create table if not exists public.th_job_applications (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  email text,
  city text,
  availability text,
  experience text,
  message text,
  handled boolean not null default false,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

alter table public.th_job_applications enable row level security;

-- Same reasoning as th_leads: anyone should be able to submit an
-- application, logged in or not, so this is a clean, permissive
-- INSERT-only policy -- no SELECT/UPDATE/DELETE for anon, matching
-- th_leads exactly (protects applicant contact info from a plain GET).
create policy "Anyone can submit a job application"
  on public.th_job_applications for insert
  to anon, authenticated
  with check (true);

create policy "Only logged-in can view job applications"
  on public.th_job_applications for select
  to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "Only logged-in can update job applications"
  on public.th_job_applications for update
  to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "Only logged-in can delete job applications"
  on public.th_job_applications for delete
  to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- Notification on submit, same shape as notify_new_lead_email():
-- fires send-job-application-email via a Database Webhook-equivalent
-- trigger, reusing the same service_role Vault secret already stored
-- for th_leads/send-push. See
-- sql/leads/notify_new_lead_use_vault_secret.sql for why the secret
-- lives in Vault rather than hardcoded here.
create or replace function public.notify_new_job_application_email()
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
    raise warning 'notify_new_job_application_email: send_push_service_role_key not found in Vault; email not sent for application id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-job-application-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'th_job_applications',
      'record', row_to_json(NEW)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

drop trigger if exists on_new_job_application_send_email on public.th_job_applications;
create trigger on_new_job_application_send_email
  after insert on public.th_job_applications
  for each row
  execute function public.notify_new_job_application_email();
