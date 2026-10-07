-- FLH-FEAT-2026-020 v1.1\n-- Rebased after current main; migration version intentionally ordered after FLH-010 v1.3.
-- Forward-only correction for official support-workbook delivery mutual exclusion.
-- Spec: https://docs.google.com/document/d/13J_0dAIeXK1vmjDWgO5WMlpOknntkwBGtGcm22Ejo4M/edit
-- DRIVE_REVISION_ID: 2
-- Historical migrations remain immutable.

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
          'server_state', true
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
        selection_reason
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
        'published_core_question'
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

create or replace function public.flh_support_paper_start(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_version_id uuid,
  p_paper_model_code text,
  p_source text default 'uploaded_photos'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_version record;
  v_paper jsonb;
  v_map jsonb;
  v_count integer;
  v_code_count integer;
  v_existing uuid;
  v_assignment_id uuid;
  v_attempt_id uuid;
  v_question_id uuid;
  v_difficulty smallint;
  v_runtime_package jsonb;
  v_runtime_hash text;
  v_validation jsonb;
  i integer;
begin
  if nullif(btrim(p_paper_model_code),'') is null then return jsonb_build_object('error','PAPER_MODEL_CODE_REQUIRED'); end if;
  if not exists(select 1 from public.learners where workspace_id=p_workspace_id and id=p_learner_id and is_active) then
    return jsonb_build_object('error','LEARNER_NOT_FOUND');
  end if;

  -- FLH-FEAT-2026-020 v1.1: share the same learner/version lock with
  -- digital Learning so concurrent delivery starts cannot both create attempts.
  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text||':'||p_learner_id::text||':'||p_quiz_version_id::text||':support-delivery',0
  ));

  select v.id,v.quiz_id,v.settings,q.slug,q.title
    into v_version
  from public.quiz_versions v
  join public.quizzes q on q.workspace_id=v.workspace_id and q.id=v.quiz_id and q.status='active'
  where v.workspace_id=p_workspace_id and v.id=p_quiz_version_id and v.state='published'
    and coalesce((v.settings->>'support_source')::boolean,false)
  limit 1;
  if not found then return jsonb_build_object('error','PAPER_VERSION_NOT_FOUND'); end if;

  if not (
    exists (
      select 1
      from public.learner_program_enrollments e
      join public.learning_programs lp
        on lp.workspace_id=e.workspace_id and lp.id=e.program_id and lp.status='active'
      join public.program_quizzes pq
        on pq.workspace_id=e.workspace_id and pq.program_id=e.program_id
       and pq.quiz_id=v_version.quiz_id and pq.availability='available'
      where e.workspace_id=p_workspace_id and e.learner_id=p_learner_id and e.status='active'
    )
    or exists (
      select 1
      from public.quiz_assignments qa
      where qa.workspace_id=p_workspace_id and qa.learner_id=p_learner_id
        and qa.quiz_version_id=p_quiz_version_id and qa.status in ('assigned','in_progress')
        and (qa.available_at is null or qa.available_at<=now())
        and (qa.due_at is null or qa.due_at>=now())
    )
  ) then
    return jsonb_build_object('error','QUIZ_NOT_AVAILABLE');
  end if;

  v_paper:=v_version.settings->'paper_exam';
  if v_paper is null or jsonb_typeof(v_paper)<>'object' then return jsonb_build_object('error','PAPER_METADATA_MISSING'); end if;
  if nullif(v_paper->>'paper_model_code','') is null or v_paper->>'paper_model_code' is distinct from p_paper_model_code then
    return jsonb_build_object('error','PAPER_MODEL_MISMATCH');
  end if;

  select count(*) into v_code_count
  from public.quiz_versions
  where workspace_id=p_workspace_id and state='published'
    and settings->'paper_exam'->>'paper_model_code'=p_paper_model_code;
  if v_code_count<>1 then return jsonb_build_object('error','PAPER_MODEL_NOT_UNIQUE','matching_versions',v_code_count); end if;

  begin v_count:=(v_paper->>'paper_question_count')::integer;
  exception when others then return jsonb_build_object('error','PAPER_QUESTION_COUNT_INVALID'); end;
  v_map:=v_paper->'paper_question_map';
  if v_count is null or v_count<1 or v_map is null or jsonb_typeof(v_map)<>'object'
     or public.jsonb_object_length(v_map)<>v_count or nullif(v_paper->>'paper_content_hash','') is null then
    return jsonb_build_object('error','PAPER_BINDING_INVALID');
  end if;

  v_runtime_package:=public.flh_support_paper_runtime_package(p_workspace_id,p_quiz_version_id);
  if v_runtime_package is null then return jsonb_build_object('error','PAPER_RUNTIME_HASH_MISMATCH'); end if;
  v_runtime_hash:=encode(extensions.digest(convert_to(v_runtime_package::text,'UTF8'),'sha256'),'hex');
  if v_runtime_hash is distinct from nullif(v_paper->>'paper_runtime_content_hash','')
     or v_paper->'paper_canonical_package' is distinct from v_runtime_package
     or encode(extensions.digest(convert_to((v_paper->'paper_canonical_package')::text,'UTF8'),'sha256'),'hex')
        is distinct from v_paper->>'paper_content_hash' then
    return jsonb_build_object('error','PAPER_CANONICAL_BINDING_MISMATCH');
  end if;

  -- Fail closed if the immutable support session already has digital Learning
  -- evidence or an active digital attempt. The shared advisory lock makes this
  -- check race-safe against a simultaneous Learning start.
  if exists (
    select 1 from public.quiz_attempts
    where workspace_id=p_workspace_id and learner_id=p_learner_id
      and quiz_version_id=p_quiz_version_id and delivery_mode='learning'
      and status='submitted'
  ) then return jsonb_build_object('error','SESSION_ALREADY_COMPLETED'); end if;

  if exists (
    select 1 from public.quiz_attempts
    where workspace_id=p_workspace_id and learner_id=p_learner_id
      and quiz_version_id=p_quiz_version_id and delivery_mode='learning'
      and status='in_progress'
  ) then return jsonb_build_object('error','SESSION_IN_PROGRESS'); end if;

  if exists (
    select 1 from public.quiz_attempts
    where workspace_id=p_workspace_id and learner_id=p_learner_id and status='submitted'
      and metadata->>'paper_model_code'=p_paper_model_code
  ) then return jsonb_build_object('error','PAPER_ALREADY_INGESTED'); end if;

  select id into v_existing
  from public.quiz_attempts
  where workspace_id=p_workspace_id and learner_id=p_learner_id and quiz_version_id=p_quiz_version_id
    and status='in_progress' and delivery_mode='exam' and metadata->>'paper_model_code'=p_paper_model_code
  order by started_at desc limit 1;
  if found then
    v_validation:=public.flh_support_paper_validate_queue(p_workspace_id,v_existing);
    if coalesce((v_validation->>'ok')::boolean,false) is not true then
      return jsonb_build_object('error','PAPER_EXISTING_ATTEMPT_INVALID','validation',v_validation);
    end if;
    return jsonb_build_object('ok',true,'resumed',true,'attempt_id',v_existing,
      'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
      'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash');
  end if;

  select id into v_assignment_id
  from public.quiz_assignments
  where workspace_id=p_workspace_id and learner_id=p_learner_id and quiz_version_id=p_quiz_version_id
  order by created_at desc limit 1;
  if v_assignment_id is null then
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,metadata)
    values(p_workspace_id,p_learner_id,p_quiz_version_id,'assigned',now(),
      jsonb_build_object('source','support_workbook_paper','paper_model_code',p_paper_model_code))
    returning id into v_assignment_id;
  end if;

  insert into public.quiz_attempts(
    workspace_id,learner_id,quiz_version_id,assignment_id,status,delivery_mode,metadata
  ) values (
    p_workspace_id,p_learner_id,p_quiz_version_id,v_assignment_id,'in_progress','exam',
    jsonb_build_object(
      'engine','support-paper-exam-v1','server_graded',true,'server_state',true,
      'delivery_surface','paper','support_workbook_paper',true,
      'support_source',true,'support_source_code',v_version.settings->>'source_code',
      'support_session_slug',v_version.slug,
      'support_question_map_hash',encode(extensions.digest(convert_to(v_map::text,'UTF8'),'sha256'),'hex'),
      'paper_model_code',p_paper_model_code,
      'paper_quiz_version_id',p_quiz_version_id::text,
      'paper_content_hash',v_paper->>'paper_content_hash',
      'paper_runtime_content_hash',v_runtime_hash,
      'paper_question_count',v_count,
      'paper_queue_validated',false,'paper_ingested',false,
      'paper_source',coalesce(nullif(btrim(p_source),''),'uploaded_photos')
    )
  ) returning id into v_attempt_id;

  for i in 1..v_count loop
    select q.id,q.difficulty_level into v_question_id,v_difficulty
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id and q.quiz_version_id=p_quiz_version_id
      and q.id::text=v_map->(i::text)->>'question_id'
      and q.question_code=v_map->(i::text)->>'question_code'
    limit 1;
    if not found then raise exception 'PAPER_QUESTION_MAP_INVALID:%',i; end if;

    insert into public.quiz_attempt_question_queue(
      workspace_id,quiz_attempt_id,sequence_no,question_id,source_role,difficulty_level,status,selection_reason
    ) values (
      p_workspace_id,v_attempt_id,i,v_question_id,'core',v_difficulty,
      case when i=1 then 'active' else 'pending' end,'support_paper_exact_mapping'
    );
  end loop;

  v_validation:=public.flh_support_paper_validate_queue(p_workspace_id,v_attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_VALIDATION_FAILED:%',coalesce(v_validation->>'error','UNKNOWN');
  end if;
  update public.quiz_attempts
  set metadata=metadata||jsonb_build_object('paper_queue_validated',true)
  where workspace_id=p_workspace_id and id=v_attempt_id;

  return jsonb_build_object('ok',true,'resumed',false,'attempt_id',v_attempt_id,
    'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
    'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash');
end;
$function$;
