create table if not exists public.learner_learning_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  auth_nonce text not null,
  entry_type text not null default 'login' check (entry_type in ('login','resume_after_inactivity')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  end_reason text check (end_reason is null or end_reason in ('logout','inactivity','session_expired','replaced','unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learner_learning_sessions_id_workspace_key unique (id, workspace_id)
);

create index if not exists learner_learning_sessions_learner_started_idx
  on public.learner_learning_sessions (workspace_id, learner_id, started_at desc);
create index if not exists learner_learning_sessions_nonce_open_idx
  on public.learner_learning_sessions (learner_id, auth_nonce, ended_at, last_activity_at desc);

alter table public.learner_learning_sessions enable row level security;
revoke all on public.learner_learning_sessions from anon;

grant select on public.learner_learning_sessions to authenticated;

create policy learner_learning_sessions_parent_read
on public.learner_learning_sessions
for select
to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));

create trigger set_learner_learning_sessions_updated_at
before update on public.learner_learning_sessions
for each row execute function public.set_updated_at();

insert into public.workspace_settings (workspace_id, key, value, description)
select id, 'tracking.learning_sessions',
       '{"enabled":true,"inactivity_minutes":10,"heartbeat_seconds":60,"show_weekly_summary":true,"show_session_details":true,"exclude_test_learners":true}'::jsonb,
       'Learner visit/session tracking policy for parent reporting.'
from public.workspaces
where slug='ayaa-school'
on conflict (workspace_id,key) do update
set value=excluded.value, description=excluded.description, updated_at=now();
