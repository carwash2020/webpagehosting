-- Daily end-of-day email digest (edge function: daily-digest).
-- ADDITIVE ONLY: two new tables, RLS on both, one seeded settings row.
-- NOT APPLIED by merging the PR -- run by hand (see docs/daily-digest/README.md).
--
-- Ships DISABLED: enabled = false and recipients = '{}'. Nothing is sent
-- until someone sets recipients and flips enabled to true.

create table if not exists public.digest_settings (
  id smallint primary key default 1 check (id = 1),
  tenant_id uuid,
  enabled boolean not null default false,
  recipients text[] not null default '{}',   -- Connor + Steve; set via SQL/UI, never in code
  send_hour_local smallint not null default 20 check (send_hour_local between 0 and 23),
  timezone text not null default 'America/Denver',
  send_on_empty_day boolean not null default true,
  from_address text,                          -- optional; falls back to LEAD_EMAIL_FROM edge secret
  updated_at timestamptz not null default now()
);

alter table public.digest_settings enable row level security;

drop policy if exists digest_settings_internal on public.digest_settings;
create policy digest_settings_internal on public.digest_settings
  for all to authenticated
  using (exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')))
  with check (exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')));

-- Single seeded row, disabled, no recipients.
insert into public.digest_settings (id, tenant_id, enabled, recipients)
values (1, (select id from public.tenants where slug = 'triple-h'), false, '{}')
on conflict (id) do nothing;

create table if not exists public.digest_runs (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  digest_date date not null,                  -- local America/Denver date
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts int not null default 0,
  resend_message_id text,
  counts jsonb,                               -- counts only, no names/emails
  error text,                                 -- sanitized
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (digest_date)
);

-- Service-role only: RLS on, deliberately no policies.
alter table public.digest_runs enable row level security;
