-- Guest self-service booking cancellation, requested directly.
-- Run 2026-08-25.

-- A random, unguessable token generated server-side at insert time --
-- never client-settable, since a client-supplied value couldn't be
-- trusted as actually unguessable. Included in the guest's own
-- confirmation email only; never displayed anywhere else, never
-- returned by any endpoint except the two functions below, which
-- themselves only ever return it back to the same caller who already
-- has it (never enumerate or leak another booking's token).
alter table public.th_bookings add column cancel_token uuid not null default gen_random_uuid();
create unique index th_bookings_cancel_token_idx on public.th_bookings (cancel_token);

-- Read-only lookup by token, for the manage-booking page to show
-- "here's what you're about to cancel" before the guest confirms.
-- SECURITY DEFINER so it can read th_bookings despite anon having no
-- SELECT policy on the base table at all -- deliberately returns only
-- the fields needed to display a confirmation (never phone/email/
-- address/notes), and returns nothing at all for an unknown token
-- rather than distinguishing "wrong token" from "no such booking",
-- so a token can't be used to probe for the existence of others.
create or replace function public.get_booking_by_cancel_token(p_token uuid)
returns table (service_label text, start_at timestamptz, end_at timestamptz, name text, status text)
language sql
security definer
set search_path = public
stable
as $$
  select b.service_label, b.start_at, b.end_at, b.name, b.status
  from public.th_bookings b
  where b.cancel_token = p_token;
$$;

grant execute on function public.get_booking_by_cancel_token(uuid) to anon, authenticated;

-- The actual cancellation. Only ever transitions confirmed -> cancelled
-- for the exact matching token -- an already-cancelled booking, or a
-- token that doesn't match anything, both no-op rather than error, so
-- the page can show a clear "already cancelled" or "not found" state
-- without the RPC call itself failing.
create or replace function public.cancel_booking_by_token(p_token uuid)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found_status text;
begin
  select status into v_found_status from public.th_bookings where cancel_token = p_token;

  if v_found_status is null then
    return query select false, 'not-found'::text;
    return;
  end if;

  if v_found_status = 'cancelled' then
    return query select false, 'already-cancelled'::text;
    return;
  end if;

  update public.th_bookings set status = 'cancelled' where cancel_token = p_token and status = 'confirmed';
  return query select true, 'cancelled'::text;
end;
$$;

grant execute on function public.cancel_booking_by_token(uuid) to anon, authenticated;

-- Staff notification when a booking is actually cancelled (by anyone --
-- guest self-service via the function above, or any future staff-side
-- cancel action), requested as part of a complete cancel flow. Only
-- fires on a genuine confirmed -> cancelled transition, not on every
-- update to the row.
create or replace function public.notify_booking_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
begin
  if not (OLD.status = 'confirmed' and NEW.status = 'cancelled') then
    return NEW;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_booking_cancelled: send_push_service_role_key not found in Vault; push notification not sent for booking id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'th_bookings',
      'record', row_to_json(NEW),
      'old_record', row_to_json(OLD)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

drop trigger if exists on_booking_cancelled on public.th_bookings;
create trigger on_booking_cancelled
  after update on public.th_bookings
  for each row
  execute function public.notify_booking_cancelled();
