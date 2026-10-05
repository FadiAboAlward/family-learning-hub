-- FLH-FEAT-2026-020 v1.0
-- Exact-version support-workbook paper ingestion orchestrator.
-- The official paper Exam path remains authoritative:
-- flh_paper_exam_start -> guarded response saves -> flh_paper_exam_submit.
-- No latest-version resolution, parallel Learning attempt, or direct mastery write.

create or replace function public.flh_support_workbook_paper_ingest(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_version_id uuid,
  p_session_slug text,
  p_request_id uuid,
  p_responses jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_version public.quiz_versions%rowtype;
  v_quiz public.quizzes%rowtype;
  v_attempt public.quiz_attempts%rowtype;
  v_question public.quiz_questions%rowtype;
  v_response jsonb;
  v_grading text;
  v_model_code text;
  v_started jsonb;
  v_saved jsonb;
  v_submitted jsonb;
  v_result jsonb;
  v_existing_result jsonb;
  v_attempt_id uuid;
  v_position integer;
  v_value text;
  v_unanswered integer[]:='{}'::integer[];
  v_question_count integer:=0;
  v_graded_count integer:=0;
  v_ungraded_count integer:=0;
  v_unanswered_count integer:=0;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_quiz_version_id is null
     or nullif(btrim(p_session_slug),'') is null
     or p_request_id is null
     or p_responses is null
     or jsonb_typeof(p_responses)<>'object' then
    return jsonb_build_object('error','INVALID_PAPER_INGESTION');
  end if;

  if not exists (
    select 1 from public.learners l
    where l.workspace_id=p_workspace_id and l.id=p_learner_id and l.is_active
  ) then
    return jsonb_build_object('error','LEARNER_NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text||':'||p_learner_id::text||':'||p_quiz_version_id::text||':support-paper',0
  ));

  select qv.* into v_version
  from public.quiz_versions qv
  where qv.workspace_id=p_workspace_id
    and qv.id=p_quiz_version_id
    and qv.state='published'
    and coalesce((qv.settings->>'support_source')::boolean,false)
  limit 1;

  if not found or nullif(v_version.settings->>'source_code','') is null then
    return jsonb_build_object('error','SUPPORT_VERSION_NOT_FOUND');
  end if;

  select q.* into v_quiz
  from public.quizzes q
  where q.workspace_id=p_workspace_id
    and q.id=v_version.quiz_id
    and q.status='active'
    and q.slug=p_session_slug
    and coalesce((q.delivery_config->>'support_session')::boolean,false)
  limit 1;
  if not found then return jsonb_build_object('error','SUPPORT_SESSION_MISMATCH'); end if;

  v_model_code:=nullif(v_version.settings->'paper_exam'->>'paper_model_code','');
  if v_model_code is null then return jsonb_build_object('error','SUPPORT_PAPER_MODEL_NOT_REGISTERED'); end if;

  -- Same request id may retry only the exact same immutable version/session/payload.
  if exists (
    select 1 from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.metadata->>'support_paper_request_id'=p_request_id::text
      and (
        a.quiz_version_id<>p_quiz_version_id
        or a.metadata->>'support_session_slug' is distinct from p_session_slug
        or a.metadata->>'support_paper_response_md5' is distinct from md5(p_responses::text)
      )
  ) then
    return jsonb_build_object('error','PAPER_REQUEST_CONFLICT');
  end if;

  select a.* into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id
    and a.learner_id=p_learner_id
    and a.quiz_version_id=p_quiz_version_id
    and a.status='submitted'
    and a.metadata->>'support_paper_request_id'=p_request_id::text
  order by a.submitted_at desc nulls last
  limit 1;

  if found then
    v_existing_result:=v_attempt.metadata->'support_paper_result';
    if jsonb_typeof(v_existing_result)='object' then return v_existing_result; end if;
    return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
  end if;

  -- A digital completion and a paper completion of the same immutable support
  -- session are the same evidence event; never count both.
  if exists (
    select 1 from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.status='submitted'
  ) then
    return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
  end if;
  if exists (
    select 1 from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.status='in_progress'
  ) then
    return jsonb_build_object('error','SESSION_IN_PROGRESS');
  end if;

  -- Exact response-map and per-question shape validation happens BEFORE start,
  -- so malformed photos/transcriptions cannot leave a partial paper attempt.
  if exists (
    select 1
    from jsonb_object_keys(p_responses) response_key(question_code)
    where not exists (
      select 1 from public.quiz_questions q
      where q.workspace_id=p_workspace_id
        and q.quiz_version_id=p_quiz_version_id
        and q.delivery_role='core'
        and q.question_code=response_key.question_code
    )
  ) or exists (
    select 1 from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.delivery_role='core'
      and not (p_responses ? q.question_code)
  ) then
    return jsonb_build_object('error','PAPER_RESPONSE_MAP_INVALID');
  end if;

  for v_question in
    select q.*
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.delivery_role='core'
    order by q.position
  loop
    v_question_count:=v_question_count+1;
    v_grading:=coalesce(v_question.source_metadata->>'grading_mode','graded');
    if v_grading='ungraded' then v_ungraded_count:=v_ungraded_count+1;
    else v_graded_count:=v_graded_count+1; end if;

    v_response:=p_responses->v_question.question_code;
    if v_response='{"support_unanswered":true}'::jsonb then
      v_unanswered_count:=v_unanswered_count+1;
      v_unanswered:=array_append(v_unanswered,v_question.position);
      continue;
    end if;

    if jsonb_typeof(v_response)<>'object' then
      return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
    end if;

    if v_question.question_type='single_choice' then
      if jsonb_object_length(v_response)<>1
         or not(v_response?'option_position') then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end if;
      begin v_position:=nullif(v_response->>'option_position','')::integer;
      exception when others then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end;
      if v_position is null or not exists (
        select 1 from public.quiz_question_options o
        where o.workspace_id=p_workspace_id and o.question_id=v_question.id and o.position=v_position
      ) then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end if;
    elsif v_question.question_type in ('numeric','short_answer') then
      if jsonb_object_length(v_response)<>1
         or not(v_response?'value')
         or jsonb_typeof(v_response->'value')<>'string' then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end if;
      v_value:=v_response->>'value';
      if nullif(btrim(v_value),'') is null or char_length(v_value)>2000 then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end if;
      if v_question.question_type='numeric' then
        begin perform replace(btrim(v_value),',','.')::numeric;
        exception when others then
          return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
        end;
      end if;
    else
      return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
    end if;
  end loop;

  if v_question_count=0 then return jsonb_build_object('error','SUPPORT_PAPER_EMPTY_SESSION'); end if;

  v_started:=public.flh_paper_exam_start(
    p_workspace_id,p_learner_id,p_quiz_version_id,v_model_code,'support_workbook_photos'
  );
  if coalesce((v_started->>'ok')::boolean,false) is not true then
    if v_started->>'error'='PAPER_ALREADY_INGESTED' then
      return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
    end if;
    return v_started;
  end if;

  v_attempt_id:=(v_started->>'attempt_id')::uuid;
  update public.quiz_attempts
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'support_paper_request_id',p_request_id::text,
    'support_paper_response_md5',md5(p_responses::text),
    'support_session_slug',p_session_slug,
    'support_source_code',v_version.settings->>'source_code',
    'support_source_pdf_pages',coalesce(v_version.settings->'source_pdf_pages','[]'::jsonb)
  )
  where workspace_id=p_workspace_id and id=v_attempt_id and learner_id=p_learner_id;

  for v_question in
    select q.*
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.delivery_role='core'
    order by q.position
  loop
    v_response:=p_responses->v_question.question_code;
    if v_response='{"support_unanswered":true}'::jsonb then continue; end if;

    v_saved:=public.flh_support_paper_exam_save_response(
      p_workspace_id,p_learner_id,v_attempt_id,v_question.id,v_response
    );
    if coalesce((v_saved->>'ok')::boolean,false) is not true then
      raise exception 'SUPPORT_PAPER_SAVE_FAILED:%:%',
        v_question.question_code,coalesce(v_saved->>'error','UNKNOWN');
    end if;
  end loop;

  v_submitted:=public.flh_paper_exam_submit(
    p_workspace_id,p_learner_id,v_attempt_id,v_unanswered
  );
  if coalesce((v_submitted->>'ok')::boolean,false) is not true then
    raise exception 'SUPPORT_PAPER_SUBMIT_FAILED:%',coalesce(v_submitted->>'error','UNKNOWN');
  end if;

  v_result:=v_submitted||jsonb_build_object(
    'quiz_version_id',p_quiz_version_id,
    'session_slug',p_session_slug,
    'question_count',v_question_count,
    'graded_count',v_graded_count,
    'ungraded_count',v_ungraded_count,
    'unanswered_count',v_unanswered_count,
    'paper_ingested',true,
    'paper_model_code',v_model_code
  );

  update public.quiz_attempts
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'support_paper_result',v_result,
    'support_paper_request_id',p_request_id::text,
    'support_paper_response_md5',md5(p_responses::text)
  )
  where workspace_id=p_workspace_id and id=v_attempt_id and learner_id=p_learner_id;

  return v_result;
end;
$function$;

revoke all on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) from public;
revoke all on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) from anon,authenticated;
grant execute on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) to service_role;

comment on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) is
  'Ingests one exact official support-workbook session through the canonical guarded paper Exam pipeline; typed/open responses are support-aware and ungraded reflections never contribute mastery.';
