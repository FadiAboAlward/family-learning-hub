-- FLH-FEAT-2026-005 deterministic authorization/privacy contract.
do $$
declare
  v_def text;
  v_policy text;
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
end
$$;
