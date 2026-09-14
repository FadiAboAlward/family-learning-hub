do $setup$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_learner uuid;
  v_subject bigint;
  v_quiz constant uuid := '40000000-0000-4000-8000-000000000001';
  v_version constant uuid := '40000000-0000-4000-8000-000000000002';
  v_concept constant uuid := '40000000-0000-4000-8000-000000000003';
  v_question constant uuid := '40000000-0000-4000-8000-000000000004';
  v_next_question constant uuid := '40000000-0000-4000-8000-000000000005';
  v_attempt constant uuid := '50000000-0000-4000-8000-000000000001';
begin
  delete from public.quiz_attempts where id = v_attempt;
  delete from public.quizzes where id = v_quiz;
  delete from public.learning_concepts where id = v_concept;
  delete from public.subjects where code = 'QA-RPC-CONCURRENCY';

  select id into strict v_learner
  from public.learners
  where workspace_id = v_workspace
    and slug = 'test'
    and coalesce((metadata->>'is_test')::boolean, false);

  insert into public.subjects(code, name_ar, name_en)
  values ('QA-RPC-CONCURRENCY', 'اختبار تزامن RPC', 'RPC concurrency QA')
  returning id into v_subject;
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz, v_workspace, v_subject, 'qa-learning-answer-concurrency', 'Learning answer concurrency QA', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state, settings)
  values (v_version, v_workspace, v_quiz, 1, 'published', '{"attempt_scores":[100,75,50,25]}'::jsonb);
  insert into public.learning_concepts(id, workspace_id, subject_id, code, title)
  values (v_concept, v_workspace, v_subject, 'qa-rpc-concurrency', 'RPC concurrency concept');
  insert into public.quiz_questions(
    id, workspace_id, quiz_version_id, position, question_type, prompt, points,
    difficulty_level, max_attempts, remediation_after_attempt, delivery_role, question_code
  ) values
    (v_question, v_workspace, v_version, 1, 'single_choice', 'Concurrent answer', 1, 3, 4, 3, 'core', 'Q-91300101'),
    (v_next_question, v_workspace, v_version, 2, 'single_choice', 'Next answer', 1, 3, 4, 3, 'core', 'Q-91300102');
  insert into public.quiz_question_options(workspace_id, question_id, position, label, content)
  values
    (v_workspace, v_question, 1, 'A', 'wrong'),
    (v_workspace, v_question, 2, 'B', 'correct');
  insert into public.quiz_question_answer_keys(
    question_id, workspace_id, correct_answer, explanation, correct_explanation, final_incorrect_explanation
  ) values (
    v_question, v_workspace, '{"option_position":2}'::jsonb,
    'base explanation', 'correct explanation', 'final incorrect explanation'
  );
  insert into public.quiz_question_concepts(workspace_id, question_id, concept_id, is_primary)
  values (v_workspace, v_question, v_concept, true);
  insert into public.quiz_attempts(id, workspace_id, learner_id, quiz_version_id, status, delivery_mode)
  values (v_attempt, v_workspace, v_learner, v_version, 'in_progress', 'learning');
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, concept_id, difficulty_level, status
  ) values
    (v_workspace, v_attempt, 1, v_question, v_concept, 3, 'active'),
    (v_workspace, v_attempt, 2, v_next_question, v_concept, 3, 'pending');
end;
$setup$;
