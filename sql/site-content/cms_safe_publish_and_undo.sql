-- Safe publish + real undo for public.site_content (2026-09-23).
-- Applied live via the Supabase MCP migration tool
-- (apply_migration: cms_safe_publish_and_undo), mirrored here per this
-- repo's convention. Safe to re-run: every step is idempotent.
--
-- WHY. tools/site-content.html edits the live public site with no PR or
-- review step in between, so the database has to be the last line of
-- defense, not the page. Before this:
--   - "Save all" upserted all 11 fields every time, so a tab opened an
--     hour earlier silently reverted anyone else's newer edit.
--   - Nothing validated a value. On 2026-08-16 an email address went live
--     as the blue top-of-site banner for 6 seconds (site_content_history).
--   - History only logged UPDATEs, never grouped a save's changes, and the
--     "Restore this value" button could overwrite a newer edit blindly.
--
-- WHAT.
--   1. site_content_history gains action / batch_id / undo_of, and the
--      trigger now logs INSERT and DELETE too. batch_id groups every row
--      one save touched, so "undo my last save" can revert all of it.
--   2. A CHECK constraint (site_content_value_is_valid) refuses a bad
--      value no matter what wrote it: this page, a future page, or SQL.
--   3. cms_publish_content(changes) applies a set of edits all-or-nothing,
--      each with a compare-and-swap on the value the editor last saw.
--   4. cms_undo_content(history_ids) reverts history rows (normally one
--      save's batch), only if nobody has changed those fields since.
--   5. Seeds googleRating / googleReviewCount with the values hardcoded on
--      the public site today (Google Business Profile: 5.0 from 7).
--
-- Both functions are SECURITY INVOKER: they run as the signed-in user, so
-- the existing RLS policies (writes need account_roles.can_manage_site_content,
-- see sql/security/restrict_site_content_and_private_buckets_to_internal_accounts.sql)
-- still decide who may write. The explicit permission check at the top of
-- each is only there to return a clear error instead of a bare RLS denial.

-- ---------------------------------------------------------------------
-- 1. History: what kind of change, which save it belonged to, what it undid
-- ---------------------------------------------------------------------
alter table public.site_content_history
  add column if not exists action text not null default 'update',
  add column if not exists batch_id uuid,
  add column if not exists undo_of bigint;

alter table public.site_content_history drop constraint if exists site_content_history_action_check;
alter table public.site_content_history
  add constraint site_content_history_action_check check (action in ('insert', 'update', 'delete'));

create index if not exists site_content_history_key_id_idx on public.site_content_history (key, id desc);
create index if not exists site_content_history_batch_id_idx on public.site_content_history (batch_id);

-- The batch id comes from a transaction-local setting the two RPCs below
-- set. A write that didn't come through them (the SQL editor, an old
-- cached copy of the page) still gets one: the first row it logs mints a
-- batch id and stores it for the rest of that transaction, so a
-- multi-row statement still groups as one save.
create or replace function public.log_site_content_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_undo_of bigint;
begin
  v_batch := nullif(current_setting('th.cms_batch_id', true), '')::uuid;
  if v_batch is null then
    v_batch := gen_random_uuid();
    perform set_config('th.cms_batch_id', v_batch::text, true);
  end if;
  v_undo_of := nullif(current_setting('th.cms_undo_of', true), '')::bigint;

  if (TG_OP = 'INSERT') then
    insert into public.site_content_history (key, old_value, new_value, changed_by, action, batch_id, undo_of)
    values (NEW.key, null, NEW.value, auth.jwt() ->> 'email', 'insert', v_batch, v_undo_of);
    return NEW;
  elsif (TG_OP = 'DELETE') then
    insert into public.site_content_history (key, old_value, new_value, changed_by, action, batch_id, undo_of)
    values (OLD.key, OLD.value, null, auth.jwt() ->> 'email', 'delete', v_batch, v_undo_of);
    return OLD;
  elsif (OLD.value is distinct from NEW.value) then
    insert into public.site_content_history (key, old_value, new_value, changed_by, action, batch_id, undo_of)
    values (NEW.key, OLD.value, NEW.value, auth.jwt() ->> 'email', 'update', v_batch, v_undo_of);
  end if;
  return NEW;
end;
$$;

drop trigger if exists site_content_change_trigger on public.site_content;
create trigger site_content_change_trigger
after insert or update or delete on public.site_content
for each row
execute function public.log_site_content_change();

-- Same as before (sql/security/fix_advisor_security_definer_warnings.sql):
-- a trigger function fires regardless of EXECUTE, so nobody needs it.
revoke execute on function public.log_site_content_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Validation the database itself enforces
-- ---------------------------------------------------------------------
-- Mirrors SITE_CONTENT_FIELDS' validate() in tools/site-content.html and
-- the public-side guards in js/review-stats.js. The page checks first so
-- the owner gets a plain-English message; this is the backstop.
--   - blank is stored as NULL (never ''), and no stray leading/trailing space
--   - googleRating: one decimal, 1.0 to 5.0 (Google's own range)
--   - googleReviewCount: a whole number, 1 to 99999
--   - phone: exactly the (435) 414-1667 shape every page displays; the
--     public pages build tel:+1 links from its 10 digits
--   - email: one plausible address
--   - hours / banners: one line, short enough to fit where they render
create or replace function public.site_content_value_is_valid(p_key text, p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then true
    when p_value = '' or p_value <> btrim(p_value) then false
    when char_length(p_value) > 500 then false
    when p_key = 'googleRating' then
      case when p_value ~ '^[1-5]\.[0-9]$' then p_value::numeric <= 5.0 else false end
    when p_key = 'googleReviewCount' then p_value ~ '^[1-9][0-9]{0,4}$'
    when p_key = 'phone' then p_value ~ '^\([2-9][0-9]{2}\) [2-9][0-9]{2}-[0-9]{4}$'
    when p_key = 'email' then
      char_length(p_value) <= 254 and p_value ~* '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
    when p_key like 'hours%' then char_length(p_value) <= 60 and p_value !~ '[\r\n]'
    when p_key in ('banner1', 'banner2') then char_length(p_value) <= 200 and p_value !~ '[\r\n]'
    else true
  end
$$;

-- A CHECK constraint runs its function as the writing role, so writers
-- need EXECUTE; anon never writes this table.
revoke execute on function public.site_content_value_is_valid(text, text) from public, anon;
grant execute on function public.site_content_value_is_valid(text, text) to authenticated, service_role;

alter table public.site_content drop constraint if exists site_content_value_valid;
alter table public.site_content
  add constraint site_content_value_valid check (public.site_content_value_is_valid(key, value));

-- ---------------------------------------------------------------------
-- 3. Publish: all-or-nothing, compare-and-swap per field
-- ---------------------------------------------------------------------
-- p_changes: [{ "key": "googleReviewCount", "expected": "7", "value": "8" }, ...]
--   expected = the value the editor showed as "current" (null for blank).
--   value    = the new value (null or "" for blank).
-- Any mismatch between expected and the real current value aborts the
-- whole publish with SQLSTATE PT409 (PostgREST answers HTTP 409), naming
-- the field in DETAIL. Only existing keys can be written: a new field
-- ships with a migration that seeds it, never from the browser.
-- Returns the history rows this publish wrote (empty if nothing changed).
create or replace function public.cms_publish_content(p_changes jsonb)
returns setof public.site_content_history
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_item jsonb;
  v_key text;
  v_expected text;
  v_new text;
  v_current text;
  v_seen text[] := '{}';
begin
  if not exists (
    select 1 from public.account_roles ar
    where ar.email = (select auth.email()) and ar.can_manage_site_content
  ) then
    raise exception 'This account is not allowed to edit site content.' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'Nothing to publish.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 40 then
    raise exception 'Too many changes in one publish.' using errcode = '22023';
  end if;

  perform set_config('th.cms_batch_id', v_batch::text, true);
  perform set_config('th.cms_undo_of', '', true);

  for v_item in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_item) <> 'object' or not (v_item ? 'key') or not (v_item ? 'expected') or not (v_item ? 'value') then
      raise exception 'Each change needs a key, an expected value, and a new value.' using errcode = '22023';
    end if;
    v_key := v_item ->> 'key';
    if v_key is null or v_key = any (v_seen) then
      raise exception 'A field was missing or listed twice.' using errcode = '22023', detail = coalesce(v_key, '');
    end if;
    v_seen := v_seen || v_key;
    v_expected := nullif(v_item ->> 'expected', '');
    v_new := nullif(btrim(coalesce(v_item ->> 'value', '')), '');

    select sc.value into v_current from public.site_content sc where sc.key = v_key for update;
    if not found then
      raise exception 'Unknown site content field.' using errcode = '22023', detail = v_key;
    end if;
    if v_current is distinct from v_expected then
      raise exception 'This field was changed by someone else since the page loaded. Nothing was published.'
        using errcode = 'PT409', detail = v_key;
    end if;
    if v_current is distinct from v_new then
      update public.site_content sc set value = v_new, updated_at = now() where sc.key = v_key;
    end if;
  end loop;

  return query
    select h.* from public.site_content_history h where h.batch_id = v_batch order by h.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Undo: revert history rows, only if nothing changed since
-- ---------------------------------------------------------------------
-- p_history_ids: normally every row of one save (same batch_id), or a
-- single row. Each field must still hold exactly the value that history
-- row set; otherwise the whole undo aborts with PT409 and changes nothing,
-- so an undo can never clobber a newer edit. The undo itself is logged as
-- a new batch whose rows carry undo_of = the row they reverted.
create or replace function public.cms_undo_content(p_history_ids bigint[])
returns setof public.site_content_history
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_row public.site_content_history%rowtype;
  v_current text;
  v_wanted int;
  v_found int;
begin
  if not exists (
    select 1 from public.account_roles ar
    where ar.email = (select auth.email()) and ar.can_manage_site_content
  ) then
    raise exception 'This account is not allowed to edit site content.' using errcode = '42501';
  end if;

  if p_history_ids is null or cardinality(p_history_ids) = 0 then
    raise exception 'Nothing to undo.' using errcode = '22023';
  end if;
  if cardinality(p_history_ids) > 40 then
    raise exception 'Too many changes in one undo.' using errcode = '22023';
  end if;

  select count(distinct x) into v_wanted from unnest(p_history_ids) as x;
  select count(*) into v_found from public.site_content_history h where h.id = any (p_history_ids);
  if v_found <> v_wanted then
    raise exception 'That change is no longer in the history.' using errcode = '22023';
  end if;

  perform set_config('th.cms_batch_id', v_batch::text, true);

  for v_row in
    select * from public.site_content_history h where h.id = any (p_history_ids) order by h.id desc
  loop
    select sc.value into v_current from public.site_content sc where sc.key = v_row.key for update;
    if not found then
      raise exception 'That field no longer exists.' using errcode = '22023', detail = v_row.key;
    end if;
    if v_current is distinct from v_row.new_value then
      raise exception 'This field has been changed again since. Nothing was undone.'
        using errcode = 'PT409', detail = v_row.key;
    end if;
    perform set_config('th.cms_undo_of', v_row.id::text, true);
    update public.site_content sc set value = v_row.old_value, updated_at = now() where sc.key = v_row.key;
  end loop;
  perform set_config('th.cms_undo_of', '', true);

  return query
    select h.* from public.site_content_history h where h.batch_id = v_batch order by h.id;
end;
$$;

revoke execute on function public.cms_publish_content(jsonb) from public, anon;
revoke execute on function public.cms_undo_content(bigint[]) from public, anon;
grant execute on function public.cms_publish_content(jsonb) to authenticated;
grant execute on function public.cms_undo_content(bigint[]) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Seed the review fields with today's live, hardcoded values
-- ---------------------------------------------------------------------
-- Matches index.html's JSON-LD aggregateRating and every "5.0 from 7
-- Google reviews" line, so the public pages render identically the
-- moment they start reading these. The trigger logs both as 'insert'
-- rows with no changed_by (the editor shows them as "setup").
insert into public.site_content (key, value) values
  ('googleRating', '5.0'),
  ('googleReviewCount', '7')
on conflict (key) do nothing;
