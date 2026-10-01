-- FLH-FEAT-2026-014 v1.1
-- Proves that publishing a successor version does not strand an older
-- in-progress Learning or Exam attempt, while fresh starts still use latest.
do $contract$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_program constant uuid := '94000000-0000-4000-8000-000000000001';
  v_quiz constant uuid := '94000000-0000-4000-8000-000000000002';
  v_v1 constant uuid := '94000000-0000-4000-8000-000000000003';
  v_v2 constant uuid := '94000000-0000-4000-8000-000000000004';
  v_q1_learning constant uuid := '94000000-0000-4000-8000-000000000005';
  v_q1_exam constant uuid := '94000000-0000-4000-8000-000000000006';
  v_q2_learning constant uuid := '94000000-0000-4000-8000-000000000007';
  v_q2_exam constant uuid := '94000000-0000-4000-8000-000000000008';
  v_learning_attempt constant uuid := '94000000-0000-4000-8000-000000000009';
  v_exam_attempt constant uuid := '94000000-0000-4000-8000-000000000010';
  v_assignment constant uuid := '94000000-0000-4000-8000-000000000011';
  v_learner uuid;
  v_subject bigint;
  v_result jsonb;
  v_fresh_learning uuid;
  v_fresh_exam uuid;
  v_assigned_learning uuid;
  v_assigned_exam uuid;
begin
  select id into v_learner
  from public.learners
  where workspace_id=v_workspace
    and slug='test'
    and is_active
  limit 1;

  if v_learner is null then
    raise exception 'VERSION_RESUME_TEST_LEARNER_MISSING';
  end if;

  insert into public.subjects(code,name_ar,name_en)
  values('qa-version-resume','اختبار استئناف النسخة','Version resume QA')
  returning id into v_subject;

  insert into public.learning_programs(id,workspace_id,slug,title,status)
  values(v_program,v_workspace,'qa-version-resume-program','Version resume QA','active');

  insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status)
  values(v_workspace,v_learner,v_program,'active');

  insert into public.quizzes(
    id,workspace_id,subject_id,slug,title,status,delivery_config
  ) values (
    v_quiz,v_workspace,v_subject,'qa-version-resume-quiz','Version resume quiz','active',
    '{"exam":{"question_count":1}}'::jsonb
  );

  insert into public.program_quizzes(workspace_id,program_id,quiz_id,availability)
  values(v_workspace,v_program,v_quiz,'available');

  insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state)
  values
    (v_v1,v_workspace,v_quiz,1,'published'),
    (v_v2,v_workspace,v_quiz,2,'published');

  insert into public.quiz_questions(
    id,workspace_id,quiz_version_id,position,question_type,prompt,origin,
    points,difficulty_level,delivery_role,prompt_language
  ) values
    (v_q1_learning,v_workspace,v_v1,1,'single_choice','old learning prompt','generated',1,2,'core','en'),
    (v_q1_exam,v_workspace,v_v1,2,'single_choice','old exam prompt','generated',1,2,'exam_pool','en'),
    (v_q2_learning,v_workspace,v_v2,1,'single_choice','new learning prompt','generated',1,2,'core','en'),
    (v_q2_exam,v_workspace,v_v2,2,'single_choice','new exam prompt','generated',1,2,'exam_pool','en');

  insert into public.quiz_question_options(workspace_id,question_id,position,label,content)
  values
    (v_workspace,v_q1_learning,1,'A','old learning option'),
    (v_workspace,v_q1_exam,1,'A','old exam option'),
    (v_workspace,v_q2_learning,1,'A','new learning option'),
    (v_workspace,v_q2_exam,1,'A','new exam option');

  insert into public.quiz_attempts(
    id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata
  ) values
    (v_learning_attempt,v_workspace,v_learner,v_v1,'in_progress','learning','{"qa":"version-resume"}'::jsonb),
    (v_exam_attempt,v_workspace,v_learner,v_v1,'in_progress','exam','{"qa":"version-resume"}'::jsonb);

  insert into public.quiz_attempt_question_queue(
    workspace_id,quiz_attempt_id,sequence_no,question_id,source_role,
    difficulty_level,status,selection_reason
  ) values
    (v_workspace,v_learning_attempt,1,v_q1_learning,'core',2,'active','qa_old_learning'),
    (v_workspace,v_exam_attempt,1,v_q1_exam,'core',2,'active','qa_old_exam');

  insert into public.quiz_attempt_answers(
    workspace_id,attempt_id,question_id,response
  ) values (
    v_workspace,v_exam_attempt,v_q1_exam,'{"option_position":1}'::jsonb
  );

  set local role service_role;
  v_result := public.flh_learning_start(v_workspace,v_learner,'qa-version-resume-quiz');
  reset role;

  if v_result->>'attempt_id' <> v_learning_attempt::text
     or coalesce((v_result->>'resumed')::boolean,false) is not true
     or v_result->'queue'->0->'question'->>'prompt' <> 'old learning prompt' then
    raise exception 'VERSION_RESUME_LEARNING_OLD_ATTEMPT_NOT_RESUMED:%', v_result;
  end if;

  set local role service_role;
  v_result := public.flh_exam_start(v_workspace,v_learner,'qa-version-resume-quiz');
  reset role;

  if v_result->>'attempt_id' <> v_exam_attempt::text
     or coalesce((v_result->>'resumed')::boolean,false) is not true
     or v_result->'questions'->0->'question'->>'prompt' <> 'old exam prompt'
     or v_result->'questions'->0->'saved_response' <> '{"option_position":1}'::jsonb then
    raise exception 'VERSION_RESUME_EXAM_OLD_ATTEMPT_NOT_RESUMED:%', v_result;
  end if;

  update public.quiz_attempts
  set status='abandoned'
  where workspace_id=v_workspace
    and id in (v_learning_attempt,v_exam_attempt);

  set local role service_role;
  v_result := public.flh_learning_start(v_workspace,v_learner,'qa-version-resume-quiz');
  reset role;
  v_fresh_learning := (v_result->>'attempt_id')::uuid;

  if v_result->>'error' is not null
     or coalesce((v_result->>'resumed')::boolean,false) is true
     or v_result->'queue'->0->'question'->>'prompt' <> 'new learning prompt'
     or not exists (
       select 1 from public.quiz_attempts
       where id=v_fresh_learning
         and workspace_id=v_workspace
         and quiz_version_id=v_v2
         and delivery_mode='learning'
     ) then
    raise exception 'VERSION_RESUME_FRESH_LEARNING_NOT_LATEST:%', v_result;
  end if;

  set local role service_role;
  v_result := public.flh_exam_start(v_workspace,v_learner,'qa-version-resume-quiz');
  reset role;
  v_fresh_exam := (v_result->>'attempt_id')::uuid;

  if v_result->>'error' is not null
     or coalesce((v_result->>'resumed')::boolean,false) is true
     or v_result->'questions'->0->'question'->>'prompt' <> 'new exam prompt'
     or not exists (
       select 1 from public.quiz_attempts
       where id=v_fresh_exam
         and workspace_id=v_workspace
         and quiz_version_id=v_v2
         and delivery_mode='exam'
     ) then
    raise exception 'VERSION_RESUME_FRESH_EXAM_NOT_LATEST:%', v_result;
  end if;

  -- Remove the program-access path and prove that a still-valid assignment to
  -- v1 remains actionable after v2 exists.
  update public.quiz_attempts
  set status='abandoned'
  where workspace_id=v_workspace
    and id in (v_fresh_learning,v_fresh_exam);

  delete from public.learner_program_enrollments
  where workspace_id=v_workspace
    and learner_id=v_learner
    and program_id=v_program;

  insert into public.quiz_assignments(
    id,workspace_id,learner_id,quiz_version_id,status,available_at,due_at
  ) values (
    v_assignment,v_workspace,v_learner,v_v1,'assigned',
    now() - interval '1 hour',now() + interval '1 hour'
  );

  set local role service_role;
  v_result := public.flh_learning_start(v_workspace,v_learner,'qa-version-resume-quiz');
  reset role;
  v_assigned_learning := (v_result->>'attempt_id')::uuid;

  if v_result->>'error' is not null
     or coalesce((v_result->>'resumed')::boolean,false) is true
     or v_result->'queue'->0->'question'->>'prompt' <> 'old learning prompt'
     or not exists (
       select 1 from public.quiz_attempts
       where id=v_assigned_learning
         and workspace_id=v_workspace
         and quiz_version_id=v_v1
         and assignment_id=v_assignment
         and delivery_mode='learning'
     ) then
    raise exception 'VERSION_RESUME_ASSIGNED_LEARNING_VERSION_LOST:%', v_result;
  end if;

  set local role service_role;
  v_result := public.flh_exam_start(v_workspace,v_learner,'qa-version-resume-quiz');
  reset role;
  v_assigned_exam := (v_result->>'attempt_id')::uuid;

  if v_result->>'error' is not null
     or coalesce((v_result->>'resumed')::boolean,false) is true
     or v_result->'questions'->0->'question'->>'prompt' <> 'old exam prompt'
     or not exists (
       select 1 from public.quiz_attempts
       where id=v_assigned_exam
         and workspace_id=v_workspace
         and quiz_version_id=v_v1
         and delivery_mode='exam'
     ) then
    raise exception 'VERSION_RESUME_ASSIGNED_EXAM_VERSION_LOST:%', v_result;
  end if;

  delete from public.quiz_attempts
  where workspace_id=v_workspace
    and quiz_version_id in (v_v1,v_v2);

  delete from public.quiz_assignments
  where workspace_id=v_workspace and id=v_assignment;

  delete from public.learner_program_enrollments
  where workspace_id=v_workspace and program_id=v_program;

  delete from public.program_quizzes
  where workspace_id=v_workspace and program_id=v_program;

  delete from public.learning_programs
  where workspace_id=v_workspace and id=v_program;

  delete from public.quizzes
  where workspace_id=v_workspace and id=v_quiz;

  delete from public.subjects
  where id=v_subject;
end;
$contract$;
