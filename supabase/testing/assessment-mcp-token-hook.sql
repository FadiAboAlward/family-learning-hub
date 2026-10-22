-- FLH-033 activation config for the independently approved FREE TESTING project ONLY.
-- Not an automatic migration; never apply/enable on Production.
-- Public OAuth client, no client secret. Other clients and ordinary sessions remain unchanged.
create or replace function public.flh_assessment_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
begin
  -- Supabase Custom Access Token input carries the OAuth client inside claims.
  if event->'claims'->>'client_id' = 'd555d742-2195-4676-bf35-e3d09c25077a' then
    if event->'claims'->>'role' is distinct from 'authenticated' then
      raise exception 'MCP_OAUTH_ROLE_INVALID';
    end if;
    event := jsonb_set(event, '{claims,aud}',
      '"https://gzfbkudvvxthbhjsmwsc.supabase.co/functions/v1/assessment-mcp/mcp"'::jsonb);
  end if;
  return event;
end;
$$;
revoke all on function public.flh_assessment_mcp_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.flh_assessment_mcp_access_token_hook(jsonb) to supabase_auth_admin;
