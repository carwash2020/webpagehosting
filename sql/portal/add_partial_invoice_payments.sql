-- Partial payments for larger jobs (2026-09-17). The internal side
-- (tools/workspace.html, th_invoices, the relational `invoices` mirror)
-- already supports a paidAmount/paid_amount pair -- see
-- tools/sync.js's deriveInvoicePaid() and workspace.html's
-- getPaidAmount()/invoicePaymentStatus(). client_portal_invoices never
-- got the equivalent column, because until now every portal payment
-- was all-or-nothing. Unlike th_invoices (a JSON blob that predates
-- paidAmount and needs null-fallback handling for legacy rows), every
-- row in this table is written exclusively by edge functions this
-- project controls -- NOT NULL DEFAULT 0 is safe and simpler here, no
-- backfill step needed.
--
-- Staged, not applied -- per this session's governance, schema
-- migrations against the live project need a human decision, not an
-- automatic apply_migration call. Run this via the Supabase dashboard
-- or MCP tools once reviewed.
alter table client_portal_invoices
  add column paid_amount numeric not null default 0;

-- Backfill, not optional: without this, every ALREADY-paid invoice
-- (paid = true) would read paid_amount = 0 the moment this column
-- exists, which is wrong data, not just an unpopulated field -- any
-- UI or report trusting paid_amount over the paid boolean (the
-- portal's payment-progress ring, for one) would show a fully-paid
-- invoice as if nothing had been paid on it until something else
-- happened to rewrite that row. New rows going forward are written
-- correctly by the updated edge functions; this one-time UPDATE
-- catches everything that predates them.
update client_portal_invoices set paid_amount = total where paid = true;

-- Per-payment ledger -- the real fix for the increment/idempotency
-- risk this feature introduces. stripe-webhook can no longer treat
-- "mark paid" as an idempotent SET (see that function's own updated
-- header comment) -- it has to INCREMENT paid_amount by the actual
-- charged amount, and Stripe redelivers events by design. This table
-- makes "has this exact (invoice, PaymentIntent) pair already been
-- applied" a real, atomic, unique-constrained question the database
-- answers -- the same claim-before-act pattern already proven for POS
-- charges in stripe_pos_charges_logged (see stripe-webhook-index.ts's
-- own pos_charge branch), reused here rather than reinvented.
-- amount_cents is the authoritative Stripe-confirmed amount (never a
-- client-supplied figure) attributed to this one invoice: pi.amount
-- for a single-invoice PaymentIntent, or that invoice's own total for
-- a bulk PaymentIntent (which still only ever pays every covered
-- invoice IN FULL -- see create-bulk-payment-intent's own comments).
create table client_portal_invoice_payments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references client_portal_invoices(id),
  stripe_payment_intent_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (invoice_id, stripe_payment_intent_id)
);

-- No authenticated/anon policies at all -- same as stripe_customers
-- and stripe_pos_charges_logged. This is an internal reconciliation
-- ledger, never read by the client's own session; only edge functions
-- using the service role key ever touch it. RLS is enabled purely so
-- it isn't accidentally left open by a future default-policy change.
alter table client_portal_invoice_payments enable row level security;
