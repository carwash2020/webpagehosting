-- Adds th_bookings to the supabase_realtime publication, requested
-- directly. Without this, workspace.html and calendar.html's new
-- startBookingsRealtime() subscription (tools/sync.js) has nothing
-- to actually receive -- a booking-only change (a guest's own
-- cancellation or reschedule, or a brand new booking) was invisible
-- to staff watching either page until a manual reload, since neither
-- page's existing realtime subscriptions (workspace_sync, th_leads)
-- ever fire for a change to a completely different table.
-- Run 2026-08-25.

alter publication supabase_realtime add table public.th_bookings;

-- Confirm: should now list th_bookings alongside the 2 existing tables.
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
