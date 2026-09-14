-- Transactional behavior and response-contract coverage for flh_learning_start.
-- Fixtures use only the local Testing learner and are removed before commit.
do $contract$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_other_workspace constant uuid := '91000000-0000-4000-8000-000000000001';
  v_inactive_learner constant uuid := '91000000-0000-4000-8000-000000000002';
  v_program constant uuid := '91000000-0000-4000-8000-000000000003';
  v_quiz_program constant uuid := '91000000-0000-4000-8000-000000000004';
  v_version_old constant uuid := '91000000-0000-4000-8000-000000000005';
  v_version_program constant uuid := '91000000-0000-4000-8000-000000000006';
  v_question_two constant uuid := '91000000-0000-4000-8000-000000000007';
  v_question_one constant uuid := '91000000-0000-4000-8000-000000000008';
  v_question_remediation constant uuid := '91000000-0000-4000-8000-000000000009';
  v_concept constant uuid := '91000000-0000-4000-8000-000000000010';
  v_asset constant uuid := '91000000-0000-4000-8000-000000000011';
  v_quiz_assignment constant uuid := '91000000-0000-4000-8000-000000000012';
  v_version_assignment constant uuid := '91000000-0000-4000-8000-000000000013';
  v_assignment constant uuid := '91000000-0000-4000-8000-000000000014';
  v_question_assignment constant uuid := '91000000-0000-4000-8000-000000000015';
  v_quiz_unavailable constant uuid := '91000000-0000-4000-8000-000000000016';
  v_version_unavailable constant uuid := '91000000-0000-4000-8000-000000000017';
  v_future_assignment constant uuid := '91000000-0000-4000-8000-000000000018';
  v_quiz_unpublished constant uuid := '91000000-0000-4000-8000-000000000019';
  v_version_draft constant uuid := '91000000-0000-4000-8000-000000000020';
  v_quiz_empty constant uuid := '91000000-0000-4000-8000-000000000021';
  v_version_empty constant uuid := '91000000-0000-4000-8000-000000000022';
  v_empty_assignment constant uuid := '91000000-0000-4000-8000-000000000023';
  v_other_quiz constant uuid := '91000000-0000-4000-8000-000000000024';
  v_other_version constant uuid := '91000000-0000-4000-8000-000000000025';
  v_learner uuid;
  v_subject bigint;
  v_result jsonb;
  v_resume jsonb;
  v_attempt uuid;
  v_assignment_attempt uuid;
  v_keys text[];
begin
  select id into v_learner
  from public.learners
  where workspace_id = v_workspace
    and slug = 'test'
    and is_active;
  if v_learner is null then raise exception 'LEARNING_START_TEST_LEARNER_MISSING'; end if;

  insert into public.subjects(code, name_ar, name_en)
  values ('qa-learning-start-rpc', 'اختبار بدء التعلم', 'Learning start RPC QA')
  returning id into v_subject;

  insert into public.learners(id, workspace_id, display_name, slug, is_active)
  values (v_inactive_learner, v_workspace, 'Inactive QA learner', 'inactive-learning-start-qa', false);

  insert into public.learning_programs(id, workspace_id, slug, title, status)
  values (v_program, v_workspace, 'qa-learning-start-program', 'Learning start QA program', 'active');
  insert into public.learner_program_enrollments(workspace_id, learner_id, program_id, status)
  values (v_workspace, v_learner, v_program, 'active');

  insert into public.quizzes(id, workspace_id, subject_id, slug, title, description, status)
  values (v_quiz_program, v_workspace, v_subject, 'qa-learning-start-program', 'Program start QA', 'program description', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values
    (v_version_old, v_workspace, v_quiz_program, 1, 'published'),
    (v_version_program, v_workspace, v_quiz_program, 2, 'published');
  insert into public.program_quizzes(workspace_id, program_id, quiz_id, availability)
  values (v_workspace, v_program, v_quiz_program, 'available');

  insert into public.learning_concepts(id, workspace_id, subject_id, code, title)
  values (v_concept, v_workspace, v_subject, 'qa-learning-start-concept', 'Learning start concept');
  insert into public.quiz_questions(
    id, workspace_id, quiz_version_id, position, question_type, prompt, origin,
    source_page_start, source_page_end, source_metadata, points,
    difficulty_level, max_attempts, remediation_after_attempt, delivery_role
  ) values
    (v_question_two, v_workspace, v_version_program, 2, 'single_choice', 'second prompt', 'generated', 12, 13, '{"source":"qa"}', 2, 4, 5, 3, 'core'),
    (v_question_one, v_workspace, v_version_program, 1, 'single_choice', 'first prompt', 'book_adapted', 10, 10, '{"source":"book"}', 1, 2, 4, 2, 'core'),
    (v_question_remediation, v_workspace, v_version_program, 3, 'single_choice', 'remediation prompt', 'generated', null, null, '{}', 1, 1, 4, 2, 'remediation_pool');
  update public.quiz_questions
  set question_code = case id
    when v_question_one then 'Q-91400001'
    when v_question_two then 'Q-91400002'
    else 'Q-91400003'
  end
  where id in (v_question_one, v_question_two, v_question_remediation);
  insert into public.quiz_question_concepts(workspace_id, question_id, concept_id, is_primary)
  values (v_workspace, v_question_one, v_concept, true);
  insert into public.quiz_question_options(workspace_id, question_id, position, label, content)
  values
    (v_workspace, v_question_one, 2, 'B', 'option two'),
    (v_workspace, v_question_one, 1, 'A', 'option one'),
    (v_workspace, v_question_two, 1, 'A', 'second question option'),
    (v_workspace, v_question_remediation, 1, 'A', 'remediation option');
  insert into public.assets(id, workspace_id, kind, storage_bucket, storage_path, mime_type, metadata)
  values (v_asset, v_workspace, 'image', 'qa-assets', 'learning/start.png', 'image/png', '{"public_url":"https://example.test/start.png"}');
  insert into public.quiz_question_assets(workspace_id, question_id, asset_id, position, purpose, alt_text)
  values (v_workspace, v_question_one, v_asset, 1, 'prompt', 'QA image');

  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, v_learner, 'qa-learning-start-program');
  reset role;
  if v_result->>'error' is not null or (v_result->>'resumed')::boolean then
    raise exception 'LEARNING_START_PROGRAM_NEW_INVALID:%', v_result;
  end if;
  v_attempt := (v_result->>'attempt_id')::uuid;
  if v_result->'quiz' <> '{"slug":"qa-learning-start-program","title":"Program start QA","description":"program description"}'::jsonb
     or jsonb_array_length(v_result->'queue') <> 2
     or v_result->'queue'->0->>'question_id' <> v_question_one::text
     or v_result->'queue'->1->>'question_id' <> v_question_two::text
     or v_result->'queue'->0->>'status' <> 'active'
     or v_result->'queue'->1->>'status' <> 'pending'
     or v_result->'queue'->0->>'source_role' <> 'core'
     or v_result->'queue'->0->>'concept_id' <> v_concept::text then
    raise exception 'LEARNING_START_QUEUE_ORDER_OR_STATE_INVALID:%', v_result;
  end if;
  if v_result->'queue'->0->'question' @> '{"question_code":"Q-91400001","position":1,"question_type":"single_choice","prompt":"first prompt","origin":"book_adapted","source_page_start":10,"source_page_end":10,"source_metadata":{"source":"book"},"points":1,"difficulty_level":2,"max_attempts":4,"remediation_after_attempt":2,"delivery_role":"core"}'::jsonb is not true
     or v_result->'queue'->0->'question'->'options'->0 @> '{"position":1,"label":"A","content":"option one"}'::jsonb is not true
     or v_result->'queue'->0->'question'->'options'->1 @> '{"position":2,"label":"B","content":"option two"}'::jsonb is not true
     or v_result->'queue'->0->'question'->'assets'->0 @> '{"position":1,"purpose":"prompt","alt_text":"QA image","kind":"image","mime_type":"image/png","url":"https://example.test/start.png","storage_bucket":"qa-assets","storage_path":"learning/start.png"}'::jsonb is not true
     or v_result::text like '%correct_answer%' then
    raise exception 'LEARNING_START_QUESTION_PAYLOAD_INVALID:%', v_result;
  end if;
  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_result) key;
  if v_keys <> array['attempt_id','queue','quiz','resumed','started_at']::text[] then
    raise exception 'LEARNING_START_RESPONSE_KEYS_INVALID:%', v_keys;
  end if;
  if not exists (
    select 1 from public.quiz_attempts
    where id = v_attempt and workspace_id = v_workspace and learner_id = v_learner
      and quiz_version_id = v_version_program and assignment_id is null
      and status = 'in_progress' and delivery_mode = 'learning'
      and metadata @> '{"engine":"learning-api-v2","quiz_slug":"qa-learning-start-program","server_state":true}'::jsonb
  ) then raise exception 'LEARNING_START_PROGRAM_ATTEMPT_INVALID'; end if;

  -- Restore persisted active/draft/hint state and a remediation queue row.
  update public.quiz_attempt_question_queue
  set status = case when question_id = v_question_one then 'completed' else 'active' end,
      draft_option_position = case when question_id = v_question_two then 1 else null end,
      hint_level_requested = case when question_id = v_question_two then 2 else 0 end
  where quiz_attempt_id = v_attempt;
  insert into public.quiz_attempt_question_queue(
    workspace_id, quiz_attempt_id, sequence_no, question_id, source_role,
    parent_question_id, concept_id, difficulty_level, status, selection_reason
  ) values (
    v_workspace, v_attempt, 3, v_question_remediation, 'remediation',
    v_question_one, v_concept, 1, 'pending', 'qa_resume_remediation'
  );
  set local role service_role;
  v_resume := public.flh_learning_start(v_workspace, v_learner, 'qa-learning-start-program');
  reset role;
  if not (v_resume->>'resumed')::boolean
     or v_resume->>'attempt_id' <> v_attempt::text
     or jsonb_array_length(v_resume->'queue') <> 3
     or v_resume->'queue'->1 @> '{"status":"active","draft_option_position":1,"hint_level_requested":2}'::jsonb is not true
     or v_resume->'queue'->2 @> '{"source_role":"remediation","status":"pending"}'::jsonb is not true
     or v_resume->'queue'->2->'question'->>'delivery_role' <> 'remediation_pool'
     or (select count(*) from public.quiz_attempts where learner_id = v_learner and quiz_version_id = v_version_program and status = 'in_progress' and delivery_mode = 'learning') <> 1
     or (select count(*) from public.quiz_attempt_question_queue where quiz_attempt_id = v_attempt) <> 3 then
    raise exception 'LEARNING_START_RESUME_INVALID:%', v_resume;
  end if;

  -- Direct assignment access and exact assignment linkage.
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz_assignment, v_workspace, v_subject, 'qa-learning-start-assignment', 'Assignment start QA', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_version_assignment, v_workspace, v_quiz_assignment, 1, 'published');
  insert into public.quiz_questions(id, workspace_id, quiz_version_id, position, question_type, prompt, delivery_role)
  values (v_question_assignment, v_workspace, v_version_assignment, 1, 'single_choice', 'assignment prompt', 'core');
  insert into public.quiz_question_options(workspace_id, question_id, position, content)
  values (v_workspace, v_question_assignment, 1, 'assignment option');
  insert into public.quiz_assignments(id, workspace_id, learner_id, quiz_version_id, status, available_at, due_at)
  values (v_assignment, v_workspace, v_learner, v_version_assignment, 'assigned', now() - interval '1 hour', now() + interval '1 hour');
  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, v_learner, 'qa-learning-start-assignment');
  reset role;
  v_assignment_attempt := (v_result->>'attempt_id')::uuid;
  if v_result->>'error' is not null
     or not exists (select 1 from public.quiz_attempts where id = v_assignment_attempt and assignment_id = v_assignment)
     or jsonb_array_length(v_result->'queue') <> 1 then
    raise exception 'LEARNING_START_ASSIGNMENT_INVALID:%', v_result;
  end if;

  -- Future assignment is unavailable; draft-only quiz has no published version.
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz_unavailable, v_workspace, v_subject, 'qa-learning-start-unavailable', 'Unavailable QA', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_version_unavailable, v_workspace, v_quiz_unavailable, 1, 'published');
  insert into public.quiz_assignments(id, workspace_id, learner_id, quiz_version_id, status, available_at)
  values (v_future_assignment, v_workspace, v_learner, v_version_unavailable, 'assigned', now() + interval '1 day');
  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, v_learner, 'qa-learning-start-unavailable');
  reset role;
  if v_result->>'error' <> 'QUIZ_NOT_AVAILABLE' then raise exception 'LEARNING_START_UNAVAILABLE_INVALID:%', v_result; end if;

  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz_unpublished, v_workspace, v_subject, 'qa-learning-start-unpublished', 'Unpublished QA', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_version_draft, v_workspace, v_quiz_unpublished, 1, 'draft');
  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, v_learner, 'qa-learning-start-unpublished');
  reset role;
  if v_result->>'error' <> 'VERSION_NOT_FOUND' then raise exception 'LEARNING_START_VERSION_INVALID:%', v_result; end if;

  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, v_learner, 'qa-learning-start-missing');
  reset role;
  if v_result->>'error' <> 'QUIZ_NOT_FOUND' then raise exception 'LEARNING_START_MISSING_INVALID:%', v_result; end if;

  -- Preserve the existing no-core-question contract: attempt plus empty queue.
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_quiz_empty, v_workspace, v_subject, 'qa-learning-start-empty', 'Empty QA', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_version_empty, v_workspace, v_quiz_empty, 1, 'published');
  insert into public.quiz_assignments(id, workspace_id, learner_id, quiz_version_id, status)
  values (v_empty_assignment, v_workspace, v_learner, v_version_empty, 'assigned');
  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, v_learner, 'qa-learning-start-empty');
  reset role;
  if v_result->>'error' is not null or v_result->'queue' <> '[]'::jsonb then
    raise exception 'LEARNING_START_EMPTY_QUEUE_PARITY_INVALID:%', v_result;
  end if;

  -- Missing/inactive learner and cross-workspace combinations never gain access.
  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, gen_random_uuid(), 'qa-learning-start-program');
  reset role;
  if v_result->>'error' <> 'QUIZ_NOT_AVAILABLE' then raise exception 'LEARNING_START_UNKNOWN_LEARNER_INVALID:%', v_result; end if;
  insert into public.quiz_assignments(workspace_id, learner_id, quiz_version_id, status)
  values (v_workspace, v_inactive_learner, v_version_program, 'assigned');
  set local role service_role;
  v_result := public.flh_learning_start(v_workspace, v_inactive_learner, 'qa-learning-start-program');
  reset role;
  if v_result->>'error' <> 'QUIZ_NOT_AVAILABLE' then raise exception 'LEARNING_START_INACTIVE_LEARNER_INVALID:%', v_result; end if;

  insert into public.workspaces(id, name, slug)
  values (v_other_workspace, 'Other learning start QA', 'other-learning-start-qa');
  insert into public.quizzes(id, workspace_id, subject_id, slug, title, status)
  values (v_other_quiz, v_other_workspace, v_subject, 'qa-learning-start-program', 'Other workspace quiz', 'active');
  insert into public.quiz_versions(id, workspace_id, quiz_id, version_no, state)
  values (v_other_version, v_other_workspace, v_other_quiz, 1, 'published');
  set local role service_role;
  v_result := public.flh_learning_start(v_other_workspace, v_learner, 'qa-learning-start-program');
  reset role;
  if v_result->>'error' <> 'QUIZ_NOT_AVAILABLE' then raise exception 'LEARNING_START_CROSS_WORKSPACE_INVALID:%', v_result; end if;

  if has_function_privilege('anon', 'public.flh_learning_start(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.flh_learning_start(uuid,uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.flh_learning_start(uuid,uuid,text)', 'execute') then
    raise exception 'LEARNING_START_PRIVILEGES_INVALID';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.flh_learning_start(uuid,uuid,text)'::regprocedure
      and (
        p.prosecdef
        or not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
          where setting in ('search_path=', 'search_path=""')
        )
      )
  ) then raise exception 'LEARNING_START_SECURITY_CONFIGURATION_INVALID'; end if;

  delete from public.workspaces where id = v_other_workspace;
  delete from public.assets where id = v_asset;
  delete from public.quiz_attempts where quiz_version_id in (
    v_version_program, v_version_assignment, v_version_unavailable, v_version_draft, v_version_empty
  );
  delete from public.quizzes where id in (
    v_quiz_program, v_quiz_assignment, v_quiz_unavailable, v_quiz_unpublished, v_quiz_empty
  );
  delete from public.learning_programs where id = v_program;
  delete from public.learning_concepts where id = v_concept;
  delete from public.learners where id = v_inactive_learner;
  delete from public.subjects where id = v_subject;
end;
$contract$;
