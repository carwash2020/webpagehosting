-- Email delivery tracking for guest booking confirmations (2026-10-20).
-- Before this, a failed Resend send to the customer only showed up in
-- the edge function's own logs, and the booking flow still reported
-- "ok" regardless of whether the guest actually got anything -- there
-- was no way to tell, from the booking row itself, whether the
-- customer ever received (or opened, or bounced) their confirmation.

-- The id Resend returns for the guest confirmation send. Set by
-- send-booking-email-index.ts right after it tries the guest send;
-- used by resend-webhook-index.ts to match an incoming delivery event
-- back to the right booking.
alter table public.th_bookings add column if not exists resend_message_id text;

-- 'sent' | 'failed' -- whether the guest send itself succeeded,
-- set by send-booking-email-index.ts immediately after trying it.
alter table public.th_bookings add column if not exists email_send_status text;

-- 'sent' | 'delivered' | 'opened' | 'bounced' | 'complained' --
-- advanced by resend-webhook-index.ts as Resend's own webhook events
-- for this message id arrive. Stays null until the first event does.
alter table public.th_bookings add column if not exists email_delivery_status text;

alter table public.th_bookings add column if not exists email_delivery_updated_at timestamptz;

-- No RLS policy changes needed: the base table already has no
-- anon/authenticated SELECT policy at all (see create_booking_system.sql's
-- own comment), and the public th_bookings_availability view lists its
-- own columns explicitly (start_at, end_at only), so these new columns
-- are never exposed through it.
