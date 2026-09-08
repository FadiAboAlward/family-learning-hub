-- Harden direct-content assignment storage so browser clients cannot bypass
-- the Edge Function authorization layer.
--
-- Intended access model:
--   * anon/authenticated: no direct table or RPC access
--   * Edge Functions: use service_role after performing learner/parent auth
--   * trigger functions: continue to run internally on table/quiz changes

alter table public.learner_content_assignments enable row level security;

-- No client-facing RLS policies are intentionally created. All application
-- access to this table goes through authenticated Edge Functions that use the
-- service role after enforcing the appropriate learner/parent authorization.
revoke all privileges on table public.learner_content_assignments from anon, authenticated;

grant select, insert, update, delete on table public.learner_content_assignments to service_role;

-- These SECURITY DEFINER functions exist as trigger functions. They must not
-- also be callable as public PostgREST RPC endpoints by browser roles.
revoke execute on function public.validate_learner_content_assignment_resource() from public, anon, authenticated;
revoke execute on function public.sync_test_content_assignment() from public, anon, authenticated;
revoke execute on function public.sync_content_assignment_quiz_access() from public, anon, authenticated;
revoke execute on function public.sync_published_quiz_direct_access() from public, anon, authenticated;

grant execute on function public.validate_learner_content_assignment_resource() to service_role;
grant execute on function public.sync_test_content_assignment() to service_role;
grant execute on function public.sync_content_assignment_quiz_access() to service_role;
grant execute on function public.sync_published_quiz_direct_access() to service_role;

comment on table public.learner_content_assignments is
  'Direct learner content assignments. Browser roles have no direct access; use authorized Edge Functions.';
