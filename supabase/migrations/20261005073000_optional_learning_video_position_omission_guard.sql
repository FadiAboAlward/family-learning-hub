-- FLH-FEAT-2026-018 / SPEC_VERSION 1.5
-- Forward-only hardening: preserve omitted authoring position and fail closed
-- once an ordered multi-video sequence already exists for the learner/version.

create or replace function public.flh_learning_video_attach(p_workspace_id uuid,p_parent_id uuid,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v public.learning_video_assignments%rowtype;
  c jsonb:=p_candidate;
  v_position smallint;
  v_position_supplied boolean:=c ? 'position';
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin')) then return jsonb_build_object('error','VIDEO_ATTACHMENT_FORBIDDEN'); end if;

 if v_position_supplied then
   if jsonb_typeof(c->'position') is distinct from 'number' then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
   v_position:=(c->>'position')::smallint;
 else
   if exists(
     select 1
     from public.learning_video_assignments
     where workspace_id=p_workspace_id
       and learner_id=(c->>'learner_id')::uuid
       and quiz_version_id=(c->>'quiz_version_id')::uuid
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

 insert into public.learning_video_assignments(workspace_id,learner_id,quiz_version_id,program_id,curriculum_id,grade_level,subject_id,concept_id,position,video_ref,title,language,rationale,verification_state,embeddable,made_for_kids,verified_at,verification_expires_at,reviewed_by)
 values(p_workspace_id,(c->>'learner_id')::uuid,(c->>'quiz_version_id')::uuid,(c->>'program_id')::uuid,(c->>'curriculum_id')::uuid,(c->>'grade_level')::smallint,(c->>'subject_id')::bigint,(c->>'concept_id')::uuid,v_position,c->>'video_ref',c->>'title',c->>'language',c->>'rationale','verified',true,(c->>'made_for_kids')::boolean,(c->>'verified_at')::timestamptz,(c->>'verification_expires_at')::timestamptz,p_parent_id)
 on conflict(workspace_id,learner_id,quiz_version_id,position) do update set
  status_revision=gen_random_uuid(),
  video_revision=case when (learning_video_assignments.video_ref,learning_video_assignments.program_id,learning_video_assignments.curriculum_id,learning_video_assignments.grade_level,learning_video_assignments.subject_id,learning_video_assignments.concept_id) is distinct from (excluded.video_ref,excluded.program_id,excluded.curriculum_id,excluded.grade_level,excluded.subject_id,excluded.concept_id) then gen_random_uuid() else learning_video_assignments.video_revision end,
  program_id=excluded.program_id,curriculum_id=excluded.curriculum_id,grade_level=excluded.grade_level,subject_id=excluded.subject_id,concept_id=excluded.concept_id,
  video_ref=excluded.video_ref,title=excluded.title,language=excluded.language,rationale=excluded.rationale,verification_state='verified',embeddable=true,made_for_kids=excluded.made_for_kids,verified_at=excluded.verified_at,verification_expires_at=excluded.verification_expires_at,reviewed_by=p_parent_id,updated_at=now()
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
