-- Lets a client cancel their own work-order request (direct request,
-- 2026-09-19, from a portal audit finding) -- previously there was no
-- client UPDATE or DELETE policy on client_portal_work_orders at all
-- (by design, see create_client_portal_work_orders.sql's own comment
-- #3), so a client who fat-fingered a request or changed their mind
-- had no option but to call. That comment specifically anticipated
-- this: "If 'cancel my request' is wanted later, that should be an
-- explicit status transition through an edge function, not a raw
-- delete" -- this migration adds the status value, and
-- cancel-work-order (edge function) is the transition itself. Still no
-- client UPDATE/DELETE policy added: the edge function uses the
-- service role, same pattern as respond-to-quote.
--
-- Only reachable from 'submitted' (enforced in the edge function, not
-- here) -- once Steve has started reviewing/quoting/scheduling it, a
-- client-side cancel could vanish a request he's actively working
-- without him ever seeing why, since workspace.html's own work-request
-- queue simply filters on an explicit list of "open" statuses.

alter table public.client_portal_work_orders drop constraint if exists work_order_status_valid;
alter table public.client_portal_work_orders add constraint work_order_status_valid
  check (status in ('submitted', 'reviewing', 'quoted', 'scheduled', 'completed', 'declined', 'cancelled'));
