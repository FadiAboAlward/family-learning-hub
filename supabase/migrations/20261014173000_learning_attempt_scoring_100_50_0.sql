-- FLH-FEAT-2026-030 v1.1 — server-owned Learning attempt scoring.
-- Spec: https://docs.google.com/document/d/1XK62CabAaXW7YJP8k_amvQNImUi9Rw4sGVSB2AxU_BY/edit
-- Only new Learning attempts capture 100/50/0/0. In-progress and historical
-- attempts without a score-policy snapshot preserve existing scoring.
-- No data backfill. Existing quiz-version settings remain immutable.
-- These function bodies follow the exact latest main migration definitions.
alter table public.quiz_attempt_question_queue
  add column if not exists score_policy_snapshot jsonb;

create or replace function public.flh_learning_start(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_slug text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quiz public.quizzes%rowtype;
  v_version public.quiz_versions%rowtype;
  v_attempt public.quiz_attempts%rowtype;
  v_assignment_id uuid;
  v_via_program boolean := false;
  v_via_assignment boolean := false;
  v_resumed boolean := false;
  v_queue jsonb := '[]'::jsonb;
  v_create_stage text := 'attempt';
  v_optional_video jsonb := null;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or nullif(btrim(p_quiz_slug), '') is null then
    return jsonb_build_object('error', 'QUIZ_NOT_FOUND');
  end if;

  select q.*
  into v_quiz
  from public.quizzes q
  where q.workspace_id = p_workspace_id
    and q.slug = p_quiz_slug
    and q.status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('error', 'QUIZ_NOT_FOUND');
  end if;

  -- Resume routing is version-stable: an in-progress attempt keeps its
  -- original immutable quiz_version_id even after a successor is published.
  select qv.*
  into v_version
  from public.quiz_attempts a
  join public.quiz_versions qv
    on qv.workspace_id = a.workspace_id
   and qv.id = a.quiz_version_id
  where a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
    and a.status = 'in_progress'
    and a.delivery_mode = 'learning'
    and qv.quiz_id = v_quiz.id
    and qv.state = 'published'
  order by a.started_at desc
  limit 1;

  if not found then
    -- Preserve an eligible explicit assignment's immutable version before
    -- choosing the newest published version for an unassigned program start.
    select qv.*
    into v_version
    from public.quiz_assignments qa
    join public.quiz_versions qv
      on qv.workspace_id = qa.workspace_id
     and qv.id = qa.quiz_version_id
    where qa.workspace_id = p_workspace_id
      and qa.learner_id = p_learner_id
      and qa.status in ('assigned', 'in_progress')
      and (qa.available_at is null or qa.available_at <= now())
      and (qa.due_at is null or qa.due_at >= now())
      and qv.quiz_id = v_quiz.id
      and qv.state = 'published'
    order by qa.created_at desc
    limit 1;

    if not found then
      select qv.*
      into v_version
      from public.quiz_versions qv
      where qv.workspace_id = p_workspace_id
        and qv.quiz_id = v_quiz.id
        and qv.state = 'published'
      order by qv.version_no desc
      limit 1;

      if not found then
        return jsonb_build_object('error', 'VERSION_NOT_FOUND');
      end if;
    end if;
  end if;

  -- The Edge session is authoritative, but the referenced learner must still
  -- be an active member of this workspace before any attempt can be resumed or
  -- created. Keep the public error indistinguishable from missing access.
  if not exists (
    select 1
    from public.learners l
    where l.id = p_learner_id
      and l.workspace_id = p_workspace_id
      and l.is_active
  ) then
    return jsonb_build_object('error', 'QUIZ_NOT_AVAILABLE');
  end if;

  select exists (
    select 1
    from public.learner_program_enrollments e
    join public.program_quizzes pq
      on pq.workspace_id = e.workspace_id
     and pq.program_id = e.program_id
     and pq.quiz_id = v_quiz.id
     and pq.availability = 'available'
    where e.workspace_id = p_workspace_id
      and e.learner_id = p_learner_id
      and e.status = 'active'
  ) into v_via_program;

  select qa.id
  into v_assignment_id
  from public.quiz_assignments qa
  where qa.workspace_id = p_workspace_id
    and qa.learner_id = p_learner_id
    and qa.quiz_version_id = v_version.id
    and qa.status in ('assigned', 'in_progress')
    and (qa.available_at is null or qa.available_at <= now())
    and (qa.due_at is null or qa.due_at >= now())
  order by qa.created_at desc
  limit 1;
  v_via_assignment := found;

  if not v_via_program and not v_via_assignment then
    return jsonb_build_object('error', 'QUIZ_NOT_AVAILABLE');
  end if;

  -- FLH-FEAT-2026-020 v1.1: official support paper and digital Learning
  -- represent the same evidence event. Serialize both delivery surfaces on one
  -- learner/version key, then re-check paper state while holding that lock.
  if coalesce((v_version.settings->>'support_source')::boolean,false) then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_workspace_id::text || ':' || p_learner_id::text || ':' || v_version.id::text || ':support-delivery',
        0
      )
    );

    if exists (
      select 1
      from public.quiz_attempts a
      where a.workspace_id=p_workspace_id
        and a.learner_id=p_learner_id
        and a.quiz_version_id=v_version.id
        and a.status in ('in_progress','submitted')
        and a.delivery_mode='exam'
        and nullif(a.metadata->>'paper_model_code','') is not null
    ) then
      return jsonb_build_object('error','QUIZ_NOT_AVAILABLE');
    end if;
  else
    -- Preserve the existing Learning-only serialization key for ordinary
    -- non-support quizzes.
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_workspace_id::text || ':' || p_learner_id::text || ':' || v_version.id::text || ':learning',
        0
      )
    );
  end if;

  select a.*
  into v_attempt
  from public.quiz_attempts a
  where a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
    and a.quiz_version_id = v_version.id
    and a.status = 'in_progress'
    and a.delivery_mode = 'learning'
  order by a.started_at desc
  limit 1
  for update;

  if found then
    v_resumed := true;
  else
    -- One exception block makes attempt and queue creation atomic. A queue
    -- failure rolls back the attempt insert before the error JSON is returned.
    begin
      insert into public.quiz_attempts(
        workspace_id,
        learner_id,
        quiz_version_id,
        assignment_id,
        status,
        delivery_mode,
        metadata
      ) values (
        p_workspace_id,
        p_learner_id,
        v_version.id,
        case when v_via_assignment then v_assignment_id else null end,
        'in_progress',
        'learning',
        jsonb_build_object(
          'engine', 'learning-api-v2',
          'quiz_slug', p_quiz_slug,
          'server_state', true,
          'scoring_policy_version', 'learning-100-50-0-0-v1',
          'scoring_attempt_scores', '[100,50,0,0]'::jsonb
        )
      )
      returning * into v_attempt;

      v_create_stage := 'queue';
      insert into public.quiz_attempt_question_queue(
        workspace_id,
        quiz_attempt_id,
        sequence_no,
        question_id,
        source_role,
        concept_id,
        difficulty_level,
        status,
        selection_reason,
        score_policy_snapshot
      )
      select
        p_workspace_id,
        v_attempt.id,
        row_number() over (order by q.position)::integer,
        q.id,
        'core',
        qc.concept_id,
        q.difficulty_level,
        case when row_number() over (order by q.position) = 1 then 'active' else 'pending' end,
        'published_core_question',
        '{"version":"learning-100-50-0-0-v1","attempt_scores":[100,50,0,0]}'::jsonb
      from public.quiz_questions q
      left join public.quiz_question_concepts qc
        on qc.workspace_id = q.workspace_id
       and qc.question_id = q.id
       and qc.is_primary
      where q.workspace_id = p_workspace_id
        and q.quiz_version_id = v_version.id
        and q.delivery_role = 'core'
      order by q.position;
    exception when others then
      raise warning 'flh_learning_start create failed at stage % (SQLSTATE %, message %)',
        v_create_stage,
        sqlstate,
        sqlerrm;
      if v_create_stage = 'attempt' then
        return jsonb_build_object('error', 'ATTEMPT_CREATE_FAILED');
      end if;
      return jsonb_build_object('error', 'QUEUE_CREATE_FAILED');
    end;
  end if;

  select coalesce(jsonb_agg(item order by sequence_no), '[]'::jsonb)
  into v_queue
  from (
    select
      qq.sequence_no,
      jsonb_build_object(
        'id', qq.id,
        'sequence_no', qq.sequence_no,
        'question_id', qq.question_id,
        'source_role', qq.source_role,
        'concept_id', qq.concept_id,
        'difficulty_level', qq.difficulty_level,
        'status', qq.status,
        'draft_option_position', qq.draft_option_position,
        'draft_response', qq.interaction_metadata->'draft_response',
        'hint_level_requested', qq.hint_level_requested,
        'last_hint', case
          when coalesce(qq.hint_level_requested,0) > 0 then (
            select jsonb_build_object(
              'hint_level', h.hint_level,
              'pedagogical_role', h.pedagogical_role,
              'content', h.content,
              'language', h.language,
              'terminology_display_mode', h.terminology_display_mode
            )
            from public.quiz_question_hints h
            where h.workspace_id = p_workspace_id
              and h.question_id = qq.question_id
              and h.hint_level = qq.hint_level_requested
            limit 1
          )
          else null
        end,
        'is_flagged', qq.is_flagged,
        'question', jsonb_build_object(
          'id', q.id,
          'question_code', q.question_code,
          'position', q.position,
          'question_type', q.question_type,
          'prompt', q.prompt,
          'prompt_language', q.prompt_language,
          'origin', q.origin,
          'source_page_start', q.source_page_start,
          'source_page_end', q.source_page_end,
          'source_metadata', q.source_metadata,
          'points', q.points,
          'difficulty_level', q.difficulty_level,
          'max_attempts', q.max_attempts,
          'remediation_after_attempt', q.remediation_after_attempt,
          'delivery_role', q.delivery_role,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'position', o.position,
                'label', o.label,
                'content', o.content
              )
              order by o.position
            )
            from public.quiz_question_options o
            where o.workspace_id = p_workspace_id
              and o.question_id = q.id
          ), '[]'::jsonb),
          'assets', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'position', qa.position,
                'purpose', qa.purpose,
                'alt_text', qa.alt_text,
                'kind', asset.kind,
                'mime_type', asset.mime_type,
                'url', coalesce(
                  nullif(asset.metadata->>'public_url', ''),
                  nullif(asset.metadata->>'url', '')
                ),
                'storage_bucket', asset.storage_bucket,
                'storage_path', asset.storage_path
              )
              order by qa.position
            )
            from public.quiz_question_assets qa
            join public.assets asset
              on asset.id = qa.asset_id
             and asset.workspace_id = qa.workspace_id
            where qa.workspace_id = p_workspace_id
              and qa.question_id = q.id
          ), '[]'::jsonb)
        )
      ) as item
    from public.quiz_attempt_question_queue qq
    join public.quiz_questions q
      on q.id = qq.question_id
     and q.workspace_id = qq.workspace_id
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = v_attempt.id
  ) payload;

  begin
    v_optional_video := private.flh_learning_optional_video(p_workspace_id,p_learner_id,v_attempt.id,v_version.id);
  exception when others then
    raise warning 'flh_learning_start optional video skipped (SQLSTATE %)', sqlstate;
    v_optional_video := null; -- Optional failures never roll back an authorized start.
  end;

  return jsonb_build_object(
    'optional_video', v_optional_video,
    'attempt_id', v_attempt.id,
    'started_at', v_attempt.started_at,
    'resumed', v_resumed,
    'quiz', jsonb_build_object(
      'slug', v_quiz.slug,
      'title', v_quiz.title,
      'description', v_quiz.description
    ),
    'queue', v_queue
  );
end;
$function$;

revoke all on function public.flh_learning_start(uuid,uuid,text) from public;
revoke all on function public.flh_learning_start(uuid,uuid,text) from anon, authenticated;
grant execute on function public.flh_learning_start(uuid,uuid,text) to service_role;

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
  v_answer_attempt_id uuid;
  v_misconception_id uuid := null;
  v_misconception_code text := null;
  v_misconception_confidence numeric := null;
  v_misconception_mapping_count integer := 0;
  v_misconception_concept_id uuid := null;
  v_detect_mapped_distractors boolean := true;
  v_prefer_misconception_specific_explanation boolean := true;
  v_effective_grade smallint := null;
  v_error_classification jsonb := '{}'::jsonb;
  v_explanation_set_id uuid := null;
  v_explanation_language text := null;
  v_misconception_feedback_text text := null;
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
  v_authoritative_score_snapshot jsonb;
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

  -- Respect the existing workspace-level pedagogy switches. Missing or
  -- malformed settings preserve the historical enabled behavior.
  select
    coalesce((
      select case
        when jsonb_typeof(ws.value->'detect_from_multiple_choice_distractors') = 'boolean'
          then (ws.value->>'detect_from_multiple_choice_distractors')::boolean
        else true
      end
      from public.workspace_settings ws
      where ws.workspace_id = p_workspace_id
        and ws.key = 'pedagogy.misconception_policy'
      limit 1
    ), true),
    coalesce((
      select case
        when jsonb_typeof(ws.value->'prefer_misconception_specific_explanation') = 'boolean'
          then (ws.value->>'prefer_misconception_specific_explanation')::boolean
        else true
      end
      from public.workspace_settings ws
      where ws.workspace_id = p_workspace_id
        and ws.key = 'pedagogy.misconception_policy'
      limit 1
    ), true)
  into v_detect_mapped_distractors, v_prefer_misconception_specific_explanation;

  -- A selected distractor is diagnostic evidence only when the authored option
  -- has exactly one misconception mapping in this workspace, and that sole
  -- mapping belongs to the active concept. Candidate + count are read in one
  -- statement snapshot so a concurrent mapping edit cannot turn a proven
  -- unique mapping into an arbitrary LIMIT 1 choice.
  if not v_is_correct
     and v_queue.concept_id is not null
     and v_detect_mapped_distractors then
    select
      candidate.mapping_count,
      candidate.misconception_id,
      candidate.misconception_code,
      candidate.confidence,
      candidate.concept_id
    into
      v_misconception_mapping_count,
      v_misconception_id,
      v_misconception_code,
      v_misconception_confidence,
      v_misconception_concept_id
    from (
      select
        count(*) over()::integer as mapping_count,
        m.id as misconception_id,
        m.code as misconception_code,
        qom.confidence,
        m.concept_id
      from public.question_option_misconceptions qom
      join public.misconceptions m
        on m.id = qom.misconception_id
       and m.workspace_id = qom.workspace_id
      where qom.workspace_id = p_workspace_id
        and qom.option_id = v_option_id
    ) candidate
    order by candidate.misconception_id
    limit 1;

    if found
       and v_misconception_mapping_count = 1
       and v_misconception_concept_id = v_queue.concept_id then
      v_error_classification := jsonb_build_object(
        'source', 'mapped_distractor',
        'option_id', v_option_id,
        'misconception_code', v_misconception_code,
        'confidence', v_misconception_confidence
      );

      if v_prefer_misconception_specific_explanation then
        -- Grade eligibility follows the attempt's enrolled program context when
        -- it exists. A primary program carrying this quiz is the next fallback;
        -- if there is exactly one matching active program grade, use it. The
        -- learner-level grade remains only the final display/default fallback.
        select coalesce(
          (
            select lp.grade_level
            from public.quiz_assignments qa
            join public.learner_program_enrollments lpe
              on lpe.id = qa.learner_program_enrollment_id
             and lpe.workspace_id = qa.workspace_id
             and lpe.learner_id = qa.learner_id
            join public.learning_programs lp
              on lp.id = lpe.program_id
             and lp.workspace_id = lpe.workspace_id
            where qa.id = v_attempt.assignment_id
              and qa.workspace_id = p_workspace_id
              and qa.learner_id = p_learner_id
            limit 1
          ),
          (
            select lp.grade_level
            from public.learner_program_enrollments lpe
            join public.learning_programs lp
              on lp.id = lpe.program_id
             and lp.workspace_id = lpe.workspace_id
            join public.program_quizzes pq
              on pq.workspace_id = lp.workspace_id
             and pq.program_id = lp.id
             and pq.availability = 'available'
            join public.quiz_versions qv
              on qv.id = v_attempt.quiz_version_id
             and qv.workspace_id = p_workspace_id
             and qv.quiz_id = pq.quiz_id
            where lpe.workspace_id = p_workspace_id
              and lpe.learner_id = p_learner_id
              and lpe.status = 'active'
              and lpe.is_primary
              and lp.status = 'active'
            order by lpe.started_at desc nulls last, lpe.id
            limit 1
          ),
          (
            select case
              when count(distinct lp.grade_level) = 1 then max(lp.grade_level)
              else null
            end
            from public.learner_program_enrollments lpe
            join public.learning_programs lp
              on lp.id = lpe.program_id
             and lp.workspace_id = lpe.workspace_id
            join public.program_quizzes pq
              on pq.workspace_id = lp.workspace_id
             and pq.program_id = lp.id
             and pq.availability = 'available'
            join public.quiz_versions qv
              on qv.id = v_attempt.quiz_version_id
             and qv.workspace_id = p_workspace_id
             and qv.quiz_id = pq.quiz_id
            where lpe.workspace_id = p_workspace_id
              and lpe.learner_id = p_learner_id
              and lpe.status = 'active'
              and lp.status = 'active'
              and lp.grade_level is not null
          ),
          (
            select learner.grade_level
            from public.learners learner
            where learner.id = p_learner_id
              and learner.workspace_id = p_workspace_id
          )
        )
        into v_effective_grade;

        -- Reuse an already-authored active misconception explanation when it is
        -- eligible for this question/concept, attempt, effective grade,
        -- difficulty, and learner language.
        select es.id, es.language, deliverable.feedback_text
        into v_explanation_set_id, v_explanation_language, v_misconception_feedback_text
        from public.explanation_sets es
        join lateral (
          select string_agg(eb.content->>'text', E'\n\n' order by eb.position) as feedback_text
          from public.explanation_blocks eb
          where eb.workspace_id = p_workspace_id
            and eb.explanation_set_id = es.id
            and eb.block_type = 'text'
            and nullif(btrim(eb.content->>'text'), '') is not null
        ) deliverable
          on deliverable.feedback_text is not null
        left join public.learner_instruction_profiles lip
          on lip.workspace_id = p_workspace_id
         and lip.learner_id = p_learner_id
        where es.workspace_id = p_workspace_id
          and es.misconception_id = v_misconception_id
          and es.status = 'active'
          and es.trigger_kind = 'incorrect_attempt'
          and (es.question_id is null or es.question_id = p_question_id)
          and (es.concept_id is null or es.concept_id = v_queue.concept_id)
          and (es.min_attempt_no is null or es.min_attempt_no <= v_attempt_no)
          and (es.max_attempt_no is null or es.max_attempt_no >= v_attempt_no)
          and (es.min_difficulty is null or es.min_difficulty <= v_question.difficulty_level)
          and (es.max_difficulty is null or es.max_difficulty >= v_question.difficulty_level)
          and (es.min_grade is null or (v_effective_grade is not null and es.min_grade <= v_effective_grade))
          and (es.max_grade is null or (v_effective_grade is not null and es.max_grade >= v_effective_grade))
          and es.language = coalesce(lip.primary_language, 'ar')
        order by
          case when es.question_id = p_question_id then 0 else 1 end,
          case when es.concept_id = v_queue.concept_id then 0 else 1 end,
          coalesce(es.min_attempt_no, 0) desc,
          es.id
        limit 1;

      end if;
    else
      v_misconception_id := null;
      v_misconception_code := null;
      v_misconception_confidence := null;
      v_misconception_concept_id := null;
      v_misconception_mapping_count := 0;
    end if;
  end if;

  -- Grading is bound to the immutable server-owned first core queue row.
  -- Authenticated managers cannot INSERT/UPDATE this queue, whereas attempt
  -- metadata is mutable and must never select an effective scoring policy.
  select core.score_policy_snapshot into v_authoritative_score_snapshot
  from public.quiz_attempt_question_queue core
  where core.workspace_id = p_workspace_id
    and core.quiz_attempt_id = p_attempt_id
    and core.source_role = 'core'
  order by core.sequence_no
  limit 1;
  if v_authoritative_score_snapshot is not null
     and v_authoritative_score_snapshot is distinct from
         '{"version":"learning-100-50-0-0-v1","attempt_scores":[100,50,0,0]}'::jsonb then
    return jsonb_build_object('error', 'LEARNING_SCORE_POLICY_INVALID');
  end if;

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


  -- Authentic pre-release attempts still use immutable per-version scoring.
  if v_authoritative_score_snapshot is not null then
    v_attempt_scores := v_authoritative_score_snapshot->'attempt_scores';
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

  if not v_is_correct
     and not v_finalized
     and v_misconception_feedback_text is not null then
    if jsonb_typeof(v_hint) = 'object' then
      v_hint := jsonb_set(
        v_hint,
        '{content}',
        to_jsonb(v_misconception_feedback_text),
        true
      );
    else
      -- Modeled misconception feedback is learner-visible even when the
      -- ordinary hint row is sparse/missing. This support object does not
      -- advance normal hint progression or inflate hints_used.
      v_hint := jsonb_build_object(
        'hint_level', null,
        'pedagogical_role', 'misconception_explanation',
        'content', v_misconception_feedback_text,
        'language', coalesce(v_explanation_language, 'ar'),
        'terminology_display_mode', 'inherit'
      );
    end if;
  end if;

  v_feedback_text := case
    when v_is_correct then coalesce(v_key.correct_explanation, v_key.explanation)
    when v_misconception_feedback_text is not null then v_misconception_feedback_text
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
    score_fraction,
    detected_misconception_id,
    error_classification,
    explanation_set_id
  ) values (
    p_workspace_id,
    p_attempt_id,
    p_question_id,
    v_attempt_no,
    jsonb_build_object('option_position', p_option_position),
    v_is_correct,
    v_feedback_text,
    v_hint_level,
    v_score_fraction,
    v_misconception_id,
    v_error_classification,
    v_explanation_set_id
  )
  returning id into v_answer_attempt_id;

  if v_misconception_id is not null then
    insert into public.adaptive_events(
      workspace_id,
      quiz_attempt_id,
      learner_id,
      concept_id,
      event_type,
      reason,
      input_state,
      output_state
    ) values (
      p_workspace_id,
      p_attempt_id,
      p_learner_id,
      v_queue.concept_id,
      'misconception_detected',
      'mapped_distractor',
      jsonb_build_object(
        'answer_attempt_id', v_answer_attempt_id,
        'option_id', v_option_id,
        'attempt_no', v_attempt_no
      ),
      jsonb_build_object(
        'misconception_id', v_misconception_id,
        'misconception_code', v_misconception_code,
        'confidence', v_misconception_confidence
      )
    );
  end if;

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
          'prompt_language', v_remediation_question.prompt_language,
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
      when v_misconception_feedback_text is not null then v_misconception_feedback_text
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
  v_authoritative_score_snapshot jsonb;
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

  -- Grading is bound to the immutable server-owned first core queue row.
  -- Authenticated managers cannot INSERT/UPDATE this queue, whereas attempt
  -- metadata is mutable and must never select an effective scoring policy.
  select core.score_policy_snapshot into v_authoritative_score_snapshot
  from public.quiz_attempt_question_queue core
  where core.workspace_id = p_workspace_id
    and core.quiz_attempt_id = p_attempt_id
    and core.source_role = 'core'
  order by core.sequence_no
  limit 1;
  if v_authoritative_score_snapshot is not null
     and v_authoritative_score_snapshot is distinct from
         '{"version":"learning-100-50-0-0-v1","attempt_scores":[100,50,0,0]}'::jsonb then
    return jsonb_build_object('error', 'LEARNING_SCORE_POLICY_INVALID');
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


  -- Authentic pre-release attempts still use immutable per-version scoring.
  if v_authoritative_score_snapshot is not null then
    v_attempt_scores := v_authoritative_score_snapshot->'attempt_scores';
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

