-- Phase 5 (2026-11-04): analytics joined to the business. Approved design
-- "Insights: source -> paid, and the website" + "A lead becomes a job and
-- keeps its source". Connor's calls: jobs carry the source of the lead or
-- booking they came from (invoices take it from their job); the Google
-- Analytics visit ID is saved only for visitors who accepted analytics
-- cookies; it all lives on Dashboard > Insights.
--
-- What this adds:
--   1. Where a lead / booking came from, beyond the UTM columns already
--      there: the GA visit ID (only ever sent by the site with analytics
--      consent) and the host of the site that first sent the visitor
--      (www.google.com, a host name only, never a path or query).
--   2. A lead can point at the job it became (th_leads.job_id). A visitor
--      can't set that link: on a public insert it is always cleared.
--   3. Jobs carry source + UTM + first referrer host, copied from the lead or
--      booking by the Jobs screen.
--   4. ga_report_cache: the once-a-day copy of the website numbers the
--      ga4-report function reads from Google Analytics. Internal accounts
--      can read it; only the server writes it.
--   5. ga_conversions + a trigger on invoices: the moment an invoice turns
--      paid (any path: Mark paid, Stripe, guest pay, POS, a mirror upsert),
--      if its job came from a lead or booking that carries a GA visit ID, one
--      row is queued and the ga4-conversion function is called to tell
--      Google Analytics about the sale (amount + anonymous visit ID only).
--      One row per invoice, ever, so marking it unpaid and paid again never
--      sends twice. Anything that goes wrong here is a warning, never a
--      failed invoice save.
--   6. insights_channel() + insights_source_funnel(): the "By source" table
--      and the funnel's Leads / Jobs / Invoiced / Paid. Runs as the caller,
--      so the same row rules apply; Paid is only filled for accounts that
--      can view finance.
--
-- Nothing here touches existing rows. Re-runnable.

-- 1-3. Columns ---------------------------------------------------------------
alter table public.th_leads
  add column if not exists ga_client_id text,
  add column if not exists landing_referrer text,
  add column if not exists job_id bigint;

alter table public.th_bookings
  add column if not exists ga_client_id text,
  add column if not exists landing_referrer text;

alter table public.jobs
  add column if not exists source text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term text,
  add column if not exists utm_content text,
  add column if not exists landing_referrer text;

create index if not exists th_leads_job_id_idx on public.th_leads (job_id) where job_id is not null;

-- A malformed value is dropped, never the lead: a lead is worth more than
-- its attribution. GA client IDs look like 1234567890.1234567890.
create or replace function public.th_clean_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ga_client_id is not null and new.ga_client_id !~ '^[0-9]{1,20}\.[0-9]{1,20}$' then
    new.ga_client_id := null;
  end if;
  if new.landing_referrer is not null then
    new.landing_referrer := lower(trim(new.landing_referrer));
    if new.landing_referrer !~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$' then
      new.landing_referrer := null;
    end if;
  end if;
  if tg_table_name = 'th_leads' and tg_op = 'INSERT' and new.job_id is not null
     and not coalesce(public.current_user_has_any_role(), false) then
    new.job_id := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.th_clean_attribution() from public, anon, authenticated;

drop trigger if exists th_clean_attribution on public.th_leads;
create trigger th_clean_attribution before insert or update on public.th_leads
  for each row execute function public.th_clean_attribution();
drop trigger if exists th_clean_attribution on public.th_bookings;
create trigger th_clean_attribution before insert or update on public.th_bookings
  for each row execute function public.th_clean_attribution();

-- The public booking form books through this function (direct inserts are
-- staff-only). Same as live, plus the two new fields.
create or replace function public.create_booking(p_booking jsonb)
returns table(booking_id bigint, manage_token uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_name text := nullif(trim(coalesce(p_booking->>'name', '')), '');
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
    left(nullif(trim(coalesce(p_booking->>'email', '')), ''), 200),
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
  returning id, cancel_token into v_id, v_token;

  return query select v_id, v_token;
end;
$function$;

-- 4. The daily copy of the website numbers -----------------------------------
create table if not exists public.ga_report_cache (
  tenant_id uuid not null default public.default_tenant_id_triple_h(),
  period text not null check (period in ('30d', '90d', '365d')),
  report jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (tenant_id, period)
);
alter table public.ga_report_cache enable row level security;
revoke all on table public.ga_report_cache from public, anon, authenticated;
grant select on table public.ga_report_cache to authenticated;
drop policy if exists "internal accounts can read the website report" on public.ga_report_cache;
create policy "internal accounts can read the website report" on public.ga_report_cache
  for select to authenticated
  using ((select public.current_user_has_any_role()) and tenant_id = (select public.current_tenant_id()));

-- 5. Paid invoice -> one Google Analytics sale --------------------------------
create table if not exists public.ga_conversions (
  invoice_id bigint primary key,
  tenant_id uuid,
  ga_client_id text not null,
  value numeric not null,
  currency text not null default 'USD',
  queued_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'expired')),
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text
);
alter table public.ga_conversions enable row level security;
revoke all on table public.ga_conversions from public, anon, authenticated;
grant select on table public.ga_conversions to authenticated;
drop policy if exists "internal accounts can see sales sent to Google Analytics" on public.ga_conversions;
create policy "internal accounts can see sales sent to Google Analytics" on public.ga_conversions
  for select to authenticated
  using ((select public.current_user_has_any_role()) and tenant_id = (select public.current_tenant_id()));

-- The newest GA visit ID on a booking or lead that became this job.
create or replace function public.ga_client_id_for_job(p_job_id bigint, p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.ga_client_id from (
    select b.ga_client_id, b.created_at from public.th_bookings b
      where b.job_id = p_job_id and b.ga_client_id is not null and b.tenant_id is not distinct from p_tenant
    union all
    select l.ga_client_id, l.created_at from public.th_leads l
      where l.job_id = p_job_id and l.ga_client_id is not null and l.tenant_id is not distinct from p_tenant
  ) s
  order by s.created_at desc
  limit 1;
$$;
revoke execute on function public.ga_client_id_for_job(bigint, uuid) from public, anon, authenticated;

create or replace function public.ga_queue_paid_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cid text;
  v_value numeric;
  v_key text;
  v_queued integer;
begin
  if not coalesce(new.paid, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.paid, false) then return new; end if;
  if new.job_id is null then return new; end if;
  begin
    v_cid := public.ga_client_id_for_job(new.job_id, new.tenant_id);
    if v_cid is null then return new; end if;
    v_value := round(greatest(
      coalesce(new.paid_amount, case when new.paid then new.total else 0 end, 0) - coalesce(new.refunded_amount, 0),
      0), 2);
    insert into public.ga_conversions (invoice_id, tenant_id, ga_client_id, value)
      values (new.id, new.tenant_id, v_cid, v_value)
      on conflict (invoice_id) do nothing;
    get diagnostics v_queued = row_count;
    if v_queued = 0 then return new; end if;
    select decrypted_secret into v_key from vault.decrypted_secrets
      where name = 'send_push_service_role_key' limit 1;
    if v_key is null then
      raise warning 'ga_queue_paid_invoice: no service key in Vault; invoice % stays pending for the daily retry', new.id;
      return new;
    end if;
    perform net.http_post(
      url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/ga4-conversion',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('invoice_id', new.id),
      timeout_milliseconds := 15000
    );
  exception when others then
    raise warning 'ga_queue_paid_invoice: % (invoice %)', sqlerrm, new.id;
  end;
  return new;
end;
$$;
revoke execute on function public.ga_queue_paid_invoice() from public, anon, authenticated;

drop trigger if exists ga_queue_paid_invoice on public.invoices;
create trigger ga_queue_paid_invoice after insert or update of paid on public.invoices
  for each row execute function public.ga_queue_paid_invoice();

-- 6. Insights: source -> paid ------------------------------------------------
-- One label per lead / booking / job. Order matters: a referral is a
-- referral even if it arrived through a tagged link; a tagged Google
-- Business Profile link (utm_campaign=gbp and friends) beats the plain
-- campaign rule; the customer's own "How did you hear about us?" answer is
-- the fallback when there's no link data at all.
create or replace function public.insights_channel(
  p_source text, p_utm_source text, p_utm_medium text, p_utm_campaign text,
  p_referred_by text, p_referrer text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(p_referred_by, '')), '') is not null or coalesce(p_source, '') ilike 'referral%' then 'Referral'
    when lower(coalesce(p_utm_source, '')) in ('gbp', 'gmb', 'google_business', 'googlebusiness', 'google-business')
      or lower(coalesce(p_utm_medium, '')) in ('gbp', 'gmb', 'google_business')
      or lower(coalesce(p_utm_campaign, '')) in ('gbp', 'gmb', 'google_business', 'google_business_profile') then 'Google Business'
    when nullif(trim(coalesce(p_utm_campaign, '')), '') is not null then left(trim(p_utm_campaign), 60)
    when lower(coalesce(p_utm_source, '')) = 'google' and lower(coalesce(p_utm_medium, '')) in ('cpc', 'ppc', 'paid', 'paid_search') then 'Google Ads'
    when nullif(trim(coalesce(p_utm_source, '')), '') is not null then left(trim(p_utm_source), 60)
    when p_source = 'Google Search' or coalesce(p_referrer, '') ~ '(^|\.)google\.[a-z.]+$' then 'Google search'
    when p_source = 'Social Media' or coalesce(p_referrer, '') ~ '(^|\.)(facebook|instagram|nextdoor|tiktok|twitter|x|linkedin|youtube|pinterest)\.com$' or p_referrer = 't.co' then 'Social'
    when coalesce(p_referrer, '') ~ '(^|\.)(bing|duckduckgo|yahoo|ecosia)\.com$' then 'Other search'
    when nullif(trim(coalesce(p_source, '')), '') is not null then left(trim(p_source), 60)
    else 'Not known'
  end;
$$;

create or replace function public.insights_source_funnel(p_since timestamptz)
returns table (channel text, leads integer, jobs integer, invoiced integer, paid numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with
  can_money as (
    select coalesce((select ar.can_view_finance from public.account_roles ar
                     where ar.email = (select auth.jwt() ->> 'email')), false) as ok
  ),
  lead_rows as (
    select public.insights_channel(l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.referred_by, l.landing_referrer) as ch
      from public.th_leads l where l.created_at >= p_since
    union all
    select public.insights_channel(b.source, b.utm_source, b.utm_medium, b.utm_campaign, b.referred_by, b.landing_referrer)
      from public.th_bookings b where b.created_at >= p_since and coalesce(b.status, '') <> 'cancelled'
  ),
  job_attr as (
    select j.id, j.created_at,
      case
        when coalesce(j.source, j.utm_source, j.utm_campaign, j.landing_referrer, j.referred_by) is not null
          then public.insights_channel(j.source, j.utm_source, j.utm_medium, j.utm_campaign, j.referred_by, j.landing_referrer)
        else coalesce(
          (select public.insights_channel(b.source, b.utm_source, b.utm_medium, b.utm_campaign, b.referred_by, b.landing_referrer)
             from public.th_bookings b where b.job_id = j.id order by b.created_at desc limit 1),
          (select public.insights_channel(l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.referred_by, l.landing_referrer)
             from public.th_leads l where l.job_id = j.id order by l.created_at desc limit 1),
          'Not known')
      end as ch
    from public.jobs j
  ),
  inv_rows as (
    select coalesce(ja.ch, 'Not known') as ch,
      greatest(coalesce(i.paid_amount, case when i.paid then i.total else 0 end, 0) - coalesce(i.refunded_amount, 0), 0) as received
    from public.invoices i
    left join job_attr ja on ja.id = i.job_id
    where i.created_at >= p_since
  ),
  chans as (
    select ch from lead_rows
    union select ch from job_attr where created_at >= p_since
    union select ch from inv_rows
  )
  select c.ch,
    (select count(*) from lead_rows lr where lr.ch = c.ch)::integer,
    (select count(*) from job_attr ja where ja.ch = c.ch and ja.created_at >= p_since)::integer,
    (select count(*) from inv_rows ir where ir.ch = c.ch)::integer,
    case when (select ok from can_money) then (select round(coalesce(sum(ir.received), 0), 2) from inv_rows ir where ir.ch = c.ch) end
  from chans c
  order by (c.ch = 'Not known'), 2 desc, 1;
$$;
revoke execute on function public.insights_source_funnel(timestamptz) from public, anon;
grant execute on function public.insights_source_funnel(timestamptz) to authenticated;
