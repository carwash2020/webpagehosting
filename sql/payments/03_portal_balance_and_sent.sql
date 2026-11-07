-- Fix plan Group 4, RP1 (2026-11-07): part payments, "sent", whole cents.
-- NOT APPLIED -- Connor approves first.
--
-- WHY
--   RP1.3  A part-paid invoice showed the full total as owed in the portal,
--          and Pay charged the full total again: client_portal_invoices had
--          only a paid flag. (Live 2026-11-06: no part-paid invoice yet.)
--   RP1.8  (D24) Nothing recorded that an invoice was sent; "sent" was only
--          inferred from a portal row existing.
--   RP1.10 INV-2026-1000 is paid with no amount recorded; INV-2026-0905's
--          total is 125.0025 (a fraction of a cent from tax math).
--
-- WHAT
--   1. client_portal_invoices.paid_amount: what the client has paid so far.
--      Kept in step with public.invoices.paid_amount by a trigger (the
--      Workspace already records part payments there), filled when the
--      portal row is first made, and set to the total when Stripe marks it
--      paid. The pay functions charge total - paid_amount.
--   2. invoices.sent_at: when the invoice first reached the client's portal
--      (= was emailed). Set by the same insert trigger; backfilled from the
--      portal rows that exist.
--   3. stripe_apply_pi_succeeded / stripe_upsert_payment: "owed" and each
--      invoice's share of a payment use the balance, not the total.
--   4. Backfill of the new columns: portal paid_amount from the invoice
--      (or the total when the portal row is already paid), and sent_at from
--      the first portal row. No existing value changes.
--   RP1.10's edits to existing real amounts are in
--   03b_round_real_invoice_amounts.sql, approved on their own.
--
-- Nothing is dropped or renamed. Re-runnable.
--
-- UNDO
--   drop trigger if exists portal_invoice_follow_payment on public.invoices;
--   drop trigger if exists portal_invoice_on_send on public.client_portal_invoices;
--   drop function if exists public.portal_invoice_follow_payment();
--   drop function if exists public.portal_invoice_on_send();
--   re-run sql/payments/01_stripe_event_ledger_payments_refunds.sql sections
--   for stripe_upsert_payment and stripe_apply_pi_succeeded;
--   alter table public.client_portal_invoices drop column if exists paid_amount;
--   alter table public.invoices drop column if exists sent_at;
--   (the rounding and paid_amount backfill are not undone: they are the
--   correct values.)

alter table public.client_portal_invoices add column if not exists paid_amount numeric;
alter table public.invoices add column if not exists sent_at timestamptz;

-- 1. Portal copy follows the invoice's recorded payments.
create or replace function public.portal_invoice_follow_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.client_portal_invoices cpi
     set paid_amount = round(new.paid_amount, 2), updated_at = now()
   where cpi.source_invoice_id = new.id
     and (cpi.tenant_id is null or new.tenant_id is null or cpi.tenant_id = new.tenant_id)
     and cpi.paid_amount is distinct from round(new.paid_amount, 2);
  return new;
end;
$$;
revoke execute on function public.portal_invoice_follow_payment() from public, anon, authenticated;
drop trigger if exists portal_invoice_follow_payment on public.invoices;
create trigger portal_invoice_follow_payment after insert or update of paid_amount on public.invoices
  for each row execute function public.portal_invoice_follow_payment();

-- 2. A new portal row: start from what's already paid, and stamp the
--    invoice as sent (first time only).
create or replace function public.portal_invoice_on_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
begin
  select round(i.paid_amount, 2) into v_paid from public.invoices i
   where i.id = new.source_invoice_id
     and (i.tenant_id is null or new.tenant_id is null or i.tenant_id = new.tenant_id);
  if new.paid_amount is null then new.paid_amount := v_paid; end if;
  update public.invoices i set sent_at = now()
   where i.id = new.source_invoice_id and i.sent_at is null
     and (i.tenant_id is null or new.tenant_id is null or i.tenant_id = new.tenant_id);
  return new;
end;
$$;
revoke execute on function public.portal_invoice_on_send() from public, anon, authenticated;
drop trigger if exists portal_invoice_on_send on public.client_portal_invoices;
create trigger portal_invoice_on_send before insert on public.client_portal_invoices
  for each row execute function public.portal_invoice_on_send();

-- 3. Payments use the balance.
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
  -- single invoice, pro rata by what each still owed for Pay All Outstanding
  -- (fix plan RP1.3: total minus what was already paid; by total when
  -- nothing is recorded as owed), with the rounding remainder on the last
  -- one so the shares add up exactly.
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
        case when sum(z.weight) over () > 0
             then floor(v_pay.amount_cents * z.weight / sum(z.weight) over ())::bigint else 0 end as share
      from public.client_portal_invoices cpi
      cross join lateral (select case when (select sum(greatest(c2.total - coalesce(c2.paid_amount, 0), 0))
                                             from public.client_portal_invoices c2 where c2.id = any(v_cpi)) > 0
                                      then greatest(cpi.total - coalesce(cpi.paid_amount, 0), 0)
                                      else cpi.total end as weight) z
      where cpi.id = any(v_cpi)
    ) y
  ) x
  on conflict (payment_id, client_portal_invoice_id) do nothing;

  return v_pay;
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
           'source_invoice_id', source_invoice_id, 'total', total, 'paid_amount', paid_amount) order by id), '[]'::jsonb),
         array_agg(id order by id)
  into v_rows, v_unpaid
  from public.client_portal_invoices where id = any(v_all) and not paid;

  if v_unpaid is null then
    return jsonb_build_object('action', 'invoice_payment', 'already_processed', true, 'payment_id', v_pay.id, 'invoices_marked_paid', '[]'::jsonb);
  end if;

  -- Amount check (security audit 2026-09-23, finding #7): short -> leave
  -- unpaid and alert; over -> mark paid and alert. Owed is what is left
  -- after any part payment (fix plan RP1.3), the same balance the pay
  -- functions now charge.
  select round(sum(greatest(total - coalesce(paid_amount, 0), 0)) * 100)::bigint into v_owed
  from public.client_portal_invoices where id = any(v_unpaid);
  if not (v_received > v_owed) and v_received <> v_owed then
    return jsonb_build_object('action', 'invoice_payment', 'payment_id', v_pay.id,
      'amount_mismatch', 'underpaid', 'received_cents', v_received, 'owed_cents', v_owed, 'invoices', v_rows,
      'invoices_marked_paid', '[]'::jsonb);
  end if;

  update public.client_portal_invoices set paid = true, paid_at = now(), paid_amount = total, updated_at = now() where id = any(v_unpaid);

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

revoke execute on function public.stripe_upsert_payment(jsonb, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.stripe_apply_pi_succeeded(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.stripe_upsert_payment(jsonb, text, timestamptz) to service_role;
grant execute on function public.stripe_apply_pi_succeeded(jsonb, timestamptz) to service_role;

-- 4. Backfill of the two NEW columns only (no existing value changes).
--    The edits to existing real amounts (RP1.10) are in
--    03b_round_real_invoice_amounts.sql, approved separately.
update public.client_portal_invoices cpi set paid_amount = round(i.paid_amount, 2)
  from public.invoices i
 where i.id = cpi.source_invoice_id and i.paid_amount is not null and cpi.paid_amount is null;
update public.client_portal_invoices set paid_amount = total where paid and paid_amount is null;
update public.invoices i set sent_at = s.first_sent
  from (select source_invoice_id, min(created_at) as first_sent from public.client_portal_invoices group by source_invoice_id) s
 where s.source_invoice_id = i.id and i.sent_at is null;
