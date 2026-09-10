-- Canonical pre-program-architecture baseline for a fresh Family Learning Hub database.
--
-- This is a schema-preserving squash of the 28 hosted migrations recorded before
-- 20260823213038_family_learning_hub_program_architecture.sql. The historical
-- version/name markers below preserve provenance without fabricating migration
-- ledger entries. Static catalog/configuration rows are retained because later
-- tracked migrations depend on them. No learner, access-token, attempt, answer,
-- mastery, or reward-progress rows are created.

-- Historical source: 20260823110617_001_core_learning_schema
create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','teacher','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members(user_id);

create table public.learners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null,
  slug text not null,
  grade_level smallint check (grade_level between 1 and 12),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id),
  constraint learners_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create index learners_workspace_idx on public.learners(workspace_id);

create table public.subjects (
  id bigint generated always as identity primary key,
  code text not null unique,
  name_ar text not null,
  name_en text,
  created_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  subject_id bigint not null references public.subjects(id) on delete restrict,
  code text not null unique,
  title text not null,
  grade_level smallint check (grade_level between 1 and 12),
  school_year text,
  language text not null default 'ar',
  pdf_pages integer check (pdf_pages is null or pdf_pages > 0),
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index books_subject_idx on public.books(subject_id);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  unit_label text,
  title text not null,
  pdf_page_start integer,
  pdf_page_end integer,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lessons_page_range check (
    (pdf_page_start is null and pdf_page_end is null)
    or (pdf_page_start is not null and pdf_page_end is not null and pdf_page_start > 0 and pdf_page_end >= pdf_page_start)
  )
);
create index lessons_book_order_idx on public.lessons(book_id, sort_order);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_id bigint not null references public.subjects(id) on delete restrict,
  book_id uuid references public.books(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  slug text not null,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id),
  constraint quizzes_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create index quizzes_workspace_status_idx on public.quizzes(workspace_id, status);
create index quizzes_subject_idx on public.quizzes(subject_id);

create table public.quiz_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  quiz_id uuid not null,
  version_no integer not null check (version_no > 0),
  state text not null default 'draft' check (state in ('draft','published','retired')),
  instructions text,
  settings jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, version_no),
  unique (id, workspace_id),
  foreign key (quiz_id, workspace_id) references public.quizzes(id, workspace_id) on delete cascade
);
create index quiz_versions_quiz_idx on public.quiz_versions(quiz_id, version_no desc);
create index quiz_versions_workspace_state_idx on public.quiz_versions(workspace_id, state);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  quiz_version_id uuid not null,
  position integer not null check (position > 0),
  question_type text not null check (question_type in ('single_choice','multiple_choice','true_false','short_answer','numeric')),
  prompt text not null,
  origin text not null default 'generated' check (origin in ('book_exact','book_adapted','generated')),
  source_page_start integer,
  source_page_end integer,
  source_metadata jsonb not null default '{}'::jsonb,
  points numeric(8,2) not null default 1 check (points >= 0),
  created_at timestamptz not null default now(),
  unique (quiz_version_id, position),
  unique (id, workspace_id),
  foreign key (quiz_version_id, workspace_id) references public.quiz_versions(id, workspace_id) on delete cascade,
  constraint quiz_questions_page_range check (
    (source_page_start is null and source_page_end is null)
    or (source_page_start is not null and source_page_end is not null and source_page_start > 0 and source_page_end >= source_page_start)
  )
);
create index quiz_questions_version_idx on public.quiz_questions(quiz_version_id, position);

create table public.quiz_question_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  question_id uuid not null,
  position integer not null check (position > 0),
  label text,
  content text not null,
  created_at timestamptz not null default now(),
  unique (question_id, position),
  unique (id, workspace_id),
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete cascade
);
create index quiz_question_options_question_idx on public.quiz_question_options(question_id, position);

create table public.quiz_question_answer_keys (
  question_id uuid primary key,
  workspace_id uuid not null,
  correct_answer jsonb not null,
  explanation text,
  grading_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete cascade
);
create index quiz_question_answer_keys_workspace_idx on public.quiz_question_answer_keys(workspace_id);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('image','audio','video','document','other')),
  storage_bucket text,
  storage_path text,
  mime_type text,
  source_book_id uuid references public.books(id) on delete set null,
  source_page integer,
  checksum_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint assets_source_page_positive check (source_page is null or source_page > 0)
);
create index assets_workspace_idx on public.assets(workspace_id, kind);

create table public.quiz_question_assets (
  workspace_id uuid not null,
  question_id uuid not null,
  asset_id uuid not null,
  position integer not null default 1 check (position > 0),
  purpose text not null default 'prompt' check (purpose in ('prompt','reference','feedback')),
  alt_text text,
  primary key (question_id, asset_id),
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete cascade,
  foreign key (asset_id, workspace_id) references public.assets(id, workspace_id) on delete cascade
);
create index quiz_question_assets_question_idx on public.quiz_question_assets(question_id, position);

create table public.quiz_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  quiz_version_id uuid not null,
  status text not null default 'assigned' check (status in ('assigned','completed','cancelled')),
  available_at timestamptz,
  due_at timestamptz,
  max_attempts integer check (max_attempts is null or max_attempts > 0),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (quiz_version_id, workspace_id) references public.quiz_versions(id, workspace_id) on delete cascade,
  constraint quiz_assignments_dates check (due_at is null or available_at is null or due_at >= available_at)
);
create index quiz_assignments_learner_idx on public.quiz_assignments(workspace_id, learner_id, status);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  quiz_version_id uuid not null,
  assignment_id uuid references public.quiz_assignments(id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','abandoned')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score_points numeric(10,2),
  max_points numeric(10,2),
  percentage numeric(6,2),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb,
  unique (id, workspace_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (quiz_version_id, workspace_id) references public.quiz_versions(id, workspace_id) on delete restrict,
  constraint quiz_attempts_score_values check (
    (score_points is null or score_points >= 0)
    and (max_points is null or max_points >= 0)
    and (percentage is null or (percentage >= 0 and percentage <= 100))
  )
);
create index quiz_attempts_learner_started_idx on public.quiz_attempts(workspace_id, learner_id, started_at desc);
create index quiz_attempts_version_idx on public.quiz_attempts(quiz_version_id, submitted_at desc);

create table public.quiz_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  attempt_id uuid not null,
  question_id uuid not null,
  response jsonb not null default '{}'::jsonb,
  evaluation text not null default 'ungraded' check (evaluation in ('ungraded','correct','incorrect','partial')),
  is_correct boolean,
  points_awarded numeric(8,2) check (points_awarded is null or points_awarded >= 0),
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id),
  foreign key (attempt_id, workspace_id) references public.quiz_attempts(id, workspace_id) on delete cascade,
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete restrict
);
create index quiz_attempt_answers_attempt_idx on public.quiz_attempt_answers(attempt_id);

create table public.learner_access_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  token_hash text not null unique,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade
);
create index learner_access_tokens_learner_idx on public.learner_access_tokens(workspace_id, learner_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger set_learners_updated_at before update on public.learners for each row execute function public.set_updated_at();
create trigger set_books_updated_at before update on public.books for each row execute function public.set_updated_at();
create trigger set_lessons_updated_at before update on public.lessons for each row execute function public.set_updated_at();
create trigger set_quizzes_updated_at before update on public.quizzes for each row execute function public.set_updated_at();
create trigger set_quiz_versions_updated_at before update on public.quiz_versions for each row execute function public.set_updated_at();
create trigger set_quiz_question_answer_keys_updated_at before update on public.quiz_question_answer_keys for each row execute function public.set_updated_at();

create or replace function private.workspace_role(p_workspace_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id
  limit 1
$$;

grant execute on function private.workspace_role(uuid, uuid) to authenticated;

create or replace function private.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id
  )
$$;

grant execute on function private.is_workspace_member(uuid, uuid) to authenticated;

create or replace function private.can_manage_learning(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.workspace_role(p_workspace_id, p_user_id) in ('owner','admin','teacher'), false)
$$;

grant execute on function private.can_manage_learning(uuid, uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.learners enable row level security;
alter table public.subjects enable row level security;
alter table public.books enable row level security;
alter table public.lessons enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_versions enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_question_options enable row level security;
alter table public.quiz_question_answer_keys enable row level security;
alter table public.assets enable row level security;
alter table public.quiz_question_assets enable row level security;
alter table public.quiz_assignments enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempt_answers enable row level security;
alter table public.learner_access_tokens enable row level security;

revoke all on all tables in schema public from anon;
revoke all on public.quiz_question_answer_keys, public.learner_access_tokens from authenticated;

grant select on public.subjects, public.books, public.lessons to authenticated;
grant select, insert, update, delete on public.workspaces, public.workspace_members, public.learners, public.quizzes, public.quiz_versions, public.quiz_questions, public.quiz_question_options, public.assets, public.quiz_question_assets, public.quiz_assignments, public.quiz_attempts, public.quiz_attempt_answers to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create policy subjects_read on public.subjects for select to authenticated using (true);
create policy books_read on public.books for select to authenticated using (true);
create policy lessons_read on public.lessons for select to authenticated using (true);

create policy workspaces_read on public.workspaces for select to authenticated
using (private.is_workspace_member(id, (select auth.uid())));
create policy workspaces_update on public.workspaces for update to authenticated
using (private.workspace_role(id, (select auth.uid())) in ('owner','admin'))
with check (private.workspace_role(id, (select auth.uid())) in ('owner','admin'));

create policy workspace_members_read on public.workspace_members for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy workspace_members_insert on public.workspace_members for insert to authenticated
with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));
create policy workspace_members_update on public.workspace_members for update to authenticated
using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'))
with check (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));
create policy workspace_members_delete on public.workspace_members for delete to authenticated
using (private.workspace_role(workspace_id, (select auth.uid())) in ('owner','admin'));

create policy learners_read on public.learners for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learners_manage on public.learners for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quizzes_read on public.quizzes for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quizzes_manage on public.quizzes for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_versions_read on public.quiz_versions for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_versions_manage on public.quiz_versions for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_questions_read on public.quiz_questions for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_questions_manage on public.quiz_questions for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_question_options_read on public.quiz_question_options for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_question_options_manage on public.quiz_question_options for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy assets_read on public.assets for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy assets_manage on public.assets for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_question_assets_read on public.quiz_question_assets for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_question_assets_manage on public.quiz_question_assets for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_assignments_read on public.quiz_assignments for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_assignments_manage on public.quiz_assignments for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_attempts_read on public.quiz_attempts for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_attempts_manage on public.quiz_attempts for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_attempt_answers_read on public.quiz_attempt_answers for select to authenticated
using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_attempt_answers_manage on public.quiz_attempt_answers for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

insert into public.subjects (code, name_ar, name_en) values
  ('math', 'الرياضيات', 'Mathematics'),
  ('arabic', 'اللغة العربية', 'Arabic')
on conflict (code) do nothing;

-- The workspace UUID is part of the historical platform identity: tracked
-- functions and the approved paper-exam migration reference this same tenant.
insert into public.workspaces (id, name, slug)
values ('55f9224c-8ba7-4cbc-9f88-713e6a6b41df', 'Ayaa School', 'ayaa-school')
on conflict (slug) do nothing;

insert into public.books (subject_id, code, title, grade_level, school_year, language, pdf_pages, source_metadata)
select s.id, 'AR-MATH-G5-2025-2026', 'الرياضيات - كتاب التلميذ - الصف الخامس', 5, '2025-2026', 'ar', 172,
       jsonb_build_object('math_source_of_truth','visual','visual_book_title','AR-MATH-G5 Visual Book FINAL 172p','visual_book_url','https://docs.google.com/presentation/d/1PME0ZGehmyYijehg0QumvubgENdXkU0-35Cnl-l17B8/edit')
from public.subjects s where s.code = 'math'
on conflict (code) do nothing;

insert into public.books (subject_id, code, title, grade_level, school_year, language, pdf_pages, source_metadata)
select s.id, 'AR-LUGATI-G5-T1', 'لغتي - الصف الخامس الأساسي - الفصل الأول', 5, '2025-2026', 'ar', 108,
       jsonb_build_object('visual_book_title','AR-LUGATI-G5-T1 Visual Book FINAL 108p','visual_book_url','https://docs.google.com/presentation/d/1kSog-BQN8gS2frfPG-hCqgPuzppekpZeq7vXnZ7frxI/edit')
from public.subjects s where s.code = 'arabic'
on conflict (code) do nothing;

-- Historical source: 20260823110658_002_security_and_index_hardening
-- Manager-only access for sensitive tables while keeping them hidden from ordinary authenticated users.
grant select, insert, update, delete on public.quiz_question_answer_keys, public.learner_access_tokens to authenticated;

create policy answer_keys_manage on public.quiz_question_answer_keys
for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy learner_access_tokens_manage on public.learner_access_tokens
for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

-- Replace overlapping ALL+SELECT policies with write-only manager policies.
drop policy if exists learners_manage on public.learners;
create policy learners_insert on public.learners for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learners_update on public.learners for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learners_delete on public.learners for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quizzes_manage on public.quizzes;
create policy quizzes_insert on public.quizzes for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quizzes_update on public.quizzes for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quizzes_delete on public.quizzes for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_versions_manage on public.quiz_versions;
create policy quiz_versions_insert on public.quiz_versions for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_versions_update on public.quiz_versions for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_versions_delete on public.quiz_versions for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_questions_manage on public.quiz_questions;
create policy quiz_questions_insert on public.quiz_questions for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_questions_update on public.quiz_questions for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_questions_delete on public.quiz_questions for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_question_options_manage on public.quiz_question_options;
create policy quiz_question_options_insert on public.quiz_question_options for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_options_update on public.quiz_question_options for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_options_delete on public.quiz_question_options for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists assets_manage on public.assets;
create policy assets_insert on public.assets for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy assets_update on public.assets for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy assets_delete on public.assets for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_question_assets_manage on public.quiz_question_assets;
create policy quiz_question_assets_insert on public.quiz_question_assets for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_assets_update on public.quiz_question_assets for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_assets_delete on public.quiz_question_assets for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_assignments_manage on public.quiz_assignments;
create policy quiz_assignments_insert on public.quiz_assignments for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_assignments_update on public.quiz_assignments for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_assignments_delete on public.quiz_assignments for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_attempts_manage on public.quiz_attempts;
create policy quiz_attempts_insert on public.quiz_attempts for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempts_update on public.quiz_attempts for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempts_delete on public.quiz_attempts for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_attempt_answers_manage on public.quiz_attempt_answers;
create policy quiz_attempt_answers_insert on public.quiz_attempt_answers for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempt_answers_update on public.quiz_attempt_answers for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempt_answers_delete on public.quiz_attempt_answers for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

-- Cover foreign keys used by joins/deletes and future RLS/analytics queries.
create index if not exists workspaces_created_by_idx on public.workspaces(created_by);
create index if not exists quizzes_book_id_idx on public.quizzes(book_id);
create index if not exists quizzes_lesson_id_idx on public.quizzes(lesson_id);
create index if not exists quizzes_created_by_idx on public.quizzes(created_by);
create index if not exists quiz_versions_created_by_idx on public.quiz_versions(created_by);
create index if not exists quiz_versions_quiz_workspace_idx on public.quiz_versions(quiz_id, workspace_id);
create index if not exists quiz_questions_version_workspace_idx on public.quiz_questions(quiz_version_id, workspace_id);
create index if not exists quiz_question_options_question_workspace_idx on public.quiz_question_options(question_id, workspace_id);
create index if not exists quiz_question_answer_keys_question_workspace_idx on public.quiz_question_answer_keys(question_id, workspace_id);
create index if not exists assets_source_book_idx on public.assets(source_book_id);
create index if not exists quiz_question_assets_asset_workspace_idx on public.quiz_question_assets(asset_id, workspace_id);
create index if not exists quiz_question_assets_question_workspace_idx on public.quiz_question_assets(question_id, workspace_id);
create index if not exists quiz_assignments_assigned_by_idx on public.quiz_assignments(assigned_by);
create index if not exists quiz_assignments_learner_workspace_idx on public.quiz_assignments(learner_id, workspace_id);
create index if not exists quiz_assignments_version_workspace_idx on public.quiz_assignments(quiz_version_id, workspace_id);
create index if not exists quiz_attempts_assignment_idx on public.quiz_attempts(assignment_id);
create index if not exists quiz_attempts_learner_workspace_idx on public.quiz_attempts(learner_id, workspace_id);
create index if not exists quiz_attempts_version_workspace_idx on public.quiz_attempts(quiz_version_id, workspace_id);
create index if not exists quiz_attempt_answers_attempt_workspace_idx on public.quiz_attempt_answers(attempt_id, workspace_id);
create index if not exists quiz_attempt_answers_question_workspace_idx on public.quiz_attempt_answers(question_id, workspace_id);
create index if not exists learner_access_tokens_learner_workspace_idx on public.learner_access_tokens(learner_id, workspace_id);

-- Historical source: 20260823114524_003_curricula_and_config_layer
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

-- Historical source: 20260823115419_004_adaptive_learning_engine
create table public.units (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  slug text not null,
  title text not null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, slug),
  constraint units_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create index units_book_order_idx on public.units(book_id, sort_order);
create trigger set_units_updated_at before update on public.units for each row execute function public.set_updated_at();

alter table public.lessons add column unit_id uuid references public.units(id) on delete set null;
create index lessons_unit_idx on public.lessons(unit_id, sort_order);

alter table public.quizzes add column unit_id uuid references public.units(id) on delete set null;
alter table public.quizzes add column quiz_kind text not null default 'practice' check (quiz_kind in ('unit','lesson','practice','review','adaptive'));
create index quizzes_unit_kind_idx on public.quizzes(unit_id, quiz_kind, status);

create table public.learning_concepts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_id bigint not null references public.subjects(id) on delete restrict,
  curriculum_id uuid references public.curricula(id) on delete set null,
  parent_concept_id uuid references public.learning_concepts(id) on delete set null,
  code text not null,
  title text not null,
  description text,
  grade_level smallint check (grade_level between 1 and 12),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code),
  unique (id, workspace_id),
  constraint learning_concepts_code_format check (code = lower(code) and code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create index learning_concepts_workspace_subject_idx on public.learning_concepts(workspace_id, subject_id, grade_level);
create index learning_concepts_parent_idx on public.learning_concepts(parent_concept_id);
create trigger set_learning_concepts_updated_at before update on public.learning_concepts for each row execute function public.set_updated_at();

create table public.question_families (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null,
  subject_id bigint not null references public.subjects(id) on delete restrict,
  curriculum_id uuid references public.curricula(id) on delete set null,
  code text not null,
  title text not null,
  grade_level smallint check (grade_level between 1 and 12),
  default_difficulty smallint not null default 3 check (default_difficulty between 1 and 5),
  generation_spec jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code),
  unique (id, workspace_id),
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  constraint question_families_code_format check (code = lower(code) and code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create index question_families_concept_idx on public.question_families(concept_id, default_difficulty);
create trigger set_question_families_updated_at before update on public.question_families for each row execute function public.set_updated_at();

alter table public.quiz_questions add column question_family_id uuid;
alter table public.quiz_questions add column difficulty_level smallint not null default 3 check (difficulty_level between 1 and 5);
alter table public.quiz_questions add column max_attempts smallint not null default 4 check (max_attempts between 1 and 10);
alter table public.quiz_questions add column remediation_after_attempt smallint not null default 3 check (remediation_after_attempt between 1 and 10);
alter table public.quiz_questions add column adaptive_enabled boolean not null default true;
alter table public.quiz_questions add column delivery_role text not null default 'core' check (delivery_role in ('core','remediation_pool','challenge_pool'));
alter table public.quiz_questions add constraint quiz_questions_family_workspace_fkey foreign key (question_family_id, workspace_id) references public.question_families(id, workspace_id) on delete set null;
alter table public.quiz_questions add constraint quiz_questions_remediation_attempt_check check (remediation_after_attempt <= max_attempts);
create index quiz_questions_family_difficulty_idx on public.quiz_questions(question_family_id, difficulty_level, delivery_role);

create table public.quiz_question_concepts (
  workspace_id uuid not null,
  question_id uuid not null,
  concept_id uuid not null,
  is_primary boolean not null default false,
  weight numeric(5,2) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  primary key (question_id, concept_id),
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete cascade,
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade
);
create index quiz_question_concepts_concept_idx on public.quiz_question_concepts(concept_id, is_primary);

create table public.quiz_question_hints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  question_id uuid not null,
  hint_level smallint not null check (hint_level between 1 and 4),
  pedagogical_role text not null check (pedagogical_role in ('nudge','guide','strong_guide','near_solution')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (question_id, hint_level),
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete cascade
);
create index quiz_question_hints_question_idx on public.quiz_question_hints(question_id, hint_level);

alter table public.quiz_question_answer_keys add column correct_explanation text;
alter table public.quiz_question_answer_keys add column final_incorrect_explanation text;

create table public.quiz_answer_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  quiz_attempt_id uuid not null,
  question_id uuid not null,
  attempt_no smallint not null check (attempt_no between 1 and 10),
  response jsonb not null default '{}'::jsonb,
  is_correct boolean not null,
  feedback_text text,
  hint_level_shown smallint check (hint_level_shown between 1 and 4),
  score_fraction numeric(5,4) not null default 0 check (score_fraction between 0 and 1),
  response_time_seconds integer check (response_time_seconds is null or response_time_seconds >= 0),
  created_at timestamptz not null default now(),
  unique (quiz_attempt_id, question_id, attempt_no),
  foreign key (quiz_attempt_id, workspace_id) references public.quiz_attempts(id, workspace_id) on delete cascade,
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete restrict
);
create index quiz_answer_attempts_attempt_question_idx on public.quiz_answer_attempts(quiz_attempt_id, question_id, attempt_no);
create index quiz_answer_attempts_workspace_created_idx on public.quiz_answer_attempts(workspace_id, created_at desc);

alter table public.quiz_attempt_answers add column attempts_used smallint not null default 1 check (attempts_used between 1 and 10);
alter table public.quiz_attempt_answers add column hints_used smallint not null default 0 check (hints_used between 0 and 4);
alter table public.quiz_attempt_answers add column first_try_correct boolean;
alter table public.quiz_attempt_answers add column mastery_result text check (mastery_result in ('mastered','needs_practice','not_mastered'));

create table public.quiz_attempt_question_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  quiz_attempt_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  question_id uuid not null,
  source_role text not null default 'core' check (source_role in ('core','remediation','challenge')),
  parent_question_id uuid,
  concept_id uuid,
  difficulty_level smallint not null check (difficulty_level between 1 and 5),
  status text not null default 'pending' check (status in ('pending','active','completed','skipped')),
  selection_reason text,
  created_at timestamptz not null default now(),
  unique (quiz_attempt_id, sequence_no),
  foreign key (quiz_attempt_id, workspace_id) references public.quiz_attempts(id, workspace_id) on delete cascade,
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete restrict,
  foreign key (parent_question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete set null,
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete set null
);
create index quiz_attempt_question_queue_attempt_idx on public.quiz_attempt_question_queue(quiz_attempt_id, sequence_no);
create index quiz_attempt_question_queue_concept_idx on public.quiz_attempt_question_queue(concept_id, difficulty_level, status);

create table public.learner_concept_mastery (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  concept_id uuid not null,
  mastery_score numeric(5,2) not null default 0 check (mastery_score between 0 and 100),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  first_try_correct_count integer not null default 0 check (first_try_correct_count >= 0),
  total_question_count integer not null default 0 check (total_question_count >= 0),
  total_hint_count integer not null default 0 check (total_hint_count >= 0),
  last_difficulty smallint check (last_difficulty between 1 and 5),
  last_assessed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, concept_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade
);
create index learner_concept_mastery_learner_idx on public.learner_concept_mastery(workspace_id, learner_id, mastery_score);
create index learner_concept_mastery_concept_idx on public.learner_concept_mastery(concept_id, mastery_score);
create trigger set_learner_concept_mastery_updated_at before update on public.learner_concept_mastery for each row execute function public.set_updated_at();

create table public.adaptive_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quiz_attempt_id uuid,
  learner_id uuid,
  concept_id uuid,
  event_type text not null check (event_type in ('hint_served','remediation_triggered','remediation_selected','challenge_selected','concept_mastery_updated','question_completed')),
  reason text,
  input_state jsonb not null default '{}'::jsonb,
  output_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (quiz_attempt_id, workspace_id) references public.quiz_attempts(id, workspace_id) on delete cascade,
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete set null
);
create index adaptive_events_attempt_idx on public.adaptive_events(quiz_attempt_id, created_at);
create index adaptive_events_learner_idx on public.adaptive_events(workspace_id, learner_id, created_at desc);

alter table public.units enable row level security;
alter table public.learning_concepts enable row level security;
alter table public.question_families enable row level security;
alter table public.quiz_question_concepts enable row level security;
alter table public.quiz_question_hints enable row level security;
alter table public.quiz_answer_attempts enable row level security;
alter table public.quiz_attempt_question_queue enable row level security;
alter table public.learner_concept_mastery enable row level security;
alter table public.adaptive_events enable row level security;

revoke all on public.units, public.learning_concepts, public.question_families, public.quiz_question_concepts, public.quiz_question_hints, public.quiz_answer_attempts, public.quiz_attempt_question_queue, public.learner_concept_mastery, public.adaptive_events from anon;
grant select on public.units to authenticated;
grant select, insert, update, delete on public.learning_concepts, public.question_families, public.quiz_question_concepts, public.quiz_question_hints, public.quiz_answer_attempts, public.quiz_attempt_question_queue, public.learner_concept_mastery, public.adaptive_events to authenticated;
grant all on public.units, public.learning_concepts, public.question_families, public.quiz_question_concepts, public.quiz_question_hints, public.quiz_answer_attempts, public.quiz_attempt_question_queue, public.learner_concept_mastery, public.adaptive_events to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

create policy units_read on public.units for select to authenticated using (true);

create policy learning_concepts_read on public.learning_concepts for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learning_concepts_insert on public.learning_concepts for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learning_concepts_update on public.learning_concepts for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learning_concepts_delete on public.learning_concepts for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy question_families_read on public.question_families for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy question_families_insert on public.question_families for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy question_families_update on public.question_families for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy question_families_delete on public.question_families for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_question_concepts_read on public.quiz_question_concepts for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_question_concepts_insert on public.quiz_question_concepts for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_concepts_update on public.quiz_question_concepts for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_concepts_delete on public.quiz_question_concepts for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_question_hints_read on public.quiz_question_hints for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_question_hints_insert on public.quiz_question_hints for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_hints_update on public.quiz_question_hints for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_hints_delete on public.quiz_question_hints for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_answer_attempts_read on public.quiz_answer_attempts for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_answer_attempts_insert on public.quiz_answer_attempts for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_answer_attempts_update on public.quiz_answer_attempts for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_answer_attempts_delete on public.quiz_answer_attempts for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy quiz_attempt_question_queue_read on public.quiz_attempt_question_queue for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy quiz_attempt_question_queue_insert on public.quiz_attempt_question_queue for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempt_question_queue_update on public.quiz_attempt_question_queue for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempt_question_queue_delete on public.quiz_attempt_question_queue for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy learner_concept_mastery_read on public.learner_concept_mastery for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_concept_mastery_insert on public.learner_concept_mastery for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_concept_mastery_update on public.learner_concept_mastery for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_concept_mastery_delete on public.learner_concept_mastery for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy adaptive_events_read on public.adaptive_events for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy adaptive_events_insert on public.adaptive_events for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy adaptive_events_update on public.adaptive_events for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy adaptive_events_delete on public.adaptive_events for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create index learner_enrollments_learner_workspace_fk_idx on public.learner_enrollments(learner_id, workspace_id);

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'quiz.adaptive_defaults',
       jsonb_build_object(
         'multiple_choice_options', 5,
         'max_attempts', 4,
         'hint_levels', 4,
         'hint_roles', jsonb_build_array('nudge','guide','strong_guide','near_solution'),
         'score_by_attempt', jsonb_build_array(1.0,0.75,0.50,0.25),
         'failed_after_max_attempts_score', 0,
         'remediation_trigger_attempt', 3,
         'remediation_same_concept', true,
         'remediation_same_difficulty', true,
         'use_pre_generated_variant_pool', true,
         'live_generation_enabled', false
       ),
       'Default adaptive quiz behavior; configurable without changing application code.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

-- Historical source: 20260823115503_005_adaptive_learning_indexes
create index if not exists adaptive_events_attempt_workspace_fk_idx on public.adaptive_events(quiz_attempt_id, workspace_id);
create index if not exists adaptive_events_learner_workspace_fk_idx on public.adaptive_events(learner_id, workspace_id);
create index if not exists adaptive_events_concept_workspace_fk_idx on public.adaptive_events(concept_id, workspace_id);
create index if not exists learner_concept_mastery_learner_workspace_fk_idx on public.learner_concept_mastery(learner_id, workspace_id);
create index if not exists learner_concept_mastery_concept_workspace_fk_idx on public.learner_concept_mastery(concept_id, workspace_id);
create index if not exists learning_concepts_subject_fk_idx on public.learning_concepts(subject_id);
create index if not exists learning_concepts_curriculum_fk_idx on public.learning_concepts(curriculum_id);
create index if not exists question_families_concept_workspace_fk_idx on public.question_families(concept_id, workspace_id);
create index if not exists question_families_subject_fk_idx on public.question_families(subject_id);
create index if not exists question_families_curriculum_fk_idx on public.question_families(curriculum_id);
create index if not exists quiz_answer_attempts_quiz_attempt_workspace_fk_idx on public.quiz_answer_attempts(quiz_attempt_id, workspace_id);
create index if not exists quiz_answer_attempts_question_workspace_fk_idx on public.quiz_answer_attempts(question_id, workspace_id);
create index if not exists quiz_attempt_question_queue_attempt_workspace_fk_idx on public.quiz_attempt_question_queue(quiz_attempt_id, workspace_id);
create index if not exists quiz_attempt_question_queue_question_workspace_fk_idx on public.quiz_attempt_question_queue(question_id, workspace_id);
create index if not exists quiz_attempt_question_queue_parent_workspace_fk_idx on public.quiz_attempt_question_queue(parent_question_id, workspace_id);
create index if not exists quiz_attempt_question_queue_concept_workspace_fk_idx on public.quiz_attempt_question_queue(concept_id, workspace_id);
create index if not exists quiz_question_concepts_question_workspace_fk_idx on public.quiz_question_concepts(question_id, workspace_id);
create index if not exists quiz_question_concepts_concept_workspace_fk_idx on public.quiz_question_concepts(concept_id, workspace_id);
create index if not exists quiz_question_hints_question_workspace_fk_idx on public.quiz_question_hints(question_id, workspace_id);
create index if not exists quiz_questions_family_workspace_fk_idx on public.quiz_questions(question_family_id, workspace_id);

-- Historical source: 20260823120202_006_pedagogy_feedback_engine
create table public.learner_instruction_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  primary_language text not null default 'ar',
  secondary_languages text[] not null default '{}'::text[],
  explanation_depth text not null default 'guided' check (explanation_depth in ('brief','standard','guided','deep')),
  support_tone text not null default 'encouraging' check (support_tone in ('encouraging','calm','playful','challenge')),
  visual_support text not null default 'auto' check (visual_support in ('auto','prefer_visual','prefer_text')),
  reading_level_override smallint check (reading_level_override between 1 and 12),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id),
  unique (id, workspace_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade
);
create index learner_instruction_profiles_learner_workspace_idx on public.learner_instruction_profiles(learner_id, workspace_id);
create trigger set_learner_instruction_profiles_updated_at before update on public.learner_instruction_profiles for each row execute function public.set_updated_at();

create table public.feedback_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_kind text not null check (event_kind in ('correct','incorrect','retry','hint','remediation_intro','remediation_success','mastery','encouragement')),
  attempt_no smallint check (attempt_no between 1 and 10),
  min_grade smallint check (min_grade between 1 and 12),
  max_grade smallint check (max_grade between 1 and 12),
  tone text not null default 'encouraging' check (tone in ('encouraging','calm','playful','challenge')),
  language text not null default 'ar',
  template_text text not null,
  status text not null default 'active' check (status in ('draft','active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, event_kind, attempt_no, min_grade, max_grade, tone, language, template_text),
  constraint feedback_templates_grade_range check (max_grade is null or min_grade is null or max_grade >= min_grade)
);
create index feedback_templates_lookup_idx on public.feedback_templates(workspace_id, event_kind, attempt_no, language, status);
create trigger set_feedback_templates_updated_at before update on public.feedback_templates for each row execute function public.set_updated_at();

create table public.explanation_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  question_id uuid,
  concept_id uuid,
  trigger_kind text not null check (trigger_kind in ('incorrect_attempt','correct_answer','max_attempts_reached','remediation_intro','remediation_success','concept_review')),
  min_attempt_no smallint check (min_attempt_no between 1 and 10),
  max_attempt_no smallint check (max_attempt_no between 1 and 10),
  min_grade smallint check (min_grade between 1 and 12),
  max_grade smallint check (max_grade between 1 and 12),
  min_difficulty smallint check (min_difficulty between 1 and 5),
  max_difficulty smallint check (max_difficulty between 1 and 5),
  language text not null default 'ar',
  title text,
  status text not null default 'active' check (status in ('draft','active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete cascade,
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  constraint explanation_sets_target_required check (question_id is not null or concept_id is not null),
  constraint explanation_sets_attempt_range check (max_attempt_no is null or min_attempt_no is null or max_attempt_no >= min_attempt_no),
  constraint explanation_sets_grade_range check (max_grade is null or min_grade is null or max_grade >= min_grade),
  constraint explanation_sets_difficulty_range check (max_difficulty is null or min_difficulty is null or max_difficulty >= min_difficulty)
);
create index explanation_sets_question_lookup_idx on public.explanation_sets(question_id, trigger_kind, min_attempt_no, status);
create index explanation_sets_concept_lookup_idx on public.explanation_sets(concept_id, trigger_kind, min_attempt_no, status);
create index explanation_sets_question_workspace_fk_idx on public.explanation_sets(question_id, workspace_id);
create index explanation_sets_concept_workspace_fk_idx on public.explanation_sets(concept_id, workspace_id);
create trigger set_explanation_sets_updated_at before update on public.explanation_sets for each row execute function public.set_updated_at();

create table public.explanation_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  explanation_set_id uuid not null,
  position integer not null check (position > 0),
  block_type text not null check (block_type in ('text','image','math','steps','example','diagram','audio','video','interactive')),
  content jsonb not null default '{}'::jsonb,
  asset_id uuid,
  is_optional boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (explanation_set_id, position),
  foreign key (explanation_set_id, workspace_id) references public.explanation_sets(id, workspace_id) on delete cascade,
  foreign key (asset_id, workspace_id) references public.assets(id, workspace_id) on delete set null
);
create index explanation_blocks_set_idx on public.explanation_blocks(explanation_set_id, position);
create index explanation_blocks_set_workspace_fk_idx on public.explanation_blocks(explanation_set_id, workspace_id);
create index explanation_blocks_asset_workspace_fk_idx on public.explanation_blocks(asset_id, workspace_id);

alter table public.quiz_answer_attempts add column feedback_template_id uuid references public.feedback_templates(id) on delete set null;
alter table public.quiz_answer_attempts add column explanation_set_id uuid references public.explanation_sets(id) on delete set null;
alter table public.quiz_answer_attempts add column support_modalities text[] not null default '{}'::text[];
create index quiz_answer_attempts_feedback_template_idx on public.quiz_answer_attempts(feedback_template_id);
create index quiz_answer_attempts_explanation_set_idx on public.quiz_answer_attempts(explanation_set_id);

alter table public.adaptive_events drop constraint if exists adaptive_events_event_type_check;
alter table public.adaptive_events add constraint adaptive_events_event_type_check check (event_type in ('hint_served','remediation_triggered','remediation_selected','challenge_selected','concept_mastery_updated','question_completed','feedback_served','explanation_served','media_opened'));

alter table public.learner_instruction_profiles enable row level security;
alter table public.feedback_templates enable row level security;
alter table public.explanation_sets enable row level security;
alter table public.explanation_blocks enable row level security;

revoke all on public.learner_instruction_profiles, public.feedback_templates, public.explanation_sets, public.explanation_blocks from anon;
grant select, insert, update, delete on public.learner_instruction_profiles, public.feedback_templates, public.explanation_sets, public.explanation_blocks to authenticated;
grant all on public.learner_instruction_profiles, public.feedback_templates, public.explanation_sets, public.explanation_blocks to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

create policy learner_instruction_profiles_read on public.learner_instruction_profiles for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_instruction_profiles_insert on public.learner_instruction_profiles for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_instruction_profiles_update on public.learner_instruction_profiles for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_instruction_profiles_delete on public.learner_instruction_profiles for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy feedback_templates_read on public.feedback_templates for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy feedback_templates_insert on public.feedback_templates for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy feedback_templates_update on public.feedback_templates for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy feedback_templates_delete on public.feedback_templates for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy explanation_sets_read on public.explanation_sets for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy explanation_sets_insert on public.explanation_sets for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_sets_update on public.explanation_sets for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_sets_delete on public.explanation_sets for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy explanation_blocks_read on public.explanation_blocks for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy explanation_blocks_insert on public.explanation_blocks for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_blocks_update on public.explanation_blocks for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_blocks_delete on public.explanation_blocks for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'pedagogy.feedback_policy',
       jsonb_build_object(
         'tone','encouraging',
         'adapt_to_grade',true,
         'adapt_to_attempt',true,
         'adapt_to_difficulty',true,
         'adapt_to_response_pattern',true,
         'avoid_shaming_language',true,
         'avoid_failure_labels',true,
         'celebrate_strategy_not_only_score',true,
         'correct_feedback_includes_why',true,
         'incorrect_feedback_includes_next_step',true,
         'max_hint_levels',4
       ),
       'Supportive, age-appropriate feedback policy for learners.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'pedagogy.explanation_modalities',
       jsonb_build_object(
         'allowed',jsonb_build_array('text','image','math','steps','example','diagram','audio','video','interactive'),
         'prefer_multimodal_after_repeated_error',true,
         'visual_source_priority','book_original_when_available',
         'math_visual_authoritative',true,
         'allow_multiple_blocks_per_explanation',true
       ),
       'Multimodal explanation policy; explanations can combine several blocks and book-sourced visuals.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.feedback_templates (workspace_id, event_kind, attempt_no, min_grade, max_grade, tone, language, template_text)
select w.id, x.event_kind, x.attempt_no, 1, 6, 'encouraging', 'ar', x.template_text
from public.workspaces w
cross join (values
  ('correct',1,'ممتاز! وصلت للفكرة من أول محاولة. شوف لماذا إجابتك صحيحة 👏'),
  ('incorrect',1,'قريب! خلّينا نجرّب خطوة صغيرة تساعدك تلاحظ الفكرة.'),
  ('incorrect',2,'محاولة جيدة. هذه المرة سأعطيك تلميحًا أوضح ونحل جزءًا من الفكرة معًا.'),
  ('incorrect',3,'أنت عم تتقدم. خلّينا نركّز على الخطوة الأساسية، وبعدها جرّب مرة جديدة.'),
  ('incorrect',4,'خلّينا نشرحها بطريقة مختلفة وبوضوح أكبر، ثم نثبت الفكرة بسؤال مشابه.'),
  ('remediation_intro',null,'ما في مشكلة، خلّينا نثبت نفس الفكرة بسؤال جديد مشابه قبل ما نكمل.'),
  ('remediation_success',null,'رائع! السؤال الجديد بيّن إنك فهمت الفكرة. هلق فينا نكمل بثقة.'),
  ('mastery',null,'أحسنت! صار عندنا أكثر من دليل إنك أتقنت هالفكرة 🌟')
) as x(event_kind, attempt_no, template_text)
where w.slug = 'ayaa-school'
on conflict do nothing;

-- Historical source: 20260823120214_007_pedagogy_indexes
create index if not exists learner_instruction_profiles_workspace_idx on public.learner_instruction_profiles(workspace_id);
create index if not exists feedback_templates_workspace_idx on public.feedback_templates(workspace_id);
create index if not exists explanation_sets_workspace_idx on public.explanation_sets(workspace_id);
create index if not exists explanation_blocks_workspace_idx on public.explanation_blocks(workspace_id);
create index if not exists explanation_blocks_asset_idx on public.explanation_blocks(asset_id);

-- Historical source: 20260823120223_008_pedagogy_feedback_constraints
alter table public.quiz_answer_attempts
  add constraint quiz_answer_attempts_hint_feedback_consistency
  check (hint_level_shown is null or hint_level_shown between 1 and 4);

alter table public.explanation_blocks
  add constraint explanation_blocks_asset_required_for_media
  check (
    block_type not in ('image','audio','video','diagram')
    or asset_id is not null
    or content ? 'url'
  );

-- Historical source: 20260823120318_009_misconception_aware_feedback
create table public.misconceptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null,
  code text not null,
  title text not null,
  description text,
  remediation_strategy text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, concept_id, code),
  unique (id, workspace_id),
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  constraint misconceptions_code_format check (code = lower(code) and code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create index misconceptions_concept_idx on public.misconceptions(concept_id, code);
create index misconceptions_concept_workspace_fk_idx on public.misconceptions(concept_id, workspace_id);
create trigger set_misconceptions_updated_at before update on public.misconceptions for each row execute function public.set_updated_at();

create table public.question_option_misconceptions (
  workspace_id uuid not null,
  option_id uuid not null,
  misconception_id uuid not null,
  confidence numeric(5,4) not null default 1 check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (option_id, misconception_id),
  foreign key (option_id, workspace_id) references public.quiz_question_options(id, workspace_id) on delete cascade,
  foreign key (misconception_id, workspace_id) references public.misconceptions(id, workspace_id) on delete cascade
);
create index question_option_misconceptions_option_workspace_fk_idx on public.question_option_misconceptions(option_id, workspace_id);
create index question_option_misconceptions_misconception_workspace_fk_idx on public.question_option_misconceptions(misconception_id, workspace_id);

alter table public.explanation_sets add column misconception_id uuid;
alter table public.explanation_sets add constraint explanation_sets_misconception_workspace_fkey foreign key (misconception_id, workspace_id) references public.misconceptions(id, workspace_id) on delete set null;
create index explanation_sets_misconception_lookup_idx on public.explanation_sets(misconception_id, trigger_kind, min_attempt_no, status);
create index explanation_sets_misconception_workspace_fk_idx on public.explanation_sets(misconception_id, workspace_id);

alter table public.quiz_answer_attempts add column detected_misconception_id uuid;
alter table public.quiz_answer_attempts add column error_classification jsonb not null default '{}'::jsonb;
alter table public.quiz_answer_attempts add constraint quiz_answer_attempts_misconception_workspace_fkey foreign key (detected_misconception_id, workspace_id) references public.misconceptions(id, workspace_id) on delete set null;
create index quiz_answer_attempts_misconception_idx on public.quiz_answer_attempts(detected_misconception_id);
create index quiz_answer_attempts_misconception_workspace_fk_idx on public.quiz_answer_attempts(detected_misconception_id, workspace_id);

alter table public.adaptive_events drop constraint if exists adaptive_events_event_type_check;
alter table public.adaptive_events add constraint adaptive_events_event_type_check check (event_type in ('hint_served','remediation_triggered','remediation_selected','challenge_selected','concept_mastery_updated','question_completed','feedback_served','explanation_served','media_opened','misconception_detected'));

alter table public.misconceptions enable row level security;
alter table public.question_option_misconceptions enable row level security;
revoke all on public.misconceptions, public.question_option_misconceptions from anon;
grant select, insert, update, delete on public.misconceptions, public.question_option_misconceptions to authenticated;
grant all on public.misconceptions, public.question_option_misconceptions to service_role;

create policy misconceptions_read on public.misconceptions for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy misconceptions_insert on public.misconceptions for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy misconceptions_update on public.misconceptions for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy misconceptions_delete on public.misconceptions for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy question_option_misconceptions_read on public.question_option_misconceptions for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy question_option_misconceptions_insert on public.question_option_misconceptions for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy question_option_misconceptions_update on public.question_option_misconceptions for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy question_option_misconceptions_delete on public.question_option_misconceptions for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'pedagogy.misconception_policy',
       jsonb_build_object(
         'detect_from_multiple_choice_distractors',true,
         'classify_typed_answers_when_possible',true,
         'prefer_misconception_specific_explanation',true,
         'fallback_to_attempt_level_explanation',true,
         'log_detection_for_parent_reporting',true
       ),
       'Use the learner response pattern to select more relevant feedback and explanations.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

-- Historical source: 20260823120621_009_curriculum_language_transition
create table public.curriculum_concept_terms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null,
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  language_code text not null,
  locale_code text,
  grade_level smallint check (grade_level between 1 and 12),
  term text not null,
  short_definition text,
  usage_notes text,
  is_preferred boolean not null default true,
  source_page_start integer,
  source_page_end integer,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','book_verified','teacher_verified')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, concept_id, curriculum_id, language_code, term),
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  constraint curriculum_concept_terms_page_range check (
    (source_page_start is null and source_page_end is null)
    or (source_page_start is not null and source_page_end is not null and source_page_start > 0 and source_page_end >= source_page_start)
  )
);
create index curriculum_concept_terms_lookup_idx on public.curriculum_concept_terms(workspace_id, curriculum_id, language_code, concept_id, is_preferred);
create index curriculum_concept_terms_book_idx on public.curriculum_concept_terms(book_id, source_page_start);
create trigger set_curriculum_concept_terms_updated_at before update on public.curriculum_concept_terms for each row execute function public.set_updated_at();

create table public.concept_crosswalks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_concept_id uuid not null,
  to_concept_id uuid not null,
  from_curriculum_id uuid not null references public.curricula(id) on delete cascade,
  to_curriculum_id uuid not null references public.curricula(id) on delete cascade,
  relationship text not null check (relationship in ('exact_equivalent','near_equivalent','partial_overlap','related','no_direct_equivalent')),
  direction text not null default 'bidirectional' check (direction in ('bidirectional','from_to_only')),
  bridging_note text,
  prerequisite_gaps jsonb not null default '[]'::jsonb,
  teaching_strategy jsonb not null default '{}'::jsonb,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','book_verified','teacher_verified')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, from_concept_id, to_concept_id, from_curriculum_id, to_curriculum_id),
  foreign key (from_concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  foreign key (to_concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  constraint concept_crosswalks_not_self check (from_concept_id <> to_concept_id or from_curriculum_id <> to_curriculum_id)
);
create index concept_crosswalks_from_idx on public.concept_crosswalks(workspace_id, from_curriculum_id, from_concept_id);
create index concept_crosswalks_to_idx on public.concept_crosswalks(workspace_id, to_curriculum_id, to_concept_id);
create trigger set_concept_crosswalks_updated_at before update on public.concept_crosswalks for each row execute function public.set_updated_at();

create table public.learner_transition_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  from_curriculum_id uuid not null references public.curricula(id) on delete restrict,
  to_curriculum_id uuid not null references public.curricula(id) on delete restrict,
  target_school_year text,
  status text not null default 'planned' check (status in ('planned','preparing','active_transition','completed','paused')),
  primary_instruction_language text not null default 'ar',
  bridge_language text,
  display_mode text not null default 'dual_term' check (display_mode in ('source_only','dual_term','target_first_with_source_hint','target_only')),
  preparation_intensity smallint not null default 2 check (preparation_intensity between 1 and 5),
  settings jsonb not null default '{}'::jsonb,
  started_at date,
  target_transition_date date,
  completed_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, learner_id, from_curriculum_id, to_curriculum_id, target_school_year),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  constraint learner_transition_curricula_different check (from_curriculum_id <> to_curriculum_id),
  constraint learner_transition_dates check (target_transition_date is null or started_at is null or target_transition_date >= started_at)
);
create index learner_transition_plans_learner_idx on public.learner_transition_plans(workspace_id, learner_id, status);
create index learner_transition_plans_curricula_idx on public.learner_transition_plans(from_curriculum_id, to_curriculum_id, status);
create trigger set_learner_transition_plans_updated_at before update on public.learner_transition_plans for each row execute function public.set_updated_at();

create table public.learner_term_exposures (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  learner_id uuid not null,
  concept_id uuid not null,
  term_id uuid not null references public.curriculum_concept_terms(id) on delete cascade,
  quiz_attempt_id uuid,
  exposure_type text not null check (exposure_type in ('question','hint','explanation','review','glossary')),
  was_primary_label boolean not null default false,
  understood_after_exposure boolean,
  created_at timestamptz not null default now(),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  foreign key (quiz_attempt_id, workspace_id) references public.quiz_attempts(id, workspace_id) on delete set null
);
create index learner_term_exposures_learner_idx on public.learner_term_exposures(workspace_id, learner_id, created_at desc);
create index learner_term_exposures_term_idx on public.learner_term_exposures(term_id, created_at desc);

alter table public.curriculum_concept_terms enable row level security;
alter table public.concept_crosswalks enable row level security;
alter table public.learner_transition_plans enable row level security;
alter table public.learner_term_exposures enable row level security;

revoke all on public.curriculum_concept_terms, public.concept_crosswalks, public.learner_transition_plans, public.learner_term_exposures from anon;
grant select, insert, update, delete on public.curriculum_concept_terms, public.concept_crosswalks, public.learner_transition_plans, public.learner_term_exposures to authenticated;
grant all on public.curriculum_concept_terms, public.concept_crosswalks, public.learner_transition_plans, public.learner_term_exposures to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create policy curriculum_concept_terms_read on public.curriculum_concept_terms for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy curriculum_concept_terms_insert on public.curriculum_concept_terms for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy curriculum_concept_terms_update on public.curriculum_concept_terms for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy curriculum_concept_terms_delete on public.curriculum_concept_terms for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy concept_crosswalks_read on public.concept_crosswalks for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy concept_crosswalks_insert on public.concept_crosswalks for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy concept_crosswalks_update on public.concept_crosswalks for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy concept_crosswalks_delete on public.concept_crosswalks for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy learner_transition_plans_read on public.learner_transition_plans for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_transition_plans_insert on public.learner_transition_plans for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_transition_plans_update on public.learner_transition_plans for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_transition_plans_delete on public.learner_transition_plans for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy learner_term_exposures_read on public.learner_term_exposures for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_term_exposures_insert on public.learner_term_exposures for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_term_exposures_update on public.learner_term_exposures for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_term_exposures_delete on public.learner_term_exposures for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'transition.curriculum_language_policy',
       jsonb_build_object(
         'principle', 'concept_first_term_curriculum_specific',
         'never_assume_literal_translation', true,
         'require_source_verification_for_preferred_terms', true,
         'current_year_default_mode', 'dual_term',
         'target_year_default_mode', 'target_first_with_source_hint',
         'track_term_exposure', true,
         'support_non_equivalent_terms', true,
         'allowed_relationships', jsonb_build_array('exact_equivalent','near_equivalent','partial_overlap','related','no_direct_equivalent')
       ),
       'Policy for transitioning learners between curricula and languages while preserving curriculum-specific terminology.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

-- Historical source: 20260823120714_010_language_delivery_separation
alter table public.quiz_versions add column if not exists question_language text;
alter table public.quiz_versions add column if not exists explanation_language text;
alter table public.quiz_versions add column if not exists terminology_display_mode text check (terminology_display_mode in ('source_only','dual_term','target_first_with_source_hint','target_only'));

alter table public.quiz_questions add column if not exists prompt_language text;
alter table public.quiz_questions add column if not exists terminology_display_mode text check (terminology_display_mode in ('inherit','source_only','dual_term','target_first_with_source_hint','target_only')) default 'inherit';

alter table public.quiz_question_hints add column if not exists language text;
alter table public.quiz_question_hints add column if not exists terminology_display_mode text check (terminology_display_mode in ('inherit','source_only','dual_term','target_first_with_source_hint','target_only')) default 'inherit';

insert into public.learner_instruction_profiles (
  workspace_id, learner_id, primary_language, secondary_languages, explanation_depth, support_tone, visual_support, metadata
)
select l.workspace_id, l.id, 'ar', array['tr']::text[], 'guided', 'encouraging', 'auto',
       jsonb_build_object(
         'curriculum_transition', jsonb_build_object(
           'current_curriculum_language','tr',
           'target_curriculum_language','ar',
           'preferred_explanation_language','ar',
           'preserve_source_terms',true,
           'introduce_target_terms_gradually',true
         )
       )
from public.learners l
join public.workspaces w on w.id = l.workspace_id
where w.slug = 'ayaa-school'
on conflict (learner_id) do update
set primary_language = excluded.primary_language,
    secondary_languages = excluded.secondary_languages,
    metadata = coalesce(public.learner_instruction_profiles.metadata,'{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'delivery.language_separation',
       jsonb_build_object(
         'separate_question_language', true,
         'separate_explanation_language', true,
         'separate_curriculum_term_language', true,
         'default_explanation_language', 'ar',
         'preserve_source_curriculum_terms', true,
         'allow_dual_terminology', true,
         'allow_per_question_override', true,
         'allow_per_hint_override', true
       ),
       'Separates question language, explanation language, and curriculum-specific terminology for bilingual curriculum transition.'
from public.workspaces w where w.slug='ayaa-school'
on conflict (workspace_id, key) do update set value=excluded.value, description=excluded.description, updated_at=now();

-- Historical source: 20260823123334_009_gamification_and_rewards_engine
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

-- Historical source: 20260823123351_010_gamification_indexes
create index if not exists gamification_levels_workspace_fk_idx on public.gamification_levels(workspace_id);
create index if not exists gamification_events_learner_workspace_fk_idx on public.gamification_events(learner_id, workspace_id);
create index if not exists learner_badges_learner_workspace_fk_idx on public.learner_badges(learner_id, workspace_id);
create index if not exists gamification_rewards_image_asset_idx on public.gamification_rewards(image_asset_id);
create index if not exists reward_claims_learner_workspace_fk_idx on public.reward_claims(learner_id, workspace_id);
create index if not exists reward_claims_reviewed_by_idx on public.reward_claims(reviewed_by);

-- Historical source: 20260823123401_011_gamification_reward_integrity
alter table public.reward_claims add constraint reward_claims_reviewed_dates_check check (reviewed_at is null or reviewed_at >= requested_at);
alter table public.reward_claims add constraint reward_claims_redeemed_dates_check check (redeemed_at is null or redeemed_at >= requested_at);

-- Historical source: 20260823123409_012_gamification_level_guard
alter table public.learner_gamification_state add constraint learner_gamification_streak_guard check (longest_streak >= current_streak);

-- Historical source: 20260823123423_013_gamification_seed_badges
insert into public.gamification_badges (workspace_id, code, title, description, icon, criteria)
select w.id, v.code, v.title, v.description, v.icon, v.criteria
from public.workspaces w
cross join (values
  ('first-try', 'من أول محاولة', 'أجاب عن مجموعة من الأسئلة من أول محاولة.', '🎯', jsonb_build_object('signal','first_try_correct')),
  ('keep-going', 'ما استسلمت', 'استمر بالتعلم وأكمل بعد محاولات وتلميحات.', '💪', jsonb_build_object('signal','effort')),
  ('concept-master', 'أتقنت المفهوم', 'وصل إلى إتقان واضح في مفهوم تعليمي.', '🧠', jsonb_build_object('signal','mastery')),
  ('steady-learner', 'استمرارية جميلة', 'حافظ على عادة تعلم منتظمة.', '🔥', jsonb_build_object('signal','consistency'))
) as v(code,title,description,icon,criteria)
where w.slug='ayaa-school'
on conflict (workspace_id, code) do nothing;

-- Historical source: 20260823141315_test_learner_account_policy
insert into public.workspace_settings (workspace_id, key, value, description)
select id, 'testing.learner_account', jsonb_build_object(
  'slug','test',
  'exclude_from_parent_metrics',true,
  'allow_repeat_quiz_testing',true,
  'purpose','QA and UX testing without affecting real learner records'
), 'Rules for the dedicated test learner account.'
from public.workspaces where slug='ayaa-school'
on conflict (workspace_id,key) do update
set value=excluded.value, description=excluded.description, updated_at=now();

-- Historical source: 20260823141328_mark_test_learner_in_reports
update public.learners
set metadata = coalesce(metadata,'{}'::jsonb) || '{"is_test":true,"exclude_from_parent_metrics":true}'::jsonb,
    updated_at = now()
where workspace_id = (select id from public.workspaces where slug='ayaa-school' limit 1)
  and slug='test';

-- Historical source: 20260823141533_repeatable_test_gamification
create or replace function private.is_test_learner(p_learner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((metadata->>'is_test')::boolean, false)
  from public.learners
  where id = p_learner_id
  limit 1;
$$;

create or replace function private.rewrite_test_gamification_source()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.event_type = 'quiz_completed'
     and new.source_type = 'quiz'
     and private.is_test_learner(new.learner_id) then
    new.source_id := coalesce(new.source_id, 'quiz') || ':test:' || gen_random_uuid()::text;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('is_test', true);
  end if;
  return new;
end;
$$;

drop trigger if exists gamification_events_test_source on public.gamification_events;
create trigger gamification_events_test_source
before insert on public.gamification_events
for each row execute function private.rewrite_test_gamification_source();

-- Historical source: 20260823142137_learner_session_tracking
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

-- Historical source: 20260823142302_session_tracking_grants_and_parent_index
create index if not exists learner_learning_sessions_started_idx
  on public.learner_learning_sessions (workspace_id, started_at desc);

comment on table public.learner_learning_sessions is 'Learner active learning visits. Sessions split after inactivity and exclude test learners from parent metrics at query time.';

-- Historical source: 20260823142324_learning_session_settings_update
update public.workspace_settings
set value = jsonb_set(jsonb_set(value,'{heartbeat_seconds}','60'::jsonb,true),'{inactivity_minutes}','10'::jsonb,true), updated_at=now()
where workspace_id='55f9224c-8ba7-4cbc-9f88-713e6a6b41df' and key='tracking.learning_sessions';

-- Historical source: 20260823142337_learning_session_duration_view
create or replace view public.learner_learning_session_report as
select
  s.id,
  s.workspace_id,
  s.learner_id,
  s.entry_type,
  s.started_at,
  s.last_activity_at,
  s.ended_at,
  greatest(0, extract(epoch from (coalesce(s.ended_at,s.last_activity_at)-s.started_at))::int) as effective_duration_seconds,
  s.end_reason,
  s.metadata
from public.learner_learning_sessions s;

-- Historical source: 20260823142357_session_tracking_view_security
revoke all on public.learner_learning_session_report from anon;
grant select on public.learner_learning_session_report to authenticated;

-- Historical source: 20260823142803_remove_session_report_view
drop view if exists public.learner_learning_session_report;

-- Historical source: 20260823150650_quiz_learning_and_exam_modes
alter table public.quizzes add column if not exists delivery_config jsonb not null default '{"learning":{"instant_feedback":true,"hints":true,"retry":true},"exam":{"question_count":10,"instant_feedback":false,"hints":false,"retry":false,"show_results_after_submit":true}}'::jsonb;

alter table public.quiz_attempts add column if not exists delivery_mode text not null default 'learning';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='quiz_attempts_delivery_mode_check') then
    alter table public.quiz_attempts add constraint quiz_attempts_delivery_mode_check check (delivery_mode in ('learning','exam'));
  end if;
end $$;

update public.quizzes set delivery_config = jsonb_build_object(
  'learning', jsonb_build_object('instant_feedback',true,'hints',true,'retry',true,'progressive_hints',true,'remediation',true),
  'exam', jsonb_build_object('question_count',10,'instant_feedback',false,'hints',false,'retry',false,'show_results_after_submit',true,'show_question_review',true)
) where slug='fractions-pages-54-57';

-- Historical source: 20260823150758_exam_mode_attempt_reporting
create index if not exists quiz_attempts_delivery_mode_idx on public.quiz_attempts (workspace_id, learner_id, delivery_mode, submitted_at desc);

-- Historical source: 20260823150830_exam_mode_defaults_setting
insert into public.workspace_settings (workspace_id,key,value)
select id,'quiz.exam_defaults','{"question_count":10,"instant_feedback":false,"hints":false,"retry":false,"show_results_after_submit":true,"show_question_review":true}'::jsonb
from public.workspaces where slug='ayaa-school'
on conflict (workspace_id,key) do update set value=excluded.value;
