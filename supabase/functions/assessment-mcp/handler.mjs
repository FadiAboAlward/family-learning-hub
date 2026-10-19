import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { assessmentAuthoringTool } from '../_shared/assessment-authoring.mjs';
import { authenticateAssessmentMcp, mcpConfiguration } from './auth.mjs';

const uuid=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/);
const target=z.object({quiz_id:uuid,quiz_version_id:uuid,learner_id:uuid,program_id:uuid}).strict();
// Academic fields evolve under the canonical validator; do not define a second academic schema.
const candidate=z.object({academic_context:z.record(z.unknown()),blueprint:z.array(z.record(z.unknown())).max(40),questions:z.array(z.record(z.unknown())).length(40)}).passthrough();
const review=z.object({result:z.literal('PASS'),candidate_sha256:hash,workspace_id:uuid,quiz_id:uuid,quiz_version_id:uuid,learner_id:uuid,program_id:uuid,
  reviewer_ref:z.string().min(1),source_review_ref:z.string().min(1),learner_scope_review_ref:z.string().min(1),authority_ref:z.string().min(1),
  reviewed_at:z.string().datetime({offset:true}),warning_dispositions:z.array(z.object({code:z.string(),path:z.string(),result:z.literal('ACCEPTED'),reason:z.string().min(1)}).passthrough())}).strict();
const request={request_id:uuid},pointer={...request,candidate_sha256:hash};
export const ASSESSMENT_MCP_TOOLS=Object.freeze([
  {name:'validate_assessment_candidate',description:'Validate the exact unpublished 20 Learning + 20 Exam academic candidate and compute SHA-256. This does not perform semantic/source review. Follow the current academic SOP and review warnings.',schema:z.object({candidate}).strict(),read:true},
  {name:'create_assessment_draft',description:'Create a NEW empty draft quiz, version and program link atomically after exact academic and semantic/source/learner review. Persist one request UUID and target UUIDs before calling; reuse them unchanged on retry. Never adopt an existing or previously safety-blocked assessment.',schema:z.object({...request,target,candidate,semantic_review:review,quiz:z.object({slug:z.string().min(1).max(160),title:z.string().min(1).max(300),subject_id:z.number().int().positive(),curriculum_id:uuid}).strict()}).strict()},
  {name:'read_assessment_authoring',description:'Read authoritative draft/staged/held/released state by original request UUID after interruption or any uncertain write. Includes target, content hash, counts and released links, never answer keys or tokens. Do not regenerate an uncertain request.',schema:z.object(request).strict(),read:true},
  {name:'stage_assessment',description:'Import the exact reviewed candidate questions/options/hints using the existing application academic and semantic stage gate. Only a new integration-owned request is accepted. Returns authoritative readback.',schema:z.object({...pointer,target,candidate,semantic_review:review}).strict()},
  {name:'publish_assessment',description:'Publish the staged immutable version into HELD, still hidden from the learner. Uses the existing publication gate. Returns authoritative readback; release still requires reviewed provider-verified video.',schema:z.object(pointer).strict()},
  {name:'attach_optional_video',description:'Attach a semantically reviewed exact-context video to this HELD request. Official YouTube provider checks run server-side. Watching remains optional and Exam is video-free. Always reuse the explicit sequence position on retry.',schema:z.object({...pointer,candidate:z.object({learner_id:uuid,quiz_version_id:uuid,program_id:uuid,curriculum_id:uuid,grade_level:z.number().int().min(1).max(12),subject_id:z.number().int().positive(),concept_id:uuid,position:z.number().int().min(1).max(20),video_ref:z.string().regex(/^[A-Za-z0-9_-]{11}$/),title:z.string().min(1).max(200),language:z.enum(['ar','tr','en']),rationale:z.string().min(1).max(1000),learning_outcomes:z.array(z.string().min(1).max(160)).min(1).max(3).optional()}).strict()}).strict(),open:true},
  {name:'release_assessment',description:'Release only this new integration-owned HELD assessment through the existing atomic authorization/content/video/rollout gates and read back its final status and links. Never retry a tool-safety-blocked operation through another tool or transport. Email is a separate authorized Gmail operation.',schema:z.object(pointer).strict()}
]);

/** Fixed safe codes only: unexpected backend messages/bodies never become model output. */
export function safeMcpError(error) {
  return /^(?:ASSESSMENT_[A-Z_]+|VIDEO_[A-Z_]+|INVALID_VIDEO_INPUT|INVALID_PARENT_SESSION|AUTH_REQUIRED)$/.test(error?.message||'')?error.message:'ASSESSMENT_UNAVAILABLE';
}

export function createAssessmentMcpServer({admin,workspaceId,parentId,trace,providerOptions}) {
  const server=new McpServer({name:'family-learning-hub-assessment-authoring',version:'1.0.0'});
  for(const tool of ASSESSMENT_MCP_TOOLS) server.registerTool(tool.name,{
    description:tool.description,inputSchema:tool.schema,
    annotations:{readOnlyHint:tool.read===true,destructiveHint:['publish_assessment','attach_optional_video','release_assessment'].includes(tool.name),idempotentHint:true,openWorldHint:tool.open===true},
    _meta:{securitySchemes:[{type:'oauth2',scopes:['openid']}]}
  },async args=>{
    try {
      const result=await assessmentAuthoringTool(admin,workspaceId,parentId,tool.name,args,trace,providerOptions);
      return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
    } catch(error) { return {isError:true,content:[{type:'text',text:safeMcpError(error)}]}; }
  });
  return server;
}

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
/** Stateless official SDK transport; each request gets its own verified parent closure. */
export async function assessmentMcpHttp(req,{admin,workspaceId,env,trace,providerOptions}) {
  let config; try { config=mcpConfiguration(env); } catch { return json({error:'ASSESSMENT_MCP_DISABLED'},503); }
  const url=new URL(req.url), resource=new URL(config.resource);
  if(req.headers.has('origin') && req.headers.get('origin')!==resource.origin) return json({error:'ORIGIN_FORBIDDEN'},403);
  if(url.pathname===new URL(config.metadataUrl).pathname && req.method==='GET') return json({resource:config.resource,authorization_servers:[config.issuer],scopes_supported:['openid'],bearer_methods_supported:['header']});
  if(url.pathname!==resource.pathname) return json({error:'NOT_FOUND'},404);
  if(req.method!=='POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
  let parentId;
  try { parentId=await authenticateAssessmentMcp(admin,workspaceId,req,config); }
  catch(error) {
    if(error?.message==='VIDEO_ATTACHMENT_FORBIDDEN') return json({error:'ASSESSMENT_FORBIDDEN'},403);
    return json({error:'AUTH_REQUIRED'},401,{'WWW-Authenticate':`Bearer resource_metadata="${config.metadataUrl}", error="invalid_token", error_description="Sign in with an approved parent account"`});
  }
  // Bound actual bytes, including chunked requests; avoid trusting Content-Length alone.
  if(!req.body) return json({error:'INVALID_REQUEST'},400);
  const reader=req.body.getReader(), chunks=[]; let length=0;
  while(true) { const {value,done}=await reader.read(); if(done) break; length+=value.length; if(length>2*1024*1024) { await reader.cancel(); return json({error:'REQUEST_TOO_LARGE'},413); } chunks.push(value); }
  const body=new Uint8Array(length); let offset=0; for(const c of chunks) { body.set(c,offset); offset+=c.length; }
  const server=createAssessmentMcpServer({admin,workspaceId,parentId,trace,providerOptions});
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try {
    await server.connect(transport);
    const response=await transport.handleRequest(new Request(req.url,{method:'POST',headers:req.headers,body}));
    // JSON transport can be consumed before closing the request-scoped server.
    const output=await response.arrayBuffer();
    return new Response(output,{status:response.status,headers:response.headers});
  } catch { return json({error:'ASSESSMENT_UNAVAILABLE'},500); }
  finally { await server.close(); }
}
