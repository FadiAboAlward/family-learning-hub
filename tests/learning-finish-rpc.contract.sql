-- Transactional behavior, scoring/gamification parity, privacy, and retry
-- coverage for public.flh_learning_finish. Runs only on the disposable DB.
do $contract$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_other_workspace constant uuid := '93000000-0000-4000-8000-000000000001';
  v_other_learner constant uuid := '93000000-0000-4000-8000-000000000002';
  v_quiz constant uuid := '93000000-0000-4000-8000-000000000003';
  v_version constant uuid := '93000000-0000-4000-8000-000000000004';
  v_q1 constant uuid := '93000000-0000-4000-8000-000000000005';
  v_q2 constant uuid := '93000000-0000-4000-8000-000000000006';
  v_q3 constant uuid := '93000000-0000-4000-8000-000000000007';
  v_q4 constant uuid := '93000000-0000-4000-8000-000000000008';
  v_attempt constant uuid := '93000000-0000-4000-8000-000000000009';
  v_repeat_attempt constant uuid := '93000000-0000-4000-8000-000000000010';
  v_incomplete_attempt constant uuid := '93000000-0000-4000-8000-000000000011';
  v_exam_attempt constant uuid := '93000000-0000-4000-8000-000000000012';
  v_other_attempt constant uuid := '93000000-0000-4000-8000-000000000013';
  v_atomic_attempt constant uuid := '93000000-0000-4000-8000-000000000014';
  v_learner uuid;
  v_subject bigint;
  v_keep_going_badge uuid;
  v_result jsonb;
  v_retry jsonb;
  v_repeat jsonb;
  v_error jsonb;
  v_submitted_at timestamptz;
  v_keys text[];
begin
  select id into strict v_learner
  from public.learners
  where workspace_id = v_workspace
    and slug = 'test'
    and is_active
    and coalesce((metadata->>'is_test')::boolean, false);

  delete from public.quiz_attempts
  where id in (v_attempt, v_repeat_attempt, v_incomplete_attempt, v_exam_attempt, v_other_attempt, v_atomic_attempt);
  delete from public.learners where id = v_other_learner;
  delete from public.quizzes where id = v_quiz;
  delete from public.subjects where code = 'QA-LEARNING-FINISH-RPC';
  delete from public.gamification_events
  where workspace_id = v_workspace and learner_id = v_learner
    and source_id like 'qa-learning-finish-rpc%';
  delete from public.learner_badges
  where workspace_id = v_workspace and learner_id = v_learner
    and award_reason = 'quiz:qa-learning-finish-rpc';

  insert into public.subjects(code, name_ar, name_en)
  values ('QA-LEARNING-FINISH-RPC', 'اختبار إنهاء التعلم', 'Learning finish RPC QA')
  returning id into v_subject;
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz, v_workspace, v_subject, 'qa-learning-finish-rpc', 'Learning finish RPC QA', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_version, v_workspace, v_quiz, 1, 'published');
  insert into public.quiz_questions(
    id, workspace_id, quiz_version_id, position, question_type, prompt, points,
    difficulty_level, max_attempts, remediation_after_attempt, delivery_role, question_code
  ) values
    (v_q1, v_workspace, v_version, 1, 'single_choice', 'finish prompt one', 2, 2, 4, 3, 'core', 'Q-91500001'),
    (v_q2, v_workspace, v_version, 2, 'single_choice', 'finish prompt two', 2, 2, 4, 3, 'core', 'Q-91500002'),
    (v_q3, v_workspace, v_version, 3, 'single_choice', 'finish prompt three', 2, 3, 4, 3, 'core', 'Q-91500003'),
    (v_q4, v_workspace, v_version, 4, 'single_choice', 'finish prompt four', 1, 3, 4, 3, 'core', 'Q-91500004');
  insert into public.quiz_question_options(workspace_id, question_id, position, content)
  select v_workspace, question_id, 1, 'answer'
  from unnest(array[v_q1, v_q2, v_q3, v_q4]) question_id;
  insert into public.quiz_question_answer_keys(
    question_id, workspace_id, correct_answer, explanation,
    correct_explanation, final_incorrect_explanation, grading_config
  ) values
    (v_q1, v_workspace, '{"option_position":1,"sentinel":"FINISH_KEY_ONE"}', 'base one', 'correct one', 'incorrect one', '{"private":"DO_NOT_EXPOSE"}'),
    (v_q2, v_workspace, '{"option_position":1,"sentinel":"FINISH_KEY_TWO"}', 'base two', 'correct two', 'incorrect two', '{"private":"DO_NOT_EXPOSE"}'),
    (v_q3, v_workspace, '{"option_position":1,"sentinel":"FINISH_KEY_THREE"}', 'base three', 'correct three', 'incorrect three', '{"private":"DO_NOT_EXPOSE"}'),
    (v_q4, v_workspace, '{"option_position":1,"sentinel":"FINISH_KEY_FOUR"}', 'base four', 'correct four', 'final incorrect four', '{"private":"DO_NOT_EXPOSE"}');

  insert into public.learner_gamification_state(
    workspace_id, learner_id, xp, reward_points, current_level,
    current_streak, longest_streak, last_learning_date
  ) values (
    v_workspace, v_learner, 240, 9, 1, 2, 3,
    ((now() at time zone 'UTC')::date - 1)
  ) on conflict (learner_id) do update
  set xp = excluded.xp,
      reward_points = excluded.reward_points,
      current_level = excluded.current_level,
      current_streak = excluded.current_streak,
      longest_streak = excluded.longest_streak,
      last_learning_date = excluded.last_learning_date;

  select id into strict v_keep_going_badge
  from public.gamification_badges
  where workspace_id = v_workspace and code = 'keep-going';
  insert into public.learner_badges(workspace_id, learner_id, badge_id, award_reason)
  values (v_workspace, v_learner, v_keep_going_badge, 'quiz:qa-learning-finish-rpc');

  insert into public.quiz_attempts(
    id, workspace_id, learner_id, quiz_version_id, status, delivery_mode, started_at, metadata
  ) values (
    v_attempt, v_workspace, v_learner, v_version, 'in_progress', 'learning', now() - interval '10 minutes',
    '{"quiz_slug":"qa-learning-finish-rpc","server_state":true,"preserve":"yes"}'::jsonb
  );
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, difficulty_level, status, source_role
  ) values
    (v_workspace, v_attempt, 1, v_q1, 2, 'completed', 'core'),
    (v_workspace, v_attempt, 2, v_q2, 2, 'completed', 'core'),
    (v_workspace, v_attempt, 3, v_q3, 3, 'completed', 'core'),
    (v_workspace, v_attempt, 4, v_q4, 3, 'completed', 'core');
  insert into public.quiz_attempt_answers(
    workspace_id, attempt_id, question_id, response, evaluation, is_correct,
    points_awarded, attempts_used, hints_used, first_try_correct, mastery_result
  ) values
    (v_workspace, v_attempt, v_q1, '{"option_position":1}', 'correct', true, 2, 1, 0, true, 'mastered'),
    (v_workspace, v_attempt, v_q2, '{"option_position":1}', 'correct', true, 2, 1, 0, true, 'mastered'),
    (v_workspace, v_attempt, v_q3, '{"option_position":1}', 'correct', true, 2, 2, 2, false, 'mastered'),
    (v_workspace, v_attempt, v_q4, '{"option_position":2}', 'incorrect', false, 0, 4, 0, false, 'not_mastered');

  set local role service_role;
  v_result := public.flh_learning_finish(v_workspace, v_learner, v_attempt, 123);
  reset role;

  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_result) key;
  if v_keys <> array['attempt_id','award','first_try_correct','hints_used','max_points','ok','percentage','quiz','review','score_points']::text[]
     or v_result->>'attempt_id' <> v_attempt::text
     or v_result->'quiz' <> '{"slug":"qa-learning-finish-rpc","title":"Learning finish RPC QA"}'::jsonb
     or (v_result->>'score_points')::numeric <> 6
     or (v_result->>'max_points')::numeric <> 7
     or (v_result->>'percentage')::numeric <> 85.71
     or (v_result->>'first_try_correct')::integer <> 2
     or (v_result->>'hints_used')::integer <> 2
     or v_result->'award' <> '{"already_awarded":false,"xp":65,"reward_points":10,"badges":["first-try","keep-going","concept-master"]}'::jsonb
     or jsonb_array_length(v_result->'review') <> 4
     or v_result->'review'->0->>'question_code' <> 'Q-91500001'
     or v_result->'review'->0->>'explanation' <> 'correct one'
     or v_result->'review'->3->>'explanation' <> 'final incorrect four'
     or v_result->'review'->3->'correct_answer'->>'sentinel' <> 'FINISH_KEY_FOUR'
     or v_result::text like '%DO_NOT_EXPOSE%'
     or v_result::text like '%grading_config%'
     or v_result::text like '%' || v_learner::text || '%' then
    raise exception 'LEARNING_FINISH_RESPONSE_OR_SCORING_INVALID:%', v_result;
  end if;

  if not exists (
    select 1 from public.quiz_attempts
    where id = v_attempt and status = 'submitted' and submitted_at is not null
      and score_points = 6 and max_points = 7 and percentage = 85.71
      and duration_seconds = 123
      and metadata @> '{"engine":"learning-api-v2","server_graded":true,"first_try_correct":2,"hints_used":2}'::jsonb
      and metadata @> '{"quiz_slug":"qa-learning-finish-rpc","server_state":true,"preserve":"yes"}'::jsonb
      and metadata->'learning_finish_last_result' = v_result
  ) then raise exception 'LEARNING_FINISH_ATTEMPT_FINALIZATION_INVALID'; end if;
  select submitted_at into strict v_submitted_at from public.quiz_attempts where id = v_attempt;

  if not exists (
    select 1 from public.learner_gamification_state
    where learner_id = v_learner and workspace_id = v_workspace
      and xp = 305 and reward_points = 19 and current_level = 2
      and current_streak = 3 and longest_streak = 3
      and last_learning_date = (now() at time zone 'UTC')::date
  ) then raise exception 'LEARNING_FINISH_GAMIFICATION_STATE_INVALID'; end if;
  if (select count(*) from public.gamification_events
      where workspace_id = v_workspace and learner_id = v_learner
        and event_type = 'quiz_completed' and source_type = 'quiz'
        and source_id like 'qa-learning-finish-rpc:test:%'
        and xp_delta = 65 and reward_points_delta = 10
        and metadata @> '{"percentage":85.71,"first_try_correct":2,"hints_used":2,"engine":"learning-api-v2"}'::jsonb) <> 1 then
    raise exception 'LEARNING_FINISH_EVENT_INVALID';
  end if;
  if (select count(*) from public.learner_badges lb join public.gamification_badges b on b.id = lb.badge_id
      where lb.workspace_id = v_workspace and lb.learner_id = v_learner
        and b.code in ('first-try','keep-going','concept-master')) <> 3
     or (select count(*) from public.learner_badges where learner_id = v_learner and badge_id = v_keep_going_badge) <> 1 then
    raise exception 'LEARNING_FINISH_BADGE_OR_ALREADY_OWNED_INVALID';
  end if;

  -- Same-attempt retry returns the exact cached response and no side effects.
  set local role service_role;
  v_retry := public.flh_learning_finish(v_workspace, v_learner, v_attempt, 999);
  reset role;
  if v_retry <> v_result
     or (select submitted_at from public.quiz_attempts where id = v_attempt) <> v_submitted_at
     or (select duration_seconds from public.quiz_attempts where id = v_attempt) <> 123
     or (select count(*) from public.gamification_events where learner_id = v_learner and source_id like 'qa-learning-finish-rpc%') <> 1 then
    raise exception 'LEARNING_FINISH_RETRY_NOT_IDEMPOTENT:%', v_retry;
  end if;

  -- Recreate the normal learner's prior-award identity despite the local Test
  -- trigger, then prove another completed attempt receives no duplicate award.
  update public.gamification_events
  set source_id = 'qa-learning-finish-rpc'
  where learner_id = v_learner and source_id like 'qa-learning-finish-rpc:test:%';
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_repeat_attempt, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(workspace_id, quiz_attempt_id, sequence_no, question_id, difficulty_level, status, source_role)
  select v_workspace, v_repeat_attempt, position, id, difficulty_level, 'completed', 'core'
  from public.quiz_questions where quiz_version_id = v_version order by position;
  insert into public.quiz_attempt_answers(
    workspace_id, attempt_id, question_id, response, evaluation, is_correct,
    points_awarded, attempts_used, hints_used, first_try_correct, mastery_result
  ) select workspace_id, v_repeat_attempt, question_id, response, evaluation, is_correct,
           points_awarded, attempts_used, hints_used, first_try_correct, mastery_result
    from public.quiz_attempt_answers where attempt_id = v_attempt;
  set local role service_role;
  v_repeat := public.flh_learning_finish(v_workspace, v_learner, v_repeat_attempt, 10);
  reset role;
  if v_repeat->'award' <> '{"already_awarded":true,"xp":0,"reward_points":0,"badges":[]}'::jsonb
     or (select xp from public.learner_gamification_state where learner_id = v_learner) <> 305
     or (select count(*) from public.gamification_events where learner_id = v_learner and source_id = 'qa-learning-finish-rpc') <> 1 then
    raise exception 'LEARNING_FINISH_EXISTING_AWARD_INVALID:%', v_repeat;
  end if;

  -- Incomplete, Exam, invalid learner, wrong owner/attempt, and cross-workspace
  -- requests fail before review keys or completion side effects can be exposed.
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values
    (v_incomplete_attempt, v_workspace, v_learner, v_version, 'in_progress', 'learning'),
    (v_exam_attempt, v_workspace, v_learner, v_version, 'in_progress', 'exam');
  insert into public.quiz_attempt_question_queue(workspace_id, quiz_attempt_id, sequence_no, question_id, difficulty_level, status, source_role)
  values (v_workspace, v_incomplete_attempt, 1, v_q1, 2, 'active', 'core');
  set local role service_role;
  v_error := public.flh_learning_finish(v_workspace, v_learner, v_incomplete_attempt, 5);
  reset role;
  if v_error <> '{"error":"QUIZ_NOT_COMPLETE"}'::jsonb
     or v_error::text like '%FINISH_KEY_%'
     or exists (select 1 from public.quiz_attempts where id = v_incomplete_attempt and status <> 'in_progress') then
    raise exception 'LEARNING_FINISH_INCOMPLETE_INVALID:%', v_error;
  end if;
  set local role service_role;
  if public.flh_learning_finish(v_workspace, v_learner, v_exam_attempt, 5) <> '{"error":"ATTEMPT_NOT_ACTIVE"}'::jsonb
     or public.flh_learning_finish(v_workspace, gen_random_uuid(), v_incomplete_attempt, 5) <> '{"error":"ATTEMPT_NOT_ACTIVE"}'::jsonb
     or public.flh_learning_finish(v_workspace, v_learner, gen_random_uuid(), 5) <> '{"error":"ATTEMPT_NOT_ACTIVE"}'::jsonb
     or public.flh_learning_finish(v_other_workspace, v_learner, v_incomplete_attempt, 5) <> '{"error":"ATTEMPT_NOT_ACTIVE"}'::jsonb then
    raise exception 'LEARNING_FINISH_SCOPE_VALIDATION_INVALID';
  end if;
  reset role;

  insert into public.learners(id, workspace_id, display_name, slug, is_active, metadata)
  values (v_other_learner, v_workspace, 'Other local Testing learner', 'other-learning-finish-test', true, '{"is_test":true}');
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_other_attempt, v_workspace, v_other_learner, v_version, 'in_progress', 'learning');
  set local role service_role;
  v_error := public.flh_learning_finish(v_workspace, v_learner, v_other_attempt, 5);
  reset role;
  if v_error <> '{"error":"ATTEMPT_NOT_ACTIVE"}'::jsonb then
    raise exception 'LEARNING_FINISH_WRONG_OWNER_INVALID:%', v_error;
  end if;

  -- Force a late integer overflow and prove the transaction does not partially
  -- submit the attempt or create an event/badge before the failure.
  update public.gamification_events
  set source_id = 'qa-learning-finish-rpc:test:prior'
  where learner_id = v_learner and source_id = 'qa-learning-finish-rpc';
  update public.learner_gamification_state set xp = 2147483640 where learner_id = v_learner;
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_atomic_attempt, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(workspace_id, quiz_attempt_id, sequence_no, question_id, difficulty_level, status, source_role)
  select v_workspace, v_atomic_attempt, position, id, difficulty_level, 'completed', 'core'
  from public.quiz_questions where quiz_version_id = v_version order by position;
  insert into public.quiz_attempt_answers(
    workspace_id, attempt_id, question_id, response, evaluation, is_correct,
    points_awarded, attempts_used, hints_used, first_try_correct, mastery_result
  ) select workspace_id, v_atomic_attempt, question_id, response, evaluation, is_correct,
           points_awarded, attempts_used, hints_used, first_try_correct, mastery_result
    from public.quiz_attempt_answers where attempt_id = v_attempt;
  begin
    set local role service_role;
    perform public.flh_learning_finish(v_workspace, v_learner, v_atomic_attempt, 5);
    reset role;
    raise exception 'LEARNING_FINISH_ATOMIC_FAILURE_NOT_RAISED';
  exception when numeric_value_out_of_range then
    reset role;
  end;
  if not exists (select 1 from public.quiz_attempts where id = v_atomic_attempt and status = 'in_progress' and submitted_at is null)
     or (select count(*) from public.gamification_events where learner_id = v_learner and source_id like 'qa-learning-finish-rpc%') <> 1 then
    raise exception 'LEARNING_FINISH_ATOMIC_ROLLBACK_INVALID';
  end if;

  if has_function_privilege('anon', 'public.flh_learning_finish(uuid,uuid,uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.flh_learning_finish(uuid,uuid,uuid,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.flh_learning_finish(uuid,uuid,uuid,integer)', 'execute') then
    raise exception 'LEARNING_FINISH_PRIVILEGES_INVALID';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.flh_learning_finish(uuid,uuid,uuid,integer)'::regprocedure
      and not p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
  ) then raise exception 'LEARNING_FINISH_SECURITY_MODE_INVALID'; end if;

  delete from public.quiz_attempts
  where id in (v_attempt, v_repeat_attempt, v_incomplete_attempt, v_exam_attempt, v_other_attempt, v_atomic_attempt);
  delete from public.learners where id = v_other_learner;
  delete from public.gamification_events
  where workspace_id = v_workspace and learner_id = v_learner and source_id like 'qa-learning-finish-rpc%';
  delete from public.learner_badges
  where workspace_id = v_workspace and learner_id = v_learner and award_reason = 'quiz:qa-learning-finish-rpc';
  delete from public.learner_gamification_state
  where learner_id = v_learner and workspace_id = v_workspace;
  delete from public.quizzes where id = v_quiz;
  delete from public.subjects where id = v_subject;
end;
$contract$;
