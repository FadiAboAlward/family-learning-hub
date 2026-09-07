do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin bypassrls;
  else
    alter role service_role bypassrls;
  end if;
end
$$;

create table public.workspaces (
  id uuid primary key
);

create table public.learners (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade
);

create table public.learner_content_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  resource_type text not null check (resource_type in ('book','unit','quiz')),
  resource_id uuid not null,
  status text not null default 'active' check (status in ('active','paused','completed','revoked')),
  assigned_by uuid null,
  started_at date null default current_date,
  ended_at date null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learner_content_assignments_dates check (ended_at is null or started_at is null or ended_at >= started_at),
  unique (workspace_id, learner_id, resource_type, resource_id)
);

create or replace function public.validate_learner_content_assignment_resource()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

create or replace function public.sync_test_content_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  return new;
end;
$$;

create or replace function public.sync_content_assignment_quiz_access()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  return new;
end;
$$;

create or replace function public.sync_published_quiz_direct_access()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  return new;
end;
$$;

create trigger learner_content_assignment_validate
before insert or update on public.learner_content_assignments
for each row execute function public.validate_learner_content_assignment_resource();

grant usage on schema public to anon, authenticated, service_role;
grant all privileges on table public.learner_content_assignments to anon, authenticated, service_role;
grant execute on function public.validate_learner_content_assignment_resource() to public, anon, authenticated, service_role;
grant execute on function public.sync_test_content_assignment() to public, anon, authenticated, service_role;
grant execute on function public.sync_content_assignment_quiz_access() to public, anon, authenticated, service_role;
grant execute on function public.sync_published_quiz_direct_access() to public, anon, authenticated, service_role;
