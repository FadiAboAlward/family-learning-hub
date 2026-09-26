-- FLH-FEAT-2026-005 v1.0
-- SPEC_REVISION_ID: ANLCKQkbQF8doNFfd1ZWTBozOhQ3RgVC1dTb1w1kc2m6EGW45rytPwn7A2teeT2I_C4oomGDAYHIQAl0X00SVUKRCpZGMubkBTWmU9xgTEA
-- MIGRATION_IDENTITY: 20260925225500_harden_authenticated_authorization_and_session_privacy.sql
--
-- Production/fresh-database reconciliation:
-- * Production preflight on 2026-09-25 confirmed the historical state is still live:
--   private.workspace_role/is_workspace_member/can_manage_learning are executable by
--   PUBLIC/anon/authenticated; learner-specific gamification SELECT policies still use
--   workspace-member-wide access; authenticated still has direct learner_learning_sessions
--   privileges and the parent-read policy remains present.
-- * A fresh replay reaches the same historical contract before this migration.
-- * This migration is forward-only: rebind helper authorization to auth.uid(), narrow the
--   learner-specific read policies, and remove direct browser access to
--   public.learner_learning_sessions while retaining service_role CRUD for activity-api.
--
-- Post-merge Production checks:
-- * helper definitions bind both lookup identity and p_user_id to auth.uid();
-- * PUBLIC/anon cannot EXECUTE the three private helpers; authenticated can for RLS;
-- * learner_badges/reward_claims/learner_gamification_state/gamification_events reads are
--   manager-scoped through private.can_manage_learning;
-- * no authenticated learner_learning_sessions policy or direct CRUD privilege remains;
-- * service_role retains learner_learning_sessions CRUD and activity-api flows remain valid.
--
-- Bind browser-facing authorization decisions to auth.uid(), narrow
-- learner-specific gamification reads, and keep learner session nonces
-- behind the server-authorized activity API.

create or replace function private.workspace_role(
  p_workspace_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = (select auth.uid())
    and p_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.is_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = (select auth.uid())
    )
$$;

create or replace function private.can_manage_learning(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_user_id = (select auth.uid())
    and private.workspace_role(p_workspace_id, (select auth.uid())) in ('owner','admin','teacher'),
    false
  )
$$;

-- These helpers are used by authenticated RLS policies. Keep authenticated
-- execution, but remove inherited PUBLIC/anon execution.
revoke execute on function private.workspace_role(uuid, uuid) from public, anon;
revoke execute on function private.is_workspace_member(uuid, uuid) from public, anon;
revoke execute on function private.can_manage_learning(uuid, uuid) from public, anon;
grant execute on function private.workspace_role(uuid, uuid) to authenticated;
grant execute on function private.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function private.can_manage_learning(uuid, uuid) to authenticated;

-- Learner-specific gamification rows are not general workspace catalog data.
-- In this family app authenticated parent/manager reads use the same
-- owner/admin/teacher boundary as learning management. Learner-facing reads
-- remain server-authorized through the custom learner session APIs.
drop policy if exists learner_badges_read on public.learner_badges;
create policy learner_badges_read
  on public.learner_badges
  for select
  to authenticated
  using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists reward_claims_read on public.reward_claims;
create policy reward_claims_read
  on public.reward_claims
  for select
  to authenticated
  using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists learner_gamification_state_read on public.learner_gamification_state;
create policy learner_gamification_state_read
  on public.learner_gamification_state
  for select
  to authenticated
  using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists gamification_events_read on public.gamification_events;
create policy gamification_events_read
  on public.gamification_events
  for select
  to authenticated
  using (private.can_manage_learning(workspace_id, (select auth.uid())));

-- auth_nonce is an authorization secret for the custom learner session path.
-- No browser role needs direct table access: activity-api uses service_role
-- after verifying learner HMAC tokens or the authenticated parent session.
drop policy if exists learner_learning_sessions_parent_read
  on public.learner_learning_sessions;

revoke all privileges on table public.learner_learning_sessions
  from anon, authenticated;

grant select, insert, update, delete
  on table public.learner_learning_sessions
  to service_role;

comment on table public.learner_learning_sessions is
  'Learner activity sessions. Direct browser access is disabled because auth_nonce is server-only; use activity-api.';
