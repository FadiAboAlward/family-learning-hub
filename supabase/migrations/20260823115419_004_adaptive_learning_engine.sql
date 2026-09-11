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
