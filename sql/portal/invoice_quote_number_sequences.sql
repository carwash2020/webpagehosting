-- Collision-proof invoice and quote numbering (2026-09-02). Applied
-- directly via the Supabase MCP migration tool; recorded here after
-- the fact, same convention as every other file in sql/.
--
-- Requested directly: "I want this part to be future proof, Invoices
-- never collide, The complicated but Safe way."
--
-- Replaces `INV-<year>-<random 4 digits>` generated in the browser.
-- That old scheme had a real, compounding birthday-paradox collision
-- risk, and its only guard was a client-side warning that checked ONE
-- device's own localStorage -- so two devices, or the same device
-- before a sync, could not see each other's numbers at all.
-- checkDuplicateInvoiceNumber() could warn, but never prevent.
--
-- A Postgres SEQUENCE is the correct primitive and the reason this is
-- genuinely collision-proof rather than collision-unlikely:
-- nextval() is atomic and transactional even under concurrent callers
-- from different devices, and never returns the same value twice --
-- no coordination, locking, or retry logic in application code.
--
-- Deliberately NOT sourced from Stripe's own invoice numbering: these
-- numbers must exist the moment an invoice or quote is created in the
-- internal tool, which happens well before (and often entirely
-- without) any Stripe object -- most payments here are
-- cash/check/Venmo and never touch Stripe. Letting Stripe own the
-- number would mean either no number until payment time, or two
-- competing schemes.
--
-- Verified before applying: zero invoices and zero quotes existed
-- anywhere yet, so there was no legacy numbering to migrate. Both
-- sequences start at 1000 purely so the first real invoice reads
-- INV-2026-1000 rather than INV-2026-1.

create sequence invoice_number_seq start with 1000 increment by 1;
create sequence quote_number_seq start with 1000 increment by 1;

-- SECURITY DEFINER so an authenticated internal caller can draw a
-- number without needing direct USAGE on the sequence. Scoped
-- narrowly: no arguments, returns only a formatted string, cannot
-- read or alter anything else.
--
-- The year prefix comes from the CURRENT date at call time while the
-- counter never resets -- so numbers stay globally unique forever
-- rather than only within a year. A year-resetting counter would
-- reintroduce collisions across years for anything keyed on the
-- numeric part, and makes "which invoice is older" ambiguous.
create or replace function next_invoice_number()
returns text
language sql
security definer
set search_path = 'public'
as $$
  select 'INV-' || to_char(now(), 'YYYY') || '-' || nextval('invoice_number_seq')::text;
$$;

-- EST- (not QT-) to match what invoice-generator.html has always
-- produced and what clients already see on existing estimates. The
-- sequence is what guarantees uniqueness; the prefix is purely
-- presentational, so matching the established convention is correct.
create or replace function next_quote_number()
returns text
language sql
security definer
set search_path = 'public'
as $$
  select 'EST-' || to_char(now(), 'YYYY') || '-' || nextval('quote_number_seq')::text;
$$;

-- IMPORTANT, learned the hard way here: `revoke ... from anon` alone
-- does NOTHING on a newly created function. Postgres grants EXECUTE
-- to PUBLIC by default, and anon inherits that PUBLIC grant -- so the
-- revoke removes nothing. This was caught only by querying
-- has_function_privilege() directly rather than trusting the SQL,
-- after the security advisor flagged both functions as
-- anon-executable despite an earlier revoke. The revoke must target
-- PUBLIC itself, and the re-grant to authenticated must come after
-- (since revoking from PUBLIC also removes authenticated's inherited
-- grant).
--
-- Why it matters concretely: without this, any anonymous visitor
-- could hammer /rest/v1/rpc/next_invoice_number and burn through
-- invoice numbers indefinitely -- no data exposure, but visible gaps
-- in the sequence, and trivially avoidable.
revoke execute on function next_invoice_number() from public;
revoke execute on function next_quote_number() from public;
revoke execute on function next_invoice_number() from anon;
revoke execute on function next_quote_number() from anon;
grant execute on function next_invoice_number() to authenticated;
grant execute on function next_quote_number() to authenticated;

-- Belt-and-suspenders at the storage layer: even if a future code
-- path bypasses the functions entirely, the database itself now
-- refuses two portal invoices (or quotes) sharing a number. This is
-- the guarantee the old client-side warning could never make.
create unique index client_portal_invoices_invoice_number_key
  on client_portal_invoices (invoice_number);
create unique index client_portal_quotes_quote_number_key
  on client_portal_quotes (quote_number);
