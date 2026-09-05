alter table public.quiz_questions
  drop constraint if exists quiz_questions_delivery_role_check;

alter table public.quiz_questions
  add constraint quiz_questions_delivery_role_check
  check (delivery_role = any (array['core'::text,'remediation_pool'::text,'challenge_pool'::text,'exam_pool'::text]))
  not valid;

alter table public.quiz_questions
  validate constraint quiz_questions_delivery_role_check;

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

  -- Serialize exam starts for the same learner/version so retries or double taps
  -- cannot create two simultaneous in-progress attempts.
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

-- This function is an internal service RPC. Learner identity is verified by the
-- exam-v2-api learner session before the service-role client calls this RPC.
-- Do not expose direct execution to browser roles.
revoke all on function public.flh_exam_start(uuid,uuid,text) from public;
revoke all on function public.flh_exam_start(uuid,uuid,text) from anon, authenticated;
grant execute on function public.flh_exam_start(uuid,uuid,text) to service_role;
