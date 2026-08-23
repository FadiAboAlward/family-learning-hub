-- Family Learning Hub: program/enrollment architecture, backward compatible

-- 1) Canonical platform identity
update public.workspaces
set name = 'Family Learning Hub', slug = 'family-learning-hub', updated_at = now()
where slug = 'ayaa-school';

insert into public.workspace_settings (workspace_id, key, value, description)
select id,
       'platform_identity',
       jsonb_build_object(
         'platform_name','Family Learning Hub',
         'platform_slug','family-learning-hub',
         'architecture','One shared platform/backend with multiple learner-specific ChatGPT projects or workflows',
         'learner_scope','multiple learners, not limited to Aya or Mohammad',
         'chatgpt_project_name','AI School'
       ),
       'Canonical identity and tenancy model for the shared learning platform.'
from public.workspaces
where slug='family-learning-hub'
on conflict (workspace_id,key) do update
set value=excluded.value, description=excluded.description, updated_at=now();

insert into public.workspace_settings (workspace_id, key, value, description)
select id,
       'architecture.content_and_enrollment_model',
       jsonb_build_object(
         'version',2,
         'catalog_side',jsonb_build_array('curricula','subjects','books/sources','units','lessons','concepts','quizzes'),
         'delivery_side',jsonb_build_array('learning_programs','learner_program_enrollments','quiz_assignments','attempts','mastery'),
         'learner_grade_source_of_truth','program/enrollment context; learners.grade_level is only an optional display/default hint',
         'legacy_curriculum_enrollments','learner_enrollments remains a curriculum-specific compatibility layer',
         'test_preview','test learner may be enrolled in multiple programs and mirrors real learner assignments unless explicitly disabled'
       ),
       'Durable architecture rules separating reusable content catalog from learner-specific enrollment and progress.'
from public.workspaces
where slug='family-learning-hub'
on conflict (workspace_id,key) do update
set value=excluded.value, description=excluded.description, updated_at=now();

comment on column public.learners.grade_level is 'Optional display/default grade hint only. Program or curriculum enrollment is the source of truth for grade context.';

-- 2) Generic learning programs (curriculum-backed or independent courses)
create table if not exists public.learning_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  code text,
  title text not null,
  description text,
  program_type text not null default 'course' check (program_type in ('curriculum','course','track','custom')),
  curriculum_id uuid references public.curricula(id) on delete restrict,
  grade_level smallint check (grade_level between 1 and 12),
  school_year text,
  primary_language text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id)
);
create unique index if not exists learning_programs_workspace_code_uq
  on public.learning_programs(workspace_id, code) where code is not null;
create index if not exists learning_programs_workspace_status_idx
  on public.learning_programs(workspace_id, status, program_type);

drop trigger if exists set_learning_programs_updated_at on public.learning_programs;
create trigger set_learning_programs_updated_at before update on public.learning_programs
for each row execute function public.set_updated_at();

-- 3) Subjects offered by each program
create table if not exists public.program_subjects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  program_id uuid not null,
  subject_id bigint not null references public.subjects(id) on delete restrict,
  curriculum_subject_id uuid references public.curriculum_subjects(id) on delete set null,
  display_name text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, subject_id),
  unique (id, workspace_id),
  unique (program_id, id),
  foreign key (program_id, workspace_id) references public.learning_programs(id, workspace_id) on delete cascade
);
create index if not exists program_subjects_program_sort_idx on public.program_subjects(program_id, sort_order);
drop trigger if exists set_program_subjects_updated_at on public.program_subjects;
create trigger set_program_subjects_updated_at before update on public.program_subjects
for each row execute function public.set_updated_at();

-- 4) Books / source packages included in a program
alter table public.books add column if not exists source_kind text not null default 'textbook';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='books_source_kind_check') then
    alter table public.books add constraint books_source_kind_check
      check (source_kind in ('textbook','course_material','worksheet','custom','media_collection'));
  end if;
end $$;
comment on table public.books is 'Learning source packages. Legacy name retained for compatibility; source_kind distinguishes textbooks from course/custom material.';

create table if not exists public.program_books (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  program_id uuid not null,
  book_id uuid not null references public.books(id) on delete restrict,
  program_subject_id uuid,
  is_required boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (program_id, book_id),
  foreign key (program_id, workspace_id) references public.learning_programs(id, workspace_id) on delete cascade,
  foreign key (program_id, program_subject_id) references public.program_subjects(program_id, id) on delete set null
);
create index if not exists program_books_program_sort_idx on public.program_books(program_id, sort_order);

-- 5) Program-to-quiz catalog mapping (quiz content can be reused across programs)
create table if not exists public.program_quizzes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  program_id uuid not null,
  quiz_id uuid not null,
  program_subject_id uuid,
  availability text not null default 'available' check (availability in ('available','hidden','archived')),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, quiz_id),
  foreign key (program_id, workspace_id) references public.learning_programs(id, workspace_id) on delete cascade,
  foreign key (quiz_id, workspace_id) references public.quizzes(id, workspace_id) on delete cascade,
  foreign key (program_id, program_subject_id) references public.program_subjects(program_id, id) on delete set null
);
create index if not exists program_quizzes_program_sort_idx on public.program_quizzes(program_id, availability, sort_order);
drop trigger if exists set_program_quizzes_updated_at on public.program_quizzes;
create trigger set_program_quizzes_updated_at before update on public.program_quizzes
for each row execute function public.set_updated_at();

-- 6) Canonical learner -> program enrollment
create table if not exists public.learner_program_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  learner_id uuid not null,
  program_id uuid not null,
  status text not null default 'active' check (status in ('active','paused','completed','withdrawn')),
  is_primary boolean not null default false,
  started_at date,
  ended_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, program_id),
  unique (id, workspace_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade,
  foreign key (program_id, workspace_id) references public.learning_programs(id, workspace_id) on delete cascade,
  check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index if not exists learner_program_enrollments_lookup_idx
  on public.learner_program_enrollments(workspace_id, learner_id, status);
create unique index if not exists learner_program_one_primary_active_idx
  on public.learner_program_enrollments(learner_id)
  where is_primary and status='active';
drop trigger if exists set_learner_program_enrollments_updated_at on public.learner_program_enrollments;
create trigger set_learner_program_enrollments_updated_at before update on public.learner_program_enrollments
for each row execute function public.set_updated_at();

-- 7) Assignment context + mirror metadata
alter table public.quiz_assignments add column if not exists learner_program_enrollment_id uuid;
alter table public.quiz_assignments add column if not exists metadata jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='quiz_assignments_program_enrollment_fkey') then
    alter table public.quiz_assignments add constraint quiz_assignments_program_enrollment_fkey
      foreign key (learner_program_enrollment_id, workspace_id)
      references public.learner_program_enrollments(id, workspace_id) on delete set null;
  end if;
end $$;
create index if not exists quiz_assignments_program_enrollment_idx
  on public.quiz_assignments(learner_program_enrollment_id, status);
create unique index if not exists quiz_assignments_open_unique_idx
  on public.quiz_assignments(workspace_id, learner_id, quiz_version_id)
  where status in ('assigned','in_progress');

-- 8) RLS for new workspace-scoped tables
alter table public.learning_programs enable row level security;
alter table public.program_subjects enable row level security;
alter table public.program_books enable row level security;
alter table public.program_quizzes enable row level security;
alter table public.learner_program_enrollments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['learning_programs','program_subjects','program_books','program_quizzes','learner_program_enrollments'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())))', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())))', t, t);
  end loop;
end $$;

grant select,insert,update,delete on public.learning_programs,public.program_subjects,public.program_books,public.program_quizzes,public.learner_program_enrollments to authenticated;

-- 9) Complete curriculum subject catalog from the existing books
insert into public.curriculum_subjects (curriculum_id,subject_id,grade_level,school_year,display_name,sort_order,metadata)
select distinct b.curriculum_id,
       b.subject_id,
       b.grade_level,
       b.school_year,
       s.name_ar,
       case when s.code='arabic' then 10 when s.code='math' then 20 else 100 end,
       jsonb_build_object('derived_from_existing_book',true)
from public.books b
join public.subjects s on s.id=b.subject_id
where b.curriculum_id is not null and b.grade_level is not null
on conflict (curriculum_id,subject_id,grade_level,school_year) do update
set display_name=excluded.display_name;

-- 10) Seed the current Syrian Grade 5 offering as a program
insert into public.learning_programs
  (workspace_id,slug,code,title,description,program_type,curriculum_id,grade_level,school_year,primary_language,status,metadata)
select w.id,
       'syrian-g5-2025-2026',
       'SY-G5-2025-2026',
       'المنهاج السوري — الصف الخامس — 2025–2026',
       'برنامج المنهاج السوري للصف الخامس المرتبط بكتب ومحتوى Family Learning Hub.',
       'curriculum',
       c.id,
       5,
       '2025-2026',
       'ar',
       'active',
       jsonb_build_object('seeded_from_current_curriculum_content',true)
from public.workspaces w
join public.curricula c on c.code='syrian-national'
where w.slug='family-learning-hub'
on conflict (workspace_id,slug) do update
set title=excluded.title, curriculum_id=excluded.curriculum_id, grade_level=excluded.grade_level,
    school_year=excluded.school_year, primary_language=excluded.primary_language, status='active', updated_at=now();

insert into public.program_subjects
  (workspace_id,program_id,subject_id,curriculum_subject_id,display_name,sort_order,metadata)
select p.workspace_id,p.id,cs.subject_id,cs.id,coalesce(cs.display_name,s.name_ar),cs.sort_order,'{"seeded":true}'::jsonb
from public.learning_programs p
join public.curriculum_subjects cs on cs.curriculum_id=p.curriculum_id and cs.grade_level=p.grade_level and cs.school_year=p.school_year
join public.subjects s on s.id=cs.subject_id
where p.slug='syrian-g5-2025-2026'
on conflict (program_id,subject_id) do update
set curriculum_subject_id=excluded.curriculum_subject_id, display_name=excluded.display_name, sort_order=excluded.sort_order, updated_at=now();

insert into public.program_books (workspace_id,program_id,book_id,program_subject_id,is_required,sort_order,metadata)
select p.workspace_id,p.id,b.id,ps.id,true,
       case when s.code='arabic' then 10 when s.code='math' then 20 else 100 end,
       '{"seeded":true}'::jsonb
from public.learning_programs p
join public.books b on b.curriculum_id=p.curriculum_id and b.grade_level=p.grade_level and b.school_year=p.school_year
join public.subjects s on s.id=b.subject_id
join public.program_subjects ps on ps.program_id=p.id and ps.subject_id=b.subject_id
where p.slug='syrian-g5-2025-2026'
on conflict (program_id,book_id) do update
set program_subject_id=excluded.program_subject_id, is_required=excluded.is_required, sort_order=excluded.sort_order;

insert into public.program_quizzes (workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata)
select p.workspace_id,p.id,q.id,ps.id,'available',row_number() over (order by q.created_at,q.slug)::int,'{"seeded":true}'::jsonb
from public.learning_programs p
join public.quizzes q on q.workspace_id=p.workspace_id and q.curriculum_id=p.curriculum_id and q.status='active'
join public.program_subjects ps on ps.program_id=p.id and ps.subject_id=q.subject_id
where p.slug='syrian-g5-2025-2026'
on conflict (program_id,quiz_id) do update
set program_subject_id=excluded.program_subject_id, availability='available', updated_at=now();

-- Aya is the current learner for this Grade 5 Syrian content; test mirrors it for parent preview.
insert into public.learner_program_enrollments
  (workspace_id,learner_id,program_id,status,is_primary,started_at,metadata)
select l.workspace_id,l.id,p.id,'active',case when l.slug='aya' then true else false end,current_date,
       jsonb_build_object('seed_reason',case when l.slug='test' then 'preview_mirror' else 'current_curriculum_content' end)
from public.learners l
join public.learning_programs p on p.workspace_id=l.workspace_id and p.slug='syrian-g5-2025-2026'
where l.slug in ('aya','test')
on conflict (learner_id,program_id) do update
set status='active', is_primary=excluded.is_primary, ended_at=null, updated_at=now();

-- Curriculum compatibility enrollment for Aya only; test is deliberately excluded from curriculum reporting.
insert into public.learner_enrollments
  (workspace_id,learner_id,curriculum_id,school_year,grade_level,status,started_at,metadata)
select l.workspace_id,l.id,p.curriculum_id,p.school_year,p.grade_level,'active',current_date,
       jsonb_build_object('canonical_program_slug',p.slug,'seed_reason','current_curriculum_content')
from public.learners l
join public.learning_programs p on p.workspace_id=l.workspace_id and p.slug='syrian-g5-2025-2026'
where l.slug='aya'
on conflict (learner_id,curriculum_id,school_year) do update
set grade_level=excluded.grade_level,status='active',ended_at=null,metadata=public.learner_enrollments.metadata || excluded.metadata,updated_at=now();

-- 11) Automatic test-preview mirroring for program enrollments and open quiz assignments, with explicit opt-out.
create or replace function private.mirror_program_enrollment_to_test()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare test_id uuid;
begin
  if coalesce((new.metadata->>'skip_test_mirror')::boolean,false) then return new; end if;
  if private.is_test_learner(new.learner_id) then return new; end if;
  select id into test_id from public.learners
   where workspace_id=new.workspace_id and is_active=true and coalesce((metadata->>'is_test')::boolean,false)=true
   order by created_at limit 1;
  if test_id is null then return new; end if;
  insert into public.learner_program_enrollments
    (workspace_id,learner_id,program_id,status,is_primary,started_at,ended_at,metadata)
  values
    (new.workspace_id,test_id,new.program_id,
     case when new.status in ('active','paused') then new.status else 'active' end,
     false,new.started_at,null,
     jsonb_build_object('mirrored_from_learner_id',new.learner_id,'mirrored_from_enrollment_id',new.id))
  on conflict (learner_id,program_id) do update
    set status=excluded.status,ended_at=null,metadata=public.learner_program_enrollments.metadata || excluded.metadata,updated_at=now();
  return new;
end $$;

drop trigger if exists mirror_program_enrollment_to_test on public.learner_program_enrollments;
create trigger mirror_program_enrollment_to_test
after insert or update of status on public.learner_program_enrollments
for each row execute function private.mirror_program_enrollment_to_test();

create or replace function private.mirror_quiz_assignment_to_test()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare test_id uuid;
begin
  if new.status not in ('assigned','in_progress') then return new; end if;
  if coalesce((new.metadata->>'mirror_to_test')::boolean,true)=false then return new; end if;
  if private.is_test_learner(new.learner_id) then return new; end if;
  select id into test_id from public.learners
   where workspace_id=new.workspace_id and is_active=true and coalesce((metadata->>'is_test')::boolean,false)=true
   order by created_at limit 1;
  if test_id is null then return new; end if;
  insert into public.quiz_assignments
    (workspace_id,learner_id,quiz_version_id,status,available_at,due_at,max_attempts,assigned_by,metadata)
  values
    (new.workspace_id,test_id,new.quiz_version_id,'assigned',new.available_at,new.due_at,new.max_attempts,new.assigned_by,
     jsonb_build_object('mirrored_from_assignment_id',new.id,'mirrored_from_learner_id',new.learner_id))
  on conflict (workspace_id,learner_id,quiz_version_id) where status in ('assigned','in_progress') do nothing;
  return new;
end $$;

drop trigger if exists mirror_quiz_assignment_to_test on public.quiz_assignments;
create trigger mirror_quiz_assignment_to_test
after insert or update of status on public.quiz_assignments
for each row execute function private.mirror_quiz_assignment_to_test();
