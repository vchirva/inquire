-- =============================================================================
-- Migration 0004 — Respondent helper RPCs
-- =============================================================================

-- Returns the response_session.id for a valid session token.
-- Public (security definer); validates that the token corresponds to a real
-- in-progress session before returning the id.

create or replace function get_session_id_by_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from response_sessions where session_token = p_token;
  return v_id;
end;
$$;

-- Returns previously-saved answers for a session token.
-- Used by the respondent UI to restore state on resume.

create or replace function get_session_answers(p_token uuid)
returns table (question_id uuid, answer jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  select id into v_session_id from response_sessions where session_token = p_token;
  if v_session_id is null then
    return;
  end if;

  return query
    select r.question_id, r.answer
    from responses r
    where r.session_id = v_session_id;
end;
$$;
