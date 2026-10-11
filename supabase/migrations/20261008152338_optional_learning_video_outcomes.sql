-- FLH-FEAT-2026-024 v1.1 (Drive revision 2) / child FLH-FEAT-2026-022 v1.1 (Drive revision 3).
-- Forward-only authored educational outcomes; legacy rows remain NULL without backfill.
-- Provider validation/status, service-only access and optional Learning behavior are unchanged.

-- Match the candidate boundary's Unicode whitespace normalization.
create function private.flh_learning_video_outcome_trim(p_value text)
returns text language sql immutable security invoker set search_path = '' as $$
  select btrim(p_value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

-- Stored outcomes are canonical plain text: an optional one-dimensional ordered
-- array, with 1-3 distinct already-trimmed Unicode strings of 1-160 characters.
create function private.flh_learning_video_outcomes_valid(p_values text[])
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item text; seen text[] := array[]::text[];
begin
  if p_values is null then return true; end if;
  if array_ndims(p_values) is distinct from 1 or array_lower(p_values,1) is distinct from 1
     or cardinality(p_values) not between 1 and 3 then return false; end if;
  foreach item in array p_values loop
    if item is null or item is distinct from private.flh_learning_video_outcome_trim(item)
       or char_length(item) not between 1 and 160
       or item ~* '</?[a-z][^>]*>|<!--|<!DOCTYPE|&(#(x[0-9a-f]+|[0-9]+)|[a-z][0-9a-z]*);'
       or item = any(seen) then return false; end if;
    seen := array_append(seen,item);
  end loop;
  return true;
end;
$$;

revoke all on function private.flh_learning_video_outcome_trim(text) from public,anon,authenticated;
revoke all on function private.flh_learning_video_outcomes_valid(text[]) from public,anon,authenticated;
grant execute on function private.flh_learning_video_outcome_trim(text) to service_role;
grant execute on function private.flh_learning_video_outcomes_valid(text[]) to service_role;

alter table public.learning_video_assignments
  add column learning_outcomes text[],
  add constraint learning_video_assignments_outcomes_check
    check (private.flh_learning_video_outcomes_valid(learning_outcomes));
alter table public.learning_video_attempts
  add column learning_outcomes text[],
  add constraint learning_video_attempts_outcomes_check
    check (private.flh_learning_video_outcomes_valid(learning_outcomes));

create or replace function public.flh_learning_video_attach(p_workspace_id uuid,p_parent_id uuid,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v public.learning_video_assignments%rowtype;
  c jsonb:=p_candidate;
  v_position smallint;
  v_learner_id uuid;
  v_quiz_version_id uuid;
  v_position_supplied boolean:=c ? 'position';
  v_outcomes text[];
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin')) then return jsonb_build_object('error','VIDEO_ATTACHMENT_FORBIDDEN'); end if;

 -- Accept only the established authoring fields and four provider status fields.
 -- The Edge validates these too; direct service-role calls keep a closed boundary.
 if jsonb_typeof(c) is distinct from 'object' then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 if exists (
   select 1 from jsonb_object_keys(c) as supplied(key)
   where key <> all(array[
     'learner_id','quiz_version_id','program_id','curriculum_id','grade_level','subject_id','concept_id','position',
     'video_ref','title','language','rationale','learning_outcomes',
     'embeddable','made_for_kids','verified_at','verification_expires_at'
   ]::text[])
 ) then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 if c ? 'learning_outcomes' then
   if jsonb_typeof(c->'learning_outcomes') is distinct from 'array' then
     return jsonb_build_object('error','INVALID_VIDEO_INPUT');
   end if;
   if jsonb_array_length(c->'learning_outcomes') not between 1 and 3 or exists (
     select 1 from jsonb_array_elements(c->'learning_outcomes') as outcome(value)
     where jsonb_typeof(value) is distinct from 'string'
   ) then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
   select array_agg(private.flh_learning_video_outcome_trim(value #>> '{}') order by ordinal)
   into v_outcomes
   from jsonb_array_elements(c->'learning_outcomes') with ordinality as outcome(value,ordinal);
   if not private.flh_learning_video_outcomes_valid(v_outcomes) then
     return jsonb_build_object('error','INVALID_VIDEO_INPUT');
   end if;
 end if;

 v_learner_id:=(c->>'learner_id')::uuid;
 v_quiz_version_id:=(c->>'quiz_version_id')::uuid;
 perform pg_advisory_xact_lock(
   hashtextextended(
     p_workspace_id::text || ':' || v_learner_id::text || ':' || v_quiz_version_id::text || ':optional-video-sequence',
     0
   )
 );

 if v_position_supplied then
   if jsonb_typeof(c->'position') is distinct from 'number' then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
   v_position:=(c->>'position')::smallint;
 else
   if exists(
     select 1
     from public.learning_video_assignments
     where workspace_id=p_workspace_id
       and learner_id=v_learner_id
       and quiz_version_id=v_quiz_version_id
       and position>1
   ) then
     return jsonb_build_object('error','INVALID_VIDEO_INPUT');
   end if;
   v_position:=1;
 end if;

 if v_position is null or v_position not between 1 and 20
   or c->'embeddable' is distinct from 'true'::jsonb or jsonb_typeof(c->'made_for_kids') is distinct from 'boolean'
   or c->>'verified_at' is null or c->>'verification_expires_at' is null
   or (c->>'verified_at')::timestamptz < now()-interval '5 minutes'
   or (c->>'verified_at')::timestamptz > now()+interval '1 minute'
   or (c->>'verification_expires_at')::timestamptz > (c->>'verified_at')::timestamptz+interval '7 days'
   or not private.flh_learning_video_context_matches(p_workspace_id,(c->>'learner_id')::uuid,(c->>'quiz_version_id')::uuid,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid)
 then return jsonb_build_object('error','VIDEO_CONTEXT_MISMATCH'); end if;

 insert into public.learning_video_assignments(workspace_id,learner_id,quiz_version_id,program_id,curriculum_id,grade_level,subject_id,concept_id,position,video_ref,title,language,learning_outcomes,rationale,verification_state,embeddable,made_for_kids,verified_at,verification_expires_at,reviewed_by)
 values(p_workspace_id,v_learner_id,v_quiz_version_id,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid,v_position,c->>'video_ref',c->>'title',c->>'language',v_outcomes,c->>'rationale','verified',true,(c->>'made_for_kids')::boolean,(c->>'verified_at')::timestamptz,(c->>'verification_expires_at')::timestamptz,p_parent_id)
 on conflict(workspace_id,learner_id,quiz_version_id,position) do update set
  status_revision=gen_random_uuid(),
  video_revision=case when (learning_video_assignments.video_ref,learning_video_assignments.program_id,learning_video_assignments.curriculum_id,learning_video_assignments.grade_level,learning_video_assignments.subject_id,learning_video_assignments.concept_id,learning_video_assignments.title,learning_video_assignments.language,learning_video_assignments.learning_outcomes) is distinct from (excluded.video_ref,excluded.program_id,excluded.curriculum_id,excluded.grade_level,excluded.subject_id,excluded.concept_id,excluded.title,excluded.language,excluded.learning_outcomes) then gen_random_uuid() else learning_video_assignments.video_revision end,
  program_id=excluded.program_id,curriculum_id=excluded.curriculum_id,grade_level=excluded.grade_level,subject_id=excluded.subject_id,concept_id=excluded.concept_id,
  video_ref=excluded.video_ref,title=excluded.title,language=excluded.language,learning_outcomes=excluded.learning_outcomes,rationale=excluded.rationale,verification_state='verified',embeddable=true,made_for_kids=excluded.made_for_kids,verified_at=excluded.verified_at,verification_expires_at=excluded.verification_expires_at,reviewed_by=p_parent_id,updated_at=now()
 returning * into v;

 update public.learning_video_attempts set verification_state='verified',embeddable=true,made_for_kids=v.made_for_kids,verified_at=v.verified_at,verification_expires_at=v.verification_expires_at
 where workspace_id=p_workspace_id and video_id=v.video_revision and video_ref=v.video_ref;

 return jsonb_build_object('ok',true,'assignment_id',v.id,'video_id',v.video_revision,'position',v.position,'verification_expires_at',v.verification_expires_at);
exception
 when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range or unique_violation
 then return jsonb_build_object('error','INVALID_VIDEO_INPUT');
end;
$$;

revoke all on function public.flh_learning_video_attach(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.flh_learning_video_attach(uuid,uuid,jsonb) to service_role;

-- Add safe outcomes to the existing once-only attempt sequence snapshot.
create or replace function private.flh_learning_optional_video(p_workspace_id uuid,p_learner_id uuid,p_attempt_id uuid,p_version_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
     'availability',case when s.verification_state='verified' and s.embeddable is true and s.made_for_kids is not null and s.verification_expires_at>now() then 'available' else 'unavailable' end,
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
$$;

revoke all on function private.flh_learning_optional_video(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.flh_learning_optional_video(uuid,uuid,uuid,uuid) to service_role;


-- Current assignment preview remains read-only and separately authorized.
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
        'learning_outcomes', a.learning_outcomes,
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
