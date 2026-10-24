import { assessmentParent } from '../_shared/assessment-parent-auth.mjs';

/** No shared secret, parent JWT scraping, or administrative-token fallback. */
export function mcpConfiguration(env) {
  const resource=env.resource, issuer=env.issuer;
  if(env.enabled!=='true' || !resource || !issuer || !env.clientIds) throw new Error('ASSESSMENT_MCP_DISABLED');
  for(const value of [resource,issuer]) {
    let u; try { u=new URL(value); } catch { throw new Error('ASSESSMENT_MCP_DISABLED'); }
    if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash || u.href!==value) throw new Error('ASSESSMENT_MCP_DISABLED');
  }
  if(!resource.endsWith('/assessment-mcp/mcp') || !issuer.endsWith('/auth/v1') || new URL(resource).origin!==new URL(issuer).origin) throw new Error('ASSESSMENT_MCP_DISABLED');
  const clientIds=env.clientIds.split(',').map(s=>s.trim()).filter(Boolean);
  if(!clientIds.length || clientIds.includes('*')) throw new Error('ASSESSMENT_MCP_DISABLED');
  return {resource,issuer,clientIds,metadataUrl:resource.replace(/\/mcp$/,'/.well-known/oauth-protected-resource')};
}

/** Called only after Auth cryptographically verifies the JWT, never on decoded input. */
export function requireMcpClaims(claims,config,now=Date.now()) {
  if(!claims || claims.iss!==config.issuer || claims.aud!==config.resource || claims.role!=='authenticated'
      || claims.is_anonymous===true || typeof claims.sub!=='string' || !claims.sub
      || !config.clientIds.includes(claims.client_id) || !Number.isFinite(claims.exp) || claims.exp<=now/1000
      || (claims.nbf!==undefined && (!Number.isFinite(claims.nbf)||claims.nbf>now/1000))
      || typeof claims.scope!=='string' || !claims.scope.split(' ').includes('openid')) throw new Error('AUTH_REQUIRED');
  return claims.sub;
}

export async function authenticateAssessmentMcp(admin,workspaceId,req,config) {
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer ') || auth.length>16384) throw new Error('AUTH_REQUIRED');
  const {data,error}=await admin.auth.getClaims(auth.slice(7).trim());
  if(error) throw new Error('AUTH_REQUIRED');
  const sub=requireMcpClaims(data?.claims,config);
  const parent=await assessmentParent(admin,workspaceId,req);
  if(parent!==sub) throw new Error('AUTH_REQUIRED');
  return parent;
}
