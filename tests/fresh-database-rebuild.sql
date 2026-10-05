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
    'public.flh_learning_answer_response(uuid,uuid,uuid,uuid,jsonb)',
    'public.flh_learning_finish(uuid,uuid,uuid,integer)',
    'public.flh_exam_start(uuid,uuid,text)',
    'public.flh_paper_exam_start(uuid,uuid,uuid,text,text)',
    'public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb)',
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
        'quiz_attempt_answers','quiz_answer_attempts','quiz_attempt_question_queue',
        'learner_concept_mastery','adaptive_events','learner_term_exposures','learning_programs',
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
        'quiz_attempt_answers','quiz_answer_attempts','quiz_attempt_question_queue',
        'learner_concept_mastery','adaptive_events','learner_term_exposures',
        'learning_programs','program_subjects',
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
      'quiz_attempt_answers','learning_programs','program_subjects',
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
      ('quiz_answer_attempts', 'SELECT', 'qual'),
      ('quiz_attempt_question_queue', 'SELECT', 'qual'),
      ('learner_concept_mastery', 'SELECT', 'qual'),
      ('adaptive_events', 'SELECT', 'qual'),
      ('learner_term_exposures', 'SELECT', 'qual')
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

  -- v1.1 behavioral proof that scoped SELECT policies cannot be bypassed by
  -- an authenticated user who belongs only to a different workspace.
  <<server_owned_cross_workspace_read_contract>>
  declare
    v_outsider_user uuid := 'e513dd0a-2ea4-4e53-a505-79db5d699201';
    v_outsider_workspace uuid := 'e513dd0a-2ea4-4e53-a505-79db5d699202';
    v_target_learner uuid;
    v_target_version uuid;
    v_target_question uuid;
    v_target_concept uuid;
    v_target_curriculum uuid;
    v_target_attempt uuid := 'e513dd0a-2ea4-4e53-a505-79db5d699203';
    v_target_queue uuid := 'e513dd0a-2ea4-4e53-a505-79db5d699204';
    v_target_answer_attempt uuid := 'e513dd0a-2ea4-4e53-a505-79db5d699205';
    v_target_mastery uuid := 'e513dd0a-2ea4-4e53-a505-79db5d699206';
    v_target_term uuid := 'e513dd0a-2ea4-4e53-a505-79db5d699207';
    v_adaptive_event_id bigint;
    v_term_exposure_id bigint;
    v_visible integer;
  begin
    select l.id into v_target_learner
    from public.learners l
    where l.workspace_id=v_workspace
      and coalesce((l.metadata->>'is_test')::boolean,false)
    limit 1;

    select q.quiz_version_id,q.id
      into v_target_version,v_target_question
    from public.quiz_questions q
    where q.workspace_id=v_workspace
    order by q.created_at,q.id
    limit 1;

    select c.id,c.curriculum_id
      into v_target_concept,v_target_curriculum
    from public.learning_concepts c
    where c.workspace_id=v_workspace
      and c.curriculum_id is not null
      and not exists (
        select 1
        from public.learner_concept_mastery m
        where m.workspace_id=c.workspace_id
          and m.learner_id=v_target_learner
          and m.concept_id=c.id
      )
    order by c.created_at,c.id
    limit 1;

    if v_target_learner is null
       or v_target_version is null
       or v_target_question is null
       or v_target_concept is null
       or v_target_curriculum is null then
      raise exception 'FRESH_REBUILD_SERVER_OWNED_READ_FIXTURE_MISSING';
    end if;

    insert into auth.users(id) values (v_outsider_user);
    insert into public.workspaces(id,name,slug)
    values (
      v_outsider_workspace,
      'Fresh rebuild outsider workspace',
      'fresh-rebuild-outsider-workspace'
    );
    insert into public.workspace_members(workspace_id,user_id,role)
    values (v_outsider_workspace,v_outsider_user,'owner');

    insert into public.quiz_attempts(
      id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata
    ) values (
      v_target_attempt,v_workspace,v_target_learner,v_target_version,
      'in_progress','learning','{"is_test":true,"qa_scope":"fresh_server_owned_read_isolation"}'::jsonb
    );

    insert into public.quiz_attempt_question_queue(
      id,workspace_id,quiz_attempt_id,sequence_no,question_id,difficulty_level,status
    ) values (
      v_target_queue,v_workspace,v_target_attempt,9002,
      v_target_question,3,'pending'
    );

    insert into public.quiz_answer_attempts(
      id,workspace_id,quiz_attempt_id,question_id,attempt_no,response,is_correct,score_fraction
    ) values (
      v_target_answer_attempt,v_workspace,v_target_attempt,v_target_question,
      1,'{"option_position":1}'::jsonb,false,0
    );

    insert into public.learner_concept_mastery(
      id,workspace_id,learner_id,concept_id,metadata
    ) values (
      v_target_mastery,v_workspace,v_target_learner,v_target_concept,
      '{"is_test":true,"qa_scope":"fresh_server_owned_read_isolation"}'::jsonb
    );

    insert into public.adaptive_events(
      workspace_id,quiz_attempt_id,learner_id,concept_id,event_type,reason,input_state,output_state
    ) values (
      v_workspace,v_target_attempt,v_target_learner,v_target_concept,
      'feedback_served','qa-fresh-server-owned-read-isolation',
      '{"is_test":true}'::jsonb,'{"is_test":true}'::jsonb
    ) returning id into v_adaptive_event_id;

    insert into public.curriculum_concept_terms(
      id,workspace_id,concept_id,curriculum_id,language_code,term,verification_status,metadata
    ) values (
      v_target_term,v_workspace,v_target_concept,v_target_curriculum,
      'en','qa-fresh-server-owned-cross-workspace-term','unverified',
      '{"is_test":true,"qa_scope":"fresh_server_owned_read_isolation"}'::jsonb
    );

    insert into public.learner_term_exposures(
      workspace_id,learner_id,concept_id,term_id,quiz_attempt_id,exposure_type
    ) values (
      v_workspace,v_target_learner,v_target_concept,v_target_term,
      v_target_attempt,'review'
    ) returning id into v_term_exposure_id;

    perform set_config('request.jwt.claim.sub',v_outsider_user::text,true);
    execute 'set local role authenticated';

    select
      (select count(*) from public.quiz_answer_attempts where id=v_target_answer_attempt)
      + (select count(*) from public.quiz_attempt_question_queue where id=v_target_queue)
      + (select count(*) from public.learner_concept_mastery where id=v_target_mastery)
      + (select count(*) from public.adaptive_events where id=v_adaptive_event_id)
      + (select count(*) from public.learner_term_exposures where id=v_term_exposure_id)
    into v_visible;

    if v_visible <> 0 then
      raise exception 'FRESH_REBUILD_SERVER_OWNED_CROSS_WORKSPACE_READ:%',v_visible;
    end if;

    execute 'reset role';

    delete from public.learner_term_exposures where id=v_term_exposure_id;
    delete from public.curriculum_concept_terms where id=v_target_term;
    delete from public.adaptive_events where id=v_adaptive_event_id;
    delete from public.learner_concept_mastery where id=v_target_mastery;
    delete from public.quiz_answer_attempts where id=v_target_answer_attempt;
    delete from public.quiz_attempt_question_queue where id=v_target_queue;
    delete from public.quiz_attempts where id=v_target_attempt;
    delete from public.workspaces where id=v_outsider_workspace;
    delete from auth.users where id=v_outsider_user;
  exception when others then
    execute 'reset role';
    delete from public.learner_term_exposures where id=v_term_exposure_id;
    delete from public.curriculum_concept_terms where id=v_target_term;
    delete from public.adaptive_events where id=v_adaptive_event_id;
    delete from public.learner_concept_mastery where id=v_target_mastery;
    delete from public.quiz_answer_attempts where id=v_target_answer_attempt;
    delete from public.quiz_attempt_question_queue where id=v_target_queue;
    delete from public.quiz_attempts where id=v_target_attempt;
    delete from public.workspaces where id=v_outsider_workspace;
    delete from auth.users where id=v_outsider_user;
    raise;
  end server_owned_cross_workspace_read_contract;

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
             and settings->'self_contained_wording'->>'spec_version'='1.2'
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
            or h.content like '%الطريقة التي يذكرها الدرس%'
            or h.content like '%طريقتي الدرس%'
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


  <<progressive_hint_readability_contract>>
  declare
    v_hint_workspace uuid;
    v_foundations_quiz uuid;
    v_baseline_quiz uuid;
    v_latest uuid;
    v_source uuid;
    v_learning_count integer;
    v_exam_count integer;
    v_hint_count integer;
    v_source_misconception_count integer;
    v_latest_misconception_count integer;
  begin
    select id into v_hint_workspace
    from public.workspaces
    where slug='family-learning-hub'
    limit 1;

    select id into v_foundations_quiz
    from public.quizzes
    where workspace_id=v_hint_workspace
      and slug='sy-g7-arabic-u1-foundations-20260923-a'
      and status='archived'
    limit 1;

    if v_foundations_quiz is null then
      raise exception 'PROGRESSIVE_HINT_FOUNDATIONS_NOT_ARCHIVED';
    end if;

    select id into v_baseline_quiz
    from public.quizzes
    where workspace_id=v_hint_workspace
      and slug='sy-g7-arabic-u1-baseline-20261001'
      and status='active'
    limit 1;

    if v_baseline_quiz is null then
      raise exception 'PROGRESSIVE_HINT_BASELINE_NOT_ACTIVE';
    end if;

    select id,
           (settings->'progressive_hint_readability'->>'source_version_id')::uuid
      into v_latest, v_source
    from public.quiz_versions
    where workspace_id=v_hint_workspace
      and quiz_id=v_baseline_quiz
      and state='published'
    order by version_no desc
    limit 1;

    if v_latest is null
       or v_source is null
       or not exists (
         select 1
         from public.quiz_versions
         where workspace_id=v_hint_workspace
           and id=v_latest
           and settings->'progressive_hint_readability'->>'feature_id'='FLH-FEAT-2026-015'
           and settings->'progressive_hint_readability'->>'minimum_hint_words'='30'
           and settings->'progressive_hint_readability'->>'learner_visible_bullets'='3'
       ) then
      raise exception 'PROGRESSIVE_HINT_LATEST_VERSION_INVALID';
    end if;

    if not exists (
      select 1
      from public.quiz_versions
      where workspace_id=v_hint_workspace
        and id=v_source
        and quiz_id=v_baseline_quiz
        and state='published'
    ) then
      raise exception 'PROGRESSIVE_HINT_SOURCE_VERSION_MISSING';
    end if;

    select count(*) into v_learning_count
    from public.quiz_questions
    where workspace_id=v_hint_workspace
      and quiz_version_id=v_latest
      and delivery_role='core';

    select count(*) into v_exam_count
    from public.quiz_questions
    where workspace_id=v_hint_workspace
      and quiz_version_id=v_latest
      and delivery_role='exam_pool';

    select count(*) into v_hint_count
    from public.quiz_question_hints h
    join public.quiz_questions q
      on q.workspace_id=h.workspace_id and q.id=h.question_id
    where q.workspace_id=v_hint_workspace
      and q.quiz_version_id=v_latest
      and q.delivery_role='core';

    if v_learning_count <> 20 or v_exam_count <> 20 or v_hint_count <> 80 then
      raise exception 'PROGRESSIVE_HINT_COUNTS_INVALID:%:%:%',
        v_learning_count, v_exam_count, v_hint_count;
    end if;

    select count(*) into v_source_misconception_count
    from public.question_option_misconceptions qom
    join public.quiz_question_options o
      on o.workspace_id=qom.workspace_id and o.id=qom.option_id
    join public.quiz_questions q
      on q.workspace_id=o.workspace_id and q.id=o.question_id
    where q.workspace_id=v_hint_workspace
      and q.quiz_version_id=v_source;

    select count(*) into v_latest_misconception_count
    from public.question_option_misconceptions qom
    join public.quiz_question_options o
      on o.workspace_id=qom.workspace_id and o.id=qom.option_id
    join public.quiz_questions q
      on q.workspace_id=o.workspace_id and q.id=o.question_id
    where q.workspace_id=v_hint_workspace
      and q.quiz_version_id=v_latest;

    if v_latest_misconception_count <> v_source_misconception_count then
      raise exception 'PROGRESSIVE_HINT_MISCONCEPTION_MAPPING_COUNT_INVALID:%:%',
        v_source_misconception_count, v_latest_misconception_count;
    end if;

    if exists (
      select 1
      from public.quiz_questions q
      left join public.quiz_question_hints h
        on h.workspace_id=q.workspace_id and h.question_id=q.id
      where q.workspace_id=v_hint_workspace
        and q.quiz_version_id=v_latest
        and q.delivery_role='core'
      group by q.id
      having count(h.question_id)<>4
         or min(h.hint_level)<>1
         or max(h.hint_level)<>4
         or count(distinct h.hint_level)<>4
    ) then
      raise exception 'PROGRESSIVE_HINT_FOUR_LEVELS_INVALID';
    end if;

    if exists (
      select 1
      from public.quiz_question_hints h
      join public.quiz_questions q
        on q.workspace_id=h.workspace_id and q.id=h.question_id
      where q.workspace_id=v_hint_workspace
        and q.quiz_version_id=v_latest
        and q.delivery_role<>'core'
    ) then
      raise exception 'PROGRESSIVE_HINT_EXAM_HINTS_PRESENT';
    end if;

    if exists (
      select 1
      from public.quiz_question_hints h
      join public.quiz_questions q
        on q.workspace_id=h.workspace_id and q.id=h.question_id
      cross join lateral (
        select count(*) as line_count,
               bool_or(btrim(line) !~ '^•[[:space:]]+[^[:space:]]') as invalid_line
        from regexp_split_to_table(h.content,E'\n') line
        where btrim(line)<>''
      ) shape
      where q.workspace_id=v_hint_workspace
        and q.quiz_version_id=v_latest
        and q.delivery_role='core'
        and (shape.line_count<>3 or shape.invalid_line)
    ) then
      raise exception 'PROGRESSIVE_HINT_BULLET_STRUCTURE_INVALID';
    end if;

    if exists (
      select 1
      from public.quiz_question_hints h
      join public.quiz_questions q
        on q.workspace_id=h.workspace_id and q.id=h.question_id
      where q.workspace_id=v_hint_workspace
        and q.quiz_version_id=v_latest
        and q.delivery_role='core'
        and cardinality(
          regexp_split_to_array(
            btrim(replace(h.content,'•','')),
            '[[:space:]]+'
          )
        )<30
    ) then
      raise exception 'PROGRESSIVE_HINT_MIN_WORDS_INVALID';
    end if;

    if exists (
      select 1
      from public.quiz_questions q
      join public.quiz_question_hints h
        on h.workspace_id=q.workspace_id and h.question_id=q.id
      join public.quiz_question_answer_keys k
        on k.workspace_id=q.workspace_id and k.question_id=q.id
      join public.quiz_question_options o
        on o.workspace_id=q.workspace_id
       and o.question_id=q.id
       and o.position=nullif(k.correct_answer->>'option_position','')::integer
      where q.workspace_id=v_hint_workspace
        and q.quiz_version_id=v_latest
        and q.delivery_role='core'
        and btrim(o.content)<>''
        and position(lower(btrim(o.content)) in lower(h.content))>0
    ) then
      raise exception 'PROGRESSIVE_HINT_ANSWER_LEAK';
    end if;

    if (
      select count(*)
      from public.quiz_versions
      where workspace_id=v_hint_workspace
        and quiz_id=v_baseline_quiz
    ) < 3 then
      raise exception 'PROGRESSIVE_HINT_HISTORICAL_VERSIONS_NOT_PRESERVED';
    end if;
  end progressive_hint_readability_contract;


  <<question_code_search_path_contract>>
  declare
    v_qc_workspace uuid;
    v_qc_version uuid;
    v_generated_id uuid := 'f0190000-0000-4000-8000-000000000001';
    v_explicit_id uuid := 'f0190000-0000-4000-8000-000000000002';
    v_whitespace_id uuid := 'f0190000-0000-4000-8000-000000000003';
    v_generated_code text;
    v_whitespace_code text;
    v_explicit_code text;
  begin
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname='assign_question_public_code'
        and pg_get_function_identity_arguments(p.oid)=''
        and not p.prosecdef
        and p.proconfig @> array['search_path=""']::text[]
    ) then
      raise exception 'QUESTION_CODE_TRIGGER_FUNCTION_SECURITY_INVALID';
    end if;

    if not exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
        and c.relname='quiz_questions'
        and t.tgname='trg_assign_question_public_code'
        and not t.tgisinternal
        and t.tgenabled<>'D'
    ) then
      raise exception 'QUESTION_CODE_TRIGGER_MISSING_OR_DISABLED';
    end if;

    select id into v_qc_workspace
    from public.workspaces
    where slug='family-learning-hub'
    limit 1;

    select id into v_qc_version
    from public.quiz_versions
    where workspace_id=v_qc_workspace
    order by created_at,id
    limit 1;

    if v_qc_workspace is null or v_qc_version is null then
      raise exception 'QUESTION_CODE_TRIGGER_FIXTURE_MISSING';
    end if;

    insert into public.quiz_questions(
      id,workspace_id,quiz_version_id,position,question_type,prompt
    ) values (
      v_generated_id,v_qc_workspace,v_qc_version,900001,'single_choice',
      'QA generated public question code'
    )
    returning question_code into v_generated_code;

    if v_generated_code !~ '^Q-[0-9]{6,}$' then
      raise exception 'QUESTION_CODE_TRIGGER_GENERATION_INVALID:%',v_generated_code;
    end if;

    insert into public.quiz_questions(
      id,workspace_id,quiz_version_id,position,question_type,prompt,question_code
    ) values (
      v_whitespace_id,v_qc_workspace,v_qc_version,900003,'single_choice',
      'QA whitespace public question code','   '
    )
    returning question_code into v_whitespace_code;

    if v_whitespace_code !~ '^Q-[0-9]{6,}$' then
      raise exception 'QUESTION_CODE_TRIGGER_WHITESPACE_GENERATION_INVALID:%',v_whitespace_code;
    end if;

    insert into public.quiz_questions(
      id,workspace_id,quiz_version_id,position,question_type,prompt,question_code
    ) values (
      v_explicit_id,v_qc_workspace,v_qc_version,900002,'single_choice',
      'QA explicit public question code','Q-999999999'
    )
    returning question_code into v_explicit_code;

    if v_explicit_code <> 'Q-999999999' then
      raise exception 'QUESTION_CODE_TRIGGER_EXPLICIT_CODE_CHANGED:%',v_explicit_code;
    end if;

    delete from public.quiz_questions
    where id in (v_generated_id,v_explicit_id,v_whitespace_id);
  exception when others then
    delete from public.quiz_questions
    where id in (v_generated_id,v_explicit_id,v_whitespace_id);
    raise;
  end question_code_search_path_contract;

end;
$contract$;
