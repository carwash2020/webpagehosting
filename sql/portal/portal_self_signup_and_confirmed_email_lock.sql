-- Portal self sign-up + "confirmed email only" lock (2026-11-04, handoff
-- §2 "guests can create their own account WITHOUT an invite" and §5
-- finding "Portal has NO account-creation path"). NOT APPLIED -- Connor
-- approves first. Connor chose (2026-11-04): server-side sign-up (public
-- sign-up stays OFF in Supabase Auth), plus a database lock so an
-- unconfirmed account sees nothing.
--
-- WHY
--   * Public sign-up was switched off on 2026-09-25 (docs/ACTION-ITEMS.md)
--     because "authenticated" then meant "anyone". It stays off. Accounts
--     are made by the portal-signup edge function with the service role,
--     and only become usable once the 6-digit code emailed to that address
--     is entered.
--   * Nothing in the database checked that a session's email had been
--     confirmed. The client policies are `auth.email() = client_email`, so
--     the only thing between "typed someone else's email" and "sees their
--     invoices" was the Auth setting that refuses unconfirmed sign-ins. This
--     adds the same rule inside the database, so it holds even if that
--     setting were ever changed.
--
-- WHAT (additive: one table, two functions, restrictive policies. No
-- existing policy, row or column changes.)
--   portal_signup_codes        one pending 6-digit code per email, stored
--                              only as a SHA-256 hash, with expiry, wrong-
--                              try count and a send counter. Service role
--                              only: RLS on, no policies, no grants.
--   portal_signup_ip_limits   how many codes one network address asked for
--                              this hour (a hash of the address, never the
--                              address itself), so the form can't be used to
--                              spray emails at strangers. Service role only.
--   current_user_email_confirmed()  true when the signed-in auth user has
--                              email_confirmed_at set.
--   "Confirmed email only"     a RESTRICTIVE policy on every table a client
--                              reads or writes by email. Restrictive policies
--                              are ANDed with the existing ones, so they can
--                              only take access away, never grant it. Staff
--                              accounts are all confirmed (checked live
--                              2026-11-04: 0 unconfirmed staff), and the
--                              service role and SECURITY DEFINER RPCs are
--                              unaffected.
--   portal_account_status(email)  already live (send-invite calls it) but was
--                              never in the repo. Recorded here verbatim from
--                              the live definition (read 2026-11-04) so the
--                              repo matches the database.
--
-- WHO IS AFFECTED TODAY (checked live 2026-11-04)
--   10 auth users; 3 unconfirmed, all invited clients who have never signed
--   in. Clicking their invite link confirms them, so nobody loses access.
--
-- UNDO
--   do $$ declare t text; begin
--     foreach t in array array['card_authorizations','client_account_codes',
--       'client_notification_preferences','client_portal_checkups',
--       'client_portal_contracts','client_portal_invoices',
--       'client_portal_job_messages','client_portal_jobs','client_portal_quotes',
--       'client_portal_thread_reads','client_portal_work_order_messages',
--       'client_portal_work_orders','client_profiles','quote_questions'] loop
--       execute format('drop policy if exists "Confirmed email only" on public.%I', t);
--     end loop; end $$;
--   drop function if exists public.current_user_email_confirmed();
--   drop table if exists public.portal_signup_codes;
--   drop table if exists public.portal_signup_ip_limits;

create table if not exists public.portal_signup_codes (
  email text primary key check (email = lower(email)),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  sends integer not null default 1,
  window_started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.portal_signup_codes enable row level security;
revoke all on public.portal_signup_codes from anon, authenticated;

create table if not exists public.portal_signup_ip_limits (
  ip_hash text primary key,
  starts integer not null default 1,
  window_started_at timestamptz not null default now()
);
alter table public.portal_signup_ip_limits enable row level security;
revoke all on public.portal_signup_ip_limits from anon, authenticated;

create or replace function public.current_user_email_confirmed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke execute on function public.current_user_email_confirmed() from public, anon;
grant execute on function public.current_user_email_confirmed() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'card_authorizations', 'client_account_codes', 'client_notification_preferences',
    'client_portal_checkups', 'client_portal_contracts', 'client_portal_invoices',
    'client_portal_job_messages', 'client_portal_jobs', 'client_portal_quotes',
    'client_portal_thread_reads', 'client_portal_work_order_messages',
    'client_portal_work_orders', 'client_profiles', 'quote_questions'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "Confirmed email only" on public.%I', t);
      execute format(
        'create policy "Confirmed email only" on public.%I as restrictive for all to authenticated '
        'using ((select public.current_user_email_confirmed())) '
        'with check ((select public.current_user_email_confirmed()))', t);
    end if;
  end loop;
end $$;

-- As live (read 2026-11-04). Unchanged.
create or replace function public.portal_account_status(p_email text)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_confirmed timestamptz;
  v_found boolean;
begin
  select confirmed_at, true
    into v_confirmed, v_found
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if not coalesce(v_found, false) then
    return 'none';
  elsif v_confirmed is null then
    return 'unconfirmed';
  else
    return 'confirmed';
  end if;
end;
$function$;
