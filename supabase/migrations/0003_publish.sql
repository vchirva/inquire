-- =============================================================================
-- Migration 0003 — Publish workflow
-- =============================================================================

-- Atomically:
--   1. Validate the questionnaire (has title, ≥1 client, ≥1 question with text)
--   2. Set status = 'live' and locked_at = now()
--   3. Create one open link_group per assigned client
--   4. Return the questionnaire_id (caller fetches the new link_groups separately)

create or replace function publish_questionnaire(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q questionnaires%rowtype;
  v_question_count int;
  v_empty_text_count int;
  v_client_count int;
  v_client_id uuid;
begin
  if not is_admin() then
    raise exception 'only admins can publish';
  end if;

  select * into v_q from questionnaires where id = p_id;
  if not found then
    raise exception 'questionnaire not found';
  end if;

  if v_q.locked_at is not null then
    raise exception 'questionnaire is already locked';
  end if;

  if coalesce(trim(v_q.title), '') = '' then
    raise exception 'title is empty';
  end if;

  -- Question checks
  select count(*) into v_question_count from questions where questionnaire_id = p_id;
  if v_question_count = 0 then
    raise exception 'questionnaire has no questions';
  end if;

  select count(*) into v_empty_text_count
    from questions
    where questionnaire_id = p_id and coalesce(trim(text), '') = '';
  if v_empty_text_count > 0 then
    raise exception '% question(s) have no text', v_empty_text_count;
  end if;

  -- Client assignment check
  select count(*) into v_client_count
    from questionnaire_clients where questionnaire_id = p_id;
  if v_client_count = 0 then
    raise exception 'no clients assigned';
  end if;

  -- Lock and publish
  update questionnaires
    set status = 'live', locked_at = now()
    where id = p_id;

  -- Create one open link_group per assigned client
  for v_client_id in
    select client_id from questionnaire_clients where questionnaire_id = p_id
  loop
    insert into link_groups (questionnaire_id, client_id, created_by)
    values (p_id, v_client_id, auth.uid());
  end loop;
end;
$$;

-- Convenience: close all link groups for a questionnaire
create or replace function close_link_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only admins can close link groups';
  end if;

  update link_groups
    set status = 'closed', closed_at = now()
    where id = p_group_id and status = 'open';
end;
$$;

create or replace function reopen_link_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only admins can reopen link groups';
  end if;

  update link_groups
    set status = 'open', closed_at = null
    where id = p_group_id and status = 'closed';
end;
$$;
