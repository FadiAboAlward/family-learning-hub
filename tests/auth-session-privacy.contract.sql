-- FLH-FEAT-2026-005 deterministic authorization/privacy contract.
-- Fixture writes use deterministic IDs and are explicitly cleaned up on success.
-- CI resets/stops the disposable local database after failures.
do $$
declare
  v_def text;
  v_policy text;
  v_relation text;
  v_workspace uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699001';
  v_user_a uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699002';
  v_user_b uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699003';
  v_learner uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699004';
  v_badge uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699005';
  v_learner_badge uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699006';
  v_visible integer;
  v_member boolean;
  v_role text;
begin
  select pg_get_functiondef('private.workspace_role(uuid,uuid)'::regprocedure)
  into v_def;
  if v_def not like '%wm.user_id = (select auth.uid())%'
     or v_def not like '%p_user_id = (select auth.uid())%' then
    raise exception 'workspace_role is not bound to auth.uid()';
  end if;

  select pg_get_functiondef('private.is_workspace_member(uuid,uuid)'::regprocedure)
  into v_def;
  if v_def not like '%p_user_id = (select auth.uid())%'
     or v_def not like '%wm.user_id = (select auth.uid())%' then
    raise exception 'is_workspace_member is not bound to auth.uid()';
  end if;

  select pg_get_functiondef('private.can_manage_learning(uuid,uuid)'::regprocedure)
  into v_def;
  if v_def not like '%p_user_id = (select auth.uid())%'
     or v_def not like '%private.workspace_role(p_workspace_id, (select auth.uid()))%' then
    raise exception 'can_manage_learning is not bound to auth.uid()';
  end if;

  if has_function_privilege('anon','private.workspace_role(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','private.is_workspace_member(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','private.can_manage_learning(uuid,uuid)','EXECUTE') then
    raise exception 'anon can execute private authorization helpers';
  end if;

  if not has_function_privilege('authenticated','private.workspace_role(uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','private.is_workspace_member(uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','private.can_manage_learning(uuid,uuid)','EXECUTE') then
    raise exception 'authenticated RLS helper execution is missing';
  end if;

  foreach v_policy in array array[
    'learner_badges_read',
    'reward_claims_read',
    'learner_gamification_state_read',
    'gamification_events_read'
  ] loop
    if not exists (
      select 1
      from pg_policies
      where schemaname='public'
        and policyname=v_policy
        and roles @> array['authenticated']::name[]
        and cmd='SELECT'
        and qual like '%private.can_manage_learning(workspace_id, ( SELECT auth.uid() AS uid))%'
    ) then
      raise exception 'learner-specific gamification policy % is not manager scoped', v_policy;
    end if;
  end loop;

  if exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='learner_learning_sessions'
      and roles @> array['authenticated']::name[]
  ) then
    raise exception 'authenticated learner_learning_sessions policy still exists';
  end if;

  if has_table_privilege('authenticated','public.learner_learning_sessions','SELECT')
     or has_table_privilege('authenticated','public.learner_learning_sessions','INSERT')
     or has_table_privilege('authenticated','public.learner_learning_sessions','UPDATE')
     or has_table_privilege('authenticated','public.learner_learning_sessions','DELETE') then
    raise exception 'authenticated still has direct learner_learning_sessions CRUD access';
  end if;

  if has_table_privilege('anon','public.learner_learning_sessions','SELECT')
     or has_table_privilege('anon','public.learner_learning_sessions','INSERT')
     or has_table_privilege('anon','public.learner_learning_sessions','UPDATE')
     or has_table_privilege('anon','public.learner_learning_sessions','DELETE') then
    raise exception 'anon has direct learner_learning_sessions CRUD access';
  end if;

  if not has_table_privilege('service_role','public.learner_learning_sessions','SELECT')
     or not has_table_privilege('service_role','public.learner_learning_sessions','INSERT')
     or not has_table_privilege('service_role','public.learner_learning_sessions','UPDATE')
     or not has_table_privilege('service_role','public.learner_learning_sessions','DELETE') then
    raise exception 'service_role is missing learner_learning_sessions CRUD access';
  end if;

  -- v1.1: browser-authenticated roles may read the existing scoped views of
  -- server-owned academic state, but they must not mutate those base tables.
  foreach v_relation in array array[
    'quiz_answer_attempts',
    'quiz_attempt_question_queue',
    'learner_concept_mastery',
    'adaptive_events',
    'learner_term_exposures'
  ] loop
    if not has_table_privilege('authenticated',format('public.%I',v_relation),'SELECT') then
      raise exception 'authenticated lost required read visibility on %', v_relation;
    end if;

    if has_table_privilege('authenticated',format('public.%I',v_relation),'INSERT')
       or has_table_privilege('authenticated',format('public.%I',v_relation),'UPDATE')
       or has_table_privilege('authenticated',format('public.%I',v_relation),'DELETE')
       or has_table_privilege('authenticated',format('public.%I',v_relation),'TRUNCATE')
       or has_table_privilege('authenticated',format('public.%I',v_relation),'REFERENCES')
       or has_table_privilege('authenticated',format('public.%I',v_relation),'TRIGGER') then
      raise exception 'authenticated retains direct mutation/DDL privilege on %', v_relation;
    end if;

    if has_table_privilege('anon',format('public.%I',v_relation),'INSERT')
       or has_table_privilege('anon',format('public.%I',v_relation),'UPDATE')
       or has_table_privilege('anon',format('public.%I',v_relation),'DELETE')
       or has_table_privilege('anon',format('public.%I',v_relation),'TRUNCATE')
       or has_table_privilege('anon',format('public.%I',v_relation),'REFERENCES')
       or has_table_privilege('anon',format('public.%I',v_relation),'TRIGGER') then
      raise exception 'anon retains direct mutation privilege on %', v_relation;
    end if;

    if not has_table_privilege('service_role',format('public.%I',v_relation),'SELECT')
       or not has_table_privilege('service_role',format('public.%I',v_relation),'INSERT')
       or not has_table_privilege('service_role',format('public.%I',v_relation),'UPDATE')
       or not has_table_privilege('service_role',format('public.%I',v_relation),'DELETE') then
      raise exception 'service_role lost required server CRUD on %', v_relation;
    end if;

    if exists (
      select 1
      from pg_policies
      where schemaname='public'
        and tablename=v_relation
        and roles @> array['authenticated']::name[]
        and cmd in ('INSERT','UPDATE','DELETE','ALL')
    ) then
      raise exception 'authenticated mutation policy remains on %', v_relation;
    end if;

    if not exists (
      select 1
      from pg_policies
      where schemaname='public'
        and tablename=v_relation
        and roles @> array['authenticated']::name[]
        and cmd='SELECT'
        and coalesce(qual,'') ~ 'private\.(is_workspace_member|can_manage_learning|workspace_role)\('
    ) then
      raise exception 'authenticated scoped read policy missing on %', v_relation;
    end if;
  end loop;

  -- v1.1 behavioral cross-workspace read isolation. Structural policy-text
  -- checks are not sufficient because permissive policies are OR-combined.
  <<server_owned_read_isolation>>
  declare
    v_target_workspace uuid;
    v_target_learner uuid;
    v_target_version uuid;
    v_target_question uuid;
    v_target_concept uuid;
    v_target_curriculum uuid;
    v_target_attempt uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699101';
    v_target_queue uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699102';
    v_target_answer_attempt uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699103';
    v_target_mastery uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699104';
    v_target_term uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699105';
    v_outsider_user uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699106';
    v_outsider_workspace uuid := 'd513dd0a-2ea4-4e53-a505-79db5d699107';
    v_adaptive_event_id bigint;
    v_term_exposure_id bigint;
    v_cross_visible integer;
  begin
    select w.id into v_target_workspace
    from public.workspaces w
    where w.slug='family-learning-hub'
    limit 1;

    select l.id into v_target_learner
    from public.learners l
    where l.workspace_id=v_target_workspace
      and coalesce((l.metadata->>'is_test')::boolean,false)
    limit 1;

    select q.quiz_version_id,q.id
      into v_target_version,v_target_question
    from public.quiz_questions q
    where q.workspace_id=v_target_workspace
    order by q.created_at,q.id
    limit 1;

    select c.id,c.curriculum_id
      into v_target_concept,v_target_curriculum
    from public.learning_concepts c
    where c.workspace_id=v_target_workspace
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

    if v_target_workspace is null
       or v_target_learner is null
       or v_target_version is null
       or v_target_question is null
       or v_target_concept is null
       or v_target_curriculum is null then
      raise exception 'server-owned cross-workspace fixture prerequisites missing';
    end if;

    insert into public.quiz_attempts(
      id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata
    ) values (
      v_target_attempt,v_target_workspace,v_target_learner,v_target_version,
      'in_progress','learning','{"is_test":true,"qa_scope":"server_owned_read_isolation"}'::jsonb
    );

    insert into public.quiz_attempt_question_queue(
      id,workspace_id,quiz_attempt_id,sequence_no,question_id,difficulty_level,status
    ) values (
      v_target_queue,v_target_workspace,v_target_attempt,9001,
      v_target_question,3,'pending'
    );

    insert into public.quiz_answer_attempts(
      id,workspace_id,quiz_attempt_id,question_id,attempt_no,response,is_correct,score_fraction
    ) values (
      v_target_answer_attempt,v_target_workspace,v_target_attempt,v_target_question,
      1,'{"option_position":1}'::jsonb,false,0
    );

    insert into public.learner_concept_mastery(
      id,workspace_id,learner_id,concept_id,metadata
    ) values (
      v_target_mastery,v_target_workspace,v_target_learner,v_target_concept,
      '{"is_test":true,"qa_scope":"server_owned_read_isolation"}'::jsonb
    );

    insert into public.adaptive_events(
      workspace_id,quiz_attempt_id,learner_id,concept_id,event_type,reason,input_state,output_state
    ) values (
      v_target_workspace,v_target_attempt,v_target_learner,v_target_concept,
      'feedback_served','qa-server-owned-read-isolation',
      '{"is_test":true}'::jsonb,'{"is_test":true}'::jsonb
    ) returning id into v_adaptive_event_id;

    insert into public.curriculum_concept_terms(
      id,workspace_id,concept_id,curriculum_id,language_code,term,verification_status,metadata
    ) values (
      v_target_term,v_target_workspace,v_target_concept,v_target_curriculum,
      'en','qa-server-owned-cross-workspace-term','unverified',
      '{"is_test":true,"qa_scope":"server_owned_read_isolation"}'::jsonb
    );

    insert into public.learner_term_exposures(
      workspace_id,learner_id,concept_id,term_id,quiz_attempt_id,exposure_type
    ) values (
      v_target_workspace,v_target_learner,v_target_concept,v_target_term,
      v_target_attempt,'review'
    ) returning id into v_term_exposure_id;

    insert into auth.users(id) values (v_outsider_user);
    insert into public.workspaces(id,name,slug)
    values (
      v_outsider_workspace,
      'QA server-owned outsider workspace',
      'qa-server-owned-outsider-workspace'
    );
    insert into public.workspace_members(workspace_id,user_id,role)
    values (v_outsider_workspace,v_outsider_user,'owner');

    perform set_config('request.jwt.claim.sub',v_outsider_user::text,true);
    execute 'set local role authenticated';

    select
      (select count(*) from public.quiz_answer_attempts where id=v_target_answer_attempt)
      + (select count(*) from public.quiz_attempt_question_queue where id=v_target_queue)
      + (select count(*) from public.learner_concept_mastery where id=v_target_mastery)
      + (select count(*) from public.adaptive_events where id=v_adaptive_event_id)
      + (select count(*) from public.learner_term_exposures where id=v_term_exposure_id)
    into v_cross_visible;

    if v_cross_visible <> 0 then
      raise exception 'authenticated user can read server-owned state from another workspace: %',v_cross_visible;
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
  end server_owned_read_isolation;

  -- Behavioral negative-access fixture. User A is an ordinary viewer while
  -- user B is a manager in the same workspace. A must not be able to use B's
  -- identity in helpers or read a real existing learner_badges row.
  insert into auth.users(id) values (v_user_a), (v_user_b);

  insert into public.workspaces(id,name,slug)
  values (v_workspace,'QA auth privacy workspace','qa-auth-privacy-workspace');

  insert into public.workspace_members(workspace_id,user_id,role)
  values
    (v_workspace,v_user_a,'viewer'),
    (v_workspace,v_user_b,'owner');

  insert into public.learners(id,workspace_id,display_name,slug,grade_level,metadata)
  values (v_learner,v_workspace,'QA learner','qa-auth-privacy-learner',7,'{"is_test":true}'::jsonb);

  insert into public.gamification_badges(id,workspace_id,code,title,metadata)
  values (v_badge,v_workspace,'qa-auth-privacy-badge','QA auth privacy badge','{"is_test":true}'::jsonb);

  insert into public.learner_badges(id,workspace_id,learner_id,badge_id,award_reason,metadata)
  values (
    v_learner_badge,v_workspace,v_learner,v_badge,
    'qa-auth-session-privacy','{"is_test":true}'::jsonb
  );

  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  execute 'set local role authenticated';

  select private.is_workspace_member(v_workspace,v_user_a)
  into v_member;
  if v_member is distinct from true then
    raise exception 'positive control failed: user A is not recognized as member';
  end if;

  select private.workspace_role(v_workspace,v_user_a)
  into v_role;
  if v_role is distinct from 'viewer' then
    raise exception 'positive control failed: user A role is not viewer: %', v_role;
  end if;

  select private.is_workspace_member(v_workspace,v_user_b)
  into v_member;
  if v_member is distinct from false then
    raise exception 'user A can authorize user B through is_workspace_member';
  end if;

  select private.workspace_role(v_workspace,v_user_b)
  into v_role;
  if v_role is not null then
    raise exception 'user A can reveal user B role through workspace_role: %', v_role;
  end if;

  select count(*) into v_visible
  from public.learner_badges
  where id=v_learner_badge;
  if v_visible <> 0 then
    raise exception 'non-manager authenticated member can read learner_badges row';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  select count(*) into v_visible
  from public.learner_badges
  where id=v_learner_badge;
  if v_visible <> 1 then
    raise exception 'positive control failed: owner cannot read learner_badges row';
  end if;

  execute 'reset role';

  -- Workspace cascade removes its test membership, learner, badge and
  -- learner_badges row; auth users are then removed separately.
  delete from public.workspaces where id=v_workspace;
  delete from auth.users where id in (v_user_a,v_user_b);
end
$$;
