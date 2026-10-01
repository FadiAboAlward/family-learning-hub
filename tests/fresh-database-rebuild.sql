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
    'public.flh_learning_start(uuid,uuid,text)',
    'public.flh_learning_answer(uuid,uuid,uuid,uuid,integer)',
    'public.flh_learning_finish(uuid,uuid,uuid,integer)',
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
      ('workspaces', 'UPDATE', 'with_check')
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

  <<self_contained_wording_contract>>
  declare
    v_sc_workspace uuid;
    v_sc_slug text;
    v_sc_quiz uuid;
    v_sc_latest uuid;
    v_sc_source uuid;
    v_sc_latest_count integer;
    v_sc_source_count integer;
  begin
    select id into v_sc_workspace
    from public.workspaces
    where slug='family-learning-hub'
    limit 1;

    foreach v_sc_slug in array array[
      'sy-g7-arabic-u1-foundations-20260923-a',
      'sy-g7-arabic-u1-baseline-20261001'
    ] loop
      select id into v_sc_quiz
      from public.quizzes
      where workspace_id=v_sc_workspace and slug=v_sc_slug
      limit 1;

      if v_sc_quiz is null then
        raise exception 'SELF_CONTAINED_WORDING_QUIZ_MISSING:%', v_sc_slug;
      end if;

      select id,
             (settings->'self_contained_wording'->>'source_version_id')::uuid
        into v_sc_latest, v_sc_source
      from public.quiz_versions
      where workspace_id=v_sc_workspace
        and quiz_id=v_sc_quiz
        and state='published'
      order by version_no desc
      limit 1;

      if v_sc_latest is null
         or not exists (
           select 1
           from public.quiz_versions
           where id=v_sc_latest
             and settings->'self_contained_wording'->>'feature_id'='FLH-FEAT-2026-014'
         ) then
        raise exception 'SELF_CONTAINED_WORDING_LATEST_VERSION_INVALID:%', v_sc_slug;
      end if;

      if v_sc_source is null then
        raise exception 'SELF_CONTAINED_WORDING_SOURCE_VERSION_MISSING:%', v_sc_slug;
      end if;

      select count(*) into v_sc_latest_count
      from public.quiz_questions
      where workspace_id=v_sc_workspace and quiz_version_id=v_sc_latest;

      select count(*) into v_sc_source_count
      from public.quiz_questions
      where workspace_id=v_sc_workspace and quiz_version_id=v_sc_source;

      if v_sc_latest_count <> v_sc_source_count then
        raise exception 'SELF_CONTAINED_WORDING_COUNT_MISMATCH:%:%:%',
          v_sc_slug, v_sc_source_count, v_sc_latest_count;
      end if;

      if exists (
        select 1
        from public.quiz_questions
        where workspace_id=v_sc_workspace
          and quiz_version_id=v_sc_latest
          and (
            prompt like '%في مفردات%'
            or prompt like '%كما ورد في مفردات%'
            or prompt like '%كما في درس%'
            or prompt like '%في أسئلة الاستيعاب لنص%'
            or prompt like '%المعنى العام لقصيدة%'
          )
      ) then
        raise exception 'SELF_CONTAINED_WORDING_SOFT_PROMPT_REMAINS:%', v_sc_slug;
      end if;

      if exists (
        select 1
        from public.quiz_question_hints h
        join public.quiz_questions q
          on q.workspace_id=h.workspace_id and q.id=h.question_id
        where q.workspace_id=v_sc_workspace
          and q.quiz_version_id=v_sc_latest
          and (
            h.content='الكلمة وردت في وصف نشر الحب.'
            or h.content='استحضر وصف البحر في النص.'
          )
      ) then
        raise exception 'SELF_CONTAINED_WORDING_SOFT_HINT_REMAINS:%', v_sc_slug;
      end if;

      if exists (
        select 1
        from public.quiz_question_answer_keys k
        join public.quiz_questions q
          on q.workspace_id=k.workspace_id and q.id=k.question_id
        where q.workspace_id=v_sc_workspace
          and q.quiz_version_id=v_sc_latest
          and (
            coalesce(k.explanation,'') like '%في النص ضمن هذا السياق%'
            or coalesce(k.correct_explanation,'') like '%في النص ضمن هذا السياق%'
            or coalesce(k.final_incorrect_explanation,'') like '%في النص ضمن هذا السياق%'
            or coalesce(k.explanation,'') like '%وفق أسئلة الاستيعاب والفهم في الدرس%'
            or coalesce(k.correct_explanation,'') like '%وفق أسئلة الاستيعاب والفهم في الدرس%'
            or coalesce(k.final_incorrect_explanation,'') like '%وفق أسئلة الاستيعاب والفهم في الدرس%'
          )
      ) then
        raise exception 'SELF_CONTAINED_WORDING_SOFT_FEEDBACK_REMAINS:%', v_sc_slug;
      end if;
    end loop;

    if not exists (
      select 1
      from public.quiz_questions q
      join public.quiz_versions v on v.id=q.quiz_version_id and v.workspace_id=q.workspace_id
      join public.quizzes z on z.id=v.quiz_id and z.workspace_id=v.workspace_id
      where z.workspace_id=v_sc_workspace
        and z.slug='sy-g7-arabic-u1-foundations-20260923-a'
        and q.question_code='Q-20260923402'
        and q.prompt='في مفردات درس «عَلَمُ بلادي»، ما معنى كلمة «مُسبِغ»؟'
    ) then
      raise exception 'SELF_CONTAINED_WORDING_HISTORICAL_VERSION_MUTATED';
    end if;

    select v.id into v_sc_latest
    from public.quiz_versions v
    join public.quizzes z on z.id=v.quiz_id and z.workspace_id=v.workspace_id
    where z.workspace_id=v_sc_workspace
      and z.slug='sy-g7-arabic-u1-foundations-20260923-a'
      and v.state='published'
    order by v.version_no desc
    limit 1;

    if not exists (
      select 1
      from public.quiz_questions
      where workspace_id=v_sc_workspace
        and quiz_version_id=v_sc_latest
        and source_metadata->>'remediated_from_question_code'='Q-20260923402'
        and prompt='ورد في البيت: «عَلَمي يا مُسبغَ الحبِّ على الأرضِ وشاحًا». ما معنى «مُسبغ»؟'
    ) then
      raise exception 'SELF_CONTAINED_WORDING_OBSERVED_QUESTION_NOT_FIXED';
    end if;

    select v.id into v_sc_latest
    from public.quiz_versions v
    join public.quizzes z on z.id=v.quiz_id and z.workspace_id=v.workspace_id
    where z.workspace_id=v_sc_workspace
      and z.slug='sy-g7-arabic-u1-baseline-20261001'
      and v.state='published'
    order by v.version_no desc
    limit 1;

    if not exists (
      select 1
      from public.quiz_questions
      where workspace_id=v_sc_workspace
        and quiz_version_id=v_sc_latest
        and source_metadata->>'remediated_from_question_code'='Q-202610019231'
        and prompt like 'قال الشاعر:%خابَ راقيهِ%مَن المقصود بـ«الرّاقي» في البيت؟'
    ) then
      raise exception 'SELF_CONTAINED_WORDING_CONTEXT_EMBEDDING_MISSING';
    end if;
  end self_contained_wording_contract;

end;
$contract$;
