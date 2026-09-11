create table public.gamification_levels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  level_no integer not null check (level_no > 0),
  name text not null,
  min_xp integer not null check (min_xp >= 0),
  icon text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, level_no),
  unique (workspace_id, min_xp)
);

create table public.learner_gamification_state (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  xp integer not null default 0 check (xp >= 0),
  reward_points integer not null default 0 check (reward_points >= 0),
  current_level integer not null default 1 check (current_level > 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_learning_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id),
  unique (id, workspace_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade
);
create index learner_gamification_state_workspace_idx on public.learner_gamification_state(workspace_id, learner_id);
create trigger set_learner_gamification_state_updated_at before update on public.learner_gamification_state for each row execute function public.set_updated_at();

create table public.gamification_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  learner_id uuid not null,
  event_type text not null check (event_type in ('quiz_completed','first_try_correct','mastery_gain','improvement','streak','effort','hint_used_well','remediation_completed','badge_earned','reward_points_adjustment','xp_adjustment','other')),
  xp_delta integer not null default 0,
  reward_points_delta integer not null default 0,
  source_type text,
  source_id text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade
);
create index gamification_events_learner_created_idx on public.gamification_events(workspace_id, learner_id, created_at desc);

create table public.gamification_badges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  title text not null,
  description text,
  icon text,
  criteria jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code),
  constraint gamification_badges_code_format check (code = lower(code) and code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create trigger set_gamification_badges_updated_at before update on public.gamification_badges for each row execute function public.set_updated_at();

create table public.learner_badges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  badge_id uuid not null,
  awarded_at timestamptz not null default now(),
  award_reason text,
  metadata jsonb not null default '{}'::jsonb,
  unique (learner_id, badge_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (badge_id) references public.gamification_badges(id) on delete cascade
);
create index learner_badges_learner_idx on public.learner_badges(workspace_id, learner_id, awarded_at desc);
create index learner_badges_badge_idx on public.learner_badges(badge_id);

create table public.gamification_rewards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text,
  reward_type text not null check (reward_type in ('activity','outing','experience','privilege','gift','custom')),
  required_level integer check (required_level is null or required_level > 0),
  required_reward_points integer check (required_reward_points is null or required_reward_points >= 0),
  criteria jsonb not null default '{}'::jsonb,
  image_asset_id uuid references public.assets(id) on delete set null,
  parent_approval_required boolean not null default true,
  is_active boolean not null default true,
  max_redemptions_per_learner integer check (max_redemptions_per_learner is null or max_redemptions_per_learner > 0),
  available_from timestamptz,
  available_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gamification_rewards_dates check (available_until is null or available_from is null or available_until >= available_from)
);
create index gamification_rewards_workspace_active_idx on public.gamification_rewards(workspace_id, is_active, required_level, required_reward_points);
create trigger set_gamification_rewards_updated_at before update on public.gamification_rewards for each row execute function public.set_updated_at();

create table public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  reward_id uuid not null,
  status text not null default 'pending' check (status in ('pending','approved','redeemed','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  redeemed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  note text,
  points_spent integer not null default 0 check (points_spent >= 0),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (reward_id) references public.gamification_rewards(id) on delete restrict
);
create index reward_claims_learner_idx on public.reward_claims(workspace_id, learner_id, status, requested_at desc);
create index reward_claims_reward_idx on public.reward_claims(reward_id, status);

alter table public.gamification_levels enable row level security;
alter table public.learner_gamification_state enable row level security;
alter table public.gamification_events enable row level security;
alter table public.gamification_badges enable row level security;
alter table public.learner_badges enable row level security;
alter table public.gamification_rewards enable row level security;
alter table public.reward_claims enable row level security;

revoke all on public.gamification_levels, public.learner_gamification_state, public.gamification_events, public.gamification_badges, public.learner_badges, public.gamification_rewards, public.reward_claims from anon;
grant select, insert, update, delete on public.gamification_levels, public.learner_gamification_state, public.gamification_events, public.gamification_badges, public.learner_badges, public.gamification_rewards, public.reward_claims to authenticated;
grant all on public.gamification_levels, public.learner_gamification_state, public.gamification_events, public.gamification_badges, public.learner_badges, public.gamification_rewards, public.reward_claims to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create policy gamification_levels_read on public.gamification_levels for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy gamification_levels_manage on public.gamification_levels for all to authenticated using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin')) with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));

create policy learner_gamification_state_read on public.learner_gamification_state for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_gamification_state_manage on public.learner_gamification_state for all to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy gamification_events_read on public.gamification_events for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy gamification_events_manage on public.gamification_events for all to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy gamification_badges_read on public.gamification_badges for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy gamification_badges_manage on public.gamification_badges for all to authenticated using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin')) with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));

create policy learner_badges_read on public.learner_badges for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_badges_manage on public.learner_badges for all to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy gamification_rewards_read on public.gamification_rewards for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy gamification_rewards_manage on public.gamification_rewards for all to authenticated using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin')) with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));

create policy reward_claims_read on public.reward_claims for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy reward_claims_manage on public.reward_claims for all to authenticated using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin')) with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'gamification.defaults',
       jsonb_build_object(
         'enabled', true,
         'fun_learning_mode', true,
         'show_xp', true,
         'show_levels', true,
         'show_streaks', true,
         'show_badges', true,
         'show_reward_progress', true,
         'real_world_rewards_enabled', true,
         'parent_approval_required', true,
         'reward_signals', jsonb_build_array('mastery','improvement','consistency','effort'),
         'avoid_score_only_rewards', true,
         'repeat_question_xp_cap', true,
         'celebration_intensity', 'medium'
       ),
       'Gamification and real-world reward defaults designed to motivate learning without rewarding score-chasing alone.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.gamification_levels (workspace_id, level_no, name, min_xp, icon)
select w.id, v.level_no, v.name, v.min_xp, v.icon
from public.workspaces w
cross join (values
  (1, 'مستكشف', 0, '🌱'),
  (2, 'متعلّم نشيط', 250, '⭐'),
  (3, 'حلّال تحديات', 600, '🧩'),
  (4, 'متمكن', 1100, '🚀'),
  (5, 'بطل المعرفة', 1800, '🏆')
) as v(level_no, name, min_xp, icon)
where w.slug = 'ayaa-school'
on conflict (workspace_id, level_no) do nothing;

insert into public.learner_gamification_state (workspace_id, learner_id)
select l.workspace_id, l.id from public.learners l
on conflict (learner_id) do nothing;
