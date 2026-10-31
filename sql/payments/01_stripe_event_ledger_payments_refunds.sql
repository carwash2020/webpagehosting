-- Stripe hardening (2026-10-31): webhook event ledger, payments, refunds,
-- disputes, and a net-paid view. Follows the read-only Stripe audit of
-- 2026-10-30 (see docs/stripe-hardening-2026-10-31/README.md).
--
-- WHY
--   * stripe-webhook handled only payment_intent.succeeded. A refund or a
--     dispute in Stripe never reached the invoices, and a failed payment
--     left no trace.
--   * There was no record of which events arrived and no dedupe by
--     event.id. Replay safety depended on each invoice's `paid` flag.
--   * One stripe_payment_intent_id column on client_portal_invoices can't
--     record more than one attempt, a partial refund, or a dispute.
--
-- WHAT (additive only: new tables, new nullable or defaulted columns, new
-- indexes, new functions, a new view. Nothing is dropped, renamed or
-- retyped, and no existing row's existing columns change.)
--   stripe_events        one row per Stripe event id (the ledger).
--   payments             one row per PaymentIntent.
--   payment_allocations  which invoice(s) a PaymentIntent paid, and how
--                        much each (a Pay All Outstanding PI covers many).
--   refunds              one row per Stripe refund.
--   payment_disputes     one row per Stripe dispute.
--   invoice_payment_status (view)  net paid per public.invoices row.
--   client_portal_invoices / invoices gain refunded_amount and
--   refund_status, so the portal can show "Refunded" without a join.
--   stripe_customers / card_authorizations gain client_id (FK to clients),
--   filled by email; card_authorizations also gains stripe_payment_method_id.
--   stripe_record_event(event, refunds)  the one entry point the webhook
--   calls. It writes the ledger row and applies the event in ONE
--   transaction, so the invoice tables can't drift from each other.
--
-- REFUNDS DO NOT UN-PAY AN INVOICE (deliberate). `paid` and `paid_amount`
-- stay as they were. send-payment-reminder emails a client whenever
-- paid_amount < total, so un-paying a refunded invoice would start emailing
-- the client to pay it again. A refund instead sets refunded_amount and
-- refund_status ('partial' | 'full'), the portal shows it, and
-- invoice_payment_status reports the true net. Re-opening a refunded
-- invoice for a new payment stays a deliberate staff action
-- (set-invoice-paid -> Mark unpaid).
--
-- SECURITY
--   RLS is enabled on every new table. Only internal accounts in the same
--   tenant can SELECT (current_user_has_any_role(), which also enforces
--   internal MFA). Nothing can be written through the API except by the
--   service role, which bypasses RLS. INSERT/UPDATE/DELETE are revoked from
--   anon and authenticated as well, so a future permissive policy can't
--   open them by accident. The stripe_* functions are revoked from
--   PUBLIC/anon/authenticated; only service_role may execute
--   stripe_record_event. The view is security_invoker, so it never shows
--   more than the caller's own table policies allow.
--
-- RE-RUNNABLE: every statement is guarded (if not exists / create or
-- replace / existence checks), and the backfill only fills rows that are
-- still empty. Running the whole file twice is a no-op the second time.
--
-- DEPLOY ORDER: apply this file BEFORE deploying the updated
-- stripe-webhook. The new webhook calls stripe_record_event first and
-- returns 500 (so Stripe retries) if it doesn't exist yet.

-- ---------------------------------------------------------------------------
-- 1. Ledger
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  event_id text primary key check (event_id ~ '^evt_'),
  type text not null,
  livemode boolean not null,
  api_version text,
  stripe_created_at timestamptz,
  stripe_object_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  attempts integer not null default 1,
  processed_at timestamptz,
  outcome text check (outcome in ('processed', 'ignored')),
  result jsonb,
  error text,
  tenant_id uuid references public.tenants(id)
);
comment on table public.stripe_events is
  'Ledger of every verified Stripe webhook event, unique by event_id. processed_at null + error set = failed and will be retried by Stripe (the webhook returned 500).';
create index if not exists stripe_events_unprocessed_idx
  on public.stripe_events (received_at) where processed_at is null;
create index if not exists stripe_events_object_idx on public.stripe_events (stripe_object_id);

-- ---------------------------------------------------------------------------
-- 2. Payments, allocations, refunds, disputes
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  client_id uuid references public.clients(id) on delete set null,
  client_email text,
  kind text not null check (kind in ('invoice', 'pos', 'unknown')),
  stripe_payment_intent_id text not null unique check (stripe_payment_intent_id ~ '^pi_'),
  stripe_charge_id text unique,
  stripe_customer_id text,
  amount_cents bigint not null check (amount_cents >= 0),
  amount_received_cents bigint not null default 0 check (amount_received_cents >= 0),
  currency text not null default 'usd',
  status text not null check (status in ('requires_payment', 'processing', 'succeeded', 'failed', 'canceled')),
  -- null only for rows backfilled from before this ledger existed
  livemode boolean,
  last_error_code text,
  last_error_decline_code text,
  last_error_message text,
  failure_count integer not null default 0,
  receipt_url text,
  source text not null default 'webhook' check (source in ('webhook', 'backfill')),
  stripe_created_at timestamptz,
  -- Stripe event.created of the event that last set `status`. An older
  -- event delivered late never overwrites a newer status.
  status_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_client_id_idx on public.payments (client_id);
create index if not exists payments_client_email_idx on public.payments (lower(client_email));
create index if not exists payments_status_idx on public.payments (status);

create table if not exists public.payment_allocations (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id),
  payment_id uuid not null references public.payments(id) on delete cascade,
  client_portal_invoice_id bigint references public.client_portal_invoices(id) on delete set null,
  invoice_id bigint references public.invoices(id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  unique (payment_id, client_portal_invoice_id)
);
create index if not exists payment_allocations_invoice_id_idx on public.payment_allocations (invoice_id);
create index if not exists payment_allocations_cpi_idx on public.payment_allocations (client_portal_invoice_id);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  payment_id uuid not null references public.payments(id) on delete cascade,
  stripe_refund_id text not null unique check (stripe_refund_id ~ '^(re|pyr)_'),
  stripe_charge_id text,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null check (status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  reason text,
  stripe_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refunds_payment_id_idx on public.refunds (payment_id);

create table if not exists public.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  payment_id uuid not null references public.payments(id) on delete cascade,
  stripe_dispute_id text not null unique check (stripe_dispute_id ~ '^(dp|du)_'),
  stripe_charge_id text,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'usd',
  -- Stripe's own status string (warning_needs_response, needs_response,
  -- under_review, won, lost, ...). Not constrained: Stripe adds values.
  status text not null,
  reason text,
  evidence_due_by timestamptz,
  livemode boolean,
  stripe_created_at timestamptz,
  status_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_disputes_payment_id_idx on public.payment_disputes (payment_id);

-- ---------------------------------------------------------------------------
-- 3. Columns on existing tables (all nullable or defaulted)
-- ---------------------------------------------------------------------------
alter table public.client_portal_invoices
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists refund_status text not null default 'none';
alter table public.invoices
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists refund_status text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_portal_invoices_refund_status_check') then
    alter table public.client_portal_invoices add constraint client_portal_invoices_refund_status_check
      check (refund_status in ('none', 'partial', 'full'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_refund_status_check') then
    alter table public.invoices add constraint invoices_refund_status_check
      check (refund_status in ('none', 'partial', 'full'));
  end if;
end $$;

-- The webhook looks invoices up by PaymentIntent id; there was no index.
create index if not exists client_portal_invoices_pi_idx
  on public.client_portal_invoices (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

alter table public.stripe_customers
  add column if not exists client_id uuid references public.clients(id) on delete set null;
create unique index if not exists stripe_customers_client_id_key
  on public.stripe_customers (client_id) where client_id is not null;

alter table public.card_authorizations
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists stripe_payment_method_id text;
create index if not exists card_authorizations_client_id_idx on public.card_authorizations (client_id);

-- ---------------------------------------------------------------------------
-- 4. tenant_id on the new tables: same BEFORE INSERT trigger as the other
--    top-level tables (sql/multi-tenant/06 + 07). Sessionless service-role
--    writes fall back to Triple H.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stripe_events', 'payments', 'payment_allocations', 'refunds', 'payment_disputes'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_tenant_id' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_tenant_id before insert on public.%I for each row execute function public.set_tenant_id_from_session()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS: internal accounts in the same tenant may read; nobody but the
--    service role may write.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stripe_events', 'payments', 'payment_allocations', 'refunds', 'payment_disputes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'internal accounts can view ' || t) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.current_user_has_any_role() and tenant_id = public.current_tenant_id())',
        'internal accounts can view ' || t, t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Email -> client_id (backfill now, and fill on insert from here on)
-- ---------------------------------------------------------------------------
create or replace function public.stripe_client_id_for_email(p_email text, p_tenant uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
  where c.email_norm = nullif(lower(btrim(p_email)), '')
    and c.merged_into_id is null and not c.not_a_client
    and c.tenant_id = coalesce(p_tenant, public.default_tenant_id_triple_h())
  limit 1;
$$;

create or replace function public.stripe_fill_client_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if new.client_id is null and new.client_email is not null then
    v_client := public.stripe_client_id_for_email(new.client_email, new.tenant_id);
    -- stripe_customers.client_id is unique. Never let a second mapping for
    -- the same client make the insert fail: the edge functions ignore a
    -- failed mapping insert, so failing here would silently lose it.
    if v_client is not null and (tg_table_name <> 'stripe_customers'
        or not exists (select 1 from public.stripe_customers sc where sc.client_id = v_client)) then
      new.client_id := v_client;
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['stripe_customers', 'card_authorizations'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stripe_fill_client_id' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger stripe_fill_client_id before insert on public.%I for each row execute function public.stripe_fill_client_id()', t);
    end if;
  end loop;
end $$;

-- Backfill (idempotent: only rows whose client_id is still null; one
-- stripe_customers row per client, oldest first).
update public.stripe_customers sc set client_id = m.client_id
from (
  select distinct on (cid) sc_id, cid as client_id from (
    select sc2.id as sc_id, sc2.created_at, public.stripe_client_id_for_email(sc2.client_email, sc2.tenant_id) as cid
    from public.stripe_customers sc2 where sc2.client_id is null
  ) x
  where cid is not null and not exists (select 1 from public.stripe_customers y where y.client_id = x.cid)
  order by cid, created_at, sc_id
) m
where sc.id = m.sc_id and sc.client_id is null;

update public.card_authorizations ca
set client_id = public.stripe_client_id_for_email(ca.client_email, ca.tenant_id)
where ca.client_id is null and public.stripe_client_id_for_email(ca.client_email, ca.tenant_id) is not null;

-- ---------------------------------------------------------------------------
-- 7. Net paid
-- ---------------------------------------------------------------------------
-- Funds Stripe has taken back for a dispute: open (non-inquiry) disputes and
-- lost ones. Inquiries (warning_*) and won disputes don't move money.
create or replace function public.stripe_dispute_withdraws_funds(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('needs_response', 'under_review', 'lost');
$$;

-- Per allocation: how much of a payment's refunds/disputes falls on that
-- invoice. A single-invoice payment takes all of it. For a Pay All
-- Outstanding payment, a full refund takes each invoice's whole share and a
-- partial one is split pro rata (rounded to the cent).
create or replace view public.payment_allocation_net with (security_invoker = true) as
with p as (
  select pay.id, pay.amount_received_cents, pay.status,
    coalesce((select sum(r.amount_cents) from public.refunds r
              where r.payment_id = pay.id and r.status in ('pending', 'requires_action', 'succeeded')), 0) as refunded_cents,
    coalesce((select sum(d.amount_cents) from public.payment_disputes d
              where d.payment_id = pay.id and public.stripe_dispute_withdraws_funds(d.status)), 0) as disputed_cents,
    exists (select 1 from public.payment_disputes d where d.payment_id = pay.id
              and d.status not in ('won', 'lost', 'warning_closed', 'charge_refunded')) as dispute_open
  from public.payments pay
), a as (
  select al.*, sum(al.amount_cents) over (partition by al.payment_id) as alloc_total
  from public.payment_allocations al
)
select a.id as allocation_id, a.payment_id, a.client_portal_invoice_id, a.invoice_id, a.tenant_id,
  p.status as payment_status,
  case when p.status = 'succeeded' then a.amount_cents else 0 end as paid_cents,
  case when p.status <> 'succeeded' or p.refunded_cents = 0 then 0
       when p.refunded_cents >= p.amount_received_cents then a.amount_cents
       else least(a.amount_cents, round(p.refunded_cents::numeric * a.amount_cents / nullif(a.alloc_total, 0))::bigint) end as refunded_cents,
  case when p.status <> 'succeeded' or p.disputed_cents = 0 then 0
       when p.disputed_cents >= p.amount_received_cents then a.amount_cents
       else least(a.amount_cents, round(p.disputed_cents::numeric * a.amount_cents / nullif(a.alloc_total, 0))::bigint) end as disputed_cents,
  p.dispute_open
from a join p on p.id = a.payment_id;

-- One row per public.invoices row. Stripe-paid invoices use the ledger;
-- invoices with no succeeded Stripe payment fall back to paid_amount
-- (cash, check, or a hand-marked payment).
create or replace view public.invoice_payment_status with (security_invoker = true) as
with s as (
  select n.invoice_id,
    sum(n.paid_cents) as stripe_paid_cents,
    sum(n.refunded_cents) as refunded_cents,
    sum(n.disputed_cents) as disputed_cents,
    bool_or(n.dispute_open) as dispute_open
  from public.payment_allocation_net n where n.invoice_id is not null
  group by n.invoice_id
)
select i.id as invoice_id, i.tenant_id, i.client_id, i.invoice_number,
  round(coalesce(i.total, 0) * 100)::bigint as total_cents,
  coalesce(s.stripe_paid_cents, 0) as stripe_paid_cents,
  coalesce(s.refunded_cents, 0) as refunded_cents,
  coalesce(s.disputed_cents, 0) as disputed_cents,
  case when coalesce(s.stripe_paid_cents, 0) > 0 then 'stripe'
       when coalesce(i.paid_amount, 0) > 0 or i.paid then 'manual'
       else 'none' end as paid_via,
  case when coalesce(s.stripe_paid_cents, 0) > 0
         then s.stripe_paid_cents - s.refunded_cents - s.disputed_cents
       else round(coalesce(i.paid_amount, case when i.paid then i.total end, 0) * 100)::bigint end as net_paid_cents,
  case
    when coalesce(s.dispute_open, false) then 'disputed'
    when coalesce(s.stripe_paid_cents, 0) > 0 and s.refunded_cents > 0
         and s.stripe_paid_cents - s.refunded_cents - s.disputed_cents <= 0 then 'refunded'
    when coalesce(s.refunded_cents, 0) > 0 then 'partially_refunded'
    when (case when coalesce(s.stripe_paid_cents, 0) > 0 then s.stripe_paid_cents - s.disputed_cents
               else round(coalesce(i.paid_amount, case when i.paid then i.total end, 0) * 100) end)
         >= round(coalesce(i.total, 0) * 100) and round(coalesce(i.total, 0) * 100) > 0 then 'paid'
    when i.paid then 'paid'
    when coalesce(s.stripe_paid_cents, 0) > 0 or coalesce(i.paid_amount, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end as payment_status
from public.invoices i left join s on s.invoice_id = i.id;

revoke all on public.payment_allocation_net, public.invoice_payment_status from anon;
grant select on public.payment_allocation_net, public.invoice_payment_status to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Event processing (called only by stripe-webhook, as service_role)
-- ---------------------------------------------------------------------------
create or replace function public.stripe_ts(p_unix jsonb)
returns timestamptz language sql immutable as $$
  select case when jsonb_typeof(p_unix) = 'number' then to_timestamp((p_unix #>> '{}')::double precision) end;
$$;

-- Portal invoice rows a PaymentIntent belongs to: by the stored PI id first,
-- then by metadata (client_portal_invoice_id, or the CSV
-- client_portal_invoice_ids for Pay All Outstanding). Same order the old
-- webhook used. Non-numeric metadata parts are ignored, never cast.
create or replace function public.stripe_portal_invoice_ids_for_pi(p_pi_id text, p_metadata jsonb)
returns bigint[] language plpgsql stable set search_path = public as $$
declare v_ids bigint[];
begin
  select array_agg(id order by id) into v_ids from public.client_portal_invoices where stripe_payment_intent_id = p_pi_id;
  if v_ids is not null then return v_ids; end if;
  select array_agg(distinct part::bigint order by part::bigint) into v_ids
  from unnest(string_to_array(coalesce(p_metadata ->> 'client_portal_invoice_ids', p_metadata ->> 'client_portal_invoice_id', ''), ',')) as raw(part0),
       lateral (select btrim(part0) as part) t
  where part ~ '^[0-9]{1,18}$';
  if v_ids is null then return '{}'; end if;
  select array_agg(id order by id) into v_ids from public.client_portal_invoices where id = any(v_ids);
  return coalesce(v_ids, '{}');
end;
$$;

-- Insert or update the payments row for a PaymentIntent object, and link it
-- to its invoice(s). p_status is our status; a 'succeeded' row is never
-- moved to anything else, and an event older than the one that last set
-- the status doesn't overwrite it.
create or replace function public.stripe_upsert_payment(p_pi jsonb, p_status text, p_event_at timestamptz)
returns public.payments language plpgsql set search_path = public as $$
declare
  v_pay public.payments;
  v_meta jsonb := coalesce(p_pi -> 'metadata', '{}'::jsonb);
  v_pos boolean := (v_meta ->> 'pos_charge') = 'true';
  v_cpi bigint[];
  v_email text;
  v_tenant uuid;
  v_charge text := case when jsonb_typeof(p_pi -> 'latest_charge') = 'string' then p_pi ->> 'latest_charge'
                        when jsonb_typeof(p_pi -> 'latest_charge') = 'object' then p_pi -> 'latest_charge' ->> 'id' end;
  v_err jsonb := p_pi -> 'last_payment_error';
begin
  v_cpi := case when v_pos then '{}' else public.stripe_portal_invoice_ids_for_pi(p_pi ->> 'id', v_meta) end;
  select cpi.client_email, cpi.tenant_id into v_email, v_tenant
  from public.client_portal_invoices cpi where cpi.id = any(v_cpi) order by cpi.id limit 1;
  v_email := lower(coalesce(v_email, nullif(v_meta ->> 'pos_client_email', '')));

  insert into public.payments as p (tenant_id, client_id, client_email, kind, stripe_payment_intent_id, stripe_charge_id,
    stripe_customer_id, amount_cents, amount_received_cents, currency, status, livemode,
    last_error_code, last_error_decline_code, last_error_message, failure_count,
    stripe_created_at, status_event_at)
  values (v_tenant, public.stripe_client_id_for_email(v_email, v_tenant), v_email,
    case when v_pos then 'pos' when cardinality(v_cpi) > 0 then 'invoice' else 'unknown' end,
    p_pi ->> 'id', v_charge,
    case when jsonb_typeof(p_pi -> 'customer') = 'string' then p_pi ->> 'customer' end,
    coalesce((p_pi ->> 'amount')::bigint, 0), coalesce((p_pi ->> 'amount_received')::bigint, 0),
    coalesce(p_pi ->> 'currency', 'usd'), p_status, (p_pi ->> 'livemode')::boolean,
    v_err ->> 'code', v_err ->> 'decline_code', left(v_err ->> 'message', 500),
    case when p_status = 'failed' then 1 else 0 end,
    public.stripe_ts(p_pi -> 'created'), p_event_at)
  on conflict (stripe_payment_intent_id) do update set
    stripe_charge_id = coalesce(excluded.stripe_charge_id, p.stripe_charge_id),
    stripe_customer_id = coalesce(excluded.stripe_customer_id, p.stripe_customer_id),
    client_email = coalesce(p.client_email, excluded.client_email),
    client_id = coalesce(p.client_id, excluded.client_id),
    kind = case when p.kind = 'unknown' then excluded.kind else p.kind end,
    livemode = coalesce(excluded.livemode, p.livemode),
    amount_cents = case when p.status = 'succeeded' and excluded.status <> 'succeeded' then p.amount_cents else excluded.amount_cents end,
    amount_received_cents = greatest(p.amount_received_cents, excluded.amount_received_cents),
    status = case
      when p.status = 'succeeded' then 'succeeded'
      when excluded.status = 'succeeded' then 'succeeded'
      when p.status_event_at is not null and excluded.status_event_at < p.status_event_at then p.status
      else excluded.status end,
    status_event_at = case
      when p.status = 'succeeded' and excluded.status <> 'succeeded' then p.status_event_at
      when p.status_event_at is not null and excluded.status_event_at < p.status_event_at and excluded.status <> 'succeeded' then p.status_event_at
      else excluded.status_event_at end,
    last_error_code = case when excluded.status = 'failed' and p.status <> 'succeeded' then excluded.last_error_code else p.last_error_code end,
    last_error_decline_code = case when excluded.status = 'failed' and p.status <> 'succeeded' then excluded.last_error_decline_code else p.last_error_decline_code end,
    last_error_message = case when excluded.status = 'failed' and p.status <> 'succeeded' then excluded.last_error_message else p.last_error_message end,
    failure_count = p.failure_count + case when excluded.status = 'failed' then 1 else 0 end,
    source = 'webhook',
    updated_at = now()
  returning * into v_pay;

  -- Link to invoices. Each invoice is allocated its share of the
  -- PaymentIntent's amount (fixed when the PI was created): all of it for a
  -- single invoice, pro rata by invoice total for Pay All Outstanding, with
  -- the rounding remainder on the last one so the shares add up exactly.
  -- invoice_id only when the relational row exists, so a missing mirror row
  -- can never make the event fail forever.
  insert into public.payment_allocations (tenant_id, payment_id, client_portal_invoice_id, invoice_id, amount_cents)
  select x.tenant_id, v_pay.id, x.id, x.invoice_id,
    case when x.rn = x.n then v_pay.amount_cents - coalesce(x.before_last, 0) else x.share end
  from (
    select y.*, sum(y.share) over (order by y.id rows between unbounded preceding and 1 preceding) as before_last
    from (
      select cpi.id, cpi.tenant_id, (select i.id from public.invoices i where i.id = cpi.source_invoice_id) as invoice_id,
        row_number() over (order by cpi.id) as rn, count(*) over () as n,
        case when sum(cpi.total) over () > 0
             then floor(v_pay.amount_cents * cpi.total / sum(cpi.total) over ())::bigint else 0 end as share
      from public.client_portal_invoices cpi where cpi.id = any(v_cpi)
    ) y
  ) x
  on conflict (payment_id, client_portal_invoice_id) do nothing;

  return v_pay;
end;
$$;

-- Recompute refunded_amount / refund_status on the invoices a payment touches.
create or replace function public.stripe_refresh_invoice_refunds(p_payment_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare v_out jsonb := '[]'::jsonb; r record;
begin
  for r in
    select al.client_portal_invoice_id as cpi_id, al.invoice_id,
      (select coalesce(sum(n.refunded_cents), 0) from public.payment_allocation_net n where n.client_portal_invoice_id = al.client_portal_invoice_id) as cpi_ref,
      (select coalesce(sum(n.paid_cents), 0) from public.payment_allocation_net n where n.client_portal_invoice_id = al.client_portal_invoice_id) as cpi_paid,
      (select coalesce(sum(n.refunded_cents), 0) from public.payment_allocation_net n where n.invoice_id = al.invoice_id) as inv_ref,
      (select coalesce(sum(n.paid_cents), 0) from public.payment_allocation_net n where n.invoice_id = al.invoice_id) as inv_paid
    from public.payment_allocations al where al.payment_id = p_payment_id
  loop
    if r.cpi_id is not null then
      update public.client_portal_invoices set
        refunded_amount = r.cpi_ref / 100.0,
        refund_status = case when r.cpi_ref = 0 then 'none' when r.cpi_ref >= r.cpi_paid then 'full' else 'partial' end,
        updated_at = now()
      where id = r.cpi_id;
    end if;
    if r.invoice_id is not null then
      update public.invoices set
        refunded_amount = r.inv_ref / 100.0,
        refund_status = case when r.inv_ref = 0 then 'none' when r.inv_ref >= r.inv_paid then 'full' else 'partial' end,
        updated_at = now()
      where id = r.invoice_id;
    end if;
    v_out := v_out || jsonb_build_object('client_portal_invoice_id', r.cpi_id, 'invoice_id', r.invoice_id,
      'refunded_cents', r.cpi_ref, 'refund_status',
      case when r.cpi_ref = 0 then 'none' when r.cpi_ref >= r.cpi_paid then 'full' else 'partial' end);
  end loop;
  return v_out;
end;
$$;

-- A charge-level event (refund, dispute) for a PaymentIntent with no
-- payments row yet (a refund delivered before the success event, or a
-- payment from before the ledger): create the row from what the charge says.
create or replace function public.stripe_payment_for_charge(p_pi_id text, p_charge jsonb, p_event_at timestamptz)
returns public.payments language plpgsql set search_path = public as $$
declare v_pay public.payments;
begin
  select * into v_pay from public.payments where stripe_payment_intent_id = p_pi_id;
  if found then
    if v_pay.stripe_charge_id is null and p_charge ->> 'id' like 'ch\_%' then
      update public.payments set stripe_charge_id = p_charge ->> 'id', updated_at = now() where id = v_pay.id returning * into v_pay;
    end if;
    return v_pay;
  end if;
  return public.stripe_upsert_payment(jsonb_build_object(
    'id', p_pi_id,
    'latest_charge', case when p_charge ->> 'id' like 'ch\_%' then p_charge ->> 'id' end,
    'customer', p_charge -> 'customer',
    'amount', coalesce(p_charge -> 'amount', '0'::jsonb),
    'amount_received', coalesce(p_charge -> 'amount_captured', p_charge -> 'amount', '0'::jsonb),
    'currency', p_charge -> 'currency',
    'livemode', p_charge -> 'livemode',
    'created', p_charge -> 'created',
    'metadata', coalesce(p_charge -> 'metadata', '{}'::jsonb)),
    case when coalesce((p_charge ->> 'paid')::boolean, true) then 'succeeded' else 'failed' end, p_event_at);
end;
$$;

create or replace function public.stripe_upsert_refund(p_pay public.payments, p_refund jsonb)
returns void language plpgsql set search_path = public as $$
begin
  if coalesce(p_refund ->> 'id', '') !~ '^(re|pyr)_' then return; end if;
  insert into public.refunds as r (tenant_id, payment_id, stripe_refund_id, stripe_charge_id, amount_cents, currency, status, reason, stripe_created_at)
  values (p_pay.tenant_id, p_pay.id, p_refund ->> 'id',
    case when jsonb_typeof(p_refund -> 'charge') = 'string' then p_refund ->> 'charge' end,
    coalesce((p_refund ->> 'amount')::bigint, 0), coalesce(p_refund ->> 'currency', 'usd'),
    case when p_refund ->> 'status' in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then p_refund ->> 'status' else 'pending' end,
    p_refund ->> 'reason', public.stripe_ts(p_refund -> 'created'))
  on conflict (stripe_refund_id) do update set
    amount_cents = excluded.amount_cents,
    -- Refund status only moves forward: pending/requires_action ->
    -- succeeded/failed/canceled. A late "pending" never reopens it.
    status = case when r.status in ('succeeded', 'failed', 'canceled') and excluded.status in ('pending', 'requires_action')
                  then r.status else excluded.status end,
    reason = coalesce(excluded.reason, r.reason),
    updated_at = now();
end;
$$;

create or replace function public.stripe_apply_pi_succeeded(p_pi jsonb, p_event_at timestamptz)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_pay public.payments;
  v_meta jsonb := coalesce(p_pi -> 'metadata', '{}'::jsonb);
  v_unpaid bigint[];
  v_all bigint[];
  v_owed bigint;
  v_received bigint := coalesce((p_pi ->> 'amount_received')::bigint, -1);
  v_pos_first boolean;
  v_marked jsonb;
  v_rows jsonb;
begin
  v_pay := public.stripe_upsert_payment(p_pi, 'succeeded', p_event_at);

  if (v_meta ->> 'pos_charge') = 'true' then
    -- Same atomic claim the webhook used before (stripe_pos_charges_logged
    -- PK). create-pos-charge's charge_saved path now claims it too, so
    -- whichever of the two gets there first logs the income and receipt.
    insert into public.stripe_pos_charges_logged (payment_intent_id) values (p_pi ->> 'id')
    on conflict (payment_intent_id) do nothing;
    get diagnostics v_pos_first = row_count;
    return jsonb_build_object('action', 'pos_charge', 'pos_first', v_pos_first, 'payment_id', v_pay.id);
  end if;

  v_all := public.stripe_portal_invoice_ids_for_pi(p_pi ->> 'id', v_meta);
  if cardinality(v_all) = 0 then
    return jsonb_build_object('action', 'invoice_payment', 'warning', 'no matching invoice', 'payment_id', v_pay.id);
  end if;

  -- Row locks first, so two different events for the same invoices (say a
  -- retried PaymentIntent) can't both see them unpaid.
  perform 1 from public.client_portal_invoices where id = any(v_all) order by id for update;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'invoice_number', invoice_number, 'client_email', client_email,
           'source_invoice_id', source_invoice_id, 'total', total) order by id), '[]'::jsonb),
         array_agg(id order by id)
  into v_rows, v_unpaid
  from public.client_portal_invoices where id = any(v_all) and not paid;

  if v_unpaid is null then
    return jsonb_build_object('action', 'invoice_payment', 'already_processed', true, 'payment_id', v_pay.id, 'invoices_marked_paid', '[]'::jsonb);
  end if;

  -- Amount check (security audit 2026-09-23, finding #7), unchanged:
  -- short -> leave unpaid and alert; over -> mark paid and alert.
  select round(sum(total) * 100)::bigint into v_owed from public.client_portal_invoices where id = any(v_unpaid);
  if not (v_received > v_owed) and v_received <> v_owed then
    return jsonb_build_object('action', 'invoice_payment', 'payment_id', v_pay.id,
      'amount_mismatch', 'underpaid', 'received_cents', v_received, 'owed_cents', v_owed, 'invoices', v_rows,
      'invoices_marked_paid', '[]'::jsonb);
  end if;

  update public.client_portal_invoices set paid = true, paid_at = now(), updated_at = now() where id = any(v_unpaid);

  -- The relational copy, in the same transaction (it used to be a separate,
  -- best-effort PATCH that could fail after the portal write succeeded).
  update public.invoices i set paid = true, paid_amount = coalesce(cpi.total, 0), updated_at = now()
  from public.client_portal_invoices cpi
  where cpi.id = any(v_unpaid) and i.id = cpi.source_invoice_id;

  v_marked := v_rows;
  return jsonb_build_object('action', 'invoice_payment', 'payment_id', v_pay.id,
    'amount_mismatch', case when v_received > v_owed then 'overpaid' end,
    'received_cents', v_received, 'owed_cents', v_owed,
    'invoices', v_rows, 'invoices_marked_paid', v_marked);
end;
$$;

-- The one entry point. p_refunds: the charge's refund list, fetched by the
-- webhook for charge.refunded (API 2024-06-20 doesn't embed it).
create or replace function public.stripe_record_event(p_event jsonb, p_refunds jsonb default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_id text := p_event ->> 'id';
  v_type text := p_event ->> 'type';
  v_obj jsonb := p_event -> 'data' -> 'object';
  v_at timestamptz := public.stripe_ts(p_event -> 'created');
  v_existing public.stripe_events;
  v_result jsonb;
  v_pay public.payments;
  v_pi_id text;
  v_refund jsonb;
  v_msg text;
  v_outcome text := 'processed';
begin
  if v_id is null or v_id !~ '^evt_' or v_type is null or jsonb_typeof(v_obj) <> 'object' then
    raise exception 'stripe_record_event: malformed event';
  end if;

  insert into public.stripe_events (event_id, type, livemode, api_version, stripe_created_at, stripe_object_id, payload)
  values (v_id, v_type, coalesce((p_event ->> 'livemode')::boolean, false), p_event ->> 'api_version', v_at, v_obj ->> 'id', p_event)
  on conflict (event_id) do nothing;
  if not found then
    select * into v_existing from public.stripe_events where event_id = v_id for update;
    if v_existing.processed_at is not null then
      return jsonb_build_object('event_id', v_id, 'type', v_type, 'duplicate', true);
    end if;
    update public.stripe_events set attempts = attempts + 1 where event_id = v_id;
  end if;

  begin
    if v_type = 'payment_intent.succeeded' then
      v_result := public.stripe_apply_pi_succeeded(v_obj, v_at);

    elsif v_type in ('payment_intent.payment_failed', 'payment_intent.canceled', 'payment_intent.processing') then
      v_pay := public.stripe_upsert_payment(v_obj,
        case v_type when 'payment_intent.payment_failed' then 'failed'
                    when 'payment_intent.canceled' then 'canceled' else 'processing' end, v_at);
      v_result := jsonb_build_object('action', 'payment_status', 'payment_id', v_pay.id, 'status', v_pay.status,
        'decline_code', v_pay.last_error_decline_code);

    elsif v_type = 'charge.refunded' then
      v_pi_id := v_obj ->> 'payment_intent';
      if v_pi_id is null then
        v_result := jsonb_build_object('action', 'refund', 'warning', 'charge has no payment_intent');
      else
        v_pay := public.stripe_payment_for_charge(v_pi_id, v_obj, v_at);
        update public.payments set receipt_url = coalesce(v_obj ->> 'receipt_url', receipt_url), updated_at = now() where id = v_pay.id;
        for v_refund in select * from jsonb_array_elements(coalesce(p_refunds, v_obj -> 'refunds' -> 'data', '[]'::jsonb)) loop
          perform public.stripe_upsert_refund(v_pay, v_refund);
        end loop;
        -- The charge's own cumulative total is the authority. If the refund
        -- list didn't reach it (not supplied, or truncated), fail so Stripe
        -- retries rather than recording less than was refunded.
        if coalesce((v_obj ->> 'amount_refunded')::bigint, 0) >
           (select coalesce(sum(amount_cents), 0) from public.refunds where payment_id = v_pay.id and status in ('pending', 'requires_action', 'succeeded')) then
          raise exception 'charge.refunded: refund list for % is incomplete', v_obj ->> 'id';
        end if;
        v_result := jsonb_build_object('action', 'refund', 'payment_id', v_pay.id,
          'invoices', public.stripe_refresh_invoice_refunds(v_pay.id));
      end if;

    elsif v_type in ('charge.refund.updated', 'refund.created', 'refund.updated', 'refund.failed') then
      v_pi_id := v_obj ->> 'payment_intent';
      if v_pi_id is null then
        v_result := jsonb_build_object('action', 'refund', 'warning', 'refund has no payment_intent');
      else
        -- A Refund object doesn't carry the charge amount, so it can't
        -- create a payments row (a $0 stub would read as fully refunded).
        -- charge.refunded, which does, creates it; this one waits for that.
        select * into v_pay from public.payments where stripe_payment_intent_id = v_pi_id;
        if not found then
          v_result := jsonb_build_object('action', 'refund', 'warning', 'no payment on record for ' || v_pi_id);
          update public.stripe_events set processed_at = now(), outcome = 'processed', result = v_result, error = null where event_id = v_id;
          return v_result || jsonb_build_object('event_id', v_id, 'type', v_type, 'duplicate', false);
        end if;
        perform public.stripe_upsert_refund(v_pay, v_obj);
        v_result := jsonb_build_object('action', 'refund', 'payment_id', v_pay.id,
          'invoices', public.stripe_refresh_invoice_refunds(v_pay.id));
      end if;

    elsif v_type like 'charge.dispute.%' then
      v_pi_id := v_obj ->> 'payment_intent';
      if v_pi_id is null then
        select stripe_payment_intent_id into v_pi_id from public.payments where stripe_charge_id = v_obj ->> 'charge';
      end if;
      if v_pi_id is null then
        raise exception 'dispute %: no payment_intent and no known charge %', v_obj ->> 'id', v_obj ->> 'charge';
      end if;
      v_pay := public.stripe_payment_for_charge(v_pi_id,
        jsonb_build_object('id', v_obj -> 'charge', 'amount', v_obj -> 'amount', 'currency', v_obj -> 'currency',
                           'livemode', v_obj -> 'livemode', 'created', v_obj -> 'created'), v_at);
      insert into public.payment_disputes as d (tenant_id, payment_id, stripe_dispute_id, stripe_charge_id, amount_cents, currency,
        status, reason, evidence_due_by, livemode, stripe_created_at, status_event_at)
      values (v_pay.tenant_id, v_pay.id, v_obj ->> 'id',
        case when jsonb_typeof(v_obj -> 'charge') = 'string' then v_obj ->> 'charge' end,
        coalesce((v_obj ->> 'amount')::bigint, 0), coalesce(v_obj ->> 'currency', 'usd'),
        coalesce(v_obj ->> 'status', 'needs_response'), v_obj ->> 'reason',
        public.stripe_ts(v_obj -> 'evidence_details' -> 'due_by'), (v_obj ->> 'livemode')::boolean,
        public.stripe_ts(v_obj -> 'created'), v_at)
      on conflict (stripe_dispute_id) do update set
        status = case when d.status_event_at is not null and excluded.status_event_at < d.status_event_at then d.status else excluded.status end,
        status_event_at = greatest(d.status_event_at, excluded.status_event_at),
        amount_cents = excluded.amount_cents,
        evidence_due_by = coalesce(excluded.evidence_due_by, d.evidence_due_by),
        reason = coalesce(excluded.reason, d.reason),
        updated_at = now();
      v_result := (select jsonb_build_object('action', 'dispute', 'payment_id', v_pay.id, 'dispute_id', d.stripe_dispute_id,
          'status', d.status, 'amount_cents', d.amount_cents, 'reason', d.reason, 'evidence_due_by', d.evidence_due_by,
          'client_email', v_pay.client_email, 'first_seen', v_type = 'charge.dispute.created')
        from public.payment_disputes d where d.stripe_dispute_id = v_obj ->> 'id');

    else
      v_outcome := 'ignored';
      v_result := jsonb_build_object('action', 'ignored');
    end if;

    update public.stripe_events set processed_at = now(), outcome = v_outcome, result = v_result, error = null
    where event_id = v_id;
    return v_result || jsonb_build_object('event_id', v_id, 'type', v_type, 'duplicate', false);
  exception when others then
    -- Everything inside this block is rolled back; the ledger row (inserted
    -- above, outside it) stays with the error, and the webhook returns 500
    -- so Stripe retries the event.
    get stacked diagnostics v_msg = message_text;
    update public.stripe_events set error = left(v_msg, 1000) where event_id = v_id;
    return jsonb_build_object('event_id', v_id, 'type', v_type, 'error', v_msg);
  end;
end;
$$;

-- Lock the functions down: none is callable through the API except
-- stripe_record_event, and that one only by service_role.
do $$
declare f text;
begin
  foreach f in array array[
    'public.stripe_client_id_for_email(text, uuid)',
    'public.stripe_fill_client_id()',
    'public.stripe_portal_invoice_ids_for_pi(text, jsonb)',
    'public.stripe_upsert_payment(jsonb, text, timestamptz)',
    'public.stripe_refresh_invoice_refunds(uuid)',
    'public.stripe_payment_for_charge(text, jsonb, timestamptz)',
    'public.stripe_upsert_refund(public.payments, jsonb)',
    'public.stripe_apply_pi_succeeded(jsonb, timestamptz)',
    'public.stripe_record_event(jsonb, jsonb)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
-- service_role runs stripe_record_event as itself (security invoker), so it
-- needs the helpers too. Stated explicitly rather than relying on the
-- schema's default grants.
do $$
declare f text;
begin
  foreach f in array array[
    'public.stripe_client_id_for_email(text, uuid)',
    'public.stripe_portal_invoice_ids_for_pi(text, jsonb)',
    'public.stripe_upsert_payment(jsonb, text, timestamptz)',
    'public.stripe_refresh_invoice_refunds(uuid)',
    'public.stripe_payment_for_charge(text, jsonb, timestamptz)',
    'public.stripe_upsert_refund(public.payments, jsonb)',
    'public.stripe_apply_pi_succeeded(jsonb, timestamptz)',
    'public.stripe_record_event(jsonb, jsonb)'] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Backfill payments from invoices already paid by card (idempotent:
--    on conflict do nothing). Amount = the invoice totals the PI covered;
--    livemode unknown (null), source = 'backfill'.
-- ---------------------------------------------------------------------------
insert into public.payments (tenant_id, client_id, client_email, kind, stripe_payment_intent_id, amount_cents,
  amount_received_cents, status, livemode, source, created_at)
select min(cpi.tenant_id::text)::uuid, public.stripe_client_id_for_email(min(cpi.client_email), min(cpi.tenant_id::text)::uuid),
  lower(min(cpi.client_email)), 'invoice', cpi.stripe_payment_intent_id,
  round(sum(cpi.total) * 100)::bigint, round(sum(cpi.total) * 100)::bigint, 'succeeded', null, 'backfill',
  coalesce(min(cpi.paid_at), now())
from public.client_portal_invoices cpi
where cpi.paid and cpi.stripe_payment_intent_id ~ '^pi_'
group by cpi.stripe_payment_intent_id
on conflict (stripe_payment_intent_id) do nothing;

insert into public.payment_allocations (tenant_id, payment_id, client_portal_invoice_id, invoice_id, amount_cents)
select cpi.tenant_id, p.id, cpi.id, (select i.id from public.invoices i where i.id = cpi.source_invoice_id), round(cpi.total * 100)::bigint
from public.client_portal_invoices cpi
join public.payments p on p.stripe_payment_intent_id = cpi.stripe_payment_intent_id
where cpi.paid
on conflict (payment_id, client_portal_invoice_id) do nothing;
