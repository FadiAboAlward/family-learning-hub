-- FLH-FEAT-2026-020 v1.0
-- Service-role-only ingestion for an already printed/official support-workbook
-- session. The caller must name the exact immutable quiz version and session
-- slug; no "latest" resolution is allowed.

-- Keep the existing paper-exam blank representation exclusive to its
-- guarded model. Support-workbook transcriptions use a distinct exact blank.
alter table public.quiz_attempt_answers
  drop constraint if exists quiz_attempt_answers_attempts_used_check;

alter table public.quiz_attempt_answers
  add constraint quiz_attempt_answers_attempts_used_check
  check (
    attempts_used between 1 and 10
    or (
      attempts_used = 0
      and response in ('{"support_unanswered":true}'::jsonb,'{"support_unanswered":true}'::jsonb)
    )
  );

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
  v_key public.quiz_question_answer_keys%rowtype;
  v_response jsonb;
  v_grading text;
  v_is_correct boolean;
  v_points numeric;
  v_score numeric := 0;
  v_max numeric := 0;
  v_percentage numeric := 0;
  v_question_count integer := 0;
  v_graded_count integer := 0;
  v_ungraded_count integer := 0;
  v_unanswered_count integer := 0;
  v_option_position integer;
  v_numeric_response numeric;
  v_numeric_correct numeric;
  v_tolerance numeric;
  v_text_response text;
  v_concept_id uuid;
  v_mastery_evidence numeric;
  v_existing_result jsonb;
  v_result jsonb;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_quiz_version_id is null
     or nullif(btrim(p_session_slug),'') is null
     or p_request_id is null
     or p_responses is null
     or jsonb_typeof(p_responses) <> 'object' then
    return jsonb_build_object('error','INVALID_PAPER_INGESTION');
  end if;

  if not exists (
    select 1
    from public.learners l
    where l.workspace_id=p_workspace_id
      and l.id=p_learner_id
      and l.is_active
  ) then
    return jsonb_build_object('error','LEARNER_NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_learner_id::text || ':' ||
    p_quiz_version_id::text || ':support-paper',
    0
  ));

  select qv.* into v_version
  from public.quiz_versions qv
  where qv.workspace_id=p_workspace_id
    and qv.id=p_quiz_version_id
    and qv.state='published'
  limit 1;

  if not found
     or coalesce((v_version.settings->>'support_source')::boolean,false) is not true
     or nullif(v_version.settings->>'source_code','') is null then
    return jsonb_build_object('error','SUPPORT_VERSION_NOT_FOUND');
  end if;

  select q.* into v_quiz
  from public.quizzes q
  where q.workspace_id=p_workspace_id
    and q.id=v_version.quiz_id
    and q.status='active'
    and q.slug=p_session_slug
    and coalesce((q.delivery_config->>'support_session')::boolean,false) is true
  limit 1;

  if not found then
    return jsonb_build_object('error','SUPPORT_SESSION_MISMATCH');
  end if;

  if exists (
    select 1
    from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.metadata->>'support_paper_request_id'=p_request_id::text
      and (
        a.quiz_version_id<>p_quiz_version_id
        or a.metadata->>'support_session_slug' is distinct from p_session_slug
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
    if jsonb_typeof(v_existing_result)='object' then
      return v_existing_result;
    end if;
    return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
  end if;

  -- One immutable support session contributes one completion evidence event.
  -- A completed digital attempt blocks a later paper copy from double-counting,
  -- and a completed paper attempt blocks a second transcription.
  if exists (
    select 1
    from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.status='submitted'
  ) then
    return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
  end if;

  if exists (
    select 1
    from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.status='in_progress'
  ) then
    return jsonb_build_object('error','SESSION_IN_PROGRESS');
  end if;

  insert into public.quiz_attempts(
    workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata
  ) values (
    p_workspace_id,p_learner_id,p_quiz_version_id,'in_progress','exam',
    jsonb_build_object(
      'engine','support-paper-v1',
      'support_source',true,
      'support_source_code',v_version.settings->>'source_code',
      'support_session_slug',p_session_slug,
      'support_paper_request_id',p_request_id::text,
      'support_source_pdf_pages',coalesce(v_version.settings->'source_pdf_pages','[]'::jsonb),
      'paper_ingested',false,
      'server_graded',true
    )
  ) returning * into v_attempt;

  insert into public.quiz_attempt_question_queue(
    workspace_id,quiz_attempt_id,sequence_no,question_id,source_role,
    concept_id,difficulty_level,status,selection_reason
  )
  select
    p_workspace_id,
    v_attempt.id,
    row_number() over(order by q.position)::integer,
    q.id,
    'core',
    qc.concept_id,
    q.difficulty_level,
    'completed',
    'support_paper_exact_version'
  from public.quiz_questions q
  left join public.quiz_question_concepts qc
    on qc.workspace_id=q.workspace_id
   and qc.question_id=q.id
   and qc.is_primary
  where q.workspace_id=p_workspace_id
    and q.quiz_version_id=p_quiz_version_id
    and q.delivery_role='core'
  order by q.position;

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
    v_response:=p_responses->v_question.question_code;
    if v_response is null then
      v_response:='{"support_unanswered":true}'::jsonb;
    end if;

    select qc.concept_id into v_concept_id
    from public.quiz_question_concepts qc
    where qc.workspace_id=p_workspace_id
      and qc.question_id=v_question.id
      and qc.is_primary
    limit 1;

    if v_grading='ungraded' then
      v_ungraded_count:=v_ungraded_count+1;
      if v_response='{"support_unanswered":true}'::jsonb then
        v_unanswered_count:=v_unanswered_count+1;
      end if;

      insert into public.quiz_attempt_answers(
        workspace_id,attempt_id,question_id,response,evaluation,is_correct,
        points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
      ) values (
        p_workspace_id,v_attempt.id,v_question.id,v_response,'ungraded',null,
        0,
        case when v_response='{"support_unanswered":true}'::jsonb then 0 else 1 end,
        0,null,null
      );
      continue;
    end if;

    v_graded_count:=v_graded_count+1;
    v_max:=v_max+coalesce(v_question.points,0);
    v_is_correct:=false;
    v_points:=0;

    select k.* into v_key
    from public.quiz_question_answer_keys k
    where k.workspace_id=p_workspace_id
      and k.question_id=v_question.id;

    if not found then
      raise exception 'SUPPORT_PAPER_ANSWER_KEY_MISSING:%',v_question.question_code;
    end if;

    if v_response='{"support_unanswered":true}'::jsonb then
      v_unanswered_count:=v_unanswered_count+1;
      v_is_correct:=false;
    elsif v_question.question_type='single_choice' then
      begin
        v_option_position:=(v_response->>'option_position')::integer;
      exception when others then
        raise exception 'SUPPORT_PAPER_RESPONSE_INVALID:%',v_question.question_code;
      end;
      if not exists (
        select 1
        from public.quiz_question_options o
        where o.workspace_id=p_workspace_id
          and o.question_id=v_question.id
          and o.position=v_option_position
      ) then
        raise exception 'SUPPORT_PAPER_RESPONSE_INVALID:%',v_question.question_code;
      end if;
      v_is_correct:=v_option_position=(v_key.correct_answer->>'option_position')::integer;
    elsif v_question.question_type='numeric' then
      begin
        v_numeric_response:=replace(btrim(v_response->>'value'),',','.')::numeric;
        v_numeric_correct:=replace(btrim(v_key.correct_answer->>'value'),',','.')::numeric;
        v_tolerance:=coalesce(
          nullif(v_key.grading_config->>'absolute_tolerance','')::numeric,
          nullif(v_key.correct_answer->>'tolerance','')::numeric,
          0
        );
      exception when others then
        raise exception 'SUPPORT_PAPER_RESPONSE_INVALID:%',v_question.question_code;
      end;
      v_is_correct:=abs(v_numeric_response-v_numeric_correct)<=greatest(v_tolerance,0);
    elsif v_question.question_type='short_answer' then
      v_text_response:=lower(regexp_replace(btrim(coalesce(v_response->>'value','')),'[[:space:]]+',' ','g'));
      if v_text_response='' then
        raise exception 'SUPPORT_PAPER_RESPONSE_INVALID:%',v_question.question_code;
      end if;
      if jsonb_typeof(v_key.correct_answer->'accepted_text')='array' then
        select exists(
          select 1
          from jsonb_array_elements_text(v_key.correct_answer->'accepted_text') t(value)
          where lower(regexp_replace(btrim(t.value),'[[:space:]]+',' ','g'))=v_text_response
        ) into v_is_correct;
      else
        v_is_correct:=v_text_response=lower(regexp_replace(btrim(coalesce(v_key.correct_answer->>'value','')),'[[:space:]]+',' ','g'));
      end if;
    else
      raise exception 'SUPPORT_PAPER_QUESTION_TYPE_UNSUPPORTED:%',v_question.question_code;
    end if;

    if v_is_correct then
      v_points:=coalesce(v_question.points,0);
      v_score:=v_score+v_points;
    end if;

    insert into public.quiz_attempt_answers(
      workspace_id,attempt_id,question_id,response,evaluation,is_correct,
      points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
    ) values (
      p_workspace_id,v_attempt.id,v_question.id,v_response,
      case when v_is_correct then 'correct' else 'incorrect' end,
      v_is_correct,v_points,
      case when v_response='{"support_unanswered":true}'::jsonb then 0 else 1 end,
      0,
      case when v_response='{"support_unanswered":true}'::jsonb then false else v_is_correct end,
      case when v_is_correct then 'mastered' else 'not_mastered' end
    );

    if v_concept_id is not null then
      v_mastery_evidence:=case when v_is_correct then 100 else 0 end;
      insert into public.learner_concept_mastery as mastery(
        workspace_id,learner_id,concept_id,mastery_score,evidence_count,
        first_try_correct_count,total_question_count,total_hint_count,
        last_difficulty,last_assessed_at,metadata
      ) values (
        p_workspace_id,p_learner_id,v_concept_id,v_mastery_evidence,1,
        case when v_is_correct then 1 else 0 end,
        1,0,v_question.difficulty_level,now(),
        jsonb_build_object(
          'engine','support-paper-v1',
          'support_source_code',v_version.settings->>'source_code',
          'support_session_slug',p_session_slug
        )
      )
      on conflict (learner_id,concept_id) do update
      set mastery_score=round(
            ((mastery.mastery_score*mastery.evidence_count)+v_mastery_evidence)
            /(mastery.evidence_count+1),2
          ),
          evidence_count=mastery.evidence_count+1,
          first_try_correct_count=mastery.first_try_correct_count+case when v_is_correct then 1 else 0 end,
          total_question_count=mastery.total_question_count+1,
          total_hint_count=mastery.total_hint_count,
          last_difficulty=v_question.difficulty_level,
          last_assessed_at=now(),
          metadata=jsonb_build_object(
            'engine','support-paper-v1',
            'support_source_code',v_version.settings->>'source_code',
            'support_session_slug',p_session_slug
          );
    end if;
  end loop;

  if v_question_count=0 then
    raise exception 'SUPPORT_PAPER_EMPTY_SESSION';
  end if;

  v_percentage:=case when v_max>0 then round(v_score/v_max*100,2) else 0 end;
  v_result:=jsonb_build_object(
    'ok',true,
    'attempt_id',v_attempt.id,
    'quiz_version_id',p_quiz_version_id,
    'session_slug',p_session_slug,
    'score_points',v_score,
    'max_points',v_max,
    'percentage',v_percentage,
    'question_count',v_question_count,
    'graded_count',v_graded_count,
    'ungraded_count',v_ungraded_count,
    'unanswered_count',v_unanswered_count,
    'paper_ingested',true
  );

  update public.quiz_attempts
  set status='submitted',
      submitted_at=clock_timestamp(),
      score_points=v_score,
      max_points=v_max,
      percentage=v_percentage,
      duration_seconds=0,
      metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object(
          'paper_ingested',true,
          'paper_ingested_at',clock_timestamp(),
          'support_paper_result',v_result
        )
  where workspace_id=p_workspace_id
    and id=v_attempt.id
    and learner_id=p_learner_id;

  return v_result;
end;
$function$;

revoke all on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) from public;
revoke all on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) from anon,authenticated;
grant execute on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) to service_role;

comment on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) is
  'Ingests one exact immutable support-workbook session solved on paper. Blocks duplicate digital/paper completion evidence and never resolves a latest version.';
