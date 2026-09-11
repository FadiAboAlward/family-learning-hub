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
