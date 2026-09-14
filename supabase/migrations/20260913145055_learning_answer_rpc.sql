-- Consolidate the Learning Mode answer transition into one transactional call.
-- The function intentionally remains SECURITY INVOKER: learning-api calls it as
-- service_role, so elevated definer privileges are unnecessary. Every relation
-- is schema-qualified and the search path is empty.
create or replace function public.flh_learning_answer(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_option_position integer
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
  v_remediation_question public.quiz_questions%rowtype;
  v_remediation_queue public.quiz_attempt_question_queue%rowtype;
  v_option_id uuid;
  v_next_queue_id uuid;
  v_attempt_no integer;
  v_max_attempts integer;
  v_correct_option_position integer;
  v_is_correct boolean;
  v_finalized boolean;
  v_hint jsonb := null;
  v_hint_level integer := null;
  v_used_hint_level integer := 0;
  v_hints_used integer := 0;
  v_attempt_scores jsonb;
  v_score_percent numeric := 0;
  v_score_fraction numeric := 0;
  v_feedback_text text;
  v_remediation jsonb := null;
  v_result jsonb;
  v_cached_response jsonb;
  v_cached_result jsonb;
  v_mastery_evidence numeric := 0;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_attempt_id is null
     or p_question_id is null
     or p_option_position is null then
    return jsonb_build_object('error', 'INVALID_ANSWER');
  end if;

  -- Validate the learner independently, then lock the owned attempt before any
  -- queue row. This fixed lock order serializes double submits and activation.
  if not exists (
    select 1
    from public.learners l
    where l.id = p_learner_id
      and l.workspace_id = p_workspace_id
      and l.is_active
  ) then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  select a.*
  into v_attempt
  from public.quiz_attempts a
  where a.id = p_attempt_id
    and a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
  for update;

  if not found
     or v_attempt.status <> 'in_progress'
     or v_attempt.delivery_mode <> 'learning' then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  select qq.*
  into v_queue
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id
    and qq.question_id = p_question_id
  order by qq.sequence_no
  limit 1
  for update;

  if not found then
    return jsonb_build_object('error', 'QUESTION_NOT_ACTIVE');
  end if;

  -- A response can be committed even when the caller loses the HTTP response.
  -- Return the exact stored final result only for the same submitted option.
  if v_queue.status = 'completed' then
    v_cached_response := v_queue.interaction_metadata->'learning_answer_last_response';
    v_cached_result := v_queue.interaction_metadata->'learning_answer_last_result';
    if jsonb_typeof(v_cached_response) = 'object'
       and jsonb_typeof(v_cached_result) = 'object'
       and (v_cached_response->>'option_position')::integer = p_option_position then
      return v_cached_result;
    end if;
    return jsonb_build_object('error', 'QUESTION_NOT_ACTIVE');
  end if;

  if v_queue.status <> 'active' then
    return jsonb_build_object('error', 'QUESTION_NOT_ACTIVE');
  end if;

  select q.*
  into v_question
  from public.quiz_questions q
  where q.id = p_question_id
    and q.workspace_id = p_workspace_id
    and q.quiz_version_id = v_attempt.quiz_version_id;

  if not found or v_question.question_type <> 'single_choice' then
    return jsonb_build_object('error', 'UNSUPPORTED_QUESTION_TYPE');
  end if;

  select o.id
  into v_option_id
  from public.quiz_question_options o
  where o.workspace_id = p_workspace_id
    and o.question_id = p_question_id
    and o.position = p_option_position;

  if not found then
    return jsonb_build_object('error', 'INVALID_ANSWER');
  end if;

  select k.*
  into v_key
  from public.quiz_question_answer_keys k
  where k.workspace_id = p_workspace_id
    and k.question_id = p_question_id;

  if not found then
    return jsonb_build_object('error', 'ANSWER_KEY_NOT_FOUND');
  end if;

  select count(*)::integer + 1
  into v_attempt_no
  from public.quiz_answer_attempts aa
  where aa.workspace_id = p_workspace_id
    and aa.quiz_attempt_id = p_attempt_id
    and aa.question_id = p_question_id;

  v_max_attempts := coalesce(v_question.max_attempts, 4);
  if v_attempt_no > v_max_attempts then
    return jsonb_build_object('error', 'MAX_ATTEMPTS_REACHED');
  end if;

  begin
    v_correct_option_position := (v_key.correct_answer->>'option_position')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_correct_option_position := null;
  end;

  if v_correct_option_position is null
     or not exists (
       select 1
       from public.quiz_question_options correct_option
       where correct_option.workspace_id = p_workspace_id
         and correct_option.question_id = p_question_id
         and correct_option.position = v_correct_option_position
     ) then
    return jsonb_build_object('error', 'ANSWER_KEY_NOT_FOUND');
  end if;

  v_is_correct := coalesce(p_option_position = v_correct_option_position, false);

  select v.settings->'attempt_scores'
  into v_attempt_scores
  from public.quiz_versions v
  where v.id = v_attempt.quiz_version_id
    and v.workspace_id = p_workspace_id;

  if v_attempt_scores is null
     or jsonb_typeof(v_attempt_scores) <> 'array'
     or jsonb_array_length(v_attempt_scores) = 0 then
    v_attempt_scores := '[100,75,50,25]'::jsonb;
  end if;

  if v_is_correct then
    begin
      v_score_percent := coalesce(
        (v_attempt_scores->>least(v_attempt_no - 1, jsonb_array_length(v_attempt_scores) - 1))::numeric,
        25
      );
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_score_percent := 25;
    end;
    v_score_fraction := greatest(0, least(1, v_score_percent / 100));
  end if;
  v_finalized := v_is_correct or v_attempt_no >= v_max_attempts;
  v_used_hint_level := coalesce(v_queue.hint_level_requested, 0);

  if not v_is_correct and not v_finalized then
    v_hint_level := least(4, greatest(v_attempt_no, v_used_hint_level + 1));
    select jsonb_build_object(
      'hint_level', h.hint_level,
      'pedagogical_role', h.pedagogical_role,
      'content', h.content,
      'language', h.language,
      'terminology_display_mode', h.terminology_display_mode
    )
    into v_hint
    from public.quiz_question_hints h
    where h.workspace_id = p_workspace_id
      and h.question_id = p_question_id
      and h.hint_level = v_hint_level;

    if found then
      v_used_hint_level := greatest(v_used_hint_level, v_hint_level);
      update public.quiz_attempt_question_queue
      set hint_level_requested = v_used_hint_level,
          draft_option_position = null
      where id = v_queue.id;
    else
      v_hint := null;
      v_hint_level := null;
      update public.quiz_attempt_question_queue
      set draft_option_position = null
      where id = v_queue.id;
    end if;
  else
    update public.quiz_attempt_question_queue
    set draft_option_position = null
    where id = v_queue.id;
  end if;

  v_feedback_text := case
    when v_is_correct then coalesce(v_key.correct_explanation, v_key.explanation)
    when v_finalized then coalesce(v_key.final_incorrect_explanation, v_key.explanation)
    else v_hint->>'content'
  end;

  insert into public.quiz_answer_attempts(
    workspace_id,
    quiz_attempt_id,
    question_id,
    attempt_no,
    response,
    is_correct,
    feedback_text,
    hint_level_shown,
    score_fraction
  ) values (
    p_workspace_id,
    p_attempt_id,
    p_question_id,
    v_attempt_no,
    jsonb_build_object('option_position', p_option_position),
    v_is_correct,
    v_feedback_text,
    v_hint_level,
    v_score_fraction
  );

  -- Preserve the current remediation rule: select the first unused prepared
  -- question linked to the same concept when the configured attempt is reached.
  if not v_is_correct
     and v_attempt_no = coalesce(v_question.remediation_after_attempt, 3)
     and v_queue.concept_id is not null then
    select q.*
    into v_remediation_question
    from public.quiz_questions q
    where q.workspace_id = p_workspace_id
      and q.quiz_version_id = v_attempt.quiz_version_id
      and q.delivery_role = 'remediation_pool'
      and exists (
        select 1
        from public.quiz_question_concepts qc
        where qc.workspace_id = p_workspace_id
          and qc.question_id = q.id
          and qc.concept_id = v_queue.concept_id
      )
      and not exists (
        select 1
        from public.quiz_attempt_question_queue used
        where used.workspace_id = p_workspace_id
          and used.quiz_attempt_id = p_attempt_id
          and used.question_id = q.id
      )
    order by q.difficulty_level
    limit 1;

    if found then
      insert into public.quiz_attempt_question_queue(
        workspace_id,
        quiz_attempt_id,
        sequence_no,
        question_id,
        source_role,
        parent_question_id,
        concept_id,
        difficulty_level,
        status,
        selection_reason
      )
      select p_workspace_id,
             p_attempt_id,
             coalesce(max(existing.sequence_no), 0) + 1,
             v_remediation_question.id,
             'remediation',
             p_question_id,
             v_queue.concept_id,
             v_remediation_question.difficulty_level,
             'pending',
             'remediation_after_repeated_error'
      from public.quiz_attempt_question_queue existing
      where existing.workspace_id = p_workspace_id
        and existing.quiz_attempt_id = p_attempt_id
      returning * into v_remediation_queue;

      v_remediation := jsonb_build_object(
        'id', v_remediation_queue.id,
        'sequence_no', v_remediation_queue.sequence_no,
        'question_id', v_remediation_queue.question_id,
        'source_role', v_remediation_queue.source_role,
        'concept_id', v_remediation_queue.concept_id,
        'difficulty_level', v_remediation_queue.difficulty_level,
        'status', v_remediation_queue.status,
        'draft_option_position', v_remediation_queue.draft_option_position,
        'hint_level_requested', v_remediation_queue.hint_level_requested,
        'is_flagged', v_remediation_queue.is_flagged,
        'question', jsonb_build_object(
          'id', v_remediation_question.id,
          'question_code', v_remediation_question.question_code,
          'position', v_remediation_question.position,
          'question_type', v_remediation_question.question_type,
          'prompt', v_remediation_question.prompt,
          'origin', v_remediation_question.origin,
          'source_page_start', v_remediation_question.source_page_start,
          'source_page_end', v_remediation_question.source_page_end,
          'source_metadata', v_remediation_question.source_metadata,
          'points', v_remediation_question.points,
          'difficulty_level', v_remediation_question.difficulty_level,
          'max_attempts', v_remediation_question.max_attempts,
          'remediation_after_attempt', v_remediation_question.remediation_after_attempt,
          'delivery_role', v_remediation_question.delivery_role,
          'options', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', o.id,
              'position', o.position,
              'label', o.label,
              'content', o.content
            ) order by o.position)
            from public.quiz_question_options o
            where o.workspace_id = p_workspace_id
              and o.question_id = v_remediation_question.id
          ), '[]'::jsonb),
          'assets', coalesce((
            select jsonb_agg(jsonb_build_object(
              'position', qa.position,
              'purpose', qa.purpose,
              'alt_text', qa.alt_text,
              'kind', asset.kind,
              'mime_type', asset.mime_type,
              'url', coalesce(asset.metadata->>'public_url', asset.metadata->>'url'),
              'storage_bucket', asset.storage_bucket,
              'storage_path', asset.storage_path
            ) order by qa.position)
            from public.quiz_question_assets qa
            join public.assets asset
              on asset.id = qa.asset_id
             and asset.workspace_id = qa.workspace_id
            where qa.workspace_id = p_workspace_id
              and qa.question_id = v_remediation_question.id
          ), '[]'::jsonb)
        )
      );
    end if;
  end if;

  if v_finalized then
    v_hints_used := v_used_hint_level;

    insert into public.quiz_attempt_answers(
      workspace_id,
      attempt_id,
      question_id,
      response,
      evaluation,
      is_correct,
      points_awarded,
      attempts_used,
      hints_used,
      first_try_correct,
      mastery_result
    ) values (
      p_workspace_id,
      p_attempt_id,
      p_question_id,
      jsonb_build_object('option_position', p_option_position),
      case when v_is_correct then 'correct' else 'incorrect' end,
      v_is_correct,
      v_question.points * v_score_fraction,
      v_attempt_no,
      v_hints_used,
      v_is_correct and v_attempt_no = 1,
      case
        when v_is_correct and v_score_fraction >= 0.75 then 'mastered'
        when v_is_correct then 'needs_practice'
        else 'not_mastered'
      end
    )
    on conflict (attempt_id, question_id) do update
    set response = excluded.response,
        evaluation = excluded.evaluation,
        is_correct = excluded.is_correct,
        points_awarded = excluded.points_awarded,
        attempts_used = excluded.attempts_used,
        hints_used = excluded.hints_used,
        first_try_correct = excluded.first_try_correct,
        mastery_result = excluded.mastery_result;

    update public.quiz_attempt_question_queue
    set status = 'completed',
        draft_option_position = null
    where id = v_queue.id;

    if v_queue.concept_id is not null then
      v_mastery_evidence := case when v_is_correct then v_score_fraction * 100 else 0 end;
      insert into public.learner_concept_mastery as mastery(
        workspace_id,
        learner_id,
        concept_id,
        mastery_score,
        evidence_count,
        first_try_correct_count,
        total_question_count,
        total_hint_count,
        last_difficulty,
        last_assessed_at,
        metadata
      ) values (
        p_workspace_id,
        p_learner_id,
        v_queue.concept_id,
        v_mastery_evidence,
        1,
        case when v_is_correct and v_attempt_no = 1 then 1 else 0 end,
        1,
        v_hints_used,
        v_question.difficulty_level,
        now(),
        jsonb_build_object('engine', 'learning-api-v2', 'latest_attempt_no', v_attempt_no)
      )
      on conflict (learner_id, concept_id) do update
      set mastery_score = round(
            ((mastery.mastery_score * mastery.evidence_count) + v_mastery_evidence)
            / (mastery.evidence_count + 1),
            2
          ),
          evidence_count = mastery.evidence_count + 1,
          first_try_correct_count = mastery.first_try_correct_count
            + case when v_is_correct and v_attempt_no = 1 then 1 else 0 end,
          total_question_count = mastery.total_question_count + 1,
          total_hint_count = mastery.total_hint_count + v_hints_used,
          last_difficulty = v_question.difficulty_level,
          last_assessed_at = now(),
          metadata = jsonb_build_object('engine', 'learning-api-v2', 'latest_attempt_no', v_attempt_no);
    end if;

    select pending.id
    into v_next_queue_id
    from public.quiz_attempt_question_queue pending
    where pending.workspace_id = p_workspace_id
      and pending.quiz_attempt_id = p_attempt_id
      and pending.status = 'pending'
    order by pending.sequence_no
    limit 1
    for update;

    if found then
      update public.quiz_attempt_question_queue
      set status = 'active'
      where id = v_next_queue_id;
    end if;
  end if;

  v_result := jsonb_build_object(
    'is_correct', v_is_correct,
    'attempt_no', v_attempt_no,
    'finalized', v_finalized,
    'hint', v_hint,
    'hint_level', v_hint_level,
    'hints_used', v_used_hint_level,
    'remediation_added', v_remediation,
    'explanation', case
      when not v_finalized then null
      when v_is_correct then coalesce(v_key.correct_explanation, v_key.explanation)
      else coalesce(v_key.final_incorrect_explanation, v_key.explanation)
    end,
    'correct_option_position', case when v_finalized then v_correct_option_position else null end
  );

  if v_finalized then
    update public.quiz_attempt_question_queue
    set interaction_metadata = coalesce(interaction_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'learning_answer_last_response', jsonb_build_object('option_position', p_option_position),
        'learning_answer_last_result', v_result
      )
    where id = v_queue.id;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.flh_learning_answer(uuid,uuid,uuid,uuid,integer) from public;
revoke all on function public.flh_learning_answer(uuid,uuid,uuid,uuid,integer) from anon, authenticated;
grant execute on function public.flh_learning_answer(uuid,uuid,uuid,uuid,integer) to service_role;

comment on function public.flh_learning_answer(uuid,uuid,uuid,uuid,integer) is
  'Transactionally grades one Learning answer. Service-role only; Edge authenticates the custom learner HMAC session.';
