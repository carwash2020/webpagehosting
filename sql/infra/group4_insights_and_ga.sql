-- Fix plan Group 4, RP2 (2026-11-07): Insights tells one story, and Google
-- Analytics hears about refunds. NOT APPLIED -- Connor approves first.
-- Builds on sql/infra/phase5_attribution_and_ga4.sql (whose versions of
-- insights_channel, insights_source_funnel and ga_queue_paid_invoice this
-- replaces).
--
-- WHY / WHAT
--   RP2.2 (D17) The funnel counted each step on its own, so 1 lead "became"
--         13 jobs. Now Jobs, Invoiced and Paid follow the leads and
--         bookings made in the period: the jobs they became (job_id), those
--         jobs' invoices, and the money received on them so far (RP2.13:
--         that is what Paid means; there is no payment date to filter on).
--   RP2.22 Someone who sent the lead form AND booked counts once: rows with
--         the same email (or, with no email, the same phone digits) are one
--         person, labelled by their first contact.
--   RP2.5 "Who referred you?" is free text, and people answer "Google". A
--         referral now needs a referral code, a "Referral..." answer to How
--         did you hear about us?, or a name that isn't a search or social
--         site. Same list as thChannelLabel in tools/data-layer.js.
--   RP2.11 (direct) -> "Direct" and google/organic -> "Google search", the
--         names the website card (ga4-report) uses, before the raw
--         utm_source rule.
--   RP2.7 A sale Google never accepted ("failed") is queued again when the
--         invoice is marked paid again.
--   RP2.8 A refund on an invoice already sent to Google queues a refund
--         event (ga4-conversion sends it); one not sent yet is sent at the
--         smaller amount, or not at all if nothing is left.
--   RP2.19 Nothing is sent for $0 (or less), or for a TEST client's invoice.
--
-- Signature change: insights_channel gains p_referred_by_code (default
-- null); the 6-argument version is dropped first so calls stay unambiguous.
-- Re-runnable.
--
-- UNDO: re-run the insights_channel, insights_source_funnel and
-- ga_queue_paid_invoice sections of phase5_attribution_and_ga4.sql (after
-- `drop function if exists public.insights_channel(text, text, text, text,
-- text, text, text);`). The new ga_conversions columns can stay.

-- 1. One label per lead / booking / job -----------------------------------------
drop function if exists public.insights_channel(text, text, text, text, text, text);
create or replace function public.insights_channel(
  p_source text, p_utm_source text, p_utm_medium text, p_utm_campaign text,
  p_referred_by text, p_referrer text, p_referred_by_code text default null)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(p_referred_by_code, '')), '') is not null
      or coalesce(p_source, '') ilike 'referral%'
      or (nullif(trim(coalesce(p_referred_by, '')), '') is not null
          and lower(regexp_replace(left(trim(p_referred_by), 60), '\s+', ' ', 'g'))
              !~ '^(google|yelp|facebook|fb|instagram|ig|nextdoor|tiktok|twitter|x|linkedin|youtube|pinterest|bing|yahoo|duckduckgo|ecosia|internet|online|web|website|search|social media)( (search|maps?|ads?|reviews?|business|page|search engine))?$')
      then 'Referral'
    when lower(coalesce(p_utm_source, '')) in ('gbp', 'gmb', 'google_business', 'googlebusiness', 'google-business', 'google_business_profile')
      or lower(coalesce(p_utm_medium, '')) in ('gbp', 'gmb', 'google_business')
      or lower(coalesce(p_utm_campaign, '')) in ('gbp', 'gmb', 'google_business', 'googlebusiness', 'google-business', 'google_business_profile') then 'Google Business'
    when nullif(trim(coalesce(p_utm_campaign, '')), '') is not null then left(trim(p_utm_campaign), 60)
    when lower(coalesce(p_utm_source, '')) = 'google' and lower(coalesce(p_utm_medium, '')) in ('cpc', 'ppc', 'paid', 'paid_search') then 'Google Ads'
    when lower(trim(coalesce(p_utm_source, ''))) = '(direct)' then 'Direct'
    when lower(trim(coalesce(p_utm_source, ''))) = 'google' and lower(trim(coalesce(p_utm_medium, ''))) = 'organic' then 'Google search'
    when nullif(trim(coalesce(p_utm_source, '')), '') is not null then left(trim(p_utm_source), 60)
    when p_source = 'Google Search' or coalesce(p_referrer, '') ~ '(^|\.)google\.[a-z.]+$' then 'Google search'
    when p_source = 'Social Media' or coalesce(p_referrer, '') ~ '(^|\.)(facebook|instagram|nextdoor|tiktok|twitter|x|linkedin|youtube|pinterest)\.com$' or p_referrer = 't.co' then 'Social'
    when coalesce(p_referrer, '') ~ '(^|\.)(bing|duckduckgo|yahoo|ecosia)\.com$' then 'Other search'
    when nullif(trim(coalesce(p_source, '')), '') is not null then left(trim(p_source), 60)
    else 'Not known'
  end;
$$;

-- 2. The nested funnel ------------------------------------------------------------
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
  contacts as (
    select l.created_at, 'lead-' || l.id as rid, l.job_id,
      lower(nullif(trim(l.email), '')) as em, nullif(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), '') as ph,
      public.insights_channel(l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.referred_by, l.landing_referrer, l.referred_by_code) as ch
      from public.th_leads l where l.created_at >= p_since
    union all
    select b.created_at, 'booking-' || b.id, b.job_id,
      lower(nullif(trim(b.email), '')), nullif(regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g'), ''),
      public.insights_channel(b.source, b.utm_source, b.utm_medium, b.utm_campaign, b.referred_by, b.landing_referrer, b.referred_by_code)
      from public.th_bookings b where b.created_at >= p_since and coalesce(b.status, '') <> 'cancelled'
  ),
  keyed as (
    select c.*, coalesce(c.em, c.ph, c.rid) as person from contacts c
  ),
  people as (
    select distinct on (k.person) k.person, k.ch from keyed k order by k.person, k.created_at, k.rid
  ),
  -- Each job once, under the person whose lead or booking first became it.
  cohort_jobs as (
    select distinct on (k.job_id) k.job_id, p.ch
      from keyed k
      join people p on p.person = k.person
      join public.jobs j on j.id = k.job_id
     where k.job_id is not null
     order by k.job_id, k.created_at, k.rid
  ),
  inv_rows as (
    select cj.ch,
      greatest(coalesce(i.paid_amount, case when i.paid then i.total else 0 end, 0) - coalesce(i.refunded_amount, 0), 0) as received
    from cohort_jobs cj join public.invoices i on i.job_id = cj.job_id
  )
  select p.ch,
    count(*)::integer,
    (select count(*) from cohort_jobs cj where cj.ch = p.ch)::integer,
    (select count(*) from inv_rows ir where ir.ch = p.ch)::integer,
    case when (select ok from can_money) then (select round(coalesce(sum(ir.received), 0), 2) from inv_rows ir where ir.ch = p.ch) end
  from people p
  group by p.ch
  order by (p.ch = 'Not known'), 2 desc, 1;
$$;
revoke execute on function public.insights_source_funnel(timestamptz) from public, anon;
grant execute on function public.insights_source_funnel(timestamptz) to authenticated;

-- 3. Google Analytics: refunds, retries, and nothing for $0 or TEST -------------
alter table public.ga_conversions add column if not exists refund_value numeric not null default 0;
alter table public.ga_conversions add column if not exists refund_sent_value numeric not null default 0;
alter table public.ga_conversions add column if not exists refund_status text;
alter table public.ga_conversions add column if not exists refund_attempts integer not null default 0;
alter table public.ga_conversions add column if not exists refund_sent_at timestamptz;
alter table public.ga_conversions add column if not exists refund_error text;
alter table public.ga_conversions drop constraint if exists ga_conversions_status_check;
alter table public.ga_conversions add constraint ga_conversions_status_check
  check (status in ('pending', 'sent', 'failed', 'expired', 'cancelled'));
alter table public.ga_conversions drop constraint if exists ga_conversions_refund_status_check;
alter table public.ga_conversions add constraint ga_conversions_refund_status_check
  check (refund_status is null or refund_status in ('pending', 'sent', 'failed', 'expired'));

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
  v_changed integer;
  v_body jsonb;
begin
  begin
    v_value := round(greatest(
      coalesce(new.paid_amount, case when new.paid then new.total else 0 end, 0) - coalesce(new.refunded_amount, 0),
      0), 2);

    -- RP2.8: money went back.
    if tg_op = 'UPDATE' and coalesce(new.refunded_amount, 0) > coalesce(old.refunded_amount, 0) then
      -- Not sent yet: send what was kept, or nothing.
      update public.ga_conversions
         set value = v_value,
             status = case when v_value <= 0 then 'cancelled' else status end,
             last_error = case when v_value <= 0 then 'refunded in full before it was sent' else last_error end
       where invoice_id = new.id and status in ('pending', 'failed');
      -- Already sent: tell Google about the refund.
      update public.ga_conversions
         set refund_value = least(round(coalesce(new.refunded_amount, 0), 2), value),
             refund_status = 'pending', refund_attempts = 0, refund_error = null
       where invoice_id = new.id and status = 'sent'
         and least(round(coalesce(new.refunded_amount, 0), 2), value) > refund_sent_value;
      get diagnostics v_changed = row_count;
      if v_changed > 0 then v_body := jsonb_build_object('invoice_id', new.id, 'refund', true); end if;
    end if;

    if v_body is null
       and coalesce(new.paid, false)
       and not (tg_op = 'UPDATE' and coalesce(old.paid, false))
       and new.job_id is not null
       and v_value > 0                                                                    -- RP2.19
       and upper(split_part(btrim(coalesce(new.client_name, '')), ' ', 1)) <> 'TEST' then -- RP2.19
      v_cid := public.ga_client_id_for_job(new.job_id, new.tenant_id);
      if v_cid is not null then
        insert into public.ga_conversions as g (invoice_id, tenant_id, ga_client_id, value)
          values (new.id, new.tenant_id, v_cid, v_value)
          on conflict (invoice_id) do update
            set status = 'pending', attempts = 0, last_error = null, value = excluded.value,
                ga_client_id = excluded.ga_client_id, queued_at = now()
            where g.status = 'failed';                                                     -- RP2.7
        get diagnostics v_changed = row_count;
        if v_changed > 0 then v_body := jsonb_build_object('invoice_id', new.id); end if;
      end if;
    end if;

    if v_body is null then return new; end if;
    select decrypted_secret into v_key from vault.decrypted_secrets
      where name = 'send_push_service_role_key' limit 1;
    if v_key is null then
      raise warning 'ga_queue_paid_invoice: no service key in Vault; invoice % stays pending for the daily retry', new.id;
      return new;
    end if;
    perform net.http_post(
      url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/ga4-conversion',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := v_body,
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
create trigger ga_queue_paid_invoice after insert or update of paid, refunded_amount on public.invoices
  for each row execute function public.ga_queue_paid_invoice();
