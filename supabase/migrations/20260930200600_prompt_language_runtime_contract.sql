-- FLH-FEAT-2026-008 v1.0
-- Forward-only runtime contract hardening: expose prompt_language anywhere a
-- learner-facing prompt is returned by Learning/Exam RPCs.
-- No table data is mutated by this migration.

create or replace function public.flh_exam_start(p_workspace_id uuid, p_learner_id uuid, p_quiz_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quiz public.quizzes%rowtype;
  v_version public.quiz_versions%rowtype;
  v_attempt public.quiz_attempts%rowtype;
  v_resumed boolean := false;
  v_access boolean := false;
  v_desired integer := 10;
  v_inserted integer := 0;
  v_questions jsonb := '[]'::jsonb;
  v_question_role text := 'core';
begin
  select * into v_quiz
  from public.quizzes
  where workspace_id = p_workspace_id
    and slug = p_quiz_slug
    and status = 'active'
  limit 1;
  if not found then return jsonb_build_object('error','QUIZ_NOT_FOUND'); end if;

  select * into v_version
  from public.quiz_versions
  where workspace_id = p_workspace_id
    and quiz_id = v_quiz.id
    and state = 'published'
  order by version_no desc
  limit 1;
  if not found then return jsonb_build_object('error','VERSION_NOT_FOUND'); end if;

  select (
    exists (
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
    )
    or exists (
      select 1
      from public.quiz_assignments qa
      where qa.workspace_id = p_workspace_id
        and qa.learner_id = p_learner_id
        and qa.quiz_version_id = v_version.id
        and qa.status in ('assigned','in_progress')
        and (qa.available_at is null or qa.available_at <= now())
        and (qa.due_at is null or qa.due_at >= now())
    )
  ) into v_access;

  if not v_access then return jsonb_build_object('error','QUIZ_NOT_AVAILABLE'); end if;

  -- Serialize starts for one learner/version so a double tap or retry cannot
  -- create two simultaneous in-progress exam attempts.
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_learner_id::text || ':' || v_version.id::text, 0)
  );

  select * into v_attempt
  from public.quiz_attempts
  where workspace_id = p_workspace_id
    and learner_id = p_learner_id
    and quiz_version_id = v_version.id
    and status = 'in_progress'
    and delivery_mode = 'exam'
  order by started_at desc
  limit 1;

  if found then
    v_resumed := true;
  else
    if exists (
      select 1 from public.quiz_questions
      where workspace_id = p_workspace_id
        and quiz_version_id = v_version.id
        and delivery_role = 'exam_pool'
    ) then
      v_question_role := 'exam_pool';
    end if;

    insert into public.quiz_attempts(
      workspace_id, learner_id, quiz_version_id, status, delivery_mode, metadata
    ) values (
      p_workspace_id, p_learner_id, v_version.id, 'in_progress', 'exam',
      jsonb_build_object('engine','exam-v2-api-v6','quiz_slug',p_quiz_slug,'server_graded',true,'server_state',true,'question_pool',v_question_role)
    ) returning * into v_attempt;

    begin
      v_desired := greatest(1, coalesce((v_quiz.delivery_config->'exam'->>'question_count')::integer,10));
    exception when others then
      v_desired := 10;
    end;

    insert into public.quiz_attempt_question_queue(
      workspace_id, quiz_attempt_id, sequence_no, question_id,
      source_role, difficulty_level, status, selection_reason
    )
    select p_workspace_id, v_attempt.id,
           row_number() over(order by q.position)::integer,
           q.id, 'core', q.difficulty_level,
           case when row_number() over(order by q.position)=1 then 'active' else 'pending' end,
           case when v_question_role='exam_pool' then 'exam_independent_pool' else 'exam_core_selection' end
    from (
      select id, position, difficulty_level
      from public.quiz_questions
      where workspace_id = p_workspace_id
        and quiz_version_id = v_version.id
        and delivery_role = v_question_role
      order by position
      limit v_desired
    ) q;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      delete from public.quiz_attempts where id = v_attempt.id;
      return jsonb_build_object('error','NO_EXAM_QUESTIONS');
    end if;
  end if;

  select coalesce(jsonb_agg(item order by seq), '[]'::jsonb) into v_questions
  from (
    select qq.sequence_no as seq,
      jsonb_build_object(
        'sequence_no', qq.sequence_no,
        'question_id', qq.question_id,
        'status', qq.status,
        'is_flagged', coalesce(qq.is_flagged,false),
        'saved_response', aa.response,
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
          'points', q.points,
          'difficulty_level', q.difficulty_level,
          'options', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', o.id,
              'position', o.position,
              'label', o.label,
              'content', o.content
            ) order by o.position)
            from public.quiz_question_options o
            where o.workspace_id = p_workspace_id and o.question_id = q.id
          ), '[]'::jsonb),
          'assets', coalesce((
            select jsonb_agg(jsonb_build_object(
              'position', l.position,
              'purpose', l.purpose,
              'alt_text', l.alt_text,
              'kind', a.kind,
              'mime_type', a.mime_type,
              'url', coalesce(a.metadata->>'public_url', a.metadata->>'url'),
              'storage_bucket', a.storage_bucket,
              'storage_path', a.storage_path
            ) order by l.position)
            from public.quiz_question_assets l
            join public.assets a on a.id=l.asset_id and a.workspace_id=l.workspace_id
            where l.workspace_id = p_workspace_id and l.question_id = q.id
          ), '[]'::jsonb)
        )
      ) as item
    from public.quiz_attempt_question_queue qq
    join public.quiz_questions q
      on q.id = qq.question_id and q.workspace_id = qq.workspace_id
    left join public.quiz_attempt_answers aa
      on aa.workspace_id = qq.workspace_id
     and aa.attempt_id = qq.quiz_attempt_id
     and aa.question_id = qq.question_id
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = v_attempt.id
  ) s;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'started_at', v_attempt.started_at,
    'resumed', v_resumed,
    'quiz', jsonb_build_object('slug',v_quiz.slug,'title',v_quiz.title,'description',v_quiz.description),
    'questions', v_questions
  );
end;
$function$;

revoke all on function public.flh_exam_start(uuid,uuid,text) from public;
revoke all on function public.flh_exam_start(uuid,uuid,text) from anon, authenticated;
grant execute on function public.flh_exam_start(uuid,uuid,text) to service_role;

create or replace function public.flh_exam_submit(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempt record;
  v_queue_count integer := 0;
  v_answer_count integer := 0;
  v_score numeric := 0;
  v_max numeric := 0;
  v_flagged_count integer := 0;
  v_duration integer := 1;
  v_review jsonb := '[]'::jsonb;
  v_quiz jsonb := '{}'::jsonb;
begin
  select a.id, a.quiz_version_id, a.started_at, a.metadata
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id = p_workspace_id
    and a.id = p_attempt_id
    and a.learner_id = p_learner_id
    and a.status = 'in_progress'
    and a.delivery_mode = 'exam'
  limit 1
  for update;

  if not found then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;
  select count(*) into v_queue_count
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id;

  -- Missing rows remain missing here. Paper-only blank materialization is performed
  -- by flh_paper_exam_submit after an exact declared-blank/missing-set match.

  select count(*) into v_answer_count
  from public.quiz_attempt_answers aa
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id = aa.workspace_id
   and qq.quiz_attempt_id = aa.attempt_id
   and qq.question_id = aa.question_id
  where aa.workspace_id = p_workspace_id
    and aa.attempt_id = p_attempt_id;

  if v_queue_count = 0 or v_answer_count <> v_queue_count then
    return jsonb_build_object('error','EXAM_NOT_COMPLETE');
  end if;

  update public.quiz_attempt_answers aa
  set evaluation = case
        when aa.response = '{"unanswered":true}'::jsonb then 'incorrect'
        when nullif(aa.response->>'option_position','')::integer =
             nullif(k.correct_answer->>'option_position','')::integer then 'correct'
        else 'incorrect'
      end,
      is_correct = case
        when aa.response = '{"unanswered":true}'::jsonb then false
        else (
          nullif(aa.response->>'option_position','')::integer =
          nullif(k.correct_answer->>'option_position','')::integer
        )
      end,
      points_awarded = case
        when aa.response = '{"unanswered":true}'::jsonb then 0
        when nullif(aa.response->>'option_position','')::integer =
             nullif(k.correct_answer->>'option_position','')::integer then coalesce(q.points,1)
        else 0
      end,
      first_try_correct = case
        when aa.response = '{"unanswered":true}'::jsonb then false
        else (
          nullif(aa.response->>'option_position','')::integer =
          nullif(k.correct_answer->>'option_position','')::integer
        )
      end,
      mastery_result = case
        when aa.response = '{"unanswered":true}'::jsonb then 'not_mastered'
        when nullif(aa.response->>'option_position','')::integer =
             nullif(k.correct_answer->>'option_position','')::integer then 'mastered'
        else 'not_mastered'
      end
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.workspace_id = qq.workspace_id
   and q.id = qq.question_id
  join public.quiz_question_answer_keys k
    on k.workspace_id = q.workspace_id
   and k.question_id = q.id
  where aa.workspace_id = p_workspace_id
    and aa.attempt_id = p_attempt_id
    and qq.workspace_id = aa.workspace_id
    and qq.quiz_attempt_id = aa.attempt_id
    and qq.question_id = aa.question_id;

  select
    coalesce(sum(case when aa.is_correct then coalesce(q.points,1) else 0 end),0),
    coalesce(sum(coalesce(q.points,1)),0),
    count(*) filter (where coalesce(qq.is_flagged,false)),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'question_id', q.id,
        'question_code', q.question_code,
        'prompt', q.prompt,
          'prompt_language', q.prompt_language,
        'response', aa.response,
        'is_correct', coalesce(aa.is_correct,false),
        'was_flagged', coalesce(qq.is_flagged,false),
        'correct_answer', k.correct_answer,
        'explanation', case
          when aa.is_correct then coalesce(nullif(k.correct_explanation,''), nullif(k.explanation,''))
          else coalesce(nullif(k.final_incorrect_explanation,''), nullif(k.explanation,''))
        end,
        'hints', coalesce((
          select jsonb_agg(jsonb_build_object(
            'hint_level', h.hint_level,
            'pedagogical_role', h.pedagogical_role,
            'content', h.content
          ) order by h.hint_level)
          from public.quiz_question_hints h
          where h.workspace_id = p_workspace_id
            and h.question_id = q.id
        ), '[]'::jsonb)
      ) order by qq.sequence_no
    ), '[]'::jsonb)
  into v_score, v_max, v_flagged_count, v_review
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.workspace_id = qq.workspace_id
   and q.id = qq.question_id
  join public.quiz_attempt_answers aa
    on aa.workspace_id = qq.workspace_id
   and aa.attempt_id = qq.quiz_attempt_id
   and aa.question_id = qq.question_id
  join public.quiz_question_answer_keys k
    on k.workspace_id = q.workspace_id
   and k.question_id = q.id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id;

  v_duration := greatest(
    1,
    round(extract(epoch from (clock_timestamp() - v_attempt.started_at)))::integer
  );

  update public.quiz_attempts
  set status = 'submitted',
      submitted_at = clock_timestamp(),
      score_points = v_score,
      max_points = v_max,
      percentage = case when v_max > 0 then round((v_score / v_max) * 100, 2) else 0 end,
      duration_seconds = v_duration,
      metadata = coalesce(v_attempt.metadata,'{}'::jsonb) || jsonb_build_object(
        'engine','exam-v2-api-v5',
        'server_graded',true,
        'question_count',v_queue_count,
        'flagged_count',v_flagged_count
      )
  where id = p_attempt_id
    and workspace_id = p_workspace_id
    and status = 'in_progress';

  update public.quiz_attempt_question_queue
  set status = 'completed'
  where workspace_id = p_workspace_id
    and quiz_attempt_id = p_attempt_id;

  select jsonb_build_object('slug',q.slug,'title',q.title)
    into v_quiz
  from public.quiz_versions v
  join public.quizzes q
    on q.workspace_id = v.workspace_id
   and q.id = v.quiz_id
  where v.workspace_id = p_workspace_id
    and v.id = v_attempt.quiz_version_id
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'attempt_id',p_attempt_id,
    'quiz',coalesce(v_quiz,'{}'::jsonb),
    'score_points',v_score,
    'max_points',v_max,
    'percentage',case when v_max > 0 then round((v_score / v_max) * 100, 2) else 0 end,
    'review',v_review
  );
end;
$function$;

revoke all on function public.flh_exam_submit(uuid,uuid,uuid) from public;
revoke all on function public.flh_exam_submit(uuid,uuid,uuid) from anon, authenticated;
grant execute on function public.flh_exam_submit(uuid,uuid,uuid) to service_role;

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

create or replace function public.flh_learning_finish(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_quiz record;
  v_learner_is_test boolean := false;
  v_cached_result jsonb;
  v_score_points numeric := 0;
  v_max_points numeric := 0;
  v_percentage numeric := 0;
  v_first_try_correct integer := 0;
  v_hints_used integer := 0;
  v_duration_seconds integer := 0;
  v_submitted_at timestamptz := now();
  v_review jsonb := '[]'::jsonb;
  v_award jsonb;
  v_result jsonb;
  v_prior_award boolean := false;
  v_xp_award integer := 25;
  v_reward_points_award integer := 5;
  v_old_xp integer := 0;
  v_old_reward_points integer := 0;
  v_old_current_streak integer := 0;
  v_old_longest_streak integer := 0;
  v_old_last_learning_date date;
  v_new_xp integer;
  v_new_reward_points integer;
  v_new_level integer := 1;
  v_new_streak integer := 1;
  v_today date := (now() at time zone 'UTC')::date;
  v_yesterday date := ((now() at time zone 'UTC')::date - 1);
  v_badge_codes text[] := array[]::text[];
  v_badge_code text;
  v_badge_id uuid;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_attempt_id is null then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  -- Lock the attempt first, matching the Learning answer lock order. A second
  -- finish waits here, then returns the first transaction's cached response.
  select a.*
  into v_attempt
  from public.quiz_attempts a
  where a.id = p_attempt_id
    and a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
  for update;

  if not found or v_attempt.delivery_mode <> 'learning' then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status = 'submitted' then
    v_cached_result := v_attempt.metadata->'learning_finish_last_result';
    if jsonb_typeof(v_cached_result) = 'object' then
      return v_cached_result;
    end if;
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  -- Lock the learner after the attempt. This validates active ownership and
  -- serializes gamification awards across different attempts by one learner.
  select coalesce((l.metadata->>'is_test')::boolean, false)
  into v_learner_is_test
  from public.learners l
  where l.id = p_learner_id
    and l.workspace_id = p_workspace_id
    and l.is_active
  for update;

  if not found then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if exists (
    select 1
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = p_attempt_id
      and qq.status in ('pending', 'active')
  ) then
    return jsonb_build_object('error', 'QUIZ_NOT_COMPLETE');
  end if;

  select qz.slug, qz.title
  into v_quiz
  from public.quiz_versions qv
  join public.quizzes qz
    on qz.id = qv.quiz_id
   and qz.workspace_id = qv.workspace_id
  where qv.id = v_attempt.quiz_version_id
    and qv.workspace_id = p_workspace_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'LEARNING_FINISH_QUIZ_METADATA_MISSING';
  end if;

  -- Score only the original core-question set. Remediation remains learning
  -- evidence but does not change the current completion score denominator.
  select
    coalesce(sum(q.points), 0),
    coalesce(sum(a.points_awarded), 0),
    count(*) filter (where a.first_try_correct)::integer,
    coalesce(sum(a.hints_used), 0)::integer
  into
    v_max_points,
    v_score_points,
    v_first_try_correct,
    v_hints_used
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.id = qq.question_id
   and q.workspace_id = qq.workspace_id
  left join public.quiz_attempt_answers a
    on a.attempt_id = qq.quiz_attempt_id
   and a.question_id = qq.question_id
   and a.workspace_id = qq.workspace_id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id
    and qq.source_role = 'core';

  v_percentage := case
    when v_max_points > 0 then round(v_score_points / v_max_points * 100, 2)
    else 0
  end;

  v_duration_seconds := case
    when coalesce(p_duration_seconds, 0) > 0
      then greatest(0, least(86400, p_duration_seconds))
    else greatest(0, least(86400, round(extract(epoch from (v_submitted_at - v_attempt.started_at)))::integer))
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'question_id', a.question_id,
      'question_code', q.question_code,
      'prompt', q.prompt,
          'prompt_language', q.prompt_language,
      'response', a.response,
      'is_correct', a.is_correct,
      'correct_answer', k.correct_answer,
      'explanation', case
        when a.is_correct then coalesce(k.correct_explanation, k.explanation)
        else coalesce(k.final_incorrect_explanation, k.explanation)
      end
    ) order by qq.sequence_no
  ), '[]'::jsonb)
  into v_review
  from public.quiz_attempt_question_queue qq
  join public.quiz_attempt_answers a
    on a.attempt_id = qq.quiz_attempt_id
   and a.question_id = qq.question_id
   and a.workspace_id = qq.workspace_id
  join public.quiz_questions q
    on q.id = qq.question_id
   and q.workspace_id = qq.workspace_id
  left join public.quiz_question_answer_keys k
    on k.question_id = qq.question_id
   and k.workspace_id = qq.workspace_id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id
    and qq.source_role = 'core';

  -- Test learners deliberately receive repeatable per-attempt QA awards; the
  -- existing trigger rewrites their source_id. Production learners retain the
  -- current once-per-quiz award behavior.
  select exists (
    select 1
    from public.gamification_events e
    where e.workspace_id = p_workspace_id
      and e.learner_id = p_learner_id
      and e.event_type = 'quiz_completed'
      and e.source_type = 'quiz'
      and e.source_id = v_quiz.slug
  ) into v_prior_award;

  if v_prior_award then
    v_award := jsonb_build_object(
      'already_awarded', true,
      'xp', 0,
      'reward_points', 0,
      'badges', '[]'::jsonb
    );
  else
    if v_percentage >= 70 then
      v_xp_award := v_xp_award + 20;
      v_reward_points_award := v_reward_points_award + 5;
    end if;
    if v_first_try_correct >= 2 then
      v_xp_award := v_xp_award + 10;
      v_badge_codes := array_append(v_badge_codes, 'first-try');
    end if;
    if v_hints_used >= 2 and v_percentage >= 40 then
      v_xp_award := v_xp_award + 10;
      v_badge_codes := array_append(v_badge_codes, 'keep-going');
    end if;
    if v_percentage >= 85 then
      v_badge_codes := array_append(v_badge_codes, 'concept-master');
    end if;

    select
      s.xp,
      s.reward_points,
      s.current_streak,
      s.longest_streak,
      s.last_learning_date
    into
      v_old_xp,
      v_old_reward_points,
      v_old_current_streak,
      v_old_longest_streak,
      v_old_last_learning_date
    from public.learner_gamification_state s
    where s.workspace_id = p_workspace_id
      and s.learner_id = p_learner_id;

    if not found then
      v_old_xp := 0;
      v_old_reward_points := 0;
      v_old_current_streak := 0;
      v_old_longest_streak := 0;
      v_old_last_learning_date := null;
    end if;

    v_new_xp := v_old_xp + v_xp_award;
    v_new_reward_points := v_old_reward_points + v_reward_points_award;
    v_new_streak := case
      when v_old_last_learning_date = v_today then v_old_current_streak
      when v_old_last_learning_date = v_yesterday then v_old_current_streak + 1
      else 1
    end;

    select gl.level_no
    into v_new_level
    from public.gamification_levels gl
    where gl.workspace_id = p_workspace_id
      and gl.min_xp <= v_new_xp
    order by gl.min_xp desc
    limit 1;
    v_new_level := coalesce(v_new_level, 1);

    insert into public.learner_gamification_state as state(
      workspace_id,
      learner_id,
      xp,
      reward_points,
      current_level,
      current_streak,
      longest_streak,
      last_learning_date
    ) values (
      p_workspace_id,
      p_learner_id,
      v_new_xp,
      v_new_reward_points,
      v_new_level,
      v_new_streak,
      greatest(v_old_longest_streak, v_new_streak),
      v_today
    )
    on conflict (learner_id) do update
    set xp = excluded.xp,
        reward_points = excluded.reward_points,
        current_level = excluded.current_level,
        current_streak = excluded.current_streak,
        longest_streak = excluded.longest_streak,
        last_learning_date = excluded.last_learning_date;

    insert into public.gamification_events(
      workspace_id,
      learner_id,
      event_type,
      xp_delta,
      reward_points_delta,
      source_type,
      source_id,
      reason,
      metadata
    ) values (
      p_workspace_id,
      p_learner_id,
      'quiz_completed',
      v_xp_award,
      v_reward_points_award,
      'quiz',
      v_quiz.slug,
      'Server-graded quiz completion',
      jsonb_build_object(
        'percentage', v_percentage,
        'first_try_correct', v_first_try_correct,
        'hints_used', v_hints_used,
        'engine', 'learning-api-v2'
      )
    );

    foreach v_badge_code in array v_badge_codes loop
      select b.id
      into v_badge_id
      from public.gamification_badges b
      where b.workspace_id = p_workspace_id
        and b.code = v_badge_code;

      if found then
        insert into public.learner_badges(
          workspace_id,
          learner_id,
          badge_id,
          award_reason,
          metadata
        ) values (
          p_workspace_id,
          p_learner_id,
          v_badge_id,
          'quiz:' || v_quiz.slug,
          jsonb_build_object('percentage', v_percentage)
        )
        on conflict (learner_id, badge_id) do nothing;
      end if;
    end loop;

    v_award := jsonb_build_object(
      'already_awarded', false,
      'xp', v_xp_award,
      'reward_points', v_reward_points_award,
      'badges', to_jsonb(v_badge_codes)
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'attempt_id', p_attempt_id,
    'quiz', jsonb_build_object('slug', v_quiz.slug, 'title', v_quiz.title),
    'score_points', v_score_points,
    'max_points', v_max_points,
    'percentage', v_percentage,
    'first_try_correct', v_first_try_correct,
    'hints_used', v_hints_used,
    'award', v_award,
    'review', v_review
  );

  update public.quiz_attempts
  set status = 'submitted',
      submitted_at = v_submitted_at,
      score_points = v_score_points,
      max_points = v_max_points,
      percentage = v_percentage,
      duration_seconds = v_duration_seconds,
      metadata = coalesce(v_attempt.metadata, '{}'::jsonb) || jsonb_build_object(
        'engine', 'learning-api-v2',
        'server_graded', true,
        'first_try_correct', v_first_try_correct,
        'hints_used', v_hints_used,
        'learning_finish_last_result', v_result
      )
  where id = p_attempt_id
    and workspace_id = p_workspace_id
    and learner_id = p_learner_id;

  return v_result;
end;
$function$;

revoke all on function public.flh_learning_finish(uuid,uuid,uuid,integer) from public;
revoke all on function public.flh_learning_finish(uuid,uuid,uuid,integer) from anon, authenticated;
grant execute on function public.flh_learning_finish(uuid,uuid,uuid,integer) to service_role;

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

