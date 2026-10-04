-- FLH-FEAT-2026-018 / SPEC_VERSION 1.3
-- Read-only learner video preview for progressed Learning attempts.
-- This function never creates, resets, finishes, cancels, or snapshots an attempt.

create or replace function public.flh_learning_video_preview(
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
  v_attempt_id uuid;
  v_assignment_id uuid;
  v_via_program boolean := false;
  v_via_assignment boolean := false;
  v_flags jsonb;
  v_items jsonb := '[]'::jsonb;
  v_first jsonb;
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

  if not exists (
    select 1
    from public.learners l
    where l.workspace_id = p_workspace_id
      and l.id = p_learner_id
      and l.is_active
  ) then
    return jsonb_build_object('error', 'QUIZ_NOT_AVAILABLE');
  end if;

  -- Match Learning start routing without mutating state: resume version first,
  -- then an eligible explicit assignment, then the highest published version.
  select a.id
  into v_attempt_id
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

  if found then
    select qv.*
    into v_version
    from public.quiz_attempts a
    join public.quiz_versions qv
      on qv.workspace_id = a.workspace_id
     and qv.id = a.quiz_version_id
    where a.workspace_id = p_workspace_id
      and a.id = v_attempt_id
      and a.learner_id = p_learner_id
      and a.delivery_mode = 'learning'
      and qv.quiz_id = v_quiz.id
      and qv.state = 'published'
    limit 1;
  else
    v_attempt_id := null;

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

  select ws.value
  into v_flags
  from public.workspace_settings ws
  where ws.workspace_id = p_workspace_id
    and ws.key = 'optional_learning_videos';

  if v_flags->'enabled' is distinct from 'true'::jsonb then
    return jsonb_build_object('error', 'VIDEO_NOT_AVAILABLE');
  end if;

  if v_flags->'test_only' = 'true'::jsonb
     and not exists (
       select 1
       from public.learners l
       where l.workspace_id = p_workspace_id
         and l.id = p_learner_id
         and l.metadata->'is_test' = 'true'::jsonb
     ) then
    return jsonb_build_object('error', 'VIDEO_NOT_AVAILABLE');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.video_revision,
        'provider', 'youtube',
        'position', a.position,
        'video_ref', a.video_ref,
        'title', a.title,
        'language', a.language,
        'availability', case
          when a.verification_state = 'verified'
           and a.embeddable is true
           and a.made_for_kids is not null
           and a.verification_expires_at > now()
          then 'available'
          else 'unavailable'
        end,
        'made_for_kids', a.made_for_kids,
        'verification_expires_at', a.verification_expires_at,
        'self_report', 'not_reported',
        'report_revision', 0
      )
      order by a.position
    ),
    '[]'::jsonb
  )
  into v_items
  from public.learning_video_assignments a
  where a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
    and a.quiz_version_id = v_version.id
    and private.flh_learning_video_context_matches(
      p_workspace_id,
      p_learner_id,
      v_version.id,
      a.program_id,
      a.curriculum_id,
      a.grade_level,
      a.subject_id,
      a.concept_id
    );

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('error', 'VIDEO_NOT_AVAILABLE');
  end if;

  v_first := (v_items->0) || jsonb_build_object('only_before_first_question', false);
  if jsonb_array_length(v_items) > 1 then
    v_first := v_first || jsonb_build_object('videos', v_items);
  end if;

  return jsonb_build_object(
    'quiz_version_id', v_version.id,
    'resumable_attempt_id', v_attempt_id,
    'quiz', jsonb_build_object(
      'slug', v_quiz.slug,
      'title', v_quiz.title,
      'description', v_quiz.description
    ),
    'optional_video', v_first
  );
end;
$function$;

revoke all on function public.flh_learning_video_preview(uuid,uuid,text) from public;
revoke all on function public.flh_learning_video_preview(uuid,uuid,text) from anon, authenticated;
grant execute on function public.flh_learning_video_preview(uuid,uuid,text) to service_role;
