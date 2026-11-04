-- Guest pay codes (2026-11-04, handoff §3A; Connor: pay "right from this
-- email -- no account needed"). NOT APPLIED -- Connor approves first.
--
-- WHY
--   The invoice email and PDF had no way to pay. A client with no portal
--   account could not pay online at all.
--
-- WHAT (additive only: one new nullable column, one unique index, one
-- check. Nothing is dropped, renamed or retyped; no existing row changes.)
--   client_portal_invoices.pay_token  the code at the end of
--     /pay/<invoice number>-<code>. Made in the browser by the invoice
--     generator (makePayToken: 10 characters from 31 letters and digits
--     without look-alikes, from crypto.getRandomValues) when an invoice is
--     sent, and stored by sync-invoice-to-portal. guest-pay looks the
--     invoice up by it, with the service role.
--   Unique, so one code can only ever open one invoice. Null for every
--   invoice sent before this, and for one that was only downloaded.
--   The check is the same shape guest-pay and sync-invoice-to-portal
--   accept, so nothing else can be stored.
--
-- WHO CAN READ IT
--   Unchanged: the existing client_portal_invoices policies. A client
--   reading their own invoice sees their own code (it is in their email
--   anyway); staff with invoice access see it; anon sees nothing. guest-pay
--   reads with the service role and returns only the invoice number,
--   date, what it was for, the amount, and "T. Perides" -- never the
--   email.
--
-- ORDER
--   1. Apply this file.
--   2. Deploy guest-pay (--no-verify-jwt), sync-invoice-to-portal and
--      send-invoice-notification.
--   3. Merge the branch (the /pay/ page and the invoice generator).
--   If 2 or 3 happen first nothing breaks: sync-invoice-to-portal sends the
--   invoice without a pay link when the column is missing.
--
-- UNDO
--   drop index if exists public.client_portal_invoices_pay_token_key;
--   alter table public.client_portal_invoices drop constraint if exists client_portal_invoices_pay_token_shape;
--   alter table public.client_portal_invoices drop column if exists pay_token;

alter table public.client_portal_invoices
  add column if not exists pay_token text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_portal_invoices_pay_token_shape'
      and conrelid = 'public.client_portal_invoices'::regclass
  ) then
    alter table public.client_portal_invoices
      add constraint client_portal_invoices_pay_token_shape
      check (pay_token is null or pay_token ~ '^[a-hjkmnp-z2-9]{10,40}$');
  end if;
end $$;

create unique index if not exists client_portal_invoices_pay_token_key
  on public.client_portal_invoices (pay_token)
  where pay_token is not null;
