-- Consolidate Learning Mode start/resume into one transactional call.
-- learning-api invokes this function as service_role after authenticating the
-- custom learner HMAC session. Elevated definer privileges are unnecessary.
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

  -- Serialize one learner/version start. The second simultaneous call sees the
  -- committed attempt and resumes it instead of creating a duplicate attempt
  -- or queue. This lock is released automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_workspace_id::text || ':' || p_learner_id::text || ':' || v_version.id::text || ':learning',
      0
    )
  );

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
        'hint_level_requested', qq.hint_level_requested,
        'is_flagged', qq.is_flagged,
        'question', jsonb_build_object(
          'id', q.id,
          'question_code', q.question_code,
          'position', q.position,
          'question_type', q.question_type,
          'prompt', q.prompt,
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

  return jsonb_build_object(
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

comment on function public.flh_learning_start(uuid,uuid,text) is
  'Transactionally starts or resumes Learning Mode and returns its complete queue payload. Service-role only; Edge authenticates the custom learner HMAC session.';
