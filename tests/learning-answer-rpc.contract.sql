-- Transactional contract coverage for public.flh_learning_answer.
-- All fixtures use the existing local `test` learner. The single DO statement
-- is atomic and removes its fixtures after successful assertions.

do $contract$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_learner uuid;
  v_other_learner constant uuid := '10000000-0000-4000-8000-000000000099';
  v_subject bigint;
  v_quiz constant uuid := '10000000-0000-4000-8000-000000000001';
  v_version constant uuid := '10000000-0000-4000-8000-000000000002';
  v_concept_one constant uuid := '10000000-0000-4000-8000-000000000003';
  v_concept_two constant uuid := '10000000-0000-4000-8000-000000000004';
  v_concept_three constant uuid := '10000000-0000-4000-8000-000000000005';
  v_q_one constant uuid := '10000000-0000-4000-8000-000000000011';
  v_q_two constant uuid := '10000000-0000-4000-8000-000000000012';
  v_q_rem_one constant uuid := '10000000-0000-4000-8000-000000000013';
  v_q_end constant uuid := '10000000-0000-4000-8000-000000000014';
  v_q_outside constant uuid := '10000000-0000-4000-8000-000000000015';
  v_q_rem_two constant uuid := '10000000-0000-4000-8000-000000000016';
  v_attempt_a constant uuid := '20000000-0000-4000-8000-000000000001';
  v_attempt_b constant uuid := '20000000-0000-4000-8000-000000000002';
  v_attempt_c constant uuid := '20000000-0000-4000-8000-000000000003';
  v_attempt_d constant uuid := '20000000-0000-4000-8000-000000000004';
  v_attempt_e constant uuid := '20000000-0000-4000-8000-000000000005';
  v_attempt_f constant uuid := '20000000-0000-4000-8000-000000000006';
  v_attempt_g constant uuid := '20000000-0000-4000-8000-000000000007';
  v_misconception constant uuid := '30000000-0000-4000-8000-000000000001';
  v_wrong_option uuid;
  v_result jsonb;
  v_retry jsonb;
  v_keys text[];
begin
  select l.id into strict v_learner
  from public.learners l
  where l.workspace_id = v_workspace
    and l.slug = 'test'
    and coalesce((l.metadata->>'is_test')::boolean, false);

  insert into public.learners(id, workspace_id, display_name, slug, is_active, metadata)
  values (
    v_other_learner,
    v_workspace,
    'Local RPC Test Learner',
    'test-rpc-other',
    true,
    '{"is_test":true,"qa_automation":true,"exclude_from_parent_metrics":true}'::jsonb
  );

  insert into public.subjects(code, name_ar, name_en)
  values ('QA-RPC', 'اختبار RPC', 'RPC QA')
  returning id into v_subject;

  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz, v_workspace, v_subject, 'qa-learning-answer-rpc', 'Learning answer RPC QA', 'active');

  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state, settings)
  values (v_version, v_workspace, v_quiz, 1, 'published', '{"attempt_scores":[100,75,50,25]}'::jsonb);

  insert into public.learning_concepts(id, workspace_id, subject_id, code, title)
  values
    (v_concept_one, v_workspace, v_subject, 'qa-rpc-one', 'RPC concept one'),
    (v_concept_two, v_workspace, v_subject, 'qa-rpc-two', 'RPC concept two'),
    (v_concept_three, v_workspace, v_subject, 'qa-rpc-three', 'RPC concept three');

  insert into public.quiz_questions(
    id, workspace_id, quiz_version_id, position, question_type, prompt, points,
    difficulty_level, max_attempts, remediation_after_attempt, delivery_role, question_code
  ) values
    (v_q_one, v_workspace, v_version, 1, 'single_choice', 'Core one', 2, 3, 4, 3, 'core', 'Q-91300001'),
    (v_q_two, v_workspace, v_version, 2, 'single_choice', 'Core two', 1, 2, 2, 2, 'core', 'Q-91300002'),
    (v_q_rem_one, v_workspace, v_version, 3, 'single_choice', 'Remediation one', 1, 3, 4, 3, 'remediation_pool', 'Q-91300003'),
    (v_q_end, v_workspace, v_version, 4, 'single_choice', 'End question', 1, 1, 4, 3, 'core', 'Q-91300004'),
    (v_q_outside, v_workspace, v_version, 5, 'single_choice', 'Outside queue', 1, 1, 4, 3, 'challenge_pool', 'Q-91300005'),
    (v_q_rem_two, v_workspace, v_version, 6, 'single_choice', 'Remediation two', 1, 2, 2, 2, 'remediation_pool', 'Q-91300006');

  insert into public.quiz_question_options(workspace_id, question_id, position, label, content)
  select v_workspace, q.question_id, option_row.position, option_row.label, option_row.content
  from (values (v_q_one), (v_q_two), (v_q_rem_one), (v_q_end), (v_q_outside), (v_q_rem_two)) q(question_id)
  cross join (values (1, 'A', 'wrong'), (2, 'B', 'correct')) option_row(position, label, content);

  insert into public.quiz_question_answer_keys(
    question_id, workspace_id, correct_answer, explanation,
    correct_explanation, final_incorrect_explanation
  )
  select q.question_id,
         v_workspace,
         '{"option_position":2}'::jsonb,
         'base explanation',
         'correct explanation',
         'final incorrect explanation'
  from (values (v_q_one), (v_q_two), (v_q_rem_one), (v_q_end), (v_q_outside), (v_q_rem_two)) q(question_id);

  insert into public.quiz_question_hints(
    workspace_id, question_id, hint_level, pedagogical_role, content, language, terminology_display_mode
  ) values
    (v_workspace, v_q_one, 1, 'nudge', 'hint one', 'ar', 'inherit'),
    (v_workspace, v_q_one, 2, 'guide', 'hint two', 'ar', 'inherit'),
    (v_workspace, v_q_one, 3, 'strong_guide', 'hint three', 'ar', 'inherit'),
    (v_workspace, v_q_one, 4, 'near_solution', 'hint four', 'ar', 'inherit'),
    (v_workspace, v_q_two, 1, 'nudge', 'second question hint', 'ar', 'inherit');

  insert into public.quiz_question_concepts(workspace_id, question_id, concept_id, is_primary)
  values
    (v_workspace, v_q_one, v_concept_one, true),
    (v_workspace, v_q_rem_one, v_concept_one, true),
    (v_workspace, v_q_two, v_concept_two, true),
    (v_workspace, v_q_rem_two, v_concept_two, true),
    (v_workspace, v_q_end, v_concept_three, true);

  insert into public.misconceptions(id, workspace_id, concept_id, code, title)
  values (v_misconception, v_workspace, v_concept_one, 'qa-rpc-distractor', 'Mapped distractor');
  select id into strict v_wrong_option
  from public.quiz_question_options
  where workspace_id = v_workspace and question_id = v_q_one and position = 1;
  insert into public.question_option_misconceptions(workspace_id, option_id, misconception_id)
  values (v_workspace, v_wrong_option, v_misconception);

  -- First-try correct, final persistence, mastery, next activation, and exact
  -- same-option retry without duplicate side effects.
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt_a, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status, draft_option_position
  ) values
    (v_workspace, v_attempt_a, 1, v_q_one, v_concept_one, 3, 'active', 2),
    (v_workspace, v_attempt_a, 2, v_q_two, v_concept_two, 2, 'pending', null);

  v_result := public.flh_learning_answer(v_workspace, v_learner, v_attempt_a, v_q_one, 2);
  if v_result @> '{"is_correct":true,"attempt_no":1,"finalized":true,"hint":null,"hint_level":null,"hints_used":0,"remediation_added":null,"explanation":"correct explanation","correct_option_position":2}'::jsonb is not true then
    raise exception 'LEARNING_RPC_FIRST_TRY_CONTRACT_INVALID:%', v_result;
  end if;
  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_result) key;
  if v_keys <> array['attempt_no','correct_option_position','explanation','finalized','hint','hint_level','hints_used','is_correct','remediation_added']::text[] then
    raise exception 'LEARNING_RPC_RESPONSE_KEYS_INVALID:%', v_keys;
  end if;
  if not exists (
    select 1 from public.quiz_attempt_answers
    where attempt_id = v_attempt_a and question_id = v_q_one
      and is_correct and points_awarded = 2 and attempts_used = 1
      and hints_used = 0 and first_try_correct and mastery_result = 'mastered'
  ) then raise exception 'LEARNING_RPC_FINAL_ANSWER_INVALID'; end if;
  if not exists (
    select 1 from public.quiz_attempt_question_queue
    where quiz_attempt_id = v_attempt_a and question_id = v_q_one
      and status = 'completed' and draft_option_position is null
  ) or not exists (
    select 1 from public.quiz_attempt_question_queue
    where quiz_attempt_id = v_attempt_a and question_id = v_q_two and status = 'active'
  ) then raise exception 'LEARNING_RPC_NEXT_ACTIVATION_INVALID'; end if;
  if not exists (
    select 1 from public.learner_concept_mastery
    where learner_id = v_learner and concept_id = v_concept_one
      and mastery_score = 100 and evidence_count = 1
      and first_try_correct_count = 1 and total_question_count = 1 and total_hint_count = 0
  ) then raise exception 'LEARNING_RPC_FIRST_MASTERY_INVALID'; end if;

  v_retry := public.flh_learning_answer(v_workspace, v_learner, v_attempt_a, v_q_one, 2);
  if v_retry <> v_result then raise exception 'LEARNING_RPC_RETRY_RESPONSE_DRIFT'; end if;
  if (select count(*) from public.quiz_answer_attempts where quiz_attempt_id = v_attempt_a and question_id = v_q_one) <> 1
     or (select evidence_count from public.learner_concept_mastery where learner_id = v_learner and concept_id = v_concept_one) <> 1
     or (select count(*) from public.quiz_attempt_question_queue where quiz_attempt_id = v_attempt_a and status = 'active') <> 1 then
    raise exception 'LEARNING_RPC_RETRY_DUPLICATED_SIDE_EFFECTS';
  end if;
  if public.flh_learning_answer(v_workspace, v_learner, v_attempt_a, v_q_one, 1)->>'error' <> 'QUESTION_NOT_ACTIVE' then
    raise exception 'LEARNING_RPC_STALE_DIFFERENT_RETRY_NOT_REJECTED';
  end if;

  -- Progressive incorrect feedback, mapped-distractor non-classification parity,
  -- remediation insertion, and a fourth-attempt final correct result.
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt_b, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status, draft_option_position
  ) values (v_workspace, v_attempt_b, 1, v_q_one, v_concept_one, 3, 'active', 1);

  v_result := public.flh_learning_answer(v_workspace, v_learner, v_attempt_b, v_q_one, 1);
  if v_result @> '{"is_correct":false,"attempt_no":1,"finalized":false,"hint_level":1,"hints_used":1,"explanation":null,"correct_option_position":null}'::jsonb is not true
     or v_result->'hint'->>'content' <> 'hint one' then
    raise exception 'LEARNING_RPC_INCORRECT_HINT_ONE_INVALID:%', v_result;
  end if;
  if exists (select 1 from public.quiz_attempt_answers where attempt_id = v_attempt_b)
     or exists (select 1 from public.adaptive_events where quiz_attempt_id = v_attempt_b)
     or exists (
       select 1 from public.quiz_answer_attempts
       where quiz_attempt_id = v_attempt_b
         and (detected_misconception_id is not null or error_classification <> '{}'::jsonb)
     ) then raise exception 'LEARNING_RPC_NONFINAL_OR_MISCONCEPTION_PARITY_INVALID'; end if;

  perform public.flh_learning_answer(v_workspace, v_learner, v_attempt_b, v_q_one, 1);
  v_result := public.flh_learning_answer(v_workspace, v_learner, v_attempt_b, v_q_one, 1);
  if v_result->>'attempt_no' <> '3'
     or v_result->>'finalized' <> 'false'
     or v_result->'remediation_added'->>'question_id' <> v_q_rem_one::text
     or v_result->'remediation_added'->'question'->>'question_code' <> 'Q-91300003'
     or v_result->'remediation_added'->'question'->'options' is null
     or v_result->'remediation_added'->'question'->'assets' <> '[]'::jsonb then
    raise exception 'LEARNING_RPC_REMEDIATION_PAYLOAD_INVALID:%', v_result;
  end if;
  v_result := public.flh_learning_answer(v_workspace, v_learner, v_attempt_b, v_q_one, 2);
  if v_result @> '{"is_correct":true,"attempt_no":4,"finalized":true,"hints_used":3,"explanation":"correct explanation","correct_option_position":2}'::jsonb is not true then
    raise exception 'LEARNING_RPC_FINAL_CORRECT_INVALID:%', v_result;
  end if;
  if not exists (
    select 1 from public.quiz_attempt_answers
    where attempt_id = v_attempt_b and question_id = v_q_one
      and points_awarded = 0.5 and attempts_used = 4 and hints_used = 3
      and not first_try_correct and mastery_result = 'needs_practice'
  ) or not exists (
    select 1 from public.learner_concept_mastery
    where learner_id = v_learner and concept_id = v_concept_one
      and mastery_score = 62.50 and evidence_count = 2
      and first_try_correct_count = 1 and total_question_count = 2 and total_hint_count = 3
  ) or not exists (
    select 1 from public.quiz_attempt_question_queue
    where quiz_attempt_id = v_attempt_b and question_id = v_q_rem_one and status = 'active'
  ) then raise exception 'LEARNING_RPC_FINAL_CORRECT_SIDE_EFFECT_INVALID'; end if;

  -- Incorrect finalization at max attempts and same-transaction remediation.
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt_c, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status
  ) values (v_workspace, v_attempt_c, 1, v_q_two, v_concept_two, 2, 'active');
  perform public.flh_learning_answer(v_workspace, v_learner, v_attempt_c, v_q_two, 1);
  v_result := public.flh_learning_answer(v_workspace, v_learner, v_attempt_c, v_q_two, 1);
  if v_result @> '{"is_correct":false,"attempt_no":2,"finalized":true,"hint":null,"hint_level":null,"hints_used":1,"explanation":"final incorrect explanation","correct_option_position":2}'::jsonb is not true
     or v_result->'remediation_added'->>'question_id' <> v_q_rem_two::text then
    raise exception 'LEARNING_RPC_FINAL_INCORRECT_INVALID:%', v_result;
  end if;
  if not exists (
    select 1 from public.quiz_attempt_answers
    where attempt_id = v_attempt_c and question_id = v_q_two
      and not is_correct and points_awarded = 0 and attempts_used = 2
      and hints_used = 2 and mastery_result = 'not_mastered'
  ) or not exists (
    select 1 from public.learner_concept_mastery
    where learner_id = v_learner and concept_id = v_concept_two
      and mastery_score = 0 and evidence_count = 1 and total_hint_count = 2
  ) or not exists (
    select 1 from public.quiz_attempt_question_queue
    where quiz_attempt_id = v_attempt_c and question_id = v_q_rem_two and status = 'active'
  ) then raise exception 'LEARNING_RPC_FINAL_INCORRECT_SIDE_EFFECT_INVALID'; end if;

  -- End-of-queue leaves no active/pending row for the separate finish action.
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt_d, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status
  ) values (v_workspace, v_attempt_d, 1, v_q_end, v_concept_three, 1, 'active');
  perform public.flh_learning_answer(v_workspace, v_learner, v_attempt_d, v_q_end, 2);
  if exists (
    select 1 from public.quiz_attempt_question_queue
    where quiz_attempt_id = v_attempt_d and status in ('active', 'pending')
  ) then raise exception 'LEARNING_RPC_END_OF_QUEUE_INVALID'; end if;

  -- Input, ownership, attempt, question, completion, and workspace rejection.
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt_e, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status
  ) values (v_workspace, v_attempt_e, 1, v_q_end, v_concept_three, 1, 'active');
  if public.flh_learning_answer(v_workspace, v_learner, v_attempt_e, v_q_end, 99)->>'error' <> 'INVALID_ANSWER'
     or public.flh_learning_answer(v_workspace, v_other_learner, v_attempt_e, v_q_end, 2)->>'error' <> 'ATTEMPT_NOT_ACTIVE'
     or public.flh_learning_answer(v_workspace, v_learner, gen_random_uuid(), v_q_end, 2)->>'error' <> 'ATTEMPT_NOT_ACTIVE'
     or public.flh_learning_answer(v_workspace, v_learner, v_attempt_e, v_q_outside, 2)->>'error' <> 'QUESTION_NOT_ACTIVE'
     or public.flh_learning_answer(gen_random_uuid(), v_learner, v_attempt_e, v_q_end, 2)->>'error' <> 'ATTEMPT_NOT_ACTIVE' then
    raise exception 'LEARNING_RPC_REJECTION_CONTRACT_INVALID';
  end if;
  if exists (select 1 from public.quiz_answer_attempts where quiz_attempt_id = v_attempt_e) then
    raise exception 'LEARNING_RPC_REJECTION_WROTE_ATTEMPT';
  end if;

  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt_f, v_workspace, v_learner, v_version, 'submitted', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status
  ) values (v_workspace, v_attempt_f, 1, v_q_end, v_concept_three, 1, 'active');
  if public.flh_learning_answer(v_workspace, v_learner, v_attempt_f, v_q_end, 2)->>'error' <> 'ATTEMPT_NOT_ACTIVE' then
    raise exception 'LEARNING_RPC_COMPLETED_ATTEMPT_NOT_REJECTED';
  end if;

  -- Preserve the defensive max-attempt error for inconsistent legacy state.
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt_g, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status
  ) values (v_workspace, v_attempt_g, 1, v_q_end, v_concept_three, 1, 'active');
  insert into public.quiz_answer_attempts(
    workspace_id, quiz_attempt_id, question_id, attempt_no, response, is_correct, score_fraction
  )
  select v_workspace, v_attempt_g, v_q_end, n, jsonb_build_object('option_position', 1), false, 0
  from generate_series(1, 4) n;
  if public.flh_learning_answer(v_workspace, v_learner, v_attempt_g, v_q_end, 2)->>'error' <> 'MAX_ATTEMPTS_REACHED'
     or (select count(*) from public.quiz_answer_attempts where quiz_attempt_id = v_attempt_g) <> 4 then
    raise exception 'LEARNING_RPC_MAX_ATTEMPT_GUARD_INVALID';
  end if;

  if has_function_privilege('anon', 'public.flh_learning_answer(uuid,uuid,uuid,uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.flh_learning_answer(uuid,uuid,uuid,uuid,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.flh_learning_answer(uuid,uuid,uuid,uuid,integer)', 'execute') then
    raise exception 'LEARNING_RPC_PRIVILEGES_INVALID';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.flh_learning_answer(uuid,uuid,uuid,uuid,integer)'::regprocedure
      and (
        p.prosecdef
        or not exists (
          select 1
          from unnest(coalesce(p.proconfig, '{}'::text[])) setting
          where setting in ('search_path=', 'search_path=""')
        )
      )
  ) then raise exception 'LEARNING_RPC_SECURITY_CONFIGURATION_INVALID'; end if;

  delete from public.quiz_attempts
  where id in (v_attempt_a, v_attempt_b, v_attempt_c, v_attempt_d, v_attempt_e, v_attempt_f, v_attempt_g);
  delete from public.quizzes where id = v_quiz;
  delete from public.learning_concepts where id in (v_concept_one, v_concept_two, v_concept_three);
  delete from public.subjects where id = v_subject;
  delete from public.learners where id = v_other_learner;
end;
$contract$;
