-- FLH-FEAT-2026-003 v1.0
-- Contract: paper exams preserve declared blank printed responses as explicit
-- unanswered evidence, while normal interactive Exam remains strict.
-- All mutations are contained in an exception-backed subtransaction and roll back.

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
  v_generic_question uuid;
  v_started jsonb;
  v_attempt uuid;
  v_submitted jsonb;
  v_saved jsonb;
  v_q3 uuid;
  v_q17 uuid;
  v_unanswered_count integer;
  v_bad_unanswered_count integer;
  v_wrong_selected_count integer;
  v_total_answers integer;
  v_paper_ingested boolean;
  v_mastery_recorded boolean;
  v_mastery_evidence integer;
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

  if has_function_privilege('anon','public.flh_exam_submit(uuid,uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.flh_exam_submit(uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.flh_exam_submit(uuid,uuid,uuid)','EXECUTE') then
    raise exception 'CONTRACT_EXAM_SUBMIT_ACL_INVALID';
  end if;

  if has_function_privilege('anon','public.flh_paper_exam_submit(uuid,uuid,uuid,integer[])','EXECUTE')
     or has_function_privilege('authenticated','public.flh_paper_exam_submit(uuid,uuid,uuid,integer[])','EXECUTE')
     or not has_function_privilege('service_role','public.flh_paper_exam_submit(uuid,uuid,uuid,integer[])','EXECUTE') then
    raise exception 'CONTRACT_PAPER_SUBMIT_ACL_INVALID';
  end if;

  begin
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

    -- Generic interactive Exam remains strict and cannot accept unanswered markers.
    v_generic := public.flh_exam_start(v_workspace,v_test,v_slug);
    if nullif(v_generic->>'attempt_id','') is null then
      raise exception 'CONTRACT_GENERIC_START_FAILED';
    end if;
    v_generic_attempt := (v_generic->>'attempt_id')::uuid;

    select qq.question_id into v_generic_question
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id=v_workspace and qq.quiz_attempt_id=v_generic_attempt
    order by qq.sequence_no
    limit 1;

    begin
      insert into public.quiz_attempt_answers(
        workspace_id,attempt_id,question_id,response,evaluation,
        is_correct,points_awarded,answered_at,attempts_used,hints_used,
        first_try_correct,mastery_result
      ) values (
        v_workspace,v_generic_attempt,v_generic_question,'{"unanswered":true}'::jsonb,'ungraded',
        null,null,clock_timestamp(),0,0,null,null
      );
      raise exception 'CONTRACT_GENERIC_UNANSWERED_ACCEPTED';
    exception when others then
      if sqlerrm not like '%UNANSWERED_REQUIRES_PAPER_ATTEMPT%' then
        raise;
      end if;
    end;

    v_generic_submit := public.flh_exam_submit(v_workspace,v_test,v_generic_attempt);
    if v_generic_submit->>'error' is distinct from 'EXAM_NOT_COMPLETE' then
      raise exception 'CONTRACT_GENERIC_EXAM_BECAME_NON_STRICT';
    end if;

    -- Start through the exact version-bound paper gate.
    v_started := public.flh_paper_exam_start(
      v_workspace,
      v_test,
      v_version,
      'MOH-TRMATH7-K1-TAM-PAPER-20260921-B',
      'qa_unanswered_contract'
    );

    if coalesce((v_started->>'ok')::boolean,false) is not true then
      raise exception 'CONTRACT_PAPER_START_FAILED';
    end if;

    v_attempt := (v_started->>'attempt_id')::uuid;

    select question_id into v_q3
    from public.quiz_attempt_question_queue
    where workspace_id=v_workspace and quiz_attempt_id=v_attempt and sequence_no=3;

    select question_id into v_q17
    from public.quiz_attempt_question_queue
    where workspace_id=v_workspace and quiz_attempt_id=v_attempt and sequence_no=17;

    -- Fail closed: blank rows cannot be written outside the declared-submit wrapper.
    begin
      insert into public.quiz_attempt_answers(
        workspace_id,attempt_id,question_id,response,evaluation,
        is_correct,points_awarded,answered_at,attempts_used,hints_used,
        first_try_correct,mastery_result
      ) values (
        v_workspace,v_attempt,v_q3,'{"unanswered":true}'::jsonb,'ungraded',
        null,null,clock_timestamp(),0,0,null,null
      );
      raise exception 'CONTRACT_UNDECLARED_BLANK_ACCEPTED';
    exception when others then
      if sqlerrm not like '%PAPER_UNANSWERED_REQUIRES_DECLARED_SUBMIT%' then
        raise;
      end if;
    end;

    -- Fail closed: contradictory unanswered + selected option.
    begin
      insert into public.quiz_attempt_answers(
        workspace_id,attempt_id,question_id,response,evaluation,
        is_correct,points_awarded,answered_at,attempts_used,hints_used,
        first_try_correct,mastery_result
      ) values (
        v_workspace,v_attempt,v_q3,'{"unanswered":true,"option_position":1}'::jsonb,'ungraded',
        null,null,clock_timestamp(),0,0,null,null
      );
      raise exception 'CONTRACT_CONTRADICTORY_UNANSWERED_ACCEPTED';
    exception when others then
      if sqlerrm not like '%PAPER_ANSWER_INVALID%' then
        raise;
      end if;
    end;

    -- Fail closed: unanswered rows must have exact zero interaction counters.
    begin
      perform set_config('flh.paper_unanswered_attempt_id',v_attempt::text,true);
      insert into public.quiz_attempt_answers(
        workspace_id,attempt_id,question_id,response,evaluation,
        is_correct,points_awarded,answered_at,attempts_used,hints_used,
        first_try_correct,mastery_result
      ) values (
        v_workspace,v_attempt,v_q3,'{"unanswered":true}'::jsonb,'ungraded',
        null,null,clock_timestamp(),1,0,null,null
      );
      raise exception 'CONTRACT_INTERACTED_UNANSWERED_ACCEPTED';
    exception when others then
      if sqlerrm not like '%PAPER_UNANSWERED_INTERACTION_INVALID%' then
        raise;
      end if;
    end;

    begin
      perform set_config('flh.paper_unanswered_attempt_id',v_attempt::text,true);
      insert into public.quiz_attempt_answers(
        workspace_id,attempt_id,question_id,response,evaluation,
        is_correct,points_awarded,answered_at,attempts_used,hints_used,
        first_try_correct,mastery_result
      ) values (
        v_workspace,v_attempt,v_q3,'{"unanswered":true}'::jsonb,'ungraded',
        null,null,clock_timestamp(),null,0,null,null
      );
      raise exception 'CONTRACT_NULL_COUNTER_UNANSWERED_ACCEPTED';
    exception when others then
      if sqlerrm not like '%PAPER_UNANSWERED_INTERACTION_INVALID%' then
        raise;
      end if;
    end;

    -- Fail closed: queue validation is mandatory.
    begin
      update public.quiz_attempts
      set metadata=metadata || jsonb_build_object('paper_queue_validated',false)
      where workspace_id=v_workspace and id=v_attempt;

      perform public.flh_exam_save_answer(v_workspace,v_test,v_attempt,v_q3,1);
      raise exception 'CONTRACT_UNVALIDATED_QUEUE_ACCEPTED';
    exception when others then
      if sqlerrm not like '%PAPER_QUEUE_NOT_VALIDATED%' then
        raise;
      end if;
    end;

    -- Fail closed: an option outside the immutable paper map is rejected.
    begin
      perform public.flh_exam_save_answer(v_workspace,v_test,v_attempt,v_q3,999);
      raise exception 'CONTRACT_UNMAPPED_OPTION_ACCEPTED';
    exception when others then
      if sqlerrm not like '%PAPER_OPTION_NOT_MAPPED%' then
        raise;
      end if;
    end;

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

      v_saved := public.flh_exam_save_answer(
        v_workspace,v_test,v_attempt,r.question_id,v_option
      );
      if coalesce((v_saved->>'ok')::boolean,false) is not true then
        raise exception 'CONTRACT_SAVE_FAILED_AT_SEQUENCE:%',r.sequence_no;
      end if;
    end loop;

    -- A declaration that does not exactly equal the missing set must fail.
    v_submitted := public.flh_paper_exam_submit(
      v_workspace,v_test,v_attempt,array[3]::integer[]
    );
    if v_submitted->>'error' is distinct from 'PAPER_UNANSWERED_SET_MISMATCH' then
      raise exception 'CONTRACT_BLANK_SET_MISMATCH_NOT_REJECTED';
    end if;

    -- Exact declared blanks may be materialized and then graded.
    v_submitted := public.flh_paper_exam_submit(
      v_workspace,v_test,v_attempt,array[3,17]::integer[]
    );
    if coalesce((v_submitted->>'ok')::boolean,false) is not true then
      raise exception 'CONTRACT_PAPER_SUBMIT_FAILED';
    end if;

    if (v_submitted->>'score_points')::numeric <> 17
       or (v_submitted->>'max_points')::numeric <> 20
       or (v_submitted->>'percentage')::numeric <> 85 then
      raise exception 'CONTRACT_PAPER_SCORE_INVALID';
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

    -- Sentinel rollback: success means every fixture mutation is discarded.
    raise exception 'CONTRACT_ROLLBACK_SENTINEL';

  exception when raise_exception then
    if sqlerrm = 'CONTRACT_ROLLBACK_SENTINEL' then
      null;
    else
      raise;
    end if;
  end;
end;
$contract$;
