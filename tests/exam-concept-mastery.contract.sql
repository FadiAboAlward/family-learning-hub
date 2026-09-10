-- Database-backed contract for Exam Mode concept mastery.
-- Run only against an environment that contains the Family Learning Hub Testing
-- learner and the approved Mohammad paper fixture. Every mutation is rolled back.

begin;

do $contract$
declare
  v_workspace uuid;
  v_test uuid;
  v_version uuid;
  v_addsub uuid;
  v_muldiv uuid;
  v_attempt uuid;
  v_started jsonb;
  v_submitted jsonb;
  v_again jsonb;
  v_backfill jsonb;
  v_unvalidated uuid;
  v_malformed_validated uuid;
  v_q13 uuid;
  v_add_evidence_before integer;
  v_mul_evidence_before integer;
  v_add_first_before integer;
  v_mul_first_before integer;
  v_add_evidence_after integer;
  v_mul_evidence_after integer;
  v_add_first_after integer;
  v_mul_first_after integer;
  r record;
begin
  select id into v_workspace from public.workspaces where slug='family-learning-hub' limit 1;
  select id into v_test from public.learners where workspace_id=v_workspace and slug='test' and is_active=true limit 1;
  select id into v_version
  from public.quiz_versions
  where workspace_id=v_workspace
    and state='published'
    and settings->'paper_exam'->>'paper_model_code'='MOH-MATH7-U1-INT-PAPER-20260909-G'
  limit 1;
  select id into v_addsub from public.learning_concepts where workspace_id=v_workspace and code='sy-g7-integers-add-subtract' limit 1;
  select id into v_muldiv from public.learning_concepts where workspace_id=v_workspace and code='sy-g7-integers-multiply-divide' limit 1;

  if v_workspace is null or v_test is null or v_version is null or v_addsub is null or v_muldiv is null then
    raise exception 'CONTRACT_FIXTURE_MISSING';
  end if;

  if has_function_privilege('anon','public.flh_record_exam_concept_mastery(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.flh_record_exam_concept_mastery(uuid,uuid)','EXECUTE') then
    raise exception 'CONTRACT_LEARNER_ROLE_EXECUTE_LEAK';
  end if;
  if not has_function_privilege('service_role','public.flh_record_exam_concept_mastery(uuid,uuid)','EXECUTE') then
    raise exception 'CONTRACT_SERVICE_ROLE_EXECUTE_MISSING';
  end if;

  -- Verify that the schema enforces at most one primary concept link per question.
  select q.id into v_q13
  from public.quiz_questions q
  where q.workspace_id=v_workspace and q.quiz_version_id=v_version and q.position=13
  limit 1;
  begin
    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight)
    values(v_workspace,v_q13,v_addsub,true,1);
    raise exception 'CONTRACT_PRIMARY_CONCEPT_UNIQUENESS_NOT_ENFORCED';
  exception
    when unique_violation then null;
  end;

  -- Keep the Testing fixture deterministic without leaving any change behind.
  delete from public.quiz_attempts
  where workspace_id=v_workspace
    and learner_id=v_test
    and metadata->>'paper_model_code'='MOH-MATH7-U1-INT-PAPER-20260909-G';

  select coalesce((select evidence_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_addsub),0),
         coalesce((select evidence_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_muldiv),0),
         coalesce((select first_try_correct_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_addsub),0),
         coalesce((select first_try_correct_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_muldiv),0)
    into v_add_evidence_before,v_mul_evidence_before,v_add_first_before,v_mul_first_before;

  v_started := public.flh_paper_exam_start(
    v_workspace,v_test,v_version,'MOH-MATH7-U1-INT-PAPER-20260909-G','qa_mastery_contract'
  );
  if coalesce((v_started->>'ok')::boolean,false) is not true then
    raise exception 'CONTRACT_PAPER_START_FAILED:%',v_started;
  end if;
  v_attempt := (v_started->>'attempt_id')::uuid;

  for r in
    select qq.question_id,(k.correct_answer->>'option_position')::integer as option_position
    from public.quiz_attempt_question_queue qq
    join public.quiz_question_answer_keys k
      on k.workspace_id=qq.workspace_id and k.question_id=qq.question_id
    where qq.workspace_id=v_workspace and qq.quiz_attempt_id=v_attempt
    order by qq.sequence_no
  loop
    perform public.flh_exam_save_answer(v_workspace,v_test,v_attempt,r.question_id,r.option_position);
  end loop;

  v_submitted := public.flh_exam_submit(v_workspace,v_test,v_attempt);
  if coalesce((v_submitted->>'ok')::boolean,false) is not true
     or (v_submitted->>'percentage')::numeric <> 100 then
    raise exception 'CONTRACT_EXAM_SUBMIT_FAILED:%',v_submitted;
  end if;

  if not exists (
    select 1 from public.quiz_attempts a
    where a.workspace_id=v_workspace and a.id=v_attempt
      and a.status='submitted'
      and coalesce((a.metadata->>'concept_mastery_recorded')::boolean,false) is true
      and (a.metadata->>'concept_mastery_evidence_count')::integer=20
      and (a.metadata->>'concept_mastery_concept_count')::integer=2
  ) then
    raise exception 'CONTRACT_ATTEMPT_MARKER_INVALID';
  end if;

  select coalesce((select evidence_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_addsub),0),
         coalesce((select evidence_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_muldiv),0),
         coalesce((select first_try_correct_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_addsub),0),
         coalesce((select first_try_correct_count from public.learner_concept_mastery where workspace_id=v_workspace and learner_id=v_test and concept_id=v_muldiv),0)
    into v_add_evidence_after,v_mul_evidence_after,v_add_first_after,v_mul_first_after;

  if v_add_evidence_after <> v_add_evidence_before+13
     or v_mul_evidence_after <> v_mul_evidence_before+7
     or v_add_first_after <> v_add_first_before+13
     or v_mul_first_after <> v_mul_first_before+7 then
    raise exception 'CONTRACT_PRIMARY_EVIDENCE_COUNTS_INVALID';
  end if;

  v_again := public.flh_record_exam_concept_mastery(v_workspace,v_attempt);
  if coalesce((v_again->>'ok')::boolean,false) is not true
     or coalesce((v_again->>'already_recorded')::boolean,false) is not true then
    raise exception 'CONTRACT_IDEMPOTENCY_FAILED:%',v_again;
  end if;

  -- Backfill contract: paper_ingested without a validated queue is not eligible.
  insert into public.quiz_attempts(
    workspace_id,learner_id,quiz_version_id,status,delivery_mode,submitted_at,metadata
  ) values (
    v_workspace,v_test,v_version,'submitted','exam',clock_timestamp(),
    jsonb_build_object('paper_ingested',true,'paper_queue_validated',false,'contract_fixture','unvalidated')
  ) returning id into v_unvalidated;

  -- A row carrying both eligibility flags but lacking graded queue evidence is
  -- selected and reported as skipped, without aborting the backfill.
  insert into public.quiz_attempts(
    workspace_id,learner_id,quiz_version_id,status,delivery_mode,submitted_at,metadata
  ) values (
    v_workspace,v_test,v_version,'submitted','exam',clock_timestamp(),
    jsonb_build_object('paper_ingested',true,'paper_queue_validated',true,'contract_fixture','malformed_validated')
  ) returning id into v_malformed_validated;

  v_backfill := public.flh_backfill_paper_exam_concept_mastery();
  if coalesce((v_backfill->>'ok')::boolean,false) is not true
     or not (coalesce(v_backfill->'skipped_attempt_ids','[]'::jsonb) @> jsonb_build_array(v_malformed_validated)) then
    raise exception 'CONTRACT_BACKFILL_SKIP_REPORTING_FAILED:%',v_backfill;
  end if;
  if coalesce((select (metadata->>'concept_mastery_recorded')::boolean from public.quiz_attempts where id=v_unvalidated),false) is true then
    raise exception 'CONTRACT_UNVALIDATED_PAPER_WAS_BACKFILLED';
  end if;
end;
$contract$;

rollback;
