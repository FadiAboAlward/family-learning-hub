-- FLH-FEAT-2026-046 v1.1: one-time, database-owned grandfather marker.
-- Only drafts that predate this forward migration can be resumed without a
-- visual_plan. New service-role authoring requests always default to false.
-- This is not a Production rollout or enablement of visual_assessments.
alter table private.assessment_authoring_requests
  add column legacy_visual_eligible boolean not null default false;

-- Do NOT mark newly-created requests later. This statement runs once at
-- migration application time, not when the API receives an authoring request.
update private.assessment_authoring_requests r
 set legacy_visual_eligible=true
from public.quiz_versions v
where r.workspace_id=v.workspace_id and r.quiz_version_id=v.id
  and v.state='draft'
  and not exists(select 1 from public.assessment_publications p
    where p.workspace_id=r.workspace_id and p.quiz_version_id=r.quiz_version_id)
  and not exists(select 1 from public.quiz_questions q
    where q.workspace_id=r.workspace_id and q.quiz_version_id=r.quiz_version_id)
  and r.legacy_visual_eligible=false;

-- A separate narrow service-only eligibility RPC leaves existing authoring
-- read response shape and frozen hashes unchanged.
create or replace function public.flh_assessment_legacy_draft_eligible(
 p_workspace_id uuid,p_parent_id uuid,p_request_id uuid,
 p_version_id uuid,p_candidate_sha256 text
) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from private.assessment_authoring_requests r
   join public.quiz_versions v
    on v.workspace_id=r.workspace_id and v.id=r.quiz_version_id
   join public.quizzes qu
    on qu.workspace_id=r.workspace_id and qu.id=r.quiz_id
  where r.workspace_id=p_workspace_id and r.request_id=p_request_id
    and r.created_by=p_parent_id and r.quiz_version_id=p_version_id
    and r.candidate_sha256=p_candidate_sha256
    and r.legacy_visual_eligible=true
    and v.state='draft' and qu.status='draft'
    and v.created_by=p_parent_id and qu.created_by=p_parent_id
    and not exists(select 1 from public.assessment_publications p
      where p.workspace_id=r.workspace_id and p.quiz_version_id=r.quiz_version_id)
    and not exists(select 1 from public.quiz_questions q
      where q.workspace_id=r.workspace_id and q.quiz_version_id=r.quiz_version_id)
    and exists(select 1 from public.workspace_members m
      where m.workspace_id=p_workspace_id and m.user_id=p_parent_id
        and m.role in ('owner','admin'))
 );
$$;
revoke all on function public.flh_assessment_legacy_draft_eligible(uuid,uuid,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.flh_assessment_legacy_draft_eligible(uuid,uuid,uuid,uuid,text)
 to service_role;
