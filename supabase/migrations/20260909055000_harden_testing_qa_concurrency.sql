-- Canonical Testing learner + serialized authenticated QA lifecycle.
-- The Testing account stays hidden from the normal child login chooser; local
-- Playwright may still authenticate it directly when a protected manual PIN exists.

insert into public.learners as learner (
  workspace_id,
  display_name,
  slug,
  grade_level,
  is_active,
  metadata
)
select
  id,
  'Testing',
  'test',
  null,
  true,
  jsonb_build_object(
    'is_test', true,
    'exclude_from_parent_metrics', true,
    'qa_automation', true,
    'show_on_login', false,
    'avatar_emoji', '🧪'
  )
from public.workspaces
where slug = 'family-learning-hub'
on conflict (workspace_id, slug) do update
set display_name = excluded.display_name,
    is_active = true,
    metadata = coalesce(learner.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.workspace_settings (workspace_id, key, value, description)
select id,
       'qa.testing_learner',
       jsonb_build_object(
         'version', 2,
         'learner_slug', 'test',
         'display_name', 'Testing',
         'is_test', true,
         'exclude_from_parent_metrics', true,
         'show_on_login', false,
         'automation_auth', 'github_oidc',
         'github_oidc_audience', 'family-learning-hub-qa',
         'canonical_qa_quiz_slug', 'qa-automation-core',
         'concurrency', 'single_testing_learner_lease',
         'lease_ttl_seconds', 900,
         'local_playwright_auth', 'manual_pin_direct_login_when_configured',
         'real_learner_data_policy', 'never_use_aya_or_mohammad_for_automated_authenticated_qa'
       ),
       'Canonical isolated learner used by automated authenticated QA and local Playwright checks.'
from public.workspaces
where slug = 'family-learning-hub'
on conflict (workspace_id, key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

create table if not exists private.qa_run_leases (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lease_key text not null,
  run_id uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_id, lease_key)
);

alter table private.qa_run_leases enable row level security;
revoke all on table private.qa_run_leases from public, anon, authenticated;

create or replace function public.flh_qa_acquire_testing_lease(
  p_workspace_id uuid,
  p_run_id uuid,
  p_ttl_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  touched integer;
begin
  if p_workspace_id is null or p_run_id is null then
    return false;
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    return false;
  end if;

  insert into private.qa_run_leases as lease (
    workspace_id,
    lease_key,
    run_id,
    acquired_at,
    expires_at
  ) values (
    p_workspace_id,
    'testing-authenticated-smoke',
    p_run_id,
    now(),
    now() + make_interval(secs => p_ttl_seconds)
  )
  on conflict (workspace_id, lease_key) do update
  set run_id = excluded.run_id,
      acquired_at = case when lease.run_id = excluded.run_id then lease.acquired_at else now() end,
      expires_at = excluded.expires_at
  where lease.expires_at <= now()
     or lease.run_id = excluded.run_id;

  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

create or replace function public.flh_qa_release_testing_lease(
  p_workspace_id uuid,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  touched integer;
begin
  delete from private.qa_run_leases
  where workspace_id = p_workspace_id
    and lease_key = 'testing-authenticated-smoke'
    and run_id = p_run_id;

  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

revoke all on function public.flh_qa_acquire_testing_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.flh_qa_release_testing_lease(uuid, uuid) from public, anon, authenticated;
grant execute on function public.flh_qa_acquire_testing_lease(uuid, uuid, integer) to service_role;
grant execute on function public.flh_qa_release_testing_lease(uuid, uuid) to service_role;
