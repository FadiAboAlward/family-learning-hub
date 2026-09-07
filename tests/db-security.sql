do $$
declare
  v_rls boolean;
  v_service_bypass boolean;
  fn text;
begin
  select c.relrowsecurity into v_rls
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='learner_content_assignments';

  if v_rls is distinct from true then
    raise exception 'learner_content_assignments must have RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='learner_content_assignments'
  ) then
    raise exception 'learner_content_assignments must not expose client-facing RLS policies';
  end if;

  if has_table_privilege('anon','public.learner_content_assignments','SELECT')
     or has_table_privilege('anon','public.learner_content_assignments','INSERT')
     or has_table_privilege('anon','public.learner_content_assignments','UPDATE')
     or has_table_privilege('anon','public.learner_content_assignments','DELETE') then
    raise exception 'anon still has direct learner_content_assignments privileges';
  end if;

  if has_table_privilege('authenticated','public.learner_content_assignments','SELECT')
     or has_table_privilege('authenticated','public.learner_content_assignments','INSERT')
     or has_table_privilege('authenticated','public.learner_content_assignments','UPDATE')
     or has_table_privilege('authenticated','public.learner_content_assignments','DELETE') then
    raise exception 'authenticated still has direct learner_content_assignments privileges';
  end if;

  if not has_table_privilege('service_role','public.learner_content_assignments','SELECT')
     or not has_table_privilege('service_role','public.learner_content_assignments','INSERT')
     or not has_table_privilege('service_role','public.learner_content_assignments','UPDATE')
     or not has_table_privilege('service_role','public.learner_content_assignments','DELETE') then
    raise exception 'service_role is missing required learner_content_assignments privileges';
  end if;

  select rolbypassrls into v_service_bypass from pg_roles where rolname='service_role';
  if v_service_bypass is distinct from true then
    raise exception 'service_role must bypass RLS for the Edge Function access model';
  end if;

  foreach fn in array array[
    'public.validate_learner_content_assignment_resource()',
    'public.sync_test_content_assignment()',
    'public.sync_content_assignment_quiz_access()',
    'public.sync_published_quiz_direct_access()'
  ] loop
    if has_function_privilege('anon',fn,'EXECUTE') then
      raise exception 'anon can still execute %', fn;
    end if;
    if has_function_privilege('authenticated',fn,'EXECUTE') then
      raise exception 'authenticated can still execute %', fn;
    end if;
    if not has_function_privilege('service_role',fn,'EXECUTE') then
      raise exception 'service_role cannot execute %', fn;
    end if;
  end loop;
end
$$;

set role service_role;
select count(*) as service_role_can_read_protected_table
from public.learner_content_assignments;
reset role;

select 'database security contract passed' as result;
