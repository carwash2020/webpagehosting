-- Fix plan Group 5, RP3 (2026-11-07): public doors stay open to customers
-- and closed to abuse; internal doors check the switch, not just the login.
-- NOT APPLIED -- approved per item in-session before it runs.
--
-- WHAT
--   1. rate_limit_take(): one fixed-window counter shared by the database and
--      the edge functions (guest-pay, portal-signup verify, staff sends).
--      Keys (IPs, emails) are stored only as a SHA-256 hash. Service-only.
--   2. request_client_ip(): the caller's IP as Cloudflare reports it
--      (cf-connecting-ip, which Cloudflare overwrites; else the LAST
--      x-forwarded-for entry, never the caller-written first one).
--   3. RP3.3 create_booking(): at most 5 bookings an hour from one IP, and an
--      email, when given, must look like one. Staff are not limited.
--   4. RP3.4 + RP3.5: a public insert into th_leads, th_job_applications,
--      portal_bug_reports or portal_client_errors is rate limited per IP
--      (leads 5/h, applications 3/h, bug reports 10/h, error logs 30/h --
--      error logs over the limit are dropped quietly, never an error), and a
--      public lead always arrives unhandled, timestamped now, in the default
--      business (handled/created_at/tenant_id from the caller are ignored).
--   5. RP3.6: receipts and secure documents (insurance, LLC certificate) are
--      readable, uploadable and deletable only with can_view_finance, like
--      invoice PDFs are with can_manage_invoices. Job photos stay staff-wide
--      (the field needs them).
--   6. RP3.7 (D20): internal_mfa_enforcement.enroll_deadline. Until it is set
--      nothing changes. After it, a staff account with no verified second
--      factor no longer passes the two-factor gate (logged while the mode is
--      'log', refused once it is 'enforce'). The date is Connor's to set.
--   7. RP3.13 (D26): notification_log rows are kept 370 days (was 3700).
--   8. RP3.32: the client_portal_* SELECT policy names say what they do
--      ("clients can view their own ..."); no access changes.
--   9. RP3.33 (D30): account_roles rows are readable only by role managers,
--      plus each account's own row. team_roster() still lists everyone's
--      name, title, email and status (the Assigned-to picker and the D13
--      directory need them) but returns switches and sign-in/invite dates
--      only to role managers. internal_emails_among() answers "which of these
--      emails are staff?" for the Clients page without listing anyone.
--  10. RP4.8: client_portal_work_orders.status_note, set by staff when they
--      close or decline a request, shown to the client.
--
-- Re-runnable. Nothing is dropped except policies and functions that are
-- recreated in the same file.
--
-- UNDO (per section): drop the new triggers/functions/table/columns; re-run
-- the previous definitions from sql/booking/add_create_booking_rpc.sql (as
-- amended by sql/infra/phase5_attribution_and_ga4.sql),
-- sql/security/phase4_team_roster_and_deactivate.sql (team_roster, as amended
-- by fp1_person_title.sql), and the storage/account_roles policies listed in
-- the comments of each section.

-- 1. Rate limiting --------------------------------------------------------------
create table if not exists public.rate_limit_hits (
  bucket text not null,
  key_hash text not null,
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  primary key (bucket, key_hash)
);
alter table public.rate_limit_hits enable row level security;
revoke all on table public.rate_limit_hits from public, anon, authenticated;

create or replace function public.rate_limit_take(p_bucket text, p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(nullif(p_key, ''), 'unknown'), 'UTF8')), 'hex');
  v_window interval := make_interval(secs => greatest(coalesce(p_window_seconds, 3600), 1));
  v_hits integer;
begin
  insert into public.rate_limit_hits as r (bucket, key_hash, window_start, hits)
    values (left(coalesce(p_bucket, '?'), 80), v_hash, now(), 1)
  on conflict (bucket, key_hash) do update set
    hits = case when r.window_start <= now() - v_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start <= now() - v_window then now() else r.window_start end
  returning hits into v_hits;
  -- Now and then, forget day-old windows.
  if random() < 0.02 then
    delete from public.rate_limit_hits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= greatest(coalesce(p_max, 0), 0);
end;
$$;
revoke execute on function public.rate_limit_take(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, text, integer, integer) to service_role;

-- 2. The caller's IP, as the gateway saw it --------------------------------------
create or replace function public.request_client_ip()
returns text
language sql
stable
set search_path = public
as $$
  with h as (
    select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as j
  ), x as (
    select nullif(btrim(j ->> 'cf-connecting-ip'), '') as cf,
           string_to_array(coalesce(j ->> 'x-forwarded-for', ''), ',') as xff
    from h
  )
  select left(coalesce(cf, nullif(btrim(xff[array_length(xff, 1)]), ''), 'unknown'), 64) from x;
$$;
revoke execute on function public.request_client_ip() from public, anon, authenticated;

-- Is this request a member of the public (not staff, not the server)?
create or replace function public.request_is_public()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not exists (select 1 from public.account_roles ar where ar.email = (select auth.jwt() ->> 'email'));
$$;
revoke execute on function public.request_is_public() from public, anon, authenticated;

-- 3. RP3.3 create_booking ----------------------------------------------------------
create or replace function public.create_booking(p_booking jsonb)
returns table (booking_id bigint, manage_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_name text := nullif(trim(coalesce(p_booking->>'name', '')), '');
  v_email text := nullif(trim(coalesce(p_booking->>'email', '')), '');
  v_id bigint;
  v_token uuid;
begin
  begin
    v_start := (p_booking->>'start_at')::timestamptz;
    v_end := (p_booking->>'end_at')::timestamptz;
  exception when others then
    raise exception 'invalid-time' using errcode = '22023';
  end;
  if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '8 hours' then
    raise exception 'invalid-time' using errcode = '22023';
  end if;
  if v_start < now() - interval '5 minutes' then
    raise exception 'in-the-past' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'name-required' using errcode = '22023';
  end if;
  -- Fix plan RP3.3 (2026-11-07): a real-looking email, and no more than 5
  -- bookings an hour from one place (each one emails and pushes staff and
  -- holds a slot).
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$') then
    raise exception 'invalid-email' using errcode = '22023';
  end if;
  if public.request_is_public()
     and not public.rate_limit_take('create-booking', public.request_client_ip(), 5, 3600) then
    raise exception 'too-many' using errcode = 'PT429';
  end if;

  insert into public.th_bookings (
    service_key, service_label, start_at, end_at, name, phone, email, address, notes,
    referred_by, referred_by_code, source, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    ga_client_id, landing_referrer
  ) values (
    left(p_booking->>'service_key', 50),
    left(p_booking->>'service_label', 100),
    v_start,
    v_end,
    left(v_name, 100),
    left(nullif(trim(coalesce(p_booking->>'phone', '')), ''), 30),
    left(v_email, 200),
    left(nullif(trim(coalesce(p_booking->>'address', '')), ''), 200),
    left(nullif(p_booking->>'notes', ''), 1000),
    left(nullif(trim(coalesce(p_booking->>'referred_by', '')), ''), 200),
    left(nullif(trim(coalesce(p_booking->>'referred_by_code', '')), ''), 50),
    left(nullif(p_booking->>'source', ''), 100),
    left(nullif(p_booking->>'utm_source', ''), 200),
    left(nullif(p_booking->>'utm_medium', ''), 200),
    left(nullif(p_booking->>'utm_campaign', ''), 200),
    left(nullif(p_booking->>'utm_term', ''), 200),
    left(nullif(p_booking->>'utm_content', ''), 200),
    left(nullif(p_booking->>'ga_client_id', ''), 41),
    left(nullif(p_booking->>'landing_referrer', ''), 253)
  )
  returning id, th_bookings.cancel_token into v_id, v_token;

  return query select v_id, v_token;
end;
$$;
revoke execute on function public.create_booking(jsonb) from public;
grant execute on function public.create_booking(jsonb) to anon, authenticated;

-- 4. RP3.4 + RP3.5 public inserts ---------------------------------------------------
create or replace function public.public_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
begin
  if not public.request_is_public() then
    return new;
  end if;
  if tg_table_name = 'th_leads' then
    -- RP3.5: a lead from the public is always new.
    new.handled := false;
    new.handled_at := null;
    new.created_at := now();
    new.tenant_id := public.default_tenant_id_triple_h();
  end if;
  v_max := case tg_table_name
    when 'th_leads' then 5
    when 'th_job_applications' then 3
    when 'portal_bug_reports' then 10
    when 'portal_client_errors' then 30
    else 10 end;
  if not public.rate_limit_take('insert:' || tg_table_name, public.request_client_ip(), v_max, 3600) then
    if tg_table_name = 'portal_client_errors' then
      return null; -- an error log over the limit is dropped, never an error
    end if;
    raise exception 'Too many submissions from here. Please wait a while, or call (435) 414-1667.'
      using errcode = 'PT429';
  end if;
  return new;
end;
$$;
revoke execute on function public.public_insert_guard() from public, anon, authenticated;

drop trigger if exists public_insert_guard on public.th_leads;
create trigger public_insert_guard before insert on public.th_leads
  for each row execute function public.public_insert_guard();
drop trigger if exists public_insert_guard on public.th_job_applications;
create trigger public_insert_guard before insert on public.th_job_applications
  for each row execute function public.public_insert_guard();
drop trigger if exists public_insert_guard on public.portal_bug_reports;
create trigger public_insert_guard before insert on public.portal_bug_reports
  for each row execute function public.public_insert_guard();
drop trigger if exists public_insert_guard on public.portal_client_errors;
create trigger public_insert_guard before insert on public.portal_client_errors
  for each row execute function public.public_insert_guard();

-- 5. RP3.6 receipts and secure documents ---------------------------------------------
-- Was: "Internal accounts can view|upload|delete receipts|secure-documents",
-- each `bucket_id = '<bucket>' and current_user_has_any_role()`.
create or replace function public.current_user_can_view_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_has_any_role()
     and coalesce((select ar.can_view_finance from public.account_roles ar
                   where ar.email = (select auth.jwt() ->> 'email')), false);
$$;
revoke execute on function public.current_user_can_view_finance() from public, anon;
grant execute on function public.current_user_can_view_finance() to authenticated;

do $$
declare
  b text;
  verb text;
begin
  foreach b in array array['receipts', 'secure-documents'] loop
    foreach verb in array array['view', 'upload', 'delete'] loop
      execute format('drop policy if exists %I on storage.objects', 'Internal accounts can ' || verb || ' ' || b);
      execute format('drop policy if exists %I on storage.objects', 'Finance accounts can ' || verb || ' ' || b);
    end loop;
    execute format($p$create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L and (select public.current_user_can_view_finance()))$p$, 'Finance accounts can view ' || b, b);
    execute format($p$create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L and (select public.current_user_can_view_finance()))$p$, 'Finance accounts can upload ' || b, b);
    execute format($p$create policy %I on storage.objects for delete to authenticated
      using (bucket_id = %L and (select public.current_user_can_view_finance()))$p$, 'Finance accounts can delete ' || b, b);
  end loop;
end $$;

-- 6. RP3.7 (D20) two-factor enrolment deadline ----------------------------------------
alter table public.internal_mfa_enforcement add column if not exists enroll_deadline timestamptz;
comment on column public.internal_mfa_enforcement.enroll_deadline is
  'Fix plan RP3.7 (D20): after this time a staff account with no verified second factor stops passing the two-factor gate. Null = no deadline yet.';

create or replace function public.internal_mfa_session_ok(p_user_id uuid, p_aal text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_aal, '') = 'aal2'
      or (
        p_user_id is not null
        and not exists (
          select 1 from auth.mfa_factors f
          where f.user_id = p_user_id and f.status = 'verified'
        )
        -- D20: no factor at all is fine only until the deadline.
        and coalesce(now() < (select e.enroll_deadline from public.internal_mfa_enforcement e where e.id), true)
      )
      or public.trusted_device_session_valid(p_user_id, auth.jwt() ->> 'session_id');
$$;

-- 7. RP3.13 (D26) notification_log retention ------------------------------------------
do $$
declare
  v_job bigint;
begin
  if to_regclass('cron.job') is null then return; end if;
  select jobid into v_job from cron.job where jobname = 'archive-old-notification-log';
  if v_job is null then return; end if;
  perform cron.alter_job(job_id := v_job, command := $c$
  delete from public.notification_log where sent_at < now() - interval '370 days';
  $c$);
end $$;

-- 8. RP3.32 honest policy names ----------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
    ('client_portal_contracts', 'clients or internal accounts can view contracts', 'clients can view their own contracts'),
    ('client_portal_invoices', 'clients or internal accounts can view invoices', 'clients can view their own invoices'),
    ('client_portal_job_messages', 'clients or internal accounts view job messages', 'clients can view messages on their own jobs'),
    ('client_portal_jobs', 'clients or internal accounts can view jobs', 'clients can view their own jobs'),
    ('client_portal_quotes', 'clients or internal accounts can view quotes', 'clients can view their own quotes'),
    ('client_portal_work_order_messages', 'clients or internal accounts view work order messages', 'clients can view messages on their own work orders'),
    ('client_portal_work_orders', 'clients or internal accounts view work orders', 'clients can view their own work orders')
  ) as t(tbl, old_name, new_name) loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.old_name) then
      execute format('alter policy %I on public.%I rename to %I', r.old_name, r.tbl, r.new_name);
    end if;
  end loop;
end $$;

-- 9. RP3.33 (D30) who can see staff accounts -------------------------------------------
-- The read policy below asks "is the caller a role manager?". That check
-- reads account_roles itself, so it must not go back through the same
-- policy: same body as before, now security definer (it only ever reads
-- the caller's own row).
create or replace function public.current_user_can_manage_roles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ar.can_manage_roles
     from public.account_roles ar
     where ar.email = (select auth.jwt() ->> 'email')),
    false
  );
$$;

-- Was: "Authenticated can view account roles" for select using
-- ((select current_user_has_any_role())).
drop policy if exists "Authenticated can view account roles" on public.account_roles;
drop policy if exists "Own row, or role managers see every row" on public.account_roles;
create policy "Own row, or role managers see every row" on public.account_roles
  for select to authenticated
  using (
    (email = (select auth.jwt() ->> 'email') and (select public.current_user_has_any_role()))
    or (select public.current_user_can_manage_roles()) and (select public.current_user_has_any_role())
  );

create or replace function public.internal_emails_among(p_emails text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct lower(ar.email)), '{}')
    from public.account_roles ar
   where public.current_user_has_any_role()
     and lower(ar.email) = any (select lower(e) from unnest(coalesce(p_emails, '{}'::text[])) e limit 1000);
$$;
revoke execute on function public.internal_emails_among(text[]) from public, anon;
grant execute on function public.internal_emails_among(text[]) to authenticated;

create or replace function public.team_roster()
returns table (email text, display_name text, title text, status text, last_sign_in_at timestamptz,
  invited_at timestamptz, deactivated_at timestamptz,
  can_manage_roles boolean, can_access_dev_tools boolean, can_access_dev_tools_full boolean,
  can_manage_site_content boolean, can_manage_invoices boolean, can_manage_contracts boolean,
  can_view_finance boolean, can_view_runway boolean, can_manage_reviews boolean,
  can_manage_clients boolean, can_manage_others_jobs boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mgr boolean;
begin
  if not public.current_user_has_any_role() then
    raise exception 'Not allowed: not an internal account.' using errcode = '42501';
  end if;
  -- D30: switches and sign-in/invite dates only for role managers.
  v_mgr := public.current_user_can_manage_roles();
  return query
    select ar.email, ar.display_name, ar.title,
           case when ar.invited_at is not null and u.last_sign_in_at is null then 'invited' else 'active' end,
           case when v_mgr then u.last_sign_in_at end,
           case when v_mgr then ar.invited_at end,
           null::timestamptz,
           case when v_mgr then ar.can_manage_roles end, case when v_mgr then ar.can_access_dev_tools end,
           case when v_mgr then ar.can_access_dev_tools_full end, case when v_mgr then ar.can_manage_site_content end,
           case when v_mgr then ar.can_manage_invoices end, case when v_mgr then ar.can_manage_contracts end,
           case when v_mgr then ar.can_view_finance end, case when v_mgr then ar.can_view_runway end,
           case when v_mgr then ar.can_manage_reviews end, case when v_mgr then ar.can_manage_clients end,
           case when v_mgr then ar.can_manage_others_jobs end
      from public.account_roles ar
      left join auth.users u on lower(u.email) = lower(ar.email)
    union all
    select d.email, d.display_name, d.row_data ->> 'title', 'deactivated',
           case when v_mgr then u.last_sign_in_at end,
           case when v_mgr then (d.row_data ->> 'invited_at')::timestamptz end,
           case when v_mgr then d.deactivated_at end,
           false, false, false, false, false, false, false, false, false, false, false
      from public.account_roles_deactivated d
      left join auth.users u on lower(u.email) = lower(d.email)
    order by 1;
end;
$$;
revoke execute on function public.team_roster() from public, anon;
grant execute on function public.team_roster() to authenticated;

-- 10. RP4.8 a note on a closed work order -------------------------------------------------
alter table public.client_portal_work_orders add column if not exists status_note text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_portal_work_orders_status_note_len') then
    alter table public.client_portal_work_orders
      add constraint client_portal_work_orders_status_note_len check (status_note is null or length(status_note) <= 1000);
  end if;
end $$;

drop function if exists public.internal_update_client_portal_work_order(bigint, text, timestamptz);
create or replace function public.internal_update_client_portal_work_order(
  p_id bigint, p_status text, p_scheduled_at timestamptz default null, p_note text default null)
returns setof public.client_portal_work_orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_any_role() then
    raise exception 'Only internal accounts can update work orders.'
      using errcode = '42501';
  end if;

  return query
    update public.client_portal_work_orders
       set status = p_status,
           scheduled_at = coalesce(p_scheduled_at, scheduled_at),
           -- RP4.8: a note travels with a close/decline; any other status clears it.
           status_note = case when p_status in ('declined', 'cancelled', 'closed')
                              then left(nullif(btrim(coalesce(p_note, '')), ''), 1000) end,
           updated_at = now()
     where id = p_id
       and tenant_id = public.current_tenant_id()
    returning *;
end;
$$;
revoke execute on function public.internal_update_client_portal_work_order(bigint, text, timestamptz, text) from public, anon;
grant execute on function public.internal_update_client_portal_work_order(bigint, text, timestamptz, text) to authenticated;
