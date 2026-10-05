-- FLH-FEAT-2026-020 v1.0
-- Forward-only support for source-faithful typed Learning responses used by
-- official supplementary workbook sessions. Existing single-choice behavior
-- remains on flh_learning_answer and is intentionally unchanged.

create or replace function public.flh_learning_save_response_draft(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_queue public.quiz_attempt_question_queue%rowtype;
  v_question public.quiz_questions%rowtype;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_attempt_id is null
     or p_question_id is null
     or p_response is null
     or jsonb_typeof(p_response) <> 'object'
     or jsonb_typeof(p_response->'value') <> 'string'
     or (select count(*) from jsonb_object_keys(p_response)) <> 1
     or length(p_response->>'value') > 2000
     or nullif(btrim(coalesce(p_response->>'value','')),'') is null then
    return jsonb_build_object('error','INVALID_ANSWER');
  end if;

  if not exists (
    select 1
    from public.learners l
    where l.id=p_learner_id
      and l.workspace_id=p_workspace_id
      and l.is_active
  ) then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  -- Match the answer RPC lock order so draft persistence and grading serialize
  -- on the same attempt/queue rows instead of racing stale metadata writes.
  select a.* into v_attempt
  from public.quiz_attempts a
  where a.id=p_attempt_id
    and a.workspace_id=p_workspace_id
    and a.learner_id=p_learner_id
  for update;

  if not found
     or v_attempt.status <> 'in_progress'
     or v_attempt.delivery_mode <> 'learning' then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  select qq.* into v_queue
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id=p_workspace_id
    and qq.quiz_attempt_id=p_attempt_id
    and qq.question_id=p_question_id
  order by qq.sequence_no
  limit 1
  for update;

  if not found or v_queue.status <> 'active' then
    return jsonb_build_object('error','QUESTION_NOT_ACTIVE');
  end if;

  select q.* into v_question
  from public.quiz_questions q
  where q.id=p_question_id
    and q.workspace_id=p_workspace_id
    and q.quiz_version_id=v_attempt.quiz_version_id;

  if not found or v_question.question_type not in ('numeric','short_answer') then
    return jsonb_build_object('error','UNSUPPORTED_QUESTION_TYPE');
  end if;

  update public.quiz_attempt_question_queue
  set interaction_metadata=coalesce(interaction_metadata,'{}'::jsonb)
        || jsonb_build_object(
          'draft_response',p_response,
          'draft_saved_at',clock_timestamp()
        )
  where id=v_queue.id;

  return jsonb_build_object('ok',true,'response',p_response);
end;
$function$;

revoke all on function public.flh_learning_save_response_draft(uuid,uuid,uuid,uuid,jsonb) from public;
revoke all on function public.flh_learning_save_response_draft(uuid,uuid,uuid,uuid,jsonb) from anon, authenticated;
grant execute on function public.flh_learning_save_response_draft(uuid,uuid,uuid,uuid,jsonb) to service_role;

comment on function public.flh_learning_save_response_draft(uuid,uuid,uuid,uuid,jsonb) is
  'Atomically persists a numeric/short-answer Learning draft while the exact attempt question is active. Serializes with answer submission so late draft writes cannot overwrite grading metadata.';

create or replace function public.flh_learning_clear_response_draft(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_question_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_queue public.quiz_attempt_question_queue%rowtype;
  v_question public.quiz_questions%rowtype;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_attempt_id is null
     or p_question_id is null then
    return jsonb_build_object('error','INVALID_ANSWER');
  end if;

  if not exists (
    select 1 from public.learners l
    where l.id=p_learner_id
      and l.workspace_id=p_workspace_id
      and l.is_active
  ) then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  select a.* into v_attempt
  from public.quiz_attempts a
  where a.id=p_attempt_id
    and a.workspace_id=p_workspace_id
    and a.learner_id=p_learner_id
  for update;

  if not found
     or v_attempt.status <> 'in_progress'
     or v_attempt.delivery_mode <> 'learning' then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  select qq.* into v_queue
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id=p_workspace_id
    and qq.quiz_attempt_id=p_attempt_id
    and qq.question_id=p_question_id
  order by qq.sequence_no
  limit 1
  for update;

  if not found or v_queue.status <> 'active' then
    return jsonb_build_object('error','QUESTION_NOT_ACTIVE');
  end if;

  select q.* into v_question
  from public.quiz_questions q
  where q.id=p_question_id
    and q.workspace_id=p_workspace_id
    and q.quiz_version_id=v_attempt.quiz_version_id;

  if not found or v_question.question_type not in ('numeric','short_answer') then
    return jsonb_build_object('error','UNSUPPORTED_QUESTION_TYPE');
  end if;

  update public.quiz_attempt_question_queue
  set interaction_metadata=coalesce(interaction_metadata,'{}'::jsonb)
        - 'draft_response' - 'draft_saved_at'
  where id=v_queue.id;

  return jsonb_build_object('ok',true,'cleared',true);
end;
$function$;

revoke all on function public.flh_learning_clear_response_draft(uuid,uuid,uuid,uuid) from public;
revoke all on function public.flh_learning_clear_response_draft(uuid,uuid,uuid,uuid) from anon, authenticated;
grant execute on function public.flh_learning_clear_response_draft(uuid,uuid,uuid,uuid) to service_role;

comment on function public.flh_learning_clear_response_draft(uuid,uuid,uuid,uuid) is
  'Atomically clears a restored numeric/short-answer draft while the exact Learning question remains active.';

create or replace function public.flh_learning_answer_response(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_queue public.quiz_attempt_question_queue%rowtype;
  v_question public.quiz_questions%rowtype;
  v_key public.quiz_question_answer_keys%rowtype;
  v_attempt_no integer := 1;
  v_max_attempts integer := 1;
  v_used_hint_level integer := 0;
  v_hint_level integer := null;
  v_hint jsonb := null;
  v_attempt_scores jsonb;
  v_score_percent numeric := 0;
  v_score_fraction numeric := 0;
  v_is_correct boolean := false;
  v_finalized boolean := false;
  v_ungraded boolean := false;
  v_numeric_response numeric;
  v_numeric_correct numeric;
  v_tolerance numeric := 0;
  v_text_response text;
  v_text_correct text;
  v_feedback_text text;
  v_next_queue_id uuid;
  v_mastery_evidence numeric := 0;
  v_result jsonb;
  v_cached_response jsonb;
  v_cached_result jsonb;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_attempt_id is null
     or p_question_id is null
     or p_response is null
     or jsonb_typeof(p_response) <> 'object'
     or jsonb_typeof(p_response->'value') <> 'string'
     or (select count(*) from jsonb_object_keys(p_response)) <> 1
     or length(p_response->>'value') > 2000
     or nullif(btrim(coalesce(p_response->>'value','')),'') is null then
    return jsonb_build_object('error','INVALID_ANSWER');
  end if;

  if not exists (
    select 1 from public.learners l
    where l.id=p_learner_id
      and l.workspace_id=p_workspace_id
      and l.is_active
  ) then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  select a.* into v_attempt
  from public.quiz_attempts a
  where a.id=p_attempt_id
    and a.workspace_id=p_workspace_id
    and a.learner_id=p_learner_id
  for update;

  if not found
     or v_attempt.status <> 'in_progress'
     or v_attempt.delivery_mode <> 'learning' then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  select qq.* into v_queue
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id=p_workspace_id
    and qq.quiz_attempt_id=p_attempt_id
    and qq.question_id=p_question_id
  order by qq.sequence_no
  limit 1
  for update;

  if not found then
    return jsonb_build_object('error','QUESTION_NOT_ACTIVE');
  end if;

  if v_queue.status='completed' then
    v_cached_response:=v_queue.interaction_metadata->'learning_response_last_response';
    v_cached_result:=v_queue.interaction_metadata->'learning_response_last_result';
    if jsonb_typeof(v_cached_response)='object'
       and jsonb_typeof(v_cached_result)='object'
       and v_cached_response=p_response then
      return v_cached_result;
    end if;
    return jsonb_build_object('error','QUESTION_NOT_ACTIVE');
  end if;

  if v_queue.status <> 'active' then
    return jsonb_build_object('error','QUESTION_NOT_ACTIVE');
  end if;

  select q.* into v_question
  from public.quiz_questions q
  where q.id=p_question_id
    and q.workspace_id=p_workspace_id
    and q.quiz_version_id=v_attempt.quiz_version_id;

  if not found or v_question.question_type not in ('numeric','short_answer') then
    return jsonb_build_object('error','UNSUPPORTED_QUESTION_TYPE');
  end if;

  v_ungraded:=coalesce(v_question.source_metadata->>'grading_mode','')='ungraded';
  v_used_hint_level:=coalesce(v_queue.hint_level_requested,0);

  if v_ungraded then
    if nullif(btrim(coalesce(p_response->>'value','')),'') is null then
      return jsonb_build_object('error','INVALID_ANSWER');
    end if;

    insert into public.quiz_attempt_answers(
      workspace_id,attempt_id,question_id,response,evaluation,is_correct,
      points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
    ) values (
      p_workspace_id,p_attempt_id,p_question_id,p_response,'ungraded',null,
      0,1,v_used_hint_level,null,null
    )
    on conflict (attempt_id,question_id) do update
    set response=excluded.response,
        evaluation='ungraded',
        is_correct=null,
        points_awarded=0,
        attempts_used=1,
        hints_used=excluded.hints_used,
        first_try_correct=null,
        mastery_result=null;

    update public.quiz_attempt_question_queue
    set status='completed',
        interaction_metadata=(coalesce(interaction_metadata,'{}'::jsonb)
          - 'draft_response' - 'draft_saved_at')
          || jsonb_build_object(
            'learning_response_last_response',p_response,
            'learning_response_last_result',jsonb_build_object(
              'finalized',true,'is_correct',null,'ungraded',true,
              'attempt_no',1,'hints_used',v_used_hint_level
            )
          )
    where id=v_queue.id;

    select pending.id into v_next_queue_id
    from public.quiz_attempt_question_queue pending
    where pending.workspace_id=p_workspace_id
      and pending.quiz_attempt_id=p_attempt_id
      and pending.status='pending'
    order by pending.sequence_no
    limit 1
    for update;

    if found then
      update public.quiz_attempt_question_queue
      set status='active'
      where id=v_next_queue_id;
    end if;

    return jsonb_build_object(
      'finalized',true,
      'is_correct',null,
      'ungraded',true,
      'attempt_no',1,
      'hints_used',v_used_hint_level,
      'hint',null,
      'hint_level',null,
      'explanation',null
    );
  end if;

  select k.* into v_key
  from public.quiz_question_answer_keys k
  where k.workspace_id=p_workspace_id
    and k.question_id=p_question_id;

  if not found then
    return jsonb_build_object('error','ANSWER_KEY_NOT_FOUND');
  end if;

  select count(*)::integer+1 into v_attempt_no
  from public.quiz_answer_attempts aa
  where aa.workspace_id=p_workspace_id
    and aa.quiz_attempt_id=p_attempt_id
    and aa.question_id=p_question_id;

  v_max_attempts:=coalesce(v_question.max_attempts,4);
  if v_attempt_no>v_max_attempts then
    return jsonb_build_object('error','MAX_ATTEMPTS_REACHED');
  end if;

  if v_question.question_type='numeric' then
    begin
      v_numeric_response:=replace(btrim(p_response->>'value'),',','.')::numeric;
      v_numeric_correct:=replace(btrim(v_key.correct_answer->>'value'),',','.')::numeric;
      v_tolerance:=coalesce(
        nullif(v_key.grading_config->>'absolute_tolerance','')::numeric,
        nullif(v_key.correct_answer->>'tolerance','')::numeric,
        0
      );
    exception when others then
      return jsonb_build_object('error','INVALID_ANSWER');
    end;
    v_is_correct:=abs(v_numeric_response-v_numeric_correct)<=greatest(v_tolerance,0);
  else
    v_text_response:=lower(regexp_replace(btrim(coalesce(p_response->>'value','')),'[[:space:]]+','','g'));
    if v_text_response='' then
      return jsonb_build_object('error','INVALID_ANSWER');
    end if;

    if jsonb_typeof(v_key.correct_answer->'accepted_text')='array' then
      select exists(
        select 1
        from jsonb_array_elements_text(v_key.correct_answer->'accepted_text') t(value)
        where lower(regexp_replace(btrim(t.value),'[[:space:]]+','','g'))=v_text_response
      ) into v_is_correct;
    else
      v_text_correct:=lower(regexp_replace(btrim(coalesce(v_key.correct_answer->>'value','')),'[[:space:]]+','','g'));
      if v_text_correct='' then
        return jsonb_build_object('error','ANSWER_KEY_NOT_FOUND');
      end if;
      v_is_correct:=v_text_response=v_text_correct;
    end if;
  end if;

  select v.settings->'attempt_scores'
  into v_attempt_scores
  from public.quiz_versions v
  where v.id=v_attempt.quiz_version_id
    and v.workspace_id=p_workspace_id;

  if v_attempt_scores is null
     or jsonb_typeof(v_attempt_scores)<>'array'
     or jsonb_array_length(v_attempt_scores)=0 then
    v_attempt_scores:='[100,75,50,25]'::jsonb;
  end if;

  if v_is_correct then
    begin
      v_score_percent:=coalesce(
        (v_attempt_scores->>least(v_attempt_no-1,jsonb_array_length(v_attempt_scores)-1))::numeric,
        25
      );
    exception when others then
      v_score_percent:=25;
    end;
    v_score_fraction:=greatest(0,least(1,v_score_percent/100));
  end if;

  v_finalized:=v_is_correct or v_attempt_no>=v_max_attempts;

  if not v_is_correct and not v_finalized then
    v_hint_level:=least(4,greatest(v_attempt_no,v_used_hint_level+1));
    select jsonb_build_object(
      'hint_level',h.hint_level,
      'pedagogical_role',h.pedagogical_role,
      'content',h.content,
      'language',h.language,
      'terminology_display_mode',h.terminology_display_mode
    )
    into v_hint
    from public.quiz_question_hints h
    where h.workspace_id=p_workspace_id
      and h.question_id=p_question_id
      and h.hint_level=v_hint_level;

    if found then
      v_used_hint_level:=greatest(v_used_hint_level,v_hint_level);
      update public.quiz_attempt_question_queue
      set hint_level_requested=v_used_hint_level,
          interaction_metadata=coalesce(interaction_metadata,'{}'::jsonb)-'draft_response'-'draft_saved_at'
      where id=v_queue.id;
    else
      v_hint:=null;
      v_hint_level:=null;
      update public.quiz_attempt_question_queue
      set interaction_metadata=coalesce(interaction_metadata,'{}'::jsonb)-'draft_response'-'draft_saved_at'
      where id=v_queue.id;
    end if;
  else
    update public.quiz_attempt_question_queue
    set interaction_metadata=coalesce(interaction_metadata,'{}'::jsonb)-'draft_response'-'draft_saved_at'
    where id=v_queue.id;
  end if;

  v_feedback_text:=case
    when v_is_correct then coalesce(v_key.correct_explanation,v_key.explanation)
    when v_finalized then coalesce(v_key.final_incorrect_explanation,v_key.explanation)
    else v_hint->>'content'
  end;

  insert into public.quiz_answer_attempts(
    workspace_id,quiz_attempt_id,question_id,attempt_no,response,is_correct,
    feedback_text,hint_level_shown,score_fraction
  ) values (
    p_workspace_id,p_attempt_id,p_question_id,v_attempt_no,p_response,v_is_correct,
    v_feedback_text,v_hint_level,v_score_fraction
  );

  if v_finalized then
    insert into public.quiz_attempt_answers(
      workspace_id,attempt_id,question_id,response,evaluation,is_correct,
      points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
    ) values (
      p_workspace_id,p_attempt_id,p_question_id,p_response,
      case when v_is_correct then 'correct' else 'incorrect' end,
      v_is_correct,
      v_question.points*v_score_fraction,
      v_attempt_no,
      v_used_hint_level,
      v_is_correct and v_attempt_no=1,
      case
        when v_is_correct and v_score_fraction>=0.75 then 'mastered'
        when v_is_correct then 'needs_practice'
        else 'not_mastered'
      end
    )
    on conflict (attempt_id,question_id) do update
    set response=excluded.response,
        evaluation=excluded.evaluation,
        is_correct=excluded.is_correct,
        points_awarded=excluded.points_awarded,
        attempts_used=excluded.attempts_used,
        hints_used=excluded.hints_used,
        first_try_correct=excluded.first_try_correct,
        mastery_result=excluded.mastery_result;

    if v_queue.concept_id is not null then
      v_mastery_evidence:=case when v_is_correct then v_score_fraction*100 else 0 end;
      insert into public.learner_concept_mastery as mastery(
        workspace_id,learner_id,concept_id,mastery_score,evidence_count,
        first_try_correct_count,total_question_count,total_hint_count,
        last_difficulty,last_assessed_at,metadata
      ) values (
        p_workspace_id,p_learner_id,v_queue.concept_id,v_mastery_evidence,1,
        case when v_is_correct and v_attempt_no=1 then 1 else 0 end,
        1,v_used_hint_level,v_question.difficulty_level,now(),
        jsonb_build_object('engine','learning-api-v2','response_type',v_question.question_type,'latest_attempt_no',v_attempt_no)
      )
      on conflict (learner_id,concept_id) do update
      set mastery_score=round(
            ((mastery.mastery_score*mastery.evidence_count)+v_mastery_evidence)
            /(mastery.evidence_count+1),2
          ),
          evidence_count=mastery.evidence_count+1,
          first_try_correct_count=mastery.first_try_correct_count
            + case when v_is_correct and v_attempt_no=1 then 1 else 0 end,
          total_question_count=mastery.total_question_count+1,
          total_hint_count=mastery.total_hint_count+v_used_hint_level,
          last_difficulty=v_question.difficulty_level,
          last_assessed_at=now(),
          metadata=jsonb_build_object('engine','learning-api-v2','response_type',v_question.question_type,'latest_attempt_no',v_attempt_no);
    end if;

    select pending.id into v_next_queue_id
    from public.quiz_attempt_question_queue pending
    where pending.workspace_id=p_workspace_id
      and pending.quiz_attempt_id=p_attempt_id
      and pending.status='pending'
    order by pending.sequence_no
    limit 1
    for update;

    if found then
      update public.quiz_attempt_question_queue
      set status='active'
      where id=v_next_queue_id;
    end if;
  end if;

  v_result:=jsonb_build_object(
    'is_correct',v_is_correct,
    'attempt_no',v_attempt_no,
    'finalized',v_finalized,
    'ungraded',false,
    'hint',v_hint,
    'hint_level',v_hint_level,
    'hints_used',v_used_hint_level,
    'explanation',case
      when not v_finalized then null
      when v_is_correct then coalesce(v_key.correct_explanation,v_key.explanation)
      else coalesce(v_key.final_incorrect_explanation,v_key.explanation)
    end
  );

  if v_finalized then
    update public.quiz_attempt_question_queue
    set status='completed',
        interaction_metadata=(coalesce(interaction_metadata,'{}'::jsonb)
          - 'draft_response' - 'draft_saved_at')
          || jsonb_build_object(
            'learning_response_last_response',p_response,
            'learning_response_last_result',v_result
          )
    where id=v_queue.id;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb) from public;
revoke all on function public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb) from anon, authenticated;
grant execute on function public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb) to service_role;

comment on function public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb) is
  'Grades numeric/short-answer Learning responses or records explicitly ungraded workbook reflections. Service-role only; Edge authenticates learner sessions.';
