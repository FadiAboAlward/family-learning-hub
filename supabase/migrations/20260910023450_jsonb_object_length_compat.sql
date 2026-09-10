-- Compatibility helper for PostgreSQL versions that do not expose a built-in
-- jsonb_object_length(jsonb). The paper-ingestion migration uses this helper
-- to validate exact object cardinality before accepting a paper model/queue.

create or replace function public.jsonb_object_length(p_value jsonb)
returns integer
language sql
immutable
strict
parallel safe
set search_path to 'pg_catalog'
as $function$
  select count(*)::integer from jsonb_each(p_value);
$function$;

revoke all on function public.jsonb_object_length(jsonb) from public;
revoke all on function public.jsonb_object_length(jsonb) from anon, authenticated;
grant execute on function public.jsonb_object_length(jsonb) to service_role;
