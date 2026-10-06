-- FLH-FEAT-2026-020 v1.1
-- Canonical paper/digital Learning mutual-exclusion contract.
do $contract$
declare
  w uuid;
  l uuid;
  v uuid;
  v_slug text := 'tr-g5-meb-support-s2-decimals';
  v_model text;
  paper_one jsonb;
  learning_result jsonb;
  paper_one_id uuid;
  learning_id uuid;
  assignment_preexisting boolean;
begin
  select id into strict w from public.workspaces where slug='family-learning-hub';
  select id into strict l
  from public.learners
  where workspace_id=w and slug='test' and is_active
    and coalesce((metadata->>'is_test')::boolean,false);

  select qv.id, qv.settings->'paper_exam'->>'paper_model_code'
    into strict v, v_model
  from public.quizzes q
  join public.quiz_versions qv
    on qv.workspace_id=q.workspace_id and qv.quiz_id=q.id and qv.state='published'
  where q.workspace_id=w and q.slug=v_slug
    and coalesce((q.delivery_config->>'support_session')::boolean,false)
    and coalesce((qv.settings->>'support_source')::boolean,false)
  order by qv.version_no desc
  limit 1;

  if nullif(v_model,'') is null then
    raise exception 'SUPPORT_DELIVERY_MODEL_MISSING';
  end if;

  if exists(
    select 1 from public.quiz_attempts
    where workspace_id=w and learner_id=l and quiz_version_id=v
      and status in ('in_progress','submitted')
  ) then
    raise exception 'SUPPORT_DELIVERY_TEST_PRECONDITION_ACTIVE_ATTEMPT';
  end if;

  select exists(
    select 1 from public.quiz_assignments
    where workspace_id=w and learner_id=l and quiz_version_id=v
  ) into assignment_preexisting;

  set local role service_role;
  paper_one:=public.flh_paper_exam_start(w,l,v,v_model,'qa_mutual_exclusion');
  reset role;

  if coalesce((paper_one->>'ok')::boolean,false) is not true
     or paper_one->>'resumed' is distinct from 'false' then
    raise exception 'SUPPORT_DELIVERY_PAPER_START_INVALID:%',paper_one;
  end if;
  paper_one_id:=(paper_one->>'attempt_id')::uuid;

  set local role service_role;
  learning_result:=public.flh_learning_start(w,l,v_slug);
  reset role;
  if learning_result->>'error' is distinct from 'QUIZ_NOT_AVAILABLE' then
    raise exception 'SUPPORT_DELIVERY_IN_PROGRESS_PAPER_DID_NOT_BLOCK_LEARNING:%',learning_result;
  end if;
  if exists(
    select 1 from public.quiz_attempts
    where workspace_id=w and learner_id=l and quiz_version_id=v
      and delivery_mode='learning' and status='in_progress'
  ) then
    raise exception 'SUPPORT_DELIVERY_DUPLICATE_LEARNING_CREATED';
  end if;

  update public.quiz_attempts
  set status='abandoned'
  where workspace_id=w and id=paper_one_id;

  set local role service_role;
  learning_result:=public.flh_learning_start(w,l,v_slug);
  reset role;
  if learning_result ? 'error'
     or nullif(learning_result->>'attempt_id','') is null
     or learning_result->>'resumed' is distinct from 'false' then
    raise exception 'SUPPORT_DELIVERY_ABANDONED_PAPER_STILL_BLOCKED_LEARNING:%',learning_result;
  end if;
  learning_id:=(learning_result->>'attempt_id')::uuid;

  delete from public.quiz_attempts where workspace_id=w and id=learning_id;

  -- Submitted-paper exclusion is already exercised by
  -- tests/support-workbook-paper-ingestion.contract.sql using the canonical
  -- start/save/submit path. This focused contract avoids fabricating a
  -- submitted attempt because submission intentionally triggers mastery
  -- recording and requires complete evaluated answers.

  delete from public.quiz_attempts
  where workspace_id=w and id=paper_one_id;

  if not assignment_preexisting then
    delete from public.quiz_assignments
    where workspace_id=w and learner_id=l and quiz_version_id=v
      and metadata->>'source'='support_workbook_paper';
  end if;
end;
$contract$;
