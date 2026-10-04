-- FLH-FEAT-2026-018 / SPEC_VERSION 1.2
-- Forward-only extension: one optional video becomes an ordered optional sequence.
-- Existing single-video rows remain position 1.

alter table public.learning_video_assignments
  add column position smallint not null default 1 check (position between 1 and 20);

alter table public.learning_video_assignments
  drop constraint learning_video_assignments_workspace_id_learner_id_quiz_ver_key,
  add constraint learning_video_assignments_learner_version_position_key
    unique (workspace_id, learner_id, quiz_version_id, position),
  add constraint learning_video_assignments_learner_version_video_key
    unique (workspace_id, learner_id, quiz_version_id, video_ref);

-- A Learning attempt now snapshots the whole ordered sequence on first entry.
alter table public.learning_video_attempts
  add column snapshot_id uuid not null default gen_random_uuid(),
  add column position smallint not null default 1 check (position between 1 and 20);

alter table public.learning_video_report_requests
  drop constraint learning_video_report_requests_attempt_id_workspace_id_fkey;

alter table public.learning_video_attempts
  drop constraint learning_video_attempts_pkey,
  drop constraint learning_video_attempts_attempt_id_workspace_id_key,
  add constraint learning_video_attempts_pkey primary key (snapshot_id),
  add constraint learning_video_attempts_attempt_workspace_video_key
    unique (attempt_id, workspace_id, video_id),
  add constraint learning_video_attempts_attempt_position_key
    unique (attempt_id, position);

create index learning_video_attempts_attempt_idx
  on public.learning_video_attempts(attempt_id, workspace_id);

alter table public.learning_video_report_requests
  add constraint learning_video_report_requests_attempt_workspace_video_fkey
    foreign key (attempt_id, workspace_id, video_id)
    references public.learning_video_attempts(attempt_id, workspace_id, video_id)
    on delete cascade;

create or replace function public.flh_learning_video_attach(p_workspace_id uuid,p_parent_id uuid,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.learning_video_assignments%rowtype; c jsonb:=p_candidate; v_position smallint:=coalesce((p_candidate->>'position')::smallint,1);
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin')) then return jsonb_build_object('error','VIDEO_ATTACHMENT_FORBIDDEN'); end if;
 if v_position not between 1 and 20
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
     video_ref,title,language,verification_state,embeddable,made_for_kids,verified_at,verification_expires_at
   )
   select p_attempt_id,a.video_revision,p_workspace_id,p_learner_id,p_version_id,a.program_id,a.curriculum_id,a.grade_level,a.subject_id,a.concept_id,a.position,
          a.video_ref,a.title,a.language,a.verification_state,a.embeddable,a.made_for_kids,a.verified_at,a.verification_expires_at
   from public.learning_video_assignments a
   where a.workspace_id=p_workspace_id and a.learner_id=p_learner_id and a.quiz_version_id=p_version_id
     and private.flh_learning_video_context_matches(p_workspace_id,p_learner_id,p_version_id,a.program_id,a.curriculum_id,a.grade_level,a.subject_id,a.concept_id)
   order by a.position
   on conflict(attempt_id,workspace_id,video_id) do nothing;
 end if;

 select coalesce(jsonb_agg(
   jsonb_build_object(
     'id',s.video_id,'provider','youtube','position',s.position,'video_ref',s.video_ref,'title',s.title,'language',s.language,
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

create or replace function public.flh_learning_video_report(p_workspace_id uuid,p_learner_id uuid,p_attempt_id uuid,p_video_id uuid,p_self_report text,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.learning_video_attempts%rowtype; receipt public.learning_video_report_requests%rowtype;
begin
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_self_report is null or p_self_report not in ('not_reported','not_watched','watched_part','watched_full') then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 if not exists(select 1 from public.quiz_attempts a join public.learners l on l.id=a.learner_id and l.workspace_id=a.workspace_id where a.workspace_id=p_workspace_id and a.id=p_attempt_id and a.learner_id=p_learner_id and a.delivery_mode='learning' and a.status='in_progress' and l.is_active) then return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE'); end if;
 select * into s from public.learning_video_attempts where workspace_id=p_workspace_id and attempt_id=p_attempt_id and learner_id=p_learner_id and video_id=p_video_id for update;
 if not found then return jsonb_build_object('error','VIDEO_NOT_AVAILABLE'); end if;
 select * into receipt from public.learning_video_report_requests where workspace_id=p_workspace_id and attempt_id=p_attempt_id and request_id=p_request_id;
 if found then
  if receipt.video_id<>p_video_id or receipt.self_report<>p_self_report or receipt.expected_revision<>p_expected_revision then return jsonb_build_object('error','VIDEO_REPORT_REQUEST_CONFLICT'); end if;
  return jsonb_build_object('ok',true,'duplicate',true,'self_report',s.self_report,'report_revision',s.report_revision);
 end if;
 if s.report_revision<>p_expected_revision then return jsonb_build_object('error','REPORT_CONFLICT','self_report',s.self_report,'report_revision',s.report_revision); end if;
 update public.learning_video_attempts
 set self_report=p_self_report,report_revision=report_revision+1,reported_at=now()
 where workspace_id=p_workspace_id and attempt_id=p_attempt_id and video_id=p_video_id
 returning * into s;
 insert into public.learning_video_report_requests(workspace_id,attempt_id,request_id,video_id,self_report,expected_revision,result_revision)
 values(p_workspace_id,p_attempt_id,p_request_id,p_video_id,p_self_report,p_expected_revision,s.report_revision);
 return jsonb_build_object('ok',true,'duplicate',false,'self_report',s.self_report,'report_revision',s.report_revision);
end;
$$;

revoke all on function public.flh_learning_video_report(uuid,uuid,uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.flh_learning_video_report(uuid,uuid,uuid,uuid,text,integer,uuid) to service_role;
