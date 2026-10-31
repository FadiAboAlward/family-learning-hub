-- FLH-FEAT-2026-041 v1.1 / Drive revision 3 / Issue #194.
-- Approximate opt-in resume only. No academic tables/triggers or provider calls.
create table public.learning_video_progress (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 learner_id uuid not null,
 video_ref text not null check (video_ref ~ '^[A-Za-z0-9_-]{11}$'),
 position_seconds integer not null check (position_seconds between 0 and 86400),
 ended boolean not null default false,
 revision bigint not null check (revision > 0),
 request_id uuid not null,
 cleared boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key (workspace_id,learner_id,video_ref),
 foreign key (learner_id,workspace_id) references public.learners(id,workspace_id) on delete cascade
);
alter table public.learning_video_progress enable row level security;
revoke all on public.learning_video_progress from public,anon,authenticated;
grant select,insert,update,delete on public.learning_video_progress to service_role;
create index learning_video_progress_expiry on public.learning_video_progress(workspace_id,updated_at);
comment on table public.learning_video_progress is 'Opt-in approximate resume, not proof of viewing or mastery. Service-only; delete after 29 days.';

create function public.flh_learning_video_progress(
 p_workspace_id uuid,p_learner_id uuid,p_quiz_slug text,p_attempt_id uuid,p_video_id uuid,
 p_operation text,p_expected_revision bigint,p_request_id uuid,p_position_seconds integer,p_ended boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare preview jsonb; item jsonb; saved public.learning_video_progress%rowtype; eligible boolean; response jsonb;
begin
 if p_operation is null or p_operation not in ('read','save','clear') or p_video_id is null
   or (p_operation <> 'read' and (p_expected_revision is null or p_expected_revision<0 or p_request_id is null))
   or (p_operation='save' and (p_position_seconds is null or p_position_seconds not between 0 and 86400 or p_ended is null))
 then return jsonb_build_object('error','INVALID_VIDEO_INPUT'); end if;
 preview:=public.flh_learning_video_preview(p_workspace_id,p_learner_id,p_quiz_slug,p_attempt_id);
 if preview ? 'error' then return jsonb_build_object('error','VIDEO_NOT_AVAILABLE'); end if;
 select value into item from jsonb_array_elements(coalesce(preview->'optional_video'->'videos',jsonb_build_array(preview->'optional_video'))) where value->>'id'=p_video_id::text;
 if item is null then return jsonb_build_object('error','VIDEO_NOT_AVAILABLE'); end if;
 eligible:=item->'made_for_kids'='false'::jsonb and (item->>'verification_expires_at')::timestamptz>now() and item->>'availability'='available';
 -- Serialize first insert, saves and clears across devices. This lock never touches academic rows.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||p_learner_id::text||(item->>'video_ref'),0));
 delete from public.learning_video_progress where workspace_id=p_workspace_id and learner_id=p_learner_id
   and video_ref=item->>'video_ref' and (updated_at<=now()-interval '29 days' or eligible is not true);
 if eligible is not true then
   if p_operation='read' then return jsonb_build_object('eligible',false); end if;
   return jsonb_build_object('error','VIDEO_PROGRESS_INELIGIBLE');
 end if;
 select * into saved from public.learning_video_progress where workspace_id=p_workspace_id and learner_id=p_learner_id and video_ref=item->>'video_ref' for update;
 response:=jsonb_build_object('eligible',true,'eligible_until',item->>'verification_expires_at','revision',coalesce(saved.revision,0),'position_seconds',coalesce(saved.position_seconds,0),'ended',coalesce(saved.ended,false),'has_progress',saved.revision is not null and not saved.cleared);
 if p_operation='read' then return response; end if;
 if saved.request_id=p_request_id then
   if saved.cleared<>(p_operation='clear') or saved.position_seconds<>(case when p_operation='clear' then 0 else p_position_seconds end) or saved.ended<>(case when p_operation='clear' then false else p_ended end) then
     return jsonb_build_object('error','VIDEO_PROGRESS_REQUEST_CONFLICT');
   end if;
   return response;
 end if;
 if p_expected_revision<>coalesce(saved.revision,0) then return jsonb_build_object('error','VIDEO_PROGRESS_CONFLICT'); end if;
 insert into public.learning_video_progress(workspace_id,learner_id,video_ref,position_seconds,ended,revision,request_id,cleared,updated_at)
 values(p_workspace_id,p_learner_id,item->>'video_ref',case when p_operation='clear' then 0 else p_position_seconds end,case when p_operation='clear' then false else p_ended end,coalesce(saved.revision,0)+1,p_request_id,p_operation='clear',now())
 on conflict(workspace_id,learner_id,video_ref) do update set position_seconds=excluded.position_seconds,ended=excluded.ended,revision=excluded.revision,request_id=excluded.request_id,cleared=excluded.cleared,updated_at=excluded.updated_at;
 return response||jsonb_build_object('revision',coalesce(saved.revision,0)+1,'position_seconds',case when p_operation='clear' then 0 else p_position_seconds end,'ended',case when p_operation='clear' then false else p_ended end,'has_progress',p_operation<>'clear');
end;
$$;
revoke all on function public.flh_learning_video_progress(uuid,uuid,text,uuid,uuid,text,bigint,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.flh_learning_video_progress(uuid,uuid,text,uuid,uuid,text,bigint,uuid,integer,boolean) to service_role;

-- Reuse the existing daily maintenance schedule, without any provider network request.
create or replace function public.flh_learning_video_prune_status(p_workspace_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a integer; b integer; c integer;
begin
 update public.learning_video_assignments set status_revision=gen_random_uuid(),verification_state='expired',embeddable=null,made_for_kids=null,verified_at=null,verification_expires_at=null where workspace_id=p_workspace_id and verified_at<now()-interval '29 days'; get diagnostics a=row_count;
 update public.learning_video_attempts set verification_state='expired',embeddable=null,made_for_kids=null,verified_at=null,verification_expires_at=null where workspace_id=p_workspace_id and verified_at<now()-interval '29 days'; get diagnostics b=row_count;
 delete from public.learning_video_progress where workspace_id=p_workspace_id and updated_at<=now()-interval '29 days'; get diagnostics c=row_count;
 return jsonb_build_object('ok',true,'assignments_pruned',a,'attempts_pruned',b,'progress_pruned',c);
end;
$$;
