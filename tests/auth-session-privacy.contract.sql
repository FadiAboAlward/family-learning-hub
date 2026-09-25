-- FLH-FEAT-2026-005 deterministic authorization/privacy contract.
-- Fixture writes use deterministic IDs and are explicitly cleaned up on success.
-- CI resets/stops the disposable local database after failures.
do $$
declare
  v_def text;
  v_policy text;
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

  execute 'reset role';

  -- Workspace cascade removes its test membership, learner, badge and
  -- learner_badges row; auth users are then removed separately.
  delete from public.workspaces where id=v_workspace;
  delete from auth.users where id in (v_user_a,v_user_b);
end
$;
