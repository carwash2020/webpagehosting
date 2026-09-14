-- Stripe POS double-log race fix, closing a real audit gap: the
-- 'new_card' POS charge path in stripe-webhook-index.ts logged income
-- by reading the workspace_sync blob, scanning th_income_log in JS for
-- an entry with a matching stripePaymentIntentId, and only appending a
-- new entry if none was found -- a plain check-then-act with no atomic
-- guarantee behind it. Two near-simultaneous webhook deliveries for the
-- same payment_intent.succeeded event (Stripe does redeliver, and can
-- rarely double-deliver close together) could both pass that check
-- before either write landed, producing two income-log entries and two
-- duplicate receipt emails for one real charge.
--
-- The regular invoice-paid path in the same file is already idempotency-
-- safe (it re-reads client_portal_invoices' own `paid` column and
-- filters to unpaid rows before writing), but income logged into the
-- workspace_sync JSON blob has no equivalent database-level uniqueness
-- to lean on -- a JSON array has no unique constraint. This table gives
-- it one: a real Postgres unique constraint (the primary key) is the
-- only thing that can atomically decide "am I the first request to see
-- this payment_intent_id" when two requests race, the same reasoning
-- already applied to notification_log's own (notif_type, item_key)
-- unique constraint for the exact same class of problem.
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact so the schema is reproducible from this repo, same
-- convention as every other file in this directory.
create table stripe_pos_charges_logged (
  payment_intent_id text primary key,
  logged_at timestamptz not null default now()
);

alter table stripe_pos_charges_logged enable row level security;

-- Internal-only: this is operational idempotency bookkeeping, not
-- anything a client or the public needs to read. No insert/update/
-- delete policy for the authenticated role at all -- the only writer is
-- stripe-webhook-index.ts, using the service role key server-side.
create policy "internal accounts can view pos charge idempotency records"
  on stripe_pos_charges_logged for select
  to authenticated
  using (exists (select 1 from account_roles where email = (select auth.email())));
