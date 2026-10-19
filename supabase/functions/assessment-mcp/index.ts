import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { assessmentMcpHttp } from './handler.mjs';
import { createBackendPerformanceTrace } from '../_shared/backend-performance.mjs';

const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const workspaceId='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
Deno.serve((req:Request)=>assessmentMcpHttp(req,{
  admin,workspaceId,
  env:{enabled:Deno.env.get('FLH_ASSESSMENT_MCP_ENABLED'),resource:Deno.env.get('FLH_ASSESSMENT_MCP_RESOURCE'),issuer:Deno.env.get('SUPABASE_URL')+'/auth/v1',clientIds:Deno.env.get('FLH_ASSESSMENT_MCP_CLIENT_IDS')},
  trace:createBackendPerformanceTrace({region:Deno.env.get('SB_REGION')||'unknown'}),
  providerOptions:{apiKey:Deno.env.get('YOUTUBE_API_KEY')}
}));
