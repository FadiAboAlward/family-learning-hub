create table public.curricula (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_native text,
  country_code text,
  primary_language text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curricula_code_format check (code = lower(code) and code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint curricula_country_code_len check (country_code is null or char_length(country_code) = 2)
);

create trigger set_curricula_updated_at
before update on public.curricula
for each row execute function public.set_updated_at();

create table public.curriculum_subjects (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  subject_id bigint not null references public.subjects(id) on delete restrict,
  grade_level smallint not null check (grade_level between 1 and 12),
  school_year text,
  display_name text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (curriculum_id, subject_id, grade_level, school_year)
);
create index curriculum_subjects_curriculum_idx on public.curriculum_subjects(curriculum_id, grade_level, sort_order);
create index curriculum_subjects_subject_idx on public.curriculum_subjects(subject_id);

create table public.learner_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  curriculum_id uuid not null references public.curricula(id) on delete restrict,
  school_year text not null,
  grade_level smallint not null check (grade_level between 1 and 12),
  status text not null default 'active' check (status in ('active','completed','paused','archived')),
  started_at date,
  ended_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, curriculum_id, school_year),
  unique (id, workspace_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  constraint learner_enrollments_dates check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index learner_enrollments_workspace_learner_idx on public.learner_enrollments(workspace_id, learner_id, status);
create index learner_enrollments_curriculum_idx on public.learner_enrollments(curriculum_id, school_year, grade_level);

create trigger set_learner_enrollments_updated_at
before update on public.learner_enrollments
for each row execute function public.set_updated_at();

create table public.workspace_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, key),
  constraint workspace_settings_key_format check (key = lower(key) and key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$')
);
create index workspace_settings_workspace_idx on public.workspace_settings(workspace_id);

create trigger set_workspace_settings_updated_at
before update on public.workspace_settings
for each row execute function public.set_updated_at();

alter table public.books add column curriculum_id uuid references public.curricula(id) on delete set null;
create index books_curriculum_idx on public.books(curriculum_id, grade_level, school_year);

alter table public.quizzes add column curriculum_id uuid references public.curricula(id) on delete set null;
create index quizzes_curriculum_idx on public.quizzes(curriculum_id, status);

alter table public.curricula enable row level security;
alter table public.curriculum_subjects enable row level security;
alter table public.learner_enrollments enable row level security;
alter table public.workspace_settings enable row level security;

revoke all on public.curricula, public.curriculum_subjects, public.learner_enrollments, public.workspace_settings from anon;
grant select on public.curricula, public.curriculum_subjects to authenticated;
grant select, insert, update, delete on public.learner_enrollments, public.workspace_settings to authenticated;
grant all on public.curricula, public.curriculum_subjects, public.learner_enrollments, public.workspace_settings to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

create policy curricula_read on public.curricula for select to authenticated using (true);
create policy curriculum_subjects_read on public.curriculum_subjects for select to authenticated using (true);

create policy learner_enrollments_read on public.learner_enrollments for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_enrollments_insert on public.learner_enrollments for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_enrollments_update on public.learner_enrollments for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_enrollments_delete on public.learner_enrollments for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy workspace_settings_read on public.workspace_settings for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy workspace_settings_insert on public.workspace_settings for insert to authenticated
with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));
create policy workspace_settings_update on public.workspace_settings for update to authenticated
using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'))
with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));
create policy workspace_settings_delete on public.workspace_settings for delete to authenticated
using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));

insert into public.curricula (code, name_ar, name_native, country_code, primary_language, metadata)
values
  ('syrian-national', 'المنهاج السوري', 'المنهاج السوري', 'SY', 'ar', jsonb_build_object('type','national')),
  ('turkiye-meb', 'المنهاج التركي', 'Millî Eğitim Bakanlığı Müfredatı', 'TR', 'tr', jsonb_build_object('type','national','authority','MEB'))
on conflict (code) do nothing;

update public.books b
set curriculum_id = c.id
from public.curricula c
where c.code = 'syrian-national'
  and b.code in ('AR-MATH-G5-2025-2026','AR-LUGATI-G5-T1')
  and b.curriculum_id is null;

update public.quizzes q
set curriculum_id = c.id
from public.curricula c
where c.code = 'syrian-national'
  and q.curriculum_id is null;

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'architecture.schema_policy',
       jsonb_build_object(
         'principles', jsonb_build_array('migration-first','versioned-content','config-over-hardcode','multi-curriculum','multi-learner'),
         'technical_name', 'learning-hub'
       ),
       'Architecture defaults designed to keep the system change-friendly as it grows.'
from public.workspaces w
where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do nothing;
