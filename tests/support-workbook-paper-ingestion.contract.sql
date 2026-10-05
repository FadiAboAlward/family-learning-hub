-- FLH-FEAT-2026-020 v1.0
-- Exact-version paper ingestion contract for one official support session.
do $contract$
declare
  w uuid;
  l uuid;
  v uuid;
  v_slug text := 'tr-g5-meb-support-s2-decimals';
  request_one uuid := '73000000-0000-4000-8000-000000000001';
  request_two uuid := '73000000-0000-4000-8000-000000000002';
  request_bad_extra uuid := '73000000-0000-4000-8000-000000000003';
  request_bad_missing uuid := '73000000-0000-4000-8000-000000000004';
  responses jsonb;
  first_code text;
  r jsonb;
  retry jsonb;
  blocked jsonb;
  v_attempt_id uuid;
  v2 uuid;
  v_slug2 text := 'tr-g5-meb-support-s6-space-crisis-scan';
  request_mixed uuid := '73000000-0000-4000-8000-000000000005';
  responses_mixed jsonb;
  mixed jsonb;
  v_attempt_id2 uuid;
  v_concept2 uuid;
begin
  select id into strict w from public.workspaces where slug='family-learning-hub';
  select id into strict l
  from public.learners
  where workspace_id=w and slug='test' and is_active
    and coalesce((metadata->>'is_test')::boolean,false);

  if has_function_privilege('anon','public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE') then
    raise exception 'SUPPORT_PAPER_ACL_INVALID';
  end if;

  select qv.id into strict v
  from public.quizzes q
  join public.quiz_versions qv on qv.workspace_id=q.workspace_id and qv.quiz_id=q.id and qv.state='published'
  where q.workspace_id=w and q.slug=v_slug
    and coalesce((q.delivery_config->>'support_session')::boolean,false)
    and coalesce((qv.settings->>'support_source')::boolean,false)
  order by qv.version_no desc limit 1;

  select jsonb_object_agg(q.question_code,'{"support_unanswered":true}'::jsonb order by q.position)
    into strict responses
  from public.quiz_questions q
  where q.workspace_id=w and q.quiz_version_id=v and q.delivery_role='core';

  select q.question_code into strict first_code
  from public.quiz_questions q
  where q.workspace_id=w and q.quiz_version_id=v and q.delivery_role='core'
  order by q.position
  limit 1;

  set local role service_role;
  blocked:=public.flh_support_workbook_paper_ingest(
    w,l,v,v_slug,request_bad_extra,
    responses || jsonb_build_object('TYPO-UNKNOWN-CODE','{"support_unanswered":true}'::jsonb)
  );
  reset role;
  if blocked->>'error' is distinct from 'PAPER_RESPONSE_MAP_INVALID' then
    raise exception 'SUPPORT_PAPER_UNKNOWN_CODE_NOT_REJECTED:%',blocked;
  end if;
  if exists(
    select 1 from public.quiz_attempts a
    where a.workspace_id=w and a.learner_id=l
      and a.metadata->>'support_paper_request_id'=request_bad_extra::text
  ) then raise exception 'SUPPORT_PAPER_UNKNOWN_CODE_CREATED_EVIDENCE'; end if;

  set local role service_role;
  blocked:=public.flh_support_workbook_paper_ingest(
    w,l,v,v_slug,request_bad_missing,responses-first_code
  );
  reset role;
  if blocked->>'error' is distinct from 'PAPER_RESPONSE_MAP_INVALID' then
    raise exception 'SUPPORT_PAPER_MISSING_CODE_NOT_REJECTED:%',blocked;
  end if;
  if exists(
    select 1 from public.quiz_attempts a
    where a.workspace_id=w and a.learner_id=l
      and a.metadata->>'support_paper_request_id'=request_bad_missing::text
  ) then raise exception 'SUPPORT_PAPER_MISSING_CODE_CREATED_EVIDENCE'; end if;

  set local role service_role;
  r:=public.flh_support_workbook_paper_ingest(w,l,v,v_slug,request_one,responses);
  reset role;

  if coalesce((r->>'ok')::boolean,false) is not true
     or r->>'paper_ingested' is distinct from 'true'
     or (r->>'question_count')::integer<>8
     or (r->>'graded_count')::integer<>7
     or (r->>'ungraded_count')::integer<>1
     or (r->>'unanswered_count')::integer<>8
     or (r->>'max_points')::numeric<>7
     or (r->>'score_points')::numeric<>0
     or (r->>'percentage')::numeric<>0 then
    raise exception 'SUPPORT_PAPER_RESULT_INVALID:%',r;
  end if;

  v_attempt_id:=(r->>'attempt_id')::uuid;
  if not exists(
    select 1 from public.quiz_attempts a
    where a.id=v_attempt_id and a.workspace_id=w and a.learner_id=l
      and a.status='submitted' and a.delivery_mode='learning'
      and a.metadata->>'engine'='support-paper-v1'
      and a.metadata->>'delivery_surface'='paper'
      and coalesce((a.metadata->>'paper_ingested')::boolean,false)
  ) then raise exception 'SUPPORT_PAPER_ATTEMPT_METADATA_INVALID'; end if;

  if (select count(*) from public.quiz_attempt_answers aa where aa.attempt_id=v_attempt_id and aa.response='{"support_unanswered":true}'::jsonb)<>8 then
    raise exception 'SUPPORT_PAPER_BLANK_REPRESENTATION_INVALID';
  end if;
  if exists(
    select 1 from public.quiz_attempt_answers aa
    where aa.attempt_id=v_attempt_id and aa.response='{"unanswered":true}'::jsonb
  ) then raise exception 'SUPPORT_PAPER_LEGACY_BLANK_REUSED'; end if;

  set local role service_role;
  retry:=public.flh_support_workbook_paper_ingest(w,l,v,v_slug,request_one,responses);
  reset role;
  if retry<>r then raise exception 'SUPPORT_PAPER_IDEMPOTENT_RESULT_DRIFT'; end if;
  if (select count(*) from public.quiz_attempts where workspace_id=w and learner_id=l and quiz_version_id=v and status='submitted')<>1 then
    raise exception 'SUPPORT_PAPER_IDEMPOTENT_ATTEMPT_DUPLICATION';
  end if;

  set local role service_role;
  blocked:=public.flh_support_workbook_paper_ingest(
    w,l,v,v_slug,request_one,
    jsonb_set(responses,array[first_code],jsonb_build_object('value','changed transcription'),true)
  );
  reset role;
  if blocked->>'error' is distinct from 'PAPER_REQUEST_CONFLICT' then
    raise exception 'SUPPORT_PAPER_CHANGED_RETRY_NOT_REJECTED:%',blocked;
  end if;
  if (select count(*) from public.quiz_attempts where workspace_id=w and learner_id=l and quiz_version_id=v and status='submitted')<>1 then
    raise exception 'SUPPORT_PAPER_CHANGED_RETRY_CREATED_ATTEMPT';
  end if;

  set local role service_role;
  blocked:=public.flh_support_workbook_paper_ingest(w,l,v,v_slug,request_two,responses);
  reset role;
  if blocked->>'error' is distinct from 'SESSION_ALREADY_COMPLETED' then
    raise exception 'SUPPORT_PAPER_SECOND_TRANSCRIPTION_NOT_BLOCKED:%',blocked;
  end if;

  -- Mixed scoring contract on a second immutable support session: accepted
  -- short answers (including spaced punctuation), one correct option, one wrong
  -- option, and one explicit paper blank must grade deterministically.
  select qv.id into strict v2
  from public.quizzes q
  join public.quiz_versions qv on qv.workspace_id=q.workspace_id and qv.quiz_id=q.id and qv.state='published'
  where q.workspace_id=w and q.slug=v_slug2
    and coalesce((q.delivery_config->>'support_session')::boolean,false)
    and coalesce((qv.settings->>'support_source')::boolean,false)
  order by qv.version_no desc limit 1;

  select qc.concept_id into strict v_concept2
  from public.quiz_questions q
  join public.quiz_question_concepts qc
    on qc.workspace_id=q.workspace_id and qc.question_id=q.id and qc.is_primary
  where q.workspace_id=w and q.quiz_version_id=v2
  order by q.position
  limit 1;

  delete from public.learner_concept_mastery
  where workspace_id=w and learner_id=l and concept_id=v_concept2;

  responses_mixed:=jsonb_build_object(
    'Q-202610050042',jsonb_build_object('value','1 / 4'),
    'Q-202610050043',jsonb_build_object('value','9 / 9'),
    'Q-202610050044',jsonb_build_object('value','3 / 5'),
    'Q-202610050045',jsonb_build_object('option_position',3),
    'Q-202610050046','{"support_unanswered":true}'::jsonb,
    'Q-202610050047',jsonb_build_object('option_position',2),
    'Q-202610050048',jsonb_build_object('value','1, 2, 3')
  );

  set local role service_role;
  mixed:=public.flh_support_workbook_paper_ingest(w,l,v2,v_slug2,request_mixed,responses_mixed);
  reset role;

  if coalesce((mixed->>'ok')::boolean,false) is not true
     or (mixed->>'score_points')::numeric<>4
     or (mixed->>'max_points')::numeric<>7
     or (mixed->>'percentage')::numeric<>57.14
     or (mixed->>'unanswered_count')::integer<>1 then
    raise exception 'SUPPORT_PAPER_MIXED_SCORE_INVALID:%',mixed;
  end if;

  v_attempt_id2:=(mixed->>'attempt_id')::uuid;
  if not exists(
    select 1
    from public.quiz_attempt_answers aa
    join public.quiz_questions q on q.id=aa.question_id and q.workspace_id=aa.workspace_id
    where aa.attempt_id=v_attempt_id2 and q.question_code='Q-202610050042' and aa.evaluation='correct' and aa.is_correct=true
  ) then raise exception 'SUPPORT_PAPER_SHORT_ANSWER_NOT_GRADED_CORRECT'; end if;
  if not exists(
    select 1
    from public.quiz_attempt_answers aa
    join public.quiz_questions q on q.id=aa.question_id and q.workspace_id=aa.workspace_id
    where aa.attempt_id=v_attempt_id2 and q.question_code='Q-202610050043' and aa.evaluation='incorrect' and aa.is_correct=false
  ) then raise exception 'SUPPORT_PAPER_SHORT_ANSWER_INCORRECT_NOT_RECORDED'; end if;
  if not exists(
    select 1
    from public.quiz_attempt_answers aa
    join public.quiz_questions q on q.id=aa.question_id and q.workspace_id=aa.workspace_id
    where aa.attempt_id=v_attempt_id2 and q.question_code='Q-202610050045' and aa.evaluation='correct' and aa.is_correct=true
  ) then raise exception 'SUPPORT_PAPER_OPTION_NOT_GRADED_CORRECT'; end if;
  if not exists(
    select 1
    from public.quiz_attempt_answers aa
    join public.quiz_questions q on q.id=aa.question_id and q.workspace_id=aa.workspace_id
    where aa.attempt_id=v_attempt_id2 and q.question_code='Q-202610050046'
      and aa.response='{"support_unanswered":true}'::jsonb and aa.evaluation='incorrect'
  ) then raise exception 'SUPPORT_PAPER_EXPLICIT_BLANK_NOT_RECORDED'; end if;
  if not exists(
    select 1
    from public.quiz_attempt_answers aa
    join public.quiz_questions q on q.id=aa.question_id and q.workspace_id=aa.workspace_id
    where aa.attempt_id=v_attempt_id2 and q.question_code='Q-202610050048'
      and aa.evaluation='correct' and aa.is_correct=true
  ) then raise exception 'SUPPORT_PAPER_SPACED_SHORT_ANSWER_NOT_NORMALIZED'; end if;

  if not exists(
    select 1 from public.learner_concept_mastery m
    where m.workspace_id=w and m.learner_id=l and m.concept_id=v_concept2
      and m.evidence_count=7 and m.total_question_count=7
      and m.mastery_score=57.14
      and m.metadata->>'engine'='support-paper-v1'
  ) then raise exception 'SUPPORT_PAPER_MASTERY_DELTA_INVALID'; end if;

  -- A successful DO statement commits, so explicitly remove only this
  -- contract's attempt and mastery fixtures. Failures roll back the DO statement.
  delete from public.quiz_attempts a
  where a.workspace_id=w and a.id in (v_attempt_id,v_attempt_id2);

  delete from public.learner_concept_mastery m
  where m.workspace_id=w
    and m.learner_id=l
    and m.metadata->>'engine'='support-paper-v1'
    and exists (
      select 1
      from public.quiz_question_concepts qc
      join public.quiz_questions q
        on q.workspace_id=qc.workspace_id and q.id=qc.question_id
      where qc.workspace_id=w
        and qc.concept_id=m.concept_id
        and q.quiz_version_id in (v,v2)
    );
end;
$contract$;
