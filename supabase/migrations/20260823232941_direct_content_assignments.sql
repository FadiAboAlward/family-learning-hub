create table if not exists public.learner_content_assignments (
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

create index if not exists learner_content_assignments_learner_idx on public.learner_content_assignments(workspace_id, learner_id, status);
create index if not exists learner_content_assignments_resource_idx on public.learner_content_assignments(workspace_id, resource_type, resource_id, status);

create or replace function public.validate_learner_content_assignment_resource()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.resource_type='book' and not exists(select 1 from public.books b where b.id=new.resource_id) then
    raise exception 'BOOK_NOT_FOUND';
  elsif new.resource_type='unit' and not exists(select 1 from public.units u where u.id=new.resource_id) then
    raise exception 'UNIT_NOT_FOUND';
  elsif new.resource_type='quiz' and not exists(select 1 from public.quizzes q where q.id=new.resource_id and q.workspace_id=new.workspace_id) then
    raise exception 'QUIZ_NOT_FOUND';
  end if;
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists learner_content_assignment_validate on public.learner_content_assignments;
create trigger learner_content_assignment_validate before insert or update on public.learner_content_assignments
for each row execute function public.validate_learner_content_assignment_resource();

create or replace function public.sync_test_content_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  test_id uuid;
  should_be_active boolean;
begin
  select id into test_id from public.learners
  where workspace_id=new.workspace_id and coalesce((metadata->>'is_test')::boolean,false)=true and is_active=true
  order by created_at limit 1;
  if test_id is null or new.learner_id=test_id then return new; end if;

  select exists(
    select 1 from public.learner_content_assignments a
    join public.learners l on l.id=a.learner_id
    where a.workspace_id=new.workspace_id
      and a.resource_type=new.resource_type
      and a.resource_id=new.resource_id
      and a.status='active'
      and a.learner_id<>test_id
      and coalesce((l.metadata->>'is_test')::boolean,false)=false
  ) into should_be_active;

  insert into public.learner_content_assignments(workspace_id,learner_id,resource_type,resource_id,status,started_at,ended_at,metadata)
  values(new.workspace_id,test_id,new.resource_type,new.resource_id,case when should_be_active then 'active' else 'revoked' end,current_date,case when should_be_active then null else current_date end,jsonb_build_object('mirrored_for_test',true))
  on conflict(workspace_id,learner_id,resource_type,resource_id)
  do update set status=excluded.status, ended_at=excluded.ended_at, updated_at=now(), metadata=public.learner_content_assignments.metadata || excluded.metadata;
  return new;
end;
$$;

drop trigger if exists learner_content_assignment_sync_test on public.learner_content_assignments;
create trigger learner_content_assignment_sync_test after insert or update of status on public.learner_content_assignments
for each row execute function public.sync_test_content_assignment();
