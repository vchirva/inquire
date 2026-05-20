-- =============================================================================
-- Migration 0007 — submit_session: respect conditional visibility
-- =============================================================================
-- The original submit_session required EVERY required question to have a
-- response row, ignoring show_if. If a respondent's path through the
-- questionnaire hid a required question via conditional logic, submit would
-- fail with required_questions_unanswered even though the respondent answered
-- everything the frontend showed them.
--
-- This migration rewrites the validation: a required question only blocks
-- submission if it would be visible given the respondent's answers.
--
-- Notes:
--   * Conditional evaluation here mirrors the frontend's matchCondition in
--     respondent.js (operators: equals, not_equals, contains).
--   * Forward-compat with the upcoming single_choice_spec type: when the
--     referenced answer is an object with a "value" key (the {value, spec}
--     shape), we compare against the .value field, matching frontend logic.
--   * One level of show_if chaining is evaluated directly. Nested chains
--     (A depends on B which depends on C) fall back to "treat as visible",
--     which is the safe/strict default and matches frontend behavior for the
--     common case.

create or replace function submit_session(p_session_token uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_session response_sessions%rowtype;
  v_q record;
  v_ref_answer jsonb;
  v_compare jsonb;
  v_op text;
  v_val jsonb;
  v_visible boolean;
begin
  select * into v_session
  from response_sessions
  where session_token = p_session_token and status = 'in_progress';

  if not found then
    raise exception 'session_not_found_or_already_submitted';
  end if;

  -- Walk required questions; only enforce those visible under current answers.
  for v_q in
    select id, show_if
    from questions
    where questionnaire_id = v_session.questionnaire_id
      and required = true
  loop
    v_visible := true;

    if v_q.show_if is not null
       and (v_q.show_if ? 'question_id')
       and nullif(v_q.show_if->>'question_id', '') is not null
    then
      -- Fetch referenced question's answer (if any) for this session.
      select answer into v_ref_answer
      from responses
      where session_id = v_session.id
        and question_id = (v_q.show_if->>'question_id')::uuid;

      if v_ref_answer is null then
        v_visible := false;
      else
        v_op := coalesce(v_q.show_if->>'operator', 'equals');
        v_val := v_q.show_if->'value';

        -- Unwrap {value, spec} answer shape (single_choice_spec).
        v_compare := v_ref_answer;
        if jsonb_typeof(v_compare) = 'object' and v_compare ? 'value' then
          v_compare := v_compare->'value';
        end if;

        if v_op = 'equals' then
          if jsonb_typeof(v_compare) = 'array' then
            v_visible := v_compare @> jsonb_build_array(v_val);
          else
            v_visible := v_compare = v_val;
          end if;
        elsif v_op = 'not_equals' then
          if jsonb_typeof(v_compare) = 'array' then
            v_visible := not (v_compare @> jsonb_build_array(v_val));
          else
            v_visible := v_compare <> v_val;
          end if;
        elsif v_op = 'contains' then
          if jsonb_typeof(v_compare) = 'array' then
            v_visible := v_compare @> jsonb_build_array(v_val);
          else
            v_visible := position(
              coalesce(v_val#>>'{}', '') in coalesce(v_compare#>>'{}', '')
            ) > 0;
          end if;
        end if;
      end if;
    end if;

    if v_visible then
      if not exists (
        select 1 from responses r
        where r.session_id = v_session.id and r.question_id = v_q.id
      ) then
        raise exception 'required_questions_unanswered';
      end if;
    end if;
  end loop;

  update response_sessions
  set status = 'submitted',
      submitted_at = now()
  where id = v_session.id;
end;
$$;
