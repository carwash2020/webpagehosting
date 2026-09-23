-- Safe publish + real undo for public.site_faq and public.site_terms
-- (2026-09-23). Applied live via the Supabase MCP migration tool
-- (apply_migration: cms_faq_terms_safe_publish), mirrored here per this
-- repo's convention. Safe to re-run: every step is idempotent.
--
-- Same design as cms_safe_publish_and_undo.sql (site_content), for the
-- two list-shaped CMS tables. What was wrong before:
--   - "Save all" DELETED every row and re-inserted the whole list, so
--     every save changed every row's id, history filled with N deletes
--     + N inserts and never an update, and the history panel's
--     restore-an-edit (PATCH by id) pointed at a row that no longer
--     existed; restoring a delete could duplicate a row.
--   - An item whose question or answer was cleared was silently dropped
--     by the editor's own filter -- a blank field quietly deleted a live
--     FAQ answer.
--   - No check that the list hadn't changed since the editor loaded it:
--     a stale tab's save replaced someone else's newer edits wholesale.
--
-- What this adds, per table:
--   1. History rows carry the full old/new row (old_row/new_row), the
--      save they belong to (batch_id), and what they undid (undo_of).
--      Updates are logged when ANY field changes, not only the answer.
--   2. A CHECK constraint: text present, trimmed, one-line headings,
--      sane lengths. Refused from any writer.
--   3. The question/heading UNIQUE constraints become DEFERRABLE (still
--      checked immediately by default), so a publish that edits rows in
--      place can pass through a momentary duplicate within one save.
--   4. cms_publish_faq / cms_publish_terms(expected, items): compare-
--      and-swap on the whole list (PT409 -> HTTP 409 if it changed since
--      the editor loaded it), then update rows in place by id, insert
--      new ones, delete removed ones, and renumber sort_order -- ids stay
--      stable across saves.
--   5. cms_undo_faq / cms_undo_terms(batch_id): revert one save, refused
--      (PT409) if any row it touched has changed since.
--
-- SECURITY INVOKER throughout: the existing can_manage_site_content RLS
-- policies on both tables still decide who can write.

-- ---------------------------------------------------------------------
-- 1. History: full row images, batch, undo link
-- ---------------------------------------------------------------------
alter table public.site_faq_history
  add column if not exists batch_id uuid,
  add column if not exists undo_of bigint,
  add column if not exists old_row jsonb,
  add column if not exists new_row jsonb;
alter table public.site_terms_history
  add column if not exists batch_id uuid,
  add column if not exists undo_of bigint,
  add column if not exists old_row jsonb,
  add column if not exists new_row jsonb;
create index if not exists site_faq_history_batch_id_idx on public.site_faq_history (batch_id);
create index if not exists site_terms_history_batch_id_idx on public.site_terms_history (batch_id);

create or replace function public.log_site_faq_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_undo_of bigint;
  v_old jsonb;
  v_new jsonb;
begin
  v_batch := nullif(current_setting('th.cms_batch_id', true), '')::uuid;
  if v_batch is null then
    v_batch := gen_random_uuid();
    perform set_config('th.cms_batch_id', v_batch::text, true);
  end if;
  v_undo_of := nullif(current_setting('th.cms_undo_of', true), '')::bigint;
  if (TG_OP in ('UPDATE', 'DELETE')) then
    v_old := jsonb_build_object('id', OLD.id, 'question', OLD.question, 'answer', OLD.answer, 'category', OLD.category, 'sort_order', OLD.sort_order);
  end if;
  if (TG_OP in ('UPDATE', 'INSERT')) then
    v_new := jsonb_build_object('id', NEW.id, 'question', NEW.question, 'answer', NEW.answer, 'category', NEW.category, 'sort_order', NEW.sort_order);
  end if;

  if (TG_OP = 'DELETE') then
    insert into public.site_faq_history (action, faq_id, question, old_answer, changed_by, batch_id, undo_of, old_row)
    values ('delete', OLD.id, OLD.question, OLD.answer, auth.jwt() ->> 'email', v_batch, v_undo_of, v_old);
    return OLD;
  elsif (TG_OP = 'INSERT') then
    insert into public.site_faq_history (action, faq_id, question, new_answer, changed_by, batch_id, undo_of, new_row)
    values ('insert', NEW.id, NEW.question, NEW.answer, auth.jwt() ->> 'email', v_batch, v_undo_of, v_new);
    return NEW;
  elsif (v_old is distinct from v_new) then
    insert into public.site_faq_history (action, faq_id, question, old_answer, new_answer, changed_by, batch_id, undo_of, old_row, new_row)
    values ('update', NEW.id, NEW.question, OLD.answer, NEW.answer, auth.jwt() ->> 'email', v_batch, v_undo_of, v_old, v_new);
  end if;
  return NEW;
end;
$$;

create or replace function public.log_site_terms_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_undo_of bigint;
  v_old jsonb;
  v_new jsonb;
begin
  v_batch := nullif(current_setting('th.cms_batch_id', true), '')::uuid;
  if v_batch is null then
    v_batch := gen_random_uuid();
    perform set_config('th.cms_batch_id', v_batch::text, true);
  end if;
  v_undo_of := nullif(current_setting('th.cms_undo_of', true), '')::bigint;
  if (TG_OP in ('UPDATE', 'DELETE')) then
    v_old := jsonb_build_object('id', OLD.id, 'heading', OLD.heading, 'body', OLD.body, 'sort_order', OLD.sort_order);
  end if;
  if (TG_OP in ('UPDATE', 'INSERT')) then
    v_new := jsonb_build_object('id', NEW.id, 'heading', NEW.heading, 'body', NEW.body, 'sort_order', NEW.sort_order);
  end if;

  if (TG_OP = 'DELETE') then
    insert into public.site_terms_history (action, term_id, heading, old_body, changed_by, batch_id, undo_of, old_row)
    values ('delete', OLD.id, OLD.heading, OLD.body, auth.jwt() ->> 'email', v_batch, v_undo_of, v_old);
    return OLD;
  elsif (TG_OP = 'INSERT') then
    insert into public.site_terms_history (action, term_id, heading, new_body, changed_by, batch_id, undo_of, new_row)
    values ('insert', NEW.id, NEW.heading, NEW.body, auth.jwt() ->> 'email', v_batch, v_undo_of, v_new);
    return NEW;
  elsif (v_old is distinct from v_new) then
    insert into public.site_terms_history (action, term_id, heading, old_body, new_body, changed_by, batch_id, undo_of, old_row, new_row)
    values ('update', NEW.id, NEW.heading, OLD.body, NEW.body, auth.jwt() ->> 'email', v_batch, v_undo_of, v_old, v_new);
  end if;
  return NEW;
end;
$$;

revoke execute on function public.log_site_faq_change() from public, anon, authenticated;
revoke execute on function public.log_site_terms_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Validation the database enforces
-- ---------------------------------------------------------------------
-- Mirrors the editor's own checks (tools/site-content.html). Every live
-- row passed these when they were added (checked first).
alter table public.site_faq drop constraint if exists site_faq_content_valid;
alter table public.site_faq add constraint site_faq_content_valid check (
  char_length(question) between 1 and 300 and question = btrim(question) and question !~ '[\r\n]'
  and char_length(answer) between 1 and 4000 and answer = btrim(answer)
  and char_length(category) between 1 and 80 and category = btrim(category) and category !~ '[\r\n]'
);
alter table public.site_terms drop constraint if exists site_terms_content_valid;
alter table public.site_terms add constraint site_terms_content_valid check (
  char_length(heading) between 1 and 200 and heading = btrim(heading) and heading !~ '[\r\n]'
  and char_length(body) between 1 and 20000 and body = btrim(body)
);

-- ---------------------------------------------------------------------
-- 3. Unique question / heading, now deferrable
-- ---------------------------------------------------------------------
alter table public.site_faq drop constraint if exists site_faq_question_unique;
alter table public.site_faq add constraint site_faq_question_unique unique (question) deferrable initially immediate;
alter table public.site_terms drop constraint if exists site_terms_heading_unique;
alter table public.site_terms add constraint site_terms_heading_unique unique (heading) deferrable initially immediate;

-- ---------------------------------------------------------------------
-- 4. Publish a whole list: compare-and-swap, then edit in place
-- ---------------------------------------------------------------------
-- p_expected: the list exactly as the editor loaded it,
--   [{ id, question, answer, category, sort_order }, ...]
-- p_items: the list as it should be now, in order,
--   [{ id (omit/null for a new item), question, answer, category }, ...]
-- Returns the history rows the publish wrote (empty if nothing changed).
create or replace function public.cms_publish_faq(p_expected jsonb, p_items jsonb)
returns setof public.site_faq_history
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_item jsonb;
  v_id bigint;
  v_ids bigint[] := '{}';
  v_pos int := 0;
  v_question text;
  v_answer text;
  v_category text;
begin
  if not exists (
    select 1 from public.account_roles ar
    where ar.email = (select auth.email()) and ar.can_manage_site_content
  ) then
    raise exception 'This account is not allowed to edit site content.' using errcode = '42501';
  end if;
  if p_expected is null or jsonb_typeof(p_expected) <> 'array' or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Expected and new lists are both required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Too many FAQ items.' using errcode = '22023';
  end if;

  -- Lock the list, then check nobody changed it since the editor loaded it.
  perform 1 from public.site_faq for update;
  if (select count(*) from public.site_faq) <> jsonb_array_length(p_expected)
     or exists (
       select 1 from public.site_faq f
       where not exists (
         select 1 from jsonb_array_elements(p_expected) e
         where (e ->> 'id') = f.id::text
           and (e ->> 'question') = f.question
           and (e ->> 'answer') = f.answer
           and (e ->> 'category') = f.category
           and (e ->> 'sort_order') = f.sort_order::text
       )
     ) then
    raise exception 'The FAQ was changed by someone else since the page loaded. Nothing was published.' using errcode = 'PT409';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each FAQ item must be an object.' using errcode = '22023';
    end if;
    v_id := nullif(v_item ->> 'id', '')::bigint;
    if v_id is not null then
      if v_id = any (v_ids) then
        raise exception 'An FAQ item was listed twice.' using errcode = '22023';
      end if;
      if not exists (select 1 from public.site_faq f where f.id = v_id) then
        raise exception 'An FAQ item no longer exists.' using errcode = '22023';
      end if;
      v_ids := v_ids || v_id;
    end if;
  end loop;

  set constraints public.site_faq_question_unique deferred;
  perform set_config('th.cms_batch_id', v_batch::text, true);
  perform set_config('th.cms_undo_of', '', true);

  delete from public.site_faq f where not (f.id = any (v_ids));

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_id := nullif(v_item ->> 'id', '')::bigint;
    v_question := btrim(v_item ->> 'question');
    v_answer := btrim(v_item ->> 'answer');
    v_category := coalesce(nullif(btrim(coalesce(v_item ->> 'category', '')), ''), 'General');
    if v_id is null then
      insert into public.site_faq (question, answer, category, sort_order)
      values (v_question, v_answer, v_category, v_pos);
    else
      update public.site_faq f
        set question = v_question, answer = v_answer, category = v_category, sort_order = v_pos, updated_at = now()
        where f.id = v_id
          and (f.question, f.answer, f.category, f.sort_order) is distinct from (v_question, v_answer, v_category, v_pos);
    end if;
  end loop;

  return query
    select h.* from public.site_faq_history h where h.batch_id = v_batch order by h.id;
end;
$$;

create or replace function public.cms_publish_terms(p_expected jsonb, p_items jsonb)
returns setof public.site_terms_history
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_item jsonb;
  v_id bigint;
  v_ids bigint[] := '{}';
  v_pos int := 0;
  v_heading text;
  v_body text;
begin
  if not exists (
    select 1 from public.account_roles ar
    where ar.email = (select auth.email()) and ar.can_manage_site_content
  ) then
    raise exception 'This account is not allowed to edit site content.' using errcode = '42501';
  end if;
  if p_expected is null or jsonb_typeof(p_expected) <> 'array' or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Expected and new lists are both required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Too many Terms sections.' using errcode = '22023';
  end if;

  perform 1 from public.site_terms for update;
  if (select count(*) from public.site_terms) <> jsonb_array_length(p_expected)
     or exists (
       select 1 from public.site_terms t
       where not exists (
         select 1 from jsonb_array_elements(p_expected) e
         where (e ->> 'id') = t.id::text
           and (e ->> 'heading') = t.heading
           and (e ->> 'body') = t.body
           and (e ->> 'sort_order') = t.sort_order::text
       )
     ) then
    raise exception 'The Terms were changed by someone else since the page loaded. Nothing was published.' using errcode = 'PT409';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each Terms section must be an object.' using errcode = '22023';
    end if;
    v_id := nullif(v_item ->> 'id', '')::bigint;
    if v_id is not null then
      if v_id = any (v_ids) then
        raise exception 'A Terms section was listed twice.' using errcode = '22023';
      end if;
      if not exists (select 1 from public.site_terms t where t.id = v_id) then
        raise exception 'A Terms section no longer exists.' using errcode = '22023';
      end if;
      v_ids := v_ids || v_id;
    end if;
  end loop;

  set constraints public.site_terms_heading_unique deferred;
  perform set_config('th.cms_batch_id', v_batch::text, true);
  perform set_config('th.cms_undo_of', '', true);

  delete from public.site_terms t where not (t.id = any (v_ids));

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_id := nullif(v_item ->> 'id', '')::bigint;
    v_heading := btrim(v_item ->> 'heading');
    v_body := btrim(v_item ->> 'body');
    if v_id is null then
      insert into public.site_terms (heading, body, sort_order) values (v_heading, v_body, v_pos);
    else
      update public.site_terms t
        set heading = v_heading, body = v_body, sort_order = v_pos, updated_at = now()
        where t.id = v_id
          and (t.heading, t.body, t.sort_order) is distinct from (v_heading, v_body, v_pos);
    end if;
  end loop;

  return query
    select h.* from public.site_terms_history h where h.batch_id = v_batch order by h.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Undo one save
-- ---------------------------------------------------------------------
-- Reverts every history row of p_batch_id, newest first. Each row it
-- touched must still be exactly as that save left it (an inserted row
-- still there unchanged, an updated row still holding the new version, a
-- deleted row still gone); otherwise nothing is undone (PT409). History
-- written before this migration has no row images and can't be undone
-- this way (22023).
create or replace function public.cms_undo_faq(p_batch_id uuid)
returns setof public.site_faq_history
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new_batch uuid := gen_random_uuid();
  v_row public.site_faq_history%rowtype;
  v_cur jsonb;
  v_target bigint;
begin
  if not exists (
    select 1 from public.account_roles ar
    where ar.email = (select auth.email()) and ar.can_manage_site_content
  ) then
    raise exception 'This account is not allowed to edit site content.' using errcode = '42501';
  end if;
  if p_batch_id is null or not exists (select 1 from public.site_faq_history h where h.batch_id = p_batch_id) then
    raise exception 'That save is no longer in the history.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.site_faq_history h
    where h.batch_id = p_batch_id
      and ((h.action in ('update', 'delete') and h.old_row is null) or (h.action in ('update', 'insert') and h.new_row is null))
  ) then
    raise exception 'That save is from before undo was available and can''t be undone automatically.' using errcode = '22023';
  end if;

  perform 1 from public.site_faq for update;
  set constraints public.site_faq_question_unique deferred;
  perform set_config('th.cms_batch_id', v_new_batch::text, true);

  for v_row in select * from public.site_faq_history h where h.batch_id = p_batch_id order by h.id desc loop
    v_target := (coalesce(v_row.new_row, v_row.old_row) ->> 'id')::bigint;
    v_cur := null;
    select jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'category', f.category, 'sort_order', f.sort_order)
      into v_cur from public.site_faq f where f.id = v_target;
    perform set_config('th.cms_undo_of', v_row.id::text, true);
    if v_row.action = 'insert' then
      if v_cur is distinct from v_row.new_row then
        raise exception 'The FAQ has changed since that save. Nothing was undone.' using errcode = 'PT409', detail = v_target::text;
      end if;
      delete from public.site_faq f where f.id = v_target;
    elsif v_row.action = 'update' then
      if v_cur is distinct from v_row.new_row then
        raise exception 'The FAQ has changed since that save. Nothing was undone.' using errcode = 'PT409', detail = v_target::text;
      end if;
      update public.site_faq f
        set question = v_row.old_row ->> 'question', answer = v_row.old_row ->> 'answer',
            category = v_row.old_row ->> 'category', sort_order = (v_row.old_row ->> 'sort_order')::int, updated_at = now()
        where f.id = v_target;
    else
      if v_cur is not null then
        raise exception 'The FAQ has changed since that save. Nothing was undone.' using errcode = 'PT409', detail = v_target::text;
      end if;
      insert into public.site_faq (id, question, answer, category, sort_order)
      values (v_target, v_row.old_row ->> 'question', v_row.old_row ->> 'answer', v_row.old_row ->> 'category', (v_row.old_row ->> 'sort_order')::int);
    end if;
  end loop;
  perform set_config('th.cms_undo_of', '', true);

  return query
    select h.* from public.site_faq_history h where h.batch_id = v_new_batch order by h.id;
end;
$$;

create or replace function public.cms_undo_terms(p_batch_id uuid)
returns setof public.site_terms_history
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new_batch uuid := gen_random_uuid();
  v_row public.site_terms_history%rowtype;
  v_cur jsonb;
  v_target bigint;
begin
  if not exists (
    select 1 from public.account_roles ar
    where ar.email = (select auth.email()) and ar.can_manage_site_content
  ) then
    raise exception 'This account is not allowed to edit site content.' using errcode = '42501';
  end if;
  if p_batch_id is null or not exists (select 1 from public.site_terms_history h where h.batch_id = p_batch_id) then
    raise exception 'That save is no longer in the history.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.site_terms_history h
    where h.batch_id = p_batch_id
      and ((h.action in ('update', 'delete') and h.old_row is null) or (h.action in ('update', 'insert') and h.new_row is null))
  ) then
    raise exception 'That save is from before undo was available and can''t be undone automatically.' using errcode = '22023';
  end if;

  perform 1 from public.site_terms for update;
  set constraints public.site_terms_heading_unique deferred;
  perform set_config('th.cms_batch_id', v_new_batch::text, true);

  for v_row in select * from public.site_terms_history h where h.batch_id = p_batch_id order by h.id desc loop
    v_target := (coalesce(v_row.new_row, v_row.old_row) ->> 'id')::bigint;
    v_cur := null;
    select jsonb_build_object('id', t.id, 'heading', t.heading, 'body', t.body, 'sort_order', t.sort_order)
      into v_cur from public.site_terms t where t.id = v_target;
    perform set_config('th.cms_undo_of', v_row.id::text, true);
    if v_row.action = 'insert' then
      if v_cur is distinct from v_row.new_row then
        raise exception 'The Terms have changed since that save. Nothing was undone.' using errcode = 'PT409', detail = v_target::text;
      end if;
      delete from public.site_terms t where t.id = v_target;
    elsif v_row.action = 'update' then
      if v_cur is distinct from v_row.new_row then
        raise exception 'The Terms have changed since that save. Nothing was undone.' using errcode = 'PT409', detail = v_target::text;
      end if;
      update public.site_terms t
        set heading = v_row.old_row ->> 'heading', body = v_row.old_row ->> 'body',
            sort_order = (v_row.old_row ->> 'sort_order')::int, updated_at = now()
        where t.id = v_target;
    else
      if v_cur is not null then
        raise exception 'The Terms have changed since that save. Nothing was undone.' using errcode = 'PT409', detail = v_target::text;
      end if;
      insert into public.site_terms (id, heading, body, sort_order)
      values (v_target, v_row.old_row ->> 'heading', v_row.old_row ->> 'body', (v_row.old_row ->> 'sort_order')::int);
    end if;
  end loop;
  perform set_config('th.cms_undo_of', '', true);

  return query
    select h.* from public.site_terms_history h where h.batch_id = v_new_batch order by h.id;
end;
$$;

revoke execute on function public.cms_publish_faq(jsonb, jsonb) from public, anon;
revoke execute on function public.cms_publish_terms(jsonb, jsonb) from public, anon;
revoke execute on function public.cms_undo_faq(uuid) from public, anon;
revoke execute on function public.cms_undo_terms(uuid) from public, anon;
grant execute on function public.cms_publish_faq(jsonb, jsonb) to authenticated;
grant execute on function public.cms_publish_terms(jsonb, jsonb) to authenticated;
grant execute on function public.cms_undo_faq(uuid) to authenticated;
grant execute on function public.cms_undo_terms(uuid) to authenticated;
