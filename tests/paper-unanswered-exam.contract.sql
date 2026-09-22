-- FLH-FEAT-2026-003 v1.0
-- Contract: paper exams preserve blank printed responses as explicit unanswered
-- evidence, while normal interactive Exam remains strict.
-- All mutations use the Testing learner and roll back.

do $contract$
declare
  v_workspace uuid;
  v_test uuid;
  v_version uuid;
  v_quiz uuid;
  v_slug text;
  v_assignment uuid;
  v_generic jsonb;
  v_generic_attempt uuid;
  v_generic_submit jsonb;
  v_started jsonb;
  v_attempt uuid;
  v_submitted jsonb;
  v_unanswered_count integer;
  v_bad_unanswered_count integer;
  v_wrong_selected_count integer;
  v_total_answers integer;
  v_paper_ingested boolean;
  v_mastery_recorded boolean;
  v_mastery_evidence integer;
  v_assignment_before jsonb;
  v_assignment_existed boolean := false;
  v_mastery_before jsonb := '[]'::jsonb;
  r record;
  v_option integer;
begin
  select id into v_workspace
  from public.workspaces
  where slug='family-learning-hub'
  limit 1;

  select id into v_test
  from public.learners
  where workspace_id=v_workspace
    and slug='test'
    and is_active=true
  limit 1;

  select v.id,q.id,q.slug
    into v_version,v_quiz,v_slug
  from public.quiz_versions v
  join public.quizzes q
    on q.workspace_id=v.workspace_id
   and q.id=v.quiz_id
  where v.workspace_id=v_workspace
    and v.state='published'
    and v.settings->'paper_exam'->>'paper_model_code'='MOH-TRMATH7-K1-TAM-PAPER-20260921-B'
  limit 1;

  if v_workspace is null or v_test is null or v_version is null or v_quiz is null then
    raise exception 'CONTRACT_FIXTURE_MISSING';
  end if;

  -- Deterministic cleanup inside this transaction only.
  delete from public.quiz_attempts
  where workspace_id=v_workspace
    and learner_id=v_test
    and quiz_version_id=v_version;

  select to_jsonb(qa) into v_assignment_before
  from public.quiz_assignments qa
  where qa.workspace_id=v_workspace
    and qa.learner_id=v_test
    and qa.quiz_version_id=v_version
  order by qa.created_at desc
  limit 1;

  v_assignment_existed := v_assignment_before is not null;

  select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into v_mastery_before
  from public.learner_concept_mastery m
  where m.workspace_id=v_workspace
    and m.learner_id=v_test
    and m.concept_id in (
      select distinct qc.concept_id
      from public.quiz_questions q
      join public.quiz_question_concepts qc
        on qc.workspace_id=q.workspace_id
       and qc.question_id=q.id
      where q.workspace_id=v_workspace
        and q.quiz_version_id=v_version
    );

  select id into v_assignment
  from public.quiz_assignments
  where workspace_id=v_workspace
    and learner_id=v_test
    and quiz_version_id=v_version
  order by created_at desc
  limit 1;

  if v_assignment is null then
    insert into public.quiz_assignments(
      workspace_id,learner_id,quiz_version_id,status,available_at,metadata
    ) values (
      v_workspace,v_test,v_version,'assigned',now(),
      jsonb_build_object('contract_fixture','paper_unanswered')
    ) returning id into v_assignment;
  else
    update public.quiz_assignments
    set status='assigned',available_at=now(),due_at=null
    where id=v_assignment;
  end if;

  -- Generic interactive Exam remains strict: zero saved answers cannot submit.
  v_generic := public.flh_exam_start(v_workspace,v_test,v_slug);
  if nullif(v_generic->>'attempt_id','') is null then
    raise exception 'CONTRACT_GENERIC_START_FAILED:%',v_generic;
  end if;
  v_generic_attempt := (v_generic->>'attempt_id')::uuid;

  v_generic_submit := public.flh_exam_submit(v_workspace,v_test,v_generic_attempt);
  if v_generic_submit->>'error' is distinct from 'EXAM_NOT_COMPLETE' then
    raise exception 'CONTRACT_GENERIC_EXAM_BECAME_NON_STRICT:%',v_generic_submit;
  end if;

  delete from public.quiz_attempts
  where workspace_id=v_workspace and id=v_generic_attempt;

  -- Start through the exact version-bound paper gate.
  v_started := public.flh_paper_exam_start(
    v_workspace,
    v_test,
    v_version,
    'MOH-TRMATH7-K1-TAM-PAPER-20260921-B',
    'qa_unanswered_contract'
  );

  if coalesce((v_started->>'ok')::boolean,false) is not true then
    raise exception 'CONTRACT_PAPER_START_FAILED:%',v_started;
  end if;

  v_attempt := (v_started->>'attempt_id')::uuid;

  -- Save 18 selections. Leave printed Q3 and Q17 genuinely blank.
  -- Make Q2 deliberately wrong to prove selected-wrong != unanswered.
  for r in
    select qq.sequence_no,qq.question_id,
           (k.correct_answer->>'option_position')::integer as correct_position
    from public.quiz_attempt_question_queue qq
    join public.quiz_question_answer_keys k
      on k.workspace_id=qq.workspace_id
     and k.question_id=qq.question_id
    where qq.workspace_id=v_workspace
      and qq.quiz_attempt_id=v_attempt
    order by qq.sequence_no
  loop
    if r.sequence_no in (3,17) then
      continue;
    end if;

    if r.sequence_no=2 then
      select min(o.position) into v_option
      from public.quiz_question_options o
      where o.workspace_id=v_workspace
        and o.question_id=r.question_id
        and o.position <> r.correct_position;
    else
      v_option := r.correct_position;
    end if;

    perform public.flh_exam_save_answer(
      v_workspace,v_test,v_attempt,r.question_id,v_option
    );
  end loop;

  v_submitted := public.flh_exam_submit(v_workspace,v_test,v_attempt);
  if coalesce((v_submitted->>'ok')::boolean,false) is not true then
    raise exception 'CONTRACT_PAPER_SUBMIT_FAILED:%',v_submitted;
  end if;

  if (v_submitted->>'score_points')::numeric <> 17
     or (v_submitted->>'max_points')::numeric <> 20
     or (v_submitted->>'percentage')::numeric <> 85 then
    raise exception 'CONTRACT_PAPER_SCORE_INVALID:%',v_submitted;
  end if;

  select count(*) into v_total_answers
  from public.quiz_attempt_answers
  where workspace_id=v_workspace and attempt_id=v_attempt;

  if v_total_answers <> 20 then
    raise exception 'CONTRACT_ANSWER_COUNT_INVALID:%',v_total_answers;
  end if;

  select count(*) into v_unanswered_count
  from public.quiz_attempt_answers aa
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id=aa.workspace_id
   and qq.quiz_attempt_id=aa.attempt_id
   and qq.question_id=aa.question_id
  where aa.workspace_id=v_workspace
    and aa.attempt_id=v_attempt
    and qq.sequence_no in (3,17)
    and aa.response='{"unanswered":true}'::jsonb
    and aa.evaluation='incorrect'
    and aa.is_correct=false
    and aa.points_awarded=0
    and aa.attempts_used=0
    and aa.hints_used=0
    and aa.first_try_correct=false
    and aa.mastery_result='not_mastered';

  if v_unanswered_count <> 2 then
    raise exception 'CONTRACT_UNANSWERED_ROWS_INVALID:%',v_unanswered_count;
  end if;

  select count(*) into v_bad_unanswered_count
  from public.quiz_attempt_answers aa
  where aa.workspace_id=v_workspace
    and aa.attempt_id=v_attempt
    and aa.response ? 'unanswered'
    and (
      aa.response <> '{"unanswered":true}'::jsonb
      or aa.response ? 'option_position'
    );

  if v_bad_unanswered_count <> 0 then
    raise exception 'CONTRACT_UNANSWERED_FABRICATED_OPTION';
  end if;

  select count(*) into v_wrong_selected_count
  from public.quiz_attempt_answers aa
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id=aa.workspace_id
   and qq.quiz_attempt_id=aa.attempt_id
   and qq.question_id=aa.question_id
  where aa.workspace_id=v_workspace
    and aa.attempt_id=v_attempt
    and qq.sequence_no=2
    and aa.response ? 'option_position'
    and not (aa.response ? 'unanswered')
    and aa.is_correct=false
    and aa.attempts_used=1
    and aa.hints_used=0;

  if v_wrong_selected_count <> 1 then
    raise exception 'CONTRACT_SELECTED_WRONG_WAS_NOT_PRESERVED';
  end if;

  select
    coalesce((a.metadata->>'paper_ingested')::boolean,false),
    coalesce((a.metadata->>'concept_mastery_recorded')::boolean,false),
    coalesce((a.metadata->>'concept_mastery_evidence_count')::integer,0)
  into v_paper_ingested,v_mastery_recorded,v_mastery_evidence
  from public.quiz_attempts a
  where a.workspace_id=v_workspace and a.id=v_attempt;

  if v_paper_ingested is not true
     or v_mastery_recorded is not true
     or v_mastery_evidence <> 20 then
    raise exception 'CONTRACT_PAPER_PROVENANCE_OR_MASTERY_INVALID';
  end if;

  -- Success cleanup: leave the Testing learner exactly as found.
  delete from public.quiz_attempts
  where workspace_id=v_workspace
    and learner_id=v_test
    and quiz_version_id=v_version;

  delete from public.learner_concept_mastery m
  where m.workspace_id=v_workspace
    and m.learner_id=v_test
    and m.concept_id in (
      select distinct qc.concept_id
      from public.quiz_questions q
      join public.quiz_question_concepts qc
        on qc.workspace_id=q.workspace_id
       and qc.question_id=q.id
      where q.workspace_id=v_workspace
        and q.quiz_version_id=v_version
    );

  insert into public.learner_concept_mastery(
    id,workspace_id,learner_id,concept_id,mastery_score,evidence_count,
    first_try_correct_count,total_question_count,total_hint_count,last_difficulty,
    last_assessed_at,metadata,created_at,updated_at
  )
  select
    x.id,x.workspace_id,x.learner_id,x.concept_id,x.mastery_score,x.evidence_count,
    x.first_try_correct_count,x.total_question_count,x.total_hint_count,x.last_difficulty,
    x.last_assessed_at,x.metadata,x.created_at,x.updated_at
  from jsonb_to_recordset(v_mastery_before) as x(
    id uuid, workspace_id uuid, learner_id uuid, concept_id uuid,
    mastery_score numeric, evidence_count integer, first_try_correct_count integer,
    total_question_count integer, total_hint_count integer, last_difficulty smallint,
    last_assessed_at timestamptz, metadata jsonb, created_at timestamptz, updated_at timestamptz
  );

  if v_assignment_existed then
    update public.quiz_assignments
    set status=v_assignment_before->>'status',
        available_at=(v_assignment_before->>'available_at')::timestamptz,
        due_at=(v_assignment_before->>'due_at')::timestamptz,
        max_attempts=(v_assignment_before->>'max_attempts')::integer,
        assigned_by=nullif(v_assignment_before->>'assigned_by','')::uuid,
        learner_program_enrollment_id=nullif(v_assignment_before->>'learner_program_enrollment_id','')::uuid,
        metadata=coalesce(v_assignment_before->'metadata','{}'::jsonb)
    where id=v_assignment;
  else
    delete from public.quiz_assignments
    where id=v_assignment;
  end if;

exception when others then
  -- Failure cleanup: best effort before re-raising the original assertion/error.
  if v_workspace is not null and v_test is not null and v_version is not null then
    delete from public.quiz_attempts
    where workspace_id=v_workspace
      and learner_id=v_test
      and quiz_version_id=v_version;

    delete from public.learner_concept_mastery m
    where m.workspace_id=v_workspace
      and m.learner_id=v_test
      and m.concept_id in (
        select distinct qc.concept_id
        from public.quiz_questions q
        join public.quiz_question_concepts qc
          on qc.workspace_id=q.workspace_id
         and qc.question_id=q.id
        where q.workspace_id=v_workspace
          and q.quiz_version_id=v_version
      );

    insert into public.learner_concept_mastery(
      id,workspace_id,learner_id,concept_id,mastery_score,evidence_count,
      first_try_correct_count,total_question_count,total_hint_count,last_difficulty,
      last_assessed_at,metadata,created_at,updated_at
    )
    select
      x.id,x.workspace_id,x.learner_id,x.concept_id,x.mastery_score,x.evidence_count,
      x.first_try_correct_count,x.total_question_count,x.total_hint_count,x.last_difficulty,
      x.last_assessed_at,x.metadata,x.created_at,x.updated_at
    from jsonb_to_recordset(coalesce(v_mastery_before,'[]'::jsonb)) as x(
      id uuid, workspace_id uuid, learner_id uuid, concept_id uuid,
      mastery_score numeric, evidence_count integer, first_try_correct_count integer,
      total_question_count integer, total_hint_count integer, last_difficulty smallint,
      last_assessed_at timestamptz, metadata jsonb, created_at timestamptz, updated_at timestamptz
    );

    if v_assignment is not null then
      if v_assignment_existed then
        update public.quiz_assignments
        set status=v_assignment_before->>'status',
            available_at=(v_assignment_before->>'available_at')::timestamptz,
            due_at=(v_assignment_before->>'due_at')::timestamptz,
            max_attempts=(v_assignment_before->>'max_attempts')::integer,
            assigned_by=nullif(v_assignment_before->>'assigned_by','')::uuid,
            learner_program_enrollment_id=nullif(v_assignment_before->>'learner_program_enrollment_id','')::uuid,
            metadata=coalesce(v_assignment_before->'metadata','{}'::jsonb)
        where id=v_assignment;
      else
        delete from public.quiz_assignments where id=v_assignment;
      end if;
    end if;
  end if;
  raise;
end;
$contract$;