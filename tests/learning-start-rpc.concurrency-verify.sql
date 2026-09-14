do $verify$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_program constant uuid := '92000000-0000-4000-8000-000000000001';
  v_quiz constant uuid := '92000000-0000-4000-8000-000000000002';
  v_version constant uuid := '92000000-0000-4000-8000-000000000003';
  v_attempt uuid;
  v_subject bigint;
  v_learner uuid;
begin
  select id into v_learner from public.learners where workspace_id = v_workspace and slug = 'test';
  select id into v_attempt
  from public.quiz_attempts
  where workspace_id = v_workspace
    and learner_id = v_learner
    and quiz_version_id = v_version
    and status = 'in_progress'
    and delivery_mode = 'learning';

  if v_attempt is null
     or (select count(*) from public.quiz_attempts where workspace_id = v_workspace and learner_id = v_learner and quiz_version_id = v_version and status = 'in_progress' and delivery_mode = 'learning') <> 1 then
    raise exception 'LEARNING_START_CONCURRENT_ATTEMPT_DUPLICATED';
  end if;
  if (select count(*) from public.quiz_attempt_question_queue where quiz_attempt_id = v_attempt) <> 2
     or (select count(*) from public.quiz_attempt_question_queue where quiz_attempt_id = v_attempt and status = 'active') <> 1
     or (select count(*) from public.quiz_attempt_question_queue where quiz_attempt_id = v_attempt and status = 'pending') <> 1
     or exists (
       select 1 from public.quiz_attempt_question_queue
       where quiz_attempt_id = v_attempt
       group by sequence_no having count(*) > 1
     ) then
    raise exception 'LEARNING_START_CONCURRENT_QUEUE_DUPLICATED_OR_INVALID';
  end if;

  select subject_id into v_subject from public.quizzes where id = v_quiz;
  delete from public.quiz_attempts where id = v_attempt;
  delete from public.quizzes where id = v_quiz;
  delete from public.learning_programs where id = v_program;
  delete from public.subjects where id = v_subject;
end;
$verify$;
