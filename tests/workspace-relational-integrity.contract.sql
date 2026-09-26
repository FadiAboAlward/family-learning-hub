-- FLH-FEAT-2026-004 deterministic database contract.
do $$
declare
  v_count integer;
  v_def text;
begin
  -- No existing row may violate workspace identity.
  select count(*) into v_count
  from public.quiz_attempts c join public.quiz_assignments p on p.id=c.assignment_id
  where c.assignment_id is not null and c.workspace_id is distinct from p.workspace_id;
  if v_count <> 0 then raise exception 'quiz_attempts assignment workspace mismatch'; end if;

  select count(*) into v_count
  from public.learner_term_exposures c join public.curriculum_concept_terms p on p.id=c.term_id
  where c.term_id is not null and c.workspace_id is distinct from p.workspace_id;
  if v_count <> 0 then raise exception 'learner_term_exposures term workspace mismatch'; end if;

  select count(*) into v_count
  from public.quiz_answer_attempts c join public.feedback_templates p on p.id=c.feedback_template_id
  where c.feedback_template_id is not null and c.workspace_id is distinct from p.workspace_id;
  if v_count <> 0 then raise exception 'quiz_answer_attempts feedback workspace mismatch'; end if;

  select count(*) into v_count
  from public.quiz_answer_attempts c join public.explanation_sets p on p.id=c.explanation_set_id
  where c.explanation_set_id is not null and c.workspace_id is distinct from p.workspace_id;
  if v_count <> 0 then raise exception 'quiz_answer_attempts explanation workspace mismatch'; end if;

  select count(*) into v_count
  from public.learner_badges c join public.gamification_badges p on p.id=c.badge_id
  where c.badge_id is not null and c.workspace_id is distinct from p.workspace_id;
  if v_count <> 0 then raise exception 'learner_badges badge workspace mismatch'; end if;

  select count(*) into v_count
  from public.reward_claims c join public.gamification_rewards p on p.id=c.reward_id
  where c.reward_id is not null and c.workspace_id is distinct from p.workspace_id;
  if v_count <> 0 then raise exception 'reward_claims reward workspace mismatch'; end if;

  -- Required parent composite unique keys.
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_assignments'::regclass
      and contype='u'
      and pg_get_constraintdef(oid,true)='UNIQUE (id, workspace_id)'
  ) then raise exception 'quiz_assignments composite unique key missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.curriculum_concept_terms'::regclass
      and contype='u'
      and pg_get_constraintdef(oid,true)='UNIQUE (id, workspace_id)'
  ) then raise exception 'curriculum_concept_terms composite unique key missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.feedback_templates'::regclass
      and contype='u'
      and pg_get_constraintdef(oid,true)='UNIQUE (id, workspace_id)'
  ) then raise exception 'feedback_templates composite unique key missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.explanation_sets'::regclass
      and contype='u'
      and pg_get_constraintdef(oid,true)='UNIQUE (id, workspace_id)'
  ) then raise exception 'explanation_sets composite unique key missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.gamification_badges'::regclass
      and contype='u'
      and pg_get_constraintdef(oid,true)='UNIQUE (id, workspace_id)'
  ) then raise exception 'gamification_badges composite unique key missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.gamification_rewards'::regclass
      and contype='u'
      and pg_get_constraintdef(oid,true)='UNIQUE (id, workspace_id)'
  ) then raise exception 'gamification_rewards composite unique key missing'; end if;

  -- Every replacement FK must be validated and retain the intended delete action.
  select pg_get_constraintdef(oid,true) into v_def from pg_constraint
  where conrelid='public.quiz_attempts'::regclass and conname='quiz_attempts_assignment_workspace_fkey' and convalidated;
  if v_def is null or v_def not like 'FOREIGN KEY (assignment_id, workspace_id) REFERENCES quiz_assignments(id, workspace_id) ON DELETE SET NULL (assignment_id)%'
    then raise exception 'quiz_attempts composite FK invalid: %',v_def; end if;

  select pg_get_constraintdef(oid,true) into v_def from pg_constraint
  where conrelid='public.learner_term_exposures'::regclass and conname='learner_term_exposures_term_workspace_fkey' and convalidated;
  if v_def is null or v_def not like 'FOREIGN KEY (term_id, workspace_id) REFERENCES curriculum_concept_terms(id, workspace_id) ON DELETE CASCADE%'
    then raise exception 'learner_term_exposures composite FK invalid: %',v_def; end if;

  select pg_get_constraintdef(oid,true) into v_def from pg_constraint
  where conrelid='public.quiz_answer_attempts'::regclass and conname='quiz_answer_attempts_feedback_template_workspace_fkey' and convalidated;
  if v_def is null or v_def not like 'FOREIGN KEY (feedback_template_id, workspace_id) REFERENCES feedback_templates(id, workspace_id) ON DELETE SET NULL (feedback_template_id)%'
    then raise exception 'feedback_template composite FK invalid: %',v_def; end if;

  select pg_get_constraintdef(oid,true) into v_def from pg_constraint
  where conrelid='public.quiz_answer_attempts'::regclass and conname='quiz_answer_attempts_explanation_set_workspace_fkey' and convalidated;
  if v_def is null or v_def not like 'FOREIGN KEY (explanation_set_id, workspace_id) REFERENCES explanation_sets(id, workspace_id) ON DELETE SET NULL (explanation_set_id)%'
    then raise exception 'explanation_set composite FK invalid: %',v_def; end if;

  select pg_get_constraintdef(oid,true) into v_def from pg_constraint
  where conrelid='public.learner_badges'::regclass and conname='learner_badges_badge_workspace_fkey' and convalidated;
  if v_def is null or v_def not like 'FOREIGN KEY (badge_id, workspace_id) REFERENCES gamification_badges(id, workspace_id) ON DELETE CASCADE%'
    then raise exception 'learner_badges composite FK invalid: %',v_def; end if;

  select pg_get_constraintdef(oid,true) into v_def from pg_constraint
  where conrelid='public.reward_claims'::regclass and conname='reward_claims_reward_workspace_fkey' and convalidated;
  if v_def is null or v_def not like 'FOREIGN KEY (reward_id, workspace_id) REFERENCES gamification_rewards(id, workspace_id) ON DELETE RESTRICT%'
    then raise exception 'reward_claims composite FK invalid: %',v_def; end if;

  -- Superseded scalar FKs must be gone.
  if exists (
    select 1 from pg_constraint where conname in (
      'quiz_attempts_assignment_id_fkey',
      'learner_term_exposures_term_id_fkey',
      'quiz_answer_attempts_feedback_template_id_fkey',
      'quiz_answer_attempts_explanation_set_id_fkey',
      'learner_badges_badge_id_fkey',
      'reward_claims_reward_id_fkey'
    )
  ) then raise exception 'one or more scalar FKs remain'; end if;
end
$$;
