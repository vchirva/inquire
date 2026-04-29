-- =============================================================================
-- Migration 0005 — Rewrite claim_session to return jsonb
-- =============================================================================
-- The previous TABLE-returning version was returning the result in a way that
-- PostgREST/Supabase JS interpreted as single-row-required, causing
-- "Cannot coerce the result to a single JSON object" errors. Returning jsonb
-- directly is unambiguous.
--
-- Postgres can't change a function's return type via CREATE OR REPLACE,
-- so we drop and recreate.

drop function if exists claim_session(uuid, uuid);

create function claim_session(
  p_group_token uuid,
  p_existing_session_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group link_groups%rowtype;
  v_session response_sessions%rowtype;
begin
  -- Find the link group
  select * into v_group from link_groups where group_token = p_group_token;
  if not found then
    raise exception 'invalid_group_token';
  end if;

  -- Try to resume existing session
  if p_existing_session_token is not null then
    select * into v_session
    from response_sessions
    where session_token = p_existing_session_token
      and link_group_id = v_group.id;

    if found then
      -- Always return existing session, regardless of status (so submitted shows thank-you)
      update response_sessions set last_activity_at = now() where id = v_session.id and status = 'in_progress';
      return jsonb_build_object(
        'session_token', v_session.session_token,
        'questionnaire_id', v_session.questionnaire_id,
        'status', v_session.status,
        'current_question_index', v_session.current_question_index
      );
    end if;
  end if;

  -- No resume — create new (only if group is open)
  if v_group.status = 'closed' then
    raise exception 'group_closed';
  end if;

  insert into response_sessions (link_group_id, questionnaire_id, client_id)
  values (v_group.id, v_group.questionnaire_id, v_group.client_id)
  returning * into v_session;

  return jsonb_build_object(
    'session_token', v_session.session_token,
    'questionnaire_id', v_session.questionnaire_id,
    'status', v_session.status,
    'current_question_index', v_session.current_question_index
  );
end;
$$;
