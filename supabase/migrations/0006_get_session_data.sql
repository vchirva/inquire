-- =============================================================================
-- Migration 0006 — Respondent: load questionnaire + questions
-- =============================================================================
-- Anonymous respondents can't read questionnaires/questions directly under RLS.
-- This RPC takes a valid session token and returns the questionnaire shell plus
-- its questions, all in one call.

create or replace function get_session_data(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session response_sessions%rowtype;
  v_questionnaire jsonb;
  v_questions jsonb;
begin
  select * into v_session from response_sessions where session_token = p_token;
  if not found then
    raise exception 'invalid_session';
  end if;

  select to_jsonb(q) - 'created_by' into v_questionnaire
    from questionnaires q
    where q.id = v_session.questionnaire_id;

  select coalesce(jsonb_agg(to_jsonb(qq) order by qq.order_index), '[]'::jsonb) into v_questions
    from questions qq
    where qq.questionnaire_id = v_session.questionnaire_id;

  return jsonb_build_object(
    'questionnaire', v_questionnaire,
    'questions', v_questions
  );
end;
$$;
