-- Post-replay contract for the Git-only database reconstruction.
-- This runs only against the disposable local Supabase database created in CI.

do $contract$
declare
  v_relation text;
  v_function text;
  v_workspace uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_paper_version uuid;
begin
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
        'quiz_question_answer_keys','learner_access_tokens','quiz_attempts',
        'quiz_attempt_answers','learner_concept_mastery','learning_programs',
        'program_subjects','program_books','program_quizzes',
        'learner_program_enrollments','learner_login_rate_limits'
      ])
      and not c.relrowsecurity
  ) then
    raise exception 'FRESH_REBUILD_REQUIRED_RLS_DISABLED';
  end if;
end;
$contract$;
