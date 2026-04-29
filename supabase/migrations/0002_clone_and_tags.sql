-- =============================================================================
-- Migration 0002 — Clone & tag helpers
-- =============================================================================

-- =============================================================================
-- RPC: clone_questionnaire — create an editable copy of an existing one
-- =============================================================================
-- Copies the questionnaire (always as draft) plus all its questions, tags, and
-- client assignments. The new copy is owned by the caller and references the
-- source via parent_id.

create or replace function clone_questionnaire(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source questionnaires%rowtype;
  v_new_id uuid;
begin
  if not is_admin() then
    raise exception 'only admins can clone questionnaires';
  end if;

  select * into v_source from questionnaires where id = p_source_id;
  if not found then
    raise exception 'source questionnaire not found';
  end if;

  -- Insert the new draft
  insert into questionnaires (title, description, status, parent_id, created_by)
  values (
    v_source.title || ' (copy)',
    v_source.description,
    'draft',
    v_source.id,
    auth.uid()
  )
  returning id into v_new_id;

  -- Copy questions
  insert into questions (questionnaire_id, order_index, type, text, required, options, show_if)
  select v_new_id, order_index, type, text, required, options, show_if
  from questions
  where questionnaire_id = p_source_id;

  -- Copy tag assignments
  insert into questionnaire_tags (questionnaire_id, tag_id)
  select v_new_id, tag_id
  from questionnaire_tags
  where questionnaire_id = p_source_id;

  -- Copy client assignments
  insert into questionnaire_clients (questionnaire_id, client_id)
  select v_new_id, client_id
  from questionnaire_clients
  where questionnaire_id = p_source_id;

  return v_new_id;
end;
$$;

-- =============================================================================
-- RPC: upsert_tag — find-or-create a tag by name, return its id
-- =============================================================================

create or replace function upsert_tag(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not is_admin() then
    raise exception 'only admins can manage tags';
  end if;

  v_name := trim(p_name);
  if v_name = '' then
    raise exception 'tag name is empty';
  end if;

  select id into v_id from tags where lower(name) = lower(v_name);
  if found then
    return v_id;
  end if;

  insert into tags (name) values (v_name) returning id into v_id;
  return v_id;
end;
$$;
