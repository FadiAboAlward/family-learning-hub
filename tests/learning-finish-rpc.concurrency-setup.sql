do $setup$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_learner uuid;
  v_subject bigint;
  v_quiz constant uuid := '94000000-0000-4000-8000-000000000001';
  v_version constant uuid := '94000000-0000-4000-8000-000000000002';
  v_question constant uuid := '94000000-0000-4000-8000-000000000003';
  v_attempt constant uuid := '94000000-0000-4000-8000-000000000004';
begin
  delete from public.quiz_attempts where id = v_attempt;
  delete from public.quizzes where id = v_quiz;
  delete from public.subjects where code = 'QA-LEARNING-FINISH-CONCURRENCY';

  select id into strict v_learner
  from public.learners
  where workspace_id = v_workspace and slug = 'test'
    and coalesce((metadata->>'is_test')::boolean, false);
  delete from public.gamification_events
  where learner_id = v_learner and source_id like 'qa-learning-finish-concurrency%';
  delete from public.learner_badges
  using public.gamification_badges badge
  where learner_badges.badge_id = badge.id
    and learner_badges.learner_id = v_learner
    and badge.code = 'concept-master';
  insert into public.learner_gamification_state(
    workspace_id, learner_id, xp, reward_points, current_level,
    current_streak, longest_streak, last_learning_date
  ) values (v_workspace, v_learner, 0, 0, 1, 0, 0, null)
  on conflict (learner_id) do update
  set xp = 0, reward_points = 0, current_level = 1, current_streak = 0,
      longest_streak = 0, last_learning_date = null;

  insert into public.subjects(code, name_ar, name_en)
  values ('QA-LEARNING-FINISH-CONCURRENCY', 'اختبار تزامن الإنهاء', 'Finish concurrency QA')
  returning id into v_subject;
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz, v_workspace, v_subject, 'qa-learning-finish-concurrency', 'Finish concurrency QA', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_version, v_workspace, v_quiz, 1, 'published');
  insert into public.quiz_questions(
    id, workspace_id, quiz_version_id, position, question_type, prompt, points,
    difficulty_level, max_attempts, remediation_after_attempt, delivery_role, question_code
  ) values (v_question, v_workspace, v_version, 1, 'single_choice', 'Concurrent finish', 1, 2, 4, 3, 'core', 'Q-91500401');
  insert into public.quiz_question_options(workspace_id, question_id, position, content)
  values (v_workspace, v_question, 1, 'correct');
  insert into public.quiz_question_answer_keys(
    question_id, workspace_id, correct_answer, explanation, correct_explanation, final_incorrect_explanation
  ) values (v_question, v_workspace, '{"option_position":1}', 'base', 'correct', 'incorrect');
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, difficulty_level, status, source_role
  ) values (v_workspace, v_attempt, 1, v_question, 2, 'completed', 'core');
  insert into public.quiz_attempt_answers(
    workspace_id, attempt_id, question_id, response, evaluation, is_correct,
    points_awarded, attempts_used, hints_used, first_try_correct, mastery_result
  ) values (v_workspace, v_attempt, v_question, '{"option_position":1}', 'correct', true, 1, 1, 0, true, 'mastered');
end;
$setup$;
