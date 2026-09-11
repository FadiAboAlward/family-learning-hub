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
