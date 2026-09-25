-- FLH-FEAT-2026-004 v1.0
-- Forward-only reconciliation for workspace-scoped relational integrity.
-- Production preflight on 2026-09-25 found zero cross-workspace mismatches
-- across all six relationships before this migration.

-- Parent composite keys. Each parent id is already globally unique through its
-- primary key; these keys make workspace identity part of the referenced key.
-- Build the backing index only when the owning constraint is absent. PostgreSQL
-- renames an index adopted by UNIQUE USING INDEX to the constraint name, so
-- unconditional CREATE INDEX IF NOT EXISTS would create a redundant index on a
-- repeated run.
do $parent_keys$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_assignments'::regclass
      and conname='quiz_assignments_id_workspace_id_key'
  ) then
    create unique index if not exists quiz_assignments_id_workspace_id_uidx
      on public.quiz_assignments(id, workspace_id);
    alter table public.quiz_assignments
      add constraint quiz_assignments_id_workspace_id_key
      unique using index quiz_assignments_id_workspace_id_uidx;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.curriculum_concept_terms'::regclass
      and conname='curriculum_concept_terms_id_workspace_id_key'
  ) then
    create unique index if not exists curriculum_concept_terms_id_workspace_id_uidx
      on public.curriculum_concept_terms(id, workspace_id);
    alter table public.curriculum_concept_terms
      add constraint curriculum_concept_terms_id_workspace_id_key
      unique using index curriculum_concept_terms_id_workspace_id_uidx;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.feedback_templates'::regclass
      and conname='feedback_templates_id_workspace_id_key'
  ) then
    create unique index if not exists feedback_templates_id_workspace_id_uidx
      on public.feedback_templates(id, workspace_id);
    alter table public.feedback_templates
      add constraint feedback_templates_id_workspace_id_key
      unique using index feedback_templates_id_workspace_id_uidx;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.gamification_badges'::regclass
      and conname='gamification_badges_id_workspace_id_key'
  ) then
    create unique index if not exists gamification_badges_id_workspace_id_uidx
      on public.gamification_badges(id, workspace_id);
    alter table public.gamification_badges
      add constraint gamification_badges_id_workspace_id_key
      unique using index gamification_badges_id_workspace_id_uidx;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.gamification_rewards'::regclass
      and conname='gamification_rewards_id_workspace_id_key'
  ) then
    create unique index if not exists gamification_rewards_id_workspace_id_uidx
      on public.gamification_rewards(id, workspace_id);
    alter table public.gamification_rewards
      add constraint gamification_rewards_id_workspace_id_key
      unique using index gamification_rewards_id_workspace_id_uidx;
  end if;
end
$parent_keys$;

-- Add composite constraints as NOT VALID first so current rows can be checked
-- explicitly before the old scalar constraints are removed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_attempts'::regclass
      and conname='quiz_attempts_assignment_workspace_fkey'
  ) then
    alter table public.quiz_attempts
      add constraint quiz_attempts_assignment_workspace_fkey
      foreign key (assignment_id, workspace_id)
      references public.quiz_assignments(id, workspace_id)
      on delete set null (assignment_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.learner_term_exposures'::regclass
      and conname='learner_term_exposures_term_workspace_fkey'
  ) then
    alter table public.learner_term_exposures
      add constraint learner_term_exposures_term_workspace_fkey
      foreign key (term_id, workspace_id)
      references public.curriculum_concept_terms(id, workspace_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_answer_attempts'::regclass
      and conname='quiz_answer_attempts_feedback_template_workspace_fkey'
  ) then
    alter table public.quiz_answer_attempts
      add constraint quiz_answer_attempts_feedback_template_workspace_fkey
      foreign key (feedback_template_id, workspace_id)
      references public.feedback_templates(id, workspace_id)
      on delete set null (feedback_template_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_answer_attempts'::regclass
      and conname='quiz_answer_attempts_explanation_set_workspace_fkey'
  ) then
    alter table public.quiz_answer_attempts
      add constraint quiz_answer_attempts_explanation_set_workspace_fkey
      foreign key (explanation_set_id, workspace_id)
      references public.explanation_sets(id, workspace_id)
      on delete set null (explanation_set_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.learner_badges'::regclass
      and conname='learner_badges_badge_workspace_fkey'
  ) then
    alter table public.learner_badges
      add constraint learner_badges_badge_workspace_fkey
      foreign key (badge_id, workspace_id)
      references public.gamification_badges(id, workspace_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.reward_claims'::regclass
      and conname='reward_claims_reward_workspace_fkey'
  ) then
    alter table public.reward_claims
      add constraint reward_claims_reward_workspace_fkey
      foreign key (reward_id, workspace_id)
      references public.gamification_rewards(id, workspace_id)
      on delete restrict
      not valid;
  end if;
end
$$;

alter table public.quiz_attempts
  validate constraint quiz_attempts_assignment_workspace_fkey;
alter table public.learner_term_exposures
  validate constraint learner_term_exposures_term_workspace_fkey;
alter table public.quiz_answer_attempts
  validate constraint quiz_answer_attempts_feedback_template_workspace_fkey;
alter table public.quiz_answer_attempts
  validate constraint quiz_answer_attempts_explanation_set_workspace_fkey;
alter table public.learner_badges
  validate constraint learner_badges_badge_workspace_fkey;
alter table public.reward_claims
  validate constraint reward_claims_reward_workspace_fkey;

-- Remove the superseded scalar constraints only after the composite constraints
-- are validated. Delete behavior is preserved by the composite replacements.
alter table public.quiz_attempts
  drop constraint if exists quiz_attempts_assignment_id_fkey;
alter table public.learner_term_exposures
  drop constraint if exists learner_term_exposures_term_id_fkey;
alter table public.quiz_answer_attempts
  drop constraint if exists quiz_answer_attempts_feedback_template_id_fkey;
alter table public.quiz_answer_attempts
  drop constraint if exists quiz_answer_attempts_explanation_set_id_fkey;
alter table public.learner_badges
  drop constraint if exists learner_badges_badge_id_fkey;
alter table public.reward_claims
  drop constraint if exists reward_claims_reward_id_fkey;
