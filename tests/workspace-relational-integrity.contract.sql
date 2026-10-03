-- FLH-FEAT-2026-004 v1.1 deterministic database contract.
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


-- v1.1 residual integrity: bind persisted Exam answers to the owning attempt
-- version and bind activity sessions to a learner in the same workspace.
do $v1_1$
declare
  v_workspace uuid;
  v_learner uuid;
  v_version_a uuid;
  v_version_b uuid;
  v_question_a uuid;
  v_question_b uuid;
  v_attempt uuid := 'a613dd0a-2ea4-4e53-a505-79db5d699101';
  v_answer uuid := 'a613dd0a-2ea4-4e53-a505-79db5d699102';
  v_other_workspace uuid := 'a613dd0a-2ea4-4e53-a505-79db5d699103';
  v_session uuid := 'a613dd0a-2ea4-4e53-a505-79db5d699104';
  v_rejected boolean;
  v_def text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='quiz_attempt_answers'
      and column_name='quiz_version_id'
      and is_nullable='NO'
      and data_type='uuid'
  ) then
    raise exception 'quiz_attempt_answers.quiz_version_id is missing or nullable';
  end if;

  foreach v_def in array array[
    'quiz_attempt_answers_attempt_version_workspace_fkey',
    'quiz_attempt_answers_question_version_workspace_fkey',
    'learner_learning_sessions_learner_workspace_fkey'
  ] loop
    if not exists (
      select 1
      from pg_constraint
      where conname=v_def
        and convalidated
    ) then
      raise exception 'required validated v1.1 constraint missing: %', v_def;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid='public.quiz_attempt_answers'::regclass
      and tgname='quiz_attempt_answers_bind_version'
      and not tgisinternal
  ) then
    raise exception 'quiz_attempt_answers version-binding trigger missing';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.proname='flh_bind_quiz_attempt_answer_version'
      and not p.prosecdef
  ) then
    raise exception 'version-binding helper is missing or unexpectedly SECURITY DEFINER';
  end if;

  if exists (
    select 1
    from public.quiz_attempt_answers aa
    join public.quiz_attempts a
      on a.id=aa.attempt_id and a.workspace_id=aa.workspace_id
    join public.quiz_questions q
      on q.id=aa.question_id and q.workspace_id=aa.workspace_id
    where aa.quiz_version_id is distinct from a.quiz_version_id
       or aa.quiz_version_id is distinct from q.quiz_version_id
  ) then
    raise exception 'existing quiz_attempt_answers version mismatch remains';
  end if;

  if exists (
    select 1
    from public.learner_learning_sessions s
    join public.learners l on l.id=s.learner_id
    where s.workspace_id is distinct from l.workspace_id
  ) then
    raise exception 'existing learner session workspace mismatch remains';
  end if;

  select w.id
    into v_workspace
  from public.workspaces w
  where w.slug='family-learning-hub'
  limit 1;

  select l.id
    into v_learner
  from public.learners l
  where l.workspace_id=v_workspace
    and coalesce((l.metadata->>'is_test')::boolean,false)
  limit 1;

  select q.quiz_version_id, q.id
    into v_version_a, v_question_a
  from public.quiz_questions q
  join public.quiz_versions v
    on v.id=q.quiz_version_id and v.workspace_id=q.workspace_id
  where q.workspace_id=v_workspace
    and not (v.settings ? 'paper_exam')
  order by q.quiz_version_id, q.position
  limit 1;

  select q.quiz_version_id, q.id
    into v_version_b, v_question_b
  from public.quiz_questions q
  join public.quiz_versions v
    on v.id=q.quiz_version_id and v.workspace_id=q.workspace_id
  where q.workspace_id=v_workspace
    and q.quiz_version_id<>v_version_a
    and not (v.settings ? 'paper_exam')
  order by q.quiz_version_id, q.position
  limit 1;

  if v_workspace is null or v_learner is null
     or v_version_a is null or v_version_b is null then
    raise exception 'v1.1 relational fixture prerequisites missing';
  end if;

  insert into public.quiz_attempts(
    id,workspace_id,learner_id,quiz_version_id,status,delivery_mode
  ) values (
    v_attempt,v_workspace,v_learner,v_version_a,'in_progress','exam'
  );

  insert into public.quiz_attempt_answers(
    id,workspace_id,attempt_id,question_id,response
  ) values (
    v_answer,v_workspace,v_attempt,v_question_a,'{"option_position":1}'::jsonb
  );

  if not exists (
    select 1
    from public.quiz_attempt_answers
    where id=v_answer and quiz_version_id=v_version_a
  ) then
    raise exception 'positive answer version binding did not populate quiz_version_id';
  end if;

  v_rejected := false;
  begin
    insert into public.quiz_attempt_answers(
      workspace_id,attempt_id,question_id,response
    ) values (
      v_workspace,v_attempt,v_question_b,'{"option_position":1}'::jsonb
    );
  exception when foreign_key_violation then
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'cross-version quiz attempt answer was accepted';
  end if;

  insert into public.workspaces(id,name,slug)
  values (v_other_workspace,'QA relational other workspace','qa-relational-other-workspace');

  v_rejected := false;
  begin
    insert into public.learner_learning_sessions(
      workspace_id,learner_id,auth_nonce
    ) values (
      v_other_workspace,v_learner,'qa-cross-workspace-nonce'
    );
  exception when foreign_key_violation then
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'cross-workspace learner session was accepted';
  end if;

  insert into public.learner_learning_sessions(
    id,workspace_id,learner_id,auth_nonce
  ) values (
    v_session,v_workspace,v_learner,'qa-positive-session-nonce'
  );

  delete from public.learner_learning_sessions where id=v_session;
  delete from public.quiz_attempts where id=v_attempt;
  delete from public.workspaces where id=v_other_workspace;
end
$v1_1$;
