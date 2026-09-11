-- Post-replay contract for the Git-only database reconstruction.
-- This runs only against the disposable local Supabase database created in CI.

do $contract$
declare
  v_relation text;
  v_function text;
  v_policy record;
  v_policy_contract record;
  v_workspace uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_paper_version uuid;
begin
  if not exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then
    raise exception 'FRESH_REBUILD_PGCRYPTO_SCHEMA_INVALID';
  end if;

  -- Exercise the exact pgcrypto surface used by learner PIN and paper-exam
  -- migrations. A successful full replay proves these functions were available
  -- before the first migration that referenced them.
  perform extensions.digest(convert_to('fresh-rebuild', 'UTF8'), 'sha256');
  perform extensions.crypt('fresh-rebuild', extensions.gen_salt('bf', 4));

  foreach v_relation in array array[
    'public.workspaces',
    'public.workspace_members',
    'public.workspace_settings',
    'public.learners',
    'public.learner_access_tokens',
    'public.subjects',
    'public.curricula',
    'public.curriculum_subjects',
    'public.books',
    'public.units',
    'public.lessons',
    'public.learning_concepts',
    'public.quizzes',
    'public.quiz_versions',
    'public.quiz_questions',
    'public.quiz_question_options',
    'public.quiz_question_answer_keys',
    'public.quiz_question_hints',
    'public.quiz_question_concepts',
    'public.quiz_assignments',
    'public.quiz_attempts',
    'public.quiz_attempt_answers',
    'public.quiz_attempt_question_queue',
    'public.learner_concept_mastery',
    'public.learning_programs',
    'public.program_subjects',
    'public.program_books',
    'public.program_quizzes',
    'public.learner_program_enrollments',
    'public.learner_content_assignments',
    'public.learner_gamification_state',
    'public.gamification_events',
    'public.learner_learning_sessions',
    'private.qa_run_leases'
  ] loop
    if to_regclass(v_relation) is null then
      raise exception 'FRESH_REBUILD_RELATION_MISSING:%', v_relation;
    end if;
  end loop;

  foreach v_function in array array[
    'public.set_updated_at()',
    'private.workspace_role(uuid,uuid)',
    'private.is_workspace_member(uuid,uuid)',
    'private.can_manage_learning(uuid,uuid)',
    'private.is_test_learner(uuid)',
    'public.verify_and_upgrade_learner_pin(uuid,uuid,text)',
    'public.flh_exam_start(uuid,uuid,text)',
    'public.flh_paper_exam_start(uuid,uuid,uuid,text,text)',
    'public.flh_record_exam_concept_mastery(uuid,uuid)'
  ] loop
    if to_regprocedure(v_function) is null then
      raise exception 'FRESH_REBUILD_FUNCTION_MISSING:%', v_function;
    end if;
  end loop;

  if not exists (
    select 1
    from public.workspaces
    where id = v_workspace and slug = 'family-learning-hub'
  ) then
    raise exception 'FRESH_REBUILD_CANONICAL_WORKSPACE_MISSING';
  end if;

  if exists (
    select 1 from public.learners where slug in ('aya', 'mohammad')
  ) then
    raise exception 'FRESH_REBUILD_REAL_LEARNER_WAS_FABRICATED';
  end if;

  if (select count(*) from public.learners) <> 1
     or not exists (
       select 1
       from public.learners
       where slug = 'test'
         and coalesce((metadata->>'is_test')::boolean, false)
     ) then
    raise exception 'FRESH_REBUILD_TEST_LEARNER_ISOLATION_INVALID';
  end if;

  select id into v_paper_version
  from public.quiz_versions
  where workspace_id = v_workspace
    and settings->'paper_exam'->>'paper_model_code' = 'MOH-MATH7-U1-INT-PAPER-20260909-G';

  if v_paper_version is null then
    raise exception 'FRESH_REBUILD_PAPER_MODEL_MISSING';
  end if;

  if (
    select count(*)
    from public.quiz_questions
    where workspace_id = v_workspace and quiz_version_id = v_paper_version
  ) <> 20 then
    raise exception 'FRESH_REBUILD_PAPER_MODEL_QUESTION_COUNT_INVALID';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'workspaces','workspace_members','workspace_settings','learners',
        'quiz_question_answer_keys','learner_access_tokens','quiz_assignments','quiz_attempts',
        'quiz_attempt_answers','learner_concept_mastery','learning_programs',
        'program_subjects','program_books','program_quizzes',
        'learner_program_enrollments','learner_login_rate_limits',
        'learner_gamification_state','learner_learning_sessions'
      ])
      and not c.relrowsecurity
  ) then
    raise exception 'FRESH_REBUILD_REQUIRED_RLS_DISABLED';
  end if;

  -- learner_content_assignments is deliberately not included above. The tracked
  -- repository chain predates its hosted RLS hardening, which is known drift to
  -- reconcile after issue #37 rather than backport into this historical replay.

  -- Every policy that can apply to authenticated users on a sensitive relation
  -- must carry its own workspace authorization predicate. PostgreSQL ORs
  -- permissive policies, so one safe policy cannot compensate for an unbounded
  -- sibling policy. PUBLIC policies are included because authenticated inherits
  -- PUBLIC. Command semantics determine which expression is authorization-
  -- relevant: USING for row visibility, WITH CHECK for inserted/new row values,
  -- and both for UPDATE/ALL policies.
  for v_policy in
    select p.*
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(array[
        'workspaces','workspace_members','workspace_settings','learners',
        'learner_access_tokens','quiz_assignments','quiz_attempts',
        'quiz_attempt_answers','quiz_attempt_question_queue',
        'learner_concept_mastery','learning_programs','program_subjects',
        'program_books','program_quizzes','learner_program_enrollments',
        'learner_gamification_state','gamification_events',
        'learner_learning_sessions'
      ])
      and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
  loop
    if v_policy.cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')
       and coalesce(v_policy.qual, '') !~ 'private\.(is_workspace_member|can_manage_learning|workspace_role)\(' then
      raise exception 'FRESH_REBUILD_POLICY_USING_UNBOUNDED:%.%', v_policy.tablename, v_policy.policyname;
    end if;

    if v_policy.cmd in ('INSERT', 'UPDATE', 'ALL')
       and coalesce(v_policy.with_check, '') !~ 'private\.(is_workspace_member|can_manage_learning|workspace_role)\(' then
      raise exception 'FRESH_REBUILD_POLICY_WITH_CHECK_UNBOUNDED:%.%', v_policy.tablename, v_policy.policyname;
    end if;
  end loop;

  -- Also prove the required CRUD surfaces have a bounded policy for each
  -- command/expression pair. ALL policies may satisfy an individual command.
  for v_policy_contract in
    select relation_name as tablename, operation.command_name, operation.expression_name
    from unnest(array[
      'workspace_members','workspace_settings','learners',
      'learner_access_tokens','quiz_assignments','quiz_attempts',
      'quiz_attempt_answers','quiz_attempt_question_queue',
      'learner_concept_mastery','learning_programs','program_subjects',
      'program_books','program_quizzes','learner_program_enrollments',
      'learner_gamification_state','gamification_events'
    ]::text[]) as relation_name
    cross join (values
      ('SELECT', 'qual'),
      ('INSERT', 'with_check'),
      ('UPDATE', 'qual'),
      ('UPDATE', 'with_check'),
      ('DELETE', 'qual')
    ) as operation(command_name, expression_name)
    union all
    select * from (values
      ('workspaces', 'SELECT', 'qual'),
      ('workspaces', 'UPDATE', 'qual'),
      ('workspaces', 'UPDATE', 'with_check'),
      ('learner_learning_sessions', 'SELECT', 'qual')
    ) as partial_contract(tablename, command_name, expression_name)
  loop
    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_policy_contract.tablename
        and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
        and p.cmd in (v_policy_contract.command_name, 'ALL')
        and case v_policy_contract.expression_name
          when 'qual' then coalesce(p.qual, '')
          else coalesce(p.with_check, '')
        end ~ 'private\.(is_workspace_member|can_manage_learning|workspace_role)\('
    ) then
      raise exception 'FRESH_REBUILD_REQUIRED_POLICY_CONTRACT_MISSING:%.%.%',
        v_policy_contract.tablename,
        v_policy_contract.command_name,
        v_policy_contract.expression_name;
    end if;
  end loop;
end;
$contract$;
