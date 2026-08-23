-- Persistent privacy-preserving learner login throttling.
create table if not exists public.learner_login_rate_limits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  login_key_hash text not null,
  client_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, login_key_hash, client_hash)
);
create index if not exists learner_login_rate_limits_lock_idx
  on public.learner_login_rate_limits(workspace_id, locked_until)
  where locked_until is not null;
alter table public.learner_login_rate_limits enable row level security;
revoke all on public.learner_login_rate_limits from anon, authenticated;

drop trigger if exists set_learner_login_rate_limits_updated_at on public.learner_login_rate_limits;
create trigger set_learner_login_rate_limits_updated_at before update on public.learner_login_rate_limits
for each row execute function public.set_updated_at();

update public.learners
set metadata = metadata || jsonb_build_object(
  'show_on_login', coalesce((metadata->>'show_on_login')::boolean, true),
  'avatar_emoji', coalesce(metadata->>'avatar_emoji', case slug when 'aya' then '🌷' when 'mohammad' then '🚀' when 'test' then '🧪' else '🧑‍🎓' end)
), updated_at=now()
where workspace_id=(select id from public.workspaces where slug='family-learning-hub');

update public.program_quizzes pq
set availability='hidden', updated_at=now(), metadata=pq.metadata || '{"legacy_exam_copy":true}'::jsonb
from public.quizzes q
where q.id=pq.quiz_id and q.slug='fractions-pages-54-57-exam';

insert into public.workspace_settings (workspace_id,key,value,description)
select id,'security.learner_login',
       '{"max_failures_per_window":5,"window_minutes":15,"lock_minutes":10,"client_identifier":"sha256(ip+user-agent)","stores_raw_ip":false}'::jsonb,
       'Learner PIN login throttling. Client network identifiers are hashed before persistence.'
from public.workspaces where slug='family-learning-hub'
on conflict (workspace_id,key) do update set value=excluded.value,description=excluded.description,updated_at=now();
