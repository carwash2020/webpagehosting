-- Perf fix, caught by Supabase's own advisor after
-- create_client_account_codes.sql shipped: two separate permissive
-- policies both matched role=authenticated, action=SELECT ("internal
-- accounts can manage..." via its implicit FOR ALL, and "portal
-- clients can view their own..."), so Postgres evaluated both on
-- every select against this table for no behavior difference -- the
-- same "multiple_permissive_policies" class of finding this project
-- has fixed before on other tables.
--
-- Merged into one SELECT policy (staff OR own row) and split the
-- write side into three single-action policies (insert/update/delete),
-- since Postgres has no "FOR ALL EXCEPT SELECT" shorthand. Behavior
-- is identical to before -- verified live: a portal client's own JWT
-- claims still see only their own row, and a real internal account
-- still sees every row.

drop policy if exists "internal accounts can manage client account codes" on public.client_account_codes;
drop policy if exists "portal clients can view their own account code" on public.client_account_codes;

create policy "staff or own row can view client account codes"
  on public.client_account_codes
  for select
  to authenticated
  using (
    exists (select 1 from public.account_roles where account_roles.email = (select auth.email()))
    or email = (select auth.email())
  );

create policy "internal accounts can insert client account codes"
  on public.client_account_codes
  for insert
  to authenticated
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "internal accounts can update client account codes"
  on public.client_account_codes
  for update
  to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "internal accounts can delete client account codes"
  on public.client_account_codes
  for delete
  to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));
