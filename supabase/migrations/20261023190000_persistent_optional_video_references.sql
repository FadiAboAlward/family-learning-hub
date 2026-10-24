-- FLH-FEAT-2026-036 SPEC_VERSION 1.0
-- Author-approved linked YouTube reference persists; TTL only governs cached metadata.
-- Existing private.flh_learning_video_context_matches predicates remain authoritative.
-- No YouTube status checks, stored-data edits, RLS/ACL changes, or scheduled provider calls here.
-- Existing 29-day provider API metadata pruning remains separate from video references.
CREATE OR REPLACE FUNCTION private.flh_learning_optional_video(p_workspace_id uuid, p_learner_id uuid, p_attempt_id uuid, p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare flags jsonb; items jsonb := '[]'::jsonb; first_item jsonb; prior_interaction boolean;
begin
 select value into flags from public.workspace_settings where workspace_id=p_workspace_id and key='optional_learning_videos';
 if flags->'enabled' is distinct from 'true'::jsonb then return null; end if;
 if flags->'test_only' = 'true'::jsonb and not exists(select 1 from public.learners where workspace_id=p_workspace_id and id=p_learner_id and metadata->'is_test'='true'::jsonb) then return null; end if;

 -- Snapshot exactly once per Learning attempt. Later assignment edits never alter
 -- which videos a resumed attempt sees; provider status refresh can still update
 -- the matching pinned video_revision.
 if not exists (
   select 1 from public.learning_video_attempts
   where workspace_id=p_workspace_id and attempt_id=p_attempt_id and learner_id=p_learner_id and quiz_version_id=p_version_id
 ) then
   insert into public.learning_video_attempts(
     attempt_id,video_id,workspace_id,learner_id,quiz_version_id,program_id,curriculum_id,grade_level,subject_id,concept_id,position,
     video_ref,title,language,learning_outcomes,verification_state,embeddable,made_for_kids,verified_at,verification_expires_at
   )
   select p_attempt_id,a.video_revision,p_workspace_id,p_learner_id,p_version_id,a.program_id,a.curriculum_id,a.grade_level,a.subject_id,a.concept_id,a.position,
          a.video_ref,a.title,a.language,a.learning_outcomes,a.verification_state,a.embeddable,a.made_for_kids,a.verified_at,a.verification_expires_at
   from public.learning_video_assignments a
   where a.workspace_id=p_workspace_id and a.learner_id=p_learner_id and a.quiz_version_id=p_version_id
     and private.flh_learning_video_context_matches(p_workspace_id,p_learner_id,p_version_id,a.program_id,a.curriculum_id,a.grade_level,a.subject_id,a.concept_id)
   order by a.position
   on conflict(attempt_id,workspace_id,video_id) do nothing;
 end if;

 select coalesce(jsonb_agg(
   jsonb_build_object(
     'id',s.video_id,'provider','youtube','position',s.position,'video_ref',s.video_ref,'title',s.title,'language',s.language,'learning_outcomes',s.learning_outcomes,
     'availability',case when s.video_ref ~ '^[A-Za-z0-9_-]{11}$' then 'available' else 'unavailable' end,
     'made_for_kids',s.made_for_kids,'verification_expires_at',s.verification_expires_at,'self_report',s.self_report,'report_revision',s.report_revision
   ) order by s.position
 ),'[]'::jsonb)
 into items
 from public.learning_video_attempts s
 where s.workspace_id=p_workspace_id and s.attempt_id=p_attempt_id and s.learner_id=p_learner_id and s.quiz_version_id=p_version_id
   and private.flh_learning_video_context_matches(p_workspace_id,p_learner_id,p_version_id,s.program_id,s.curriculum_id,s.grade_level,s.subject_id,s.concept_id);

 if jsonb_array_length(items)=0 then return null; end if;
 prior_interaction := exists(select 1 from public.quiz_answer_attempts where workspace_id=p_workspace_id and quiz_attempt_id=p_attempt_id);
 first_item := (items->0) || jsonb_build_object('only_before_first_question',not prior_interaction);
 if jsonb_array_length(items)>1 then
   first_item := first_item || jsonb_build_object('videos',items);
 end if;
 return first_item;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.flh_learning_video_preview(p_workspace_id uuid, p_learner_id uuid, p_quiz_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
        'learning_outcomes', a.learning_outcomes,
        'availability', case when a.video_ref ~ '^[A-Za-z0-9_-]{11}$' then 'available' else 'unavailable' end,
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
$function$
;
