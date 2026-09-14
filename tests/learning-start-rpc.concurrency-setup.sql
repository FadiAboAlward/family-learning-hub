do $setup$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_program constant uuid := '92000000-0000-4000-8000-000000000001';
  v_quiz constant uuid := '92000000-0000-4000-8000-000000000002';
  v_version constant uuid := '92000000-0000-4000-8000-000000000003';
  v_question_one constant uuid := '92000000-0000-4000-8000-000000000004';
  v_question_two constant uuid := '92000000-0000-4000-8000-000000000005';
  v_learner uuid;
  v_subject bigint;
begin
  -- Make the fixture rerunnable after an interrupted local test.
  delete from public.quiz_attempts where quiz_version_id = v_version;
  delete from public.quizzes where id = v_quiz;
  delete from public.learning_programs where id = v_program;
  delete from public.subjects where code = 'qa-learning-start-concurrency';

  select id into v_learner
  from public.learners
  where workspace_id = v_workspace and slug = 'test' and is_active;
  if v_learner is null then raise exception 'LEARNING_START_CONCURRENCY_TEST_LEARNER_MISSING'; end if;

  insert into public.subjects(code, name_ar, name_en)
  values ('qa-learning-start-concurrency', 'تزامن بدء التعلم', 'Learning start concurrency')
  returning id into v_subject;
  insert into public.learning_programs(id, workspace_id, slug, title, status)
  values (v_program, v_workspace, 'qa-learning-start-concurrency', 'Learning start concurrency', 'active');
  insert into public.learner_program_enrollments(workspace_id, learner_id, program_id, status)
  values (v_workspace, v_learner, v_program, 'active');
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz, v_workspace, v_subject, 'qa-learning-start-concurrency', 'Learning start concurrency', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_version, v_workspace, v_quiz, 1, 'published');
  insert into public.program_quizzes(workspace_id, program_id, quiz_id, availability)
  values (v_workspace, v_program, v_quiz, 'available');
  insert into public.quiz_questions(id, workspace_id, quiz_version_id, position, question_type, prompt, delivery_role)
  values
    (v_question_one, v_workspace, v_version, 1, 'single_choice', 'concurrent first', 'core'),
    (v_question_two, v_workspace, v_version, 2, 'single_choice', 'concurrent second', 'core');
  insert into public.quiz_question_options(workspace_id, question_id, position, content)
  values
    (v_workspace, v_question_one, 1, 'first option'),
    (v_workspace, v_question_two, 1, 'second option');
end;
$setup$;
