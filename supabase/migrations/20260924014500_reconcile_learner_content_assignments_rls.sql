-- Reconcile learner_content_assignments hardening with the repository migration chain.
--
-- Production was already hardened manually on 2026-09-07 from PR #36.
-- This forward-only migration makes the desired state reproducible from Git and
-- remains safe to apply again because the ALTER/REVOKE/GRANT operations are idempotent.

alter table public.learner_content_assignments enable row level security;

-- Browser roles must not bypass the authorized Edge Function boundary.
revoke all privileges on table public.learner_content_assignments from anon, authenticated;

-- Authorized Edge Functions use service_role after enforcing learner/parent authorization.
grant select, insert, update, delete
on table public.learner_content_assignments
to service_role;

-- These SECURITY DEFINER functions are trigger/internal functions, not browser RPCs.
revoke execute on function public.validate_learner_content_assignment_resource()
from public, anon, authenticated;
revoke execute on function public.sync_test_content_assignment()
from public, anon, authenticated;
revoke execute on function public.sync_content_assignment_quiz_access()
from public, anon, authenticated;
revoke execute on function public.sync_published_quiz_direct_access()
from public, anon, authenticated;

grant execute on function public.validate_learner_content_assignment_resource() to service_role;
grant execute on function public.sync_test_content_assignment() to service_role;
grant execute on function public.sync_content_assignment_quiz_access() to service_role;
grant execute on function public.sync_published_quiz_direct_access() to service_role;

comment on table public.learner_content_assignments is
  'Direct learner content assignments. Browser roles have no direct access; use authorized Edge Functions.';
