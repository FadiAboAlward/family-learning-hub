-- FLH-FEAT-2026-020 v1.0
-- Typed Learning contract for official support-workbook sessions.
do $contract$
declare
  w uuid;
  l uuid;
  v uuid;
  q_numeric uuid;
  q_reflection uuid;
  v_concept_id uuid;
  a1 uuid := '72000000-0000-4000-8000-000000000001';
  a2 uuid := '72000000-0000-4000-8000-000000000002';
  r jsonb;
  retry jsonb;
begin
  select id into strict w from public.workspaces where slug='family-learning-hub';
  select id into strict l
  from public.learners
  where workspace_id=w and slug='test' and is_active
    and coalesce((metadata->>'is_test')::boolean,false);

  if has_function_privilege('anon','public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'SUPPORT_TYPED_ACL_INVALID';
  end if;

  select qv.id,qq.id,qc.concept_id
    into strict v,q_numeric,v_concept_id
  from public.quizzes quiz
  join public.quiz_versions qv on qv.workspace_id=quiz.workspace_id and qv.quiz_id=quiz.id and qv.state='published'
  join public.quiz_questions qq on qq.workspace_id=qv.workspace_id and qq.quiz_version_id=qv.id
  join public.quiz_question_concepts qc on qc.workspace_id=qq.workspace_id and qc.question_id=qq.id and qc.is_primary
  where quiz.workspace_id=w
    and quiz.slug='tr-g5-meb-support-s2-decimals'
    and qq.question_type='numeric'
  order by qq.position
  limit 1;

  insert into public.quiz_attempts(id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata)
  values(a1,w,l,v,'in_progress','learning','{"qa_scope":"support_typed_contract"}'::jsonb);
  insert into public.quiz_attempt_question_queue(
    workspace_id,quiz_attempt_id,sequence_no,question_id,concept_id,difficulty_level,status,interaction_metadata
  )
  select w,a1,1,q_numeric,v_concept_id,difficulty_level,'active','{"draft_response":{"value":"2,5"}}'::jsonb
  from public.quiz_questions where id=q_numeric;

  set local role service_role;
  r:=public.flh_learning_answer_response(w,l,a1,q_numeric,'{"value":"9,9"}'::jsonb);
  reset role;

  if r->>'is_correct' is distinct from 'false'
     or r->>'finalized' is distinct from 'false'
     or r->>'attempt_no' is distinct from '1'
     or r->>'hint_level' is distinct from '1' then
    raise exception 'SUPPORT_TYPED_WRONG_RESPONSE_INVALID:%',r;
  end if;
  if exists(select 1 from public.quiz_attempt_answers where attempt_id=a1 and question_id=q_numeric) then
    raise exception 'SUPPORT_TYPED_NONFINAL_PERSISTED';
  end if;
  if (select interaction_metadata ? 'draft_response' from public.quiz_attempt_question_queue where quiz_attempt_id=a1 and question_id=q_numeric) then
    raise exception 'SUPPORT_TYPED_DRAFT_NOT_CLEARED_AFTER_SUBMIT';
  end if;

  set local role service_role;
  r:=public.flh_learning_answer_response(w,l,a1,q_numeric,'{"value":"2,5"}'::jsonb);
  reset role;
  if r->>'is_correct' is distinct from 'true'
     or r->>'finalized' is distinct from 'true'
     or r->>'attempt_no' is distinct from '2'
     or r->>'ungraded' is distinct from 'false' then
    raise exception 'SUPPORT_TYPED_CORRECT_RESPONSE_INVALID:%',r;
  end if;
  if not exists(
    select 1 from public.quiz_attempt_answers
    where attempt_id=a1 and question_id=q_numeric and is_correct=true
      and points_awarded=0.75 and attempts_used=2 and hints_used=1
  ) then raise exception 'SUPPORT_TYPED_FINAL_ANSWER_INVALID'; end if;
  if not exists(
    select 1 from public.learner_concept_mastery
    where learner_id=l and concept_id=v_concept_id and mastery_score=75
      and evidence_count=1 and total_question_count=1 and total_hint_count=1
  ) then raise exception 'SUPPORT_TYPED_MASTERY_INVALID'; end if;

  set local role service_role;
  retry:=public.flh_learning_answer_response(w,l,a1,q_numeric,'{"value":"2,5"}'::jsonb);
  reset role;
  if retry<>r then raise exception 'SUPPORT_TYPED_IDEMPOTENT_RESULT_DRIFT'; end if;
  if (select count(*) from public.quiz_answer_attempts where quiz_attempt_id=a1 and question_id=q_numeric)<>2
     or (select evidence_count from public.learner_concept_mastery where learner_id=l and concept_id=v_concept_id)<>1 then
    raise exception 'SUPPORT_TYPED_IDEMPOTENT_SIDE_EFFECT_DUPLICATION';
  end if;

  select qq.id into strict q_reflection
  from public.quiz_questions qq
  where qq.workspace_id=w
    and qq.quiz_version_id in (
      select qv.id from public.quizzes quiz
      join public.quiz_versions qv on qv.workspace_id=quiz.workspace_id and qv.quiz_id=quiz.id and qv.state='published'
      where quiz.workspace_id=w and quiz.slug='tr-g5-meb-support-s2-decimals'
    )
    and qq.question_type='short_answer'
    and qq.source_metadata->>'grading_mode'='ungraded'
  order by qq.position
  limit 1;

  insert into public.quiz_attempts(id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata)
  values(a2,w,l,v,'in_progress','learning','{"qa_scope":"support_typed_contract_ungraded"}'::jsonb);
  insert into public.quiz_attempt_question_queue(
    workspace_id,quiz_attempt_id,sequence_no,question_id,concept_id,difficulty_level,status
  )
  select w,a2,1,q_reflection,qc.concept_id,q.difficulty_level,'active'
  from public.quiz_questions q
  left join public.quiz_question_concepts qc on qc.workspace_id=q.workspace_id and qc.question_id=q.id and qc.is_primary
  where q.id=q_reflection;

  set local role service_role;
  r:=public.flh_learning_answer_response(w,l,a2,q_reflection,'{"value":"Kırk dört tam yüzde elli."}'::jsonb);
  reset role;
  if r->>'finalized' is distinct from 'true'
     or r->>'ungraded' is distinct from 'true'
     or r->'is_correct' is not null then
    raise exception 'SUPPORT_TYPED_UNGRADED_RESULT_INVALID:%',r;
  end if;
  if not exists(
    select 1 from public.quiz_attempt_answers
    where attempt_id=a2 and question_id=q_reflection
      and evaluation='ungraded' and is_correct is null
      and points_awarded=0 and mastery_result is null
  ) then raise exception 'SUPPORT_TYPED_UNGRADED_PERSISTENCE_INVALID'; end if;
  if (select evidence_count from public.learner_concept_mastery where learner_id=l and concept_id=v_concept_id)<>1 then
    raise exception 'SUPPORT_TYPED_UNGRADED_AFFECTED_MASTERY';
  end if;

  -- A successful DO statement commits, so explicitly remove only this
  -- contract's fixtures. Any raised exception rolls the whole DO statement back.
  delete from public.quiz_attempts
  where workspace_id=w and id in (a1,a2);

  delete from public.learner_concept_mastery
  where workspace_id=w
    and learner_id=l
    and concept_id=v_concept_id
    and metadata->>'engine'='learning-api-v2';
end;
$contract$;
