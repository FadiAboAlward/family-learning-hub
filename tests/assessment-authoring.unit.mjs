import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessmentAuthoringCommand, assessmentAuthoringTool, validateAuthoringCandidate } from '../supabase/functions/_shared/assessment-authoring.mjs';
import { assessmentParent } from '../supabase/functions/_shared/assessment-parent-auth.mjs';
import { mcpConfiguration, requireMcpClaims } from '../supabase/functions/assessment-mcp/auth.mjs';
import { assessmentMcpHttp, ASSESSMENT_MCP_TOOLS } from '../supabase/functions/assessment-mcp/handler.mjs';

const w='33000000-0000-4000-8000-000000000001',parent='33000000-0000-4000-8000-000000000002';
const target=Object.fromEntries(['quiz_id','quiz_version_id','learner_id','program_id'].map((k,i)=>[k,`33000000-0000-4000-8000-${String(i+3).padStart(12,'0')}`]));
const candidate=JSON.parse(fs.readFileSync('tests/fixtures/assessment-publication/valid-package.json','utf8'));
const checked=await validateAuthoringCandidate(candidate);assert.equal(checked.ok,true);assert.equal(checked.semantic_review,'REQUIRED');
const hash=checked.candidate_sha256,request_id='33000000-0000-4000-8000-000000000007';
const semantic_review={...target,workspace_id:w,result:'PASS',candidate_sha256:hash,reviewed_at:new Date().toISOString(),reviewer_ref:'synthetic:review',authority_ref:'synthetic:owner',source_review_ref:'synthetic:source',learner_scope_review_ref:'synthetic:test',warning_dispositions:checked.validation.warnings.map(d=>({...d,result:'ACCEPTED',reason:'Synthetic technical QA only.'}))};
const args={request_id,target,candidate,semantic_review,quiz:{slug:'qa-authoring',title:'Synthetic authoring test',subject_id:1,curriculum_id:w}};
const trace={measure:(_n,_m,fn)=>fn()};
const resource='https://testing.example/functions/v1/assessment-mcp/mcp',issuer='https://testing.example/auth/v1';
const env={enabled:'true',resource,issuer,clientIds:'approved-client'};
const config=mcpConfiguration(env);
const goodClaims={sub:parent,iss:issuer,aud:resource,role:'authenticated',client_id:'approved-client',scope:'openid',exp:Math.floor(Date.now()/1000)+600};
for(const changed of [{aud:'authenticated'},{aud:'https://other.example/mcp'},{iss:'https://other.example/auth/v1'},{role:'service_role'},{client_id:'other'},{client_id:undefined},{exp:0},{nbf:Date.now()/1000+600},{is_anonymous:true},{scope:'profile'},{sub:''}]) assert.throws(()=>requireMcpClaims({...goodClaims,...changed},config),/AUTH_REQUIRED/);
for(const changed of [{enabled:undefined},{clientIds:'*'},{resource:'http://testing.example/functions/v1/assessment-mcp/mcp'},{issuer:'https://other.example/auth/v1'}]) assert.throws(()=>mcpConfiguration({...env,...changed}),/ASSESSMENT_MCP_DISABLED/);

let calls=[],role='owner',claims=goodClaims,authError=false,state='draft',lostRead=false;
const current=()=>({ok:true,state,request_id,target,candidate_sha256:hash,question_count:state==='draft'?0:40,quiz_status:state==='released'?'active':'draft',version_state:['held','released'].includes(state)?'published':'draft'});
const admin={
  auth:{getClaims:async()=>({data:{claims},error:authError}),getUser:async()=>({data:{user:{id:parent}},error:authError})},
  from:()=>{const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{role}})};return chain;},
  rpc:async(name,payload)=>{
    calls.push({name,payload});
    if(name==='flh_assessment_authoring_command') {
      if(payload.p_action==='read' && lostRead) {lostRead=false;return {error:{message:'private token=never-print'}};}
      if(payload.p_payload.request_id!==request_id)return {error:{message:'ASSESSMENT_TARGET_INVALID'}};
      return {data:current()};
    }
    if(name==='flh_assessment_command') {
      state=({stage:'staged',publish:'held',release:'released'})[payload.p_action]||state;
      if(payload.p_action==='stage')assert.equal(payload.p_payload.semantic_review.reviewed_by,parent);
      return {data:{ok:true,state}};
    }
    if(name==='flh_learning_video_attach')return {data:{ok:true}};
    throw new Error('Unexpected RPC');
  }
};
const req=new Request(resource,{headers:{authorization:'Bearer opaque-test-token'}});
assert.equal(await assessmentParent(admin,w,req),parent);
for(role of ['teacher','learner','viewer'])await assert.rejects(()=>assessmentParent(admin,w,req),/VIDEO_ATTACHMENT_FORBIDDEN/);
role='owner';
await assert.rejects(()=>assessmentParent(admin,w,new Request(resource)),/AUTH_REQUIRED/);
const before=calls.length;
for(const bad of [ {...args,quiz:{...args.quiz,service_role:'no'}}, {...args,request_id:'invalid'}, {...args,candidate:{...candidate,questions:[]}}, {...args,semantic_review:{...semantic_review,result:'FAIL'}}, {...args,semantic_review:{...semantic_review,candidate_sha256:'0'.repeat(64)}}]) await assert.rejects(()=>assessmentAuthoringCommand(admin,w,parent,{...bad,action:'create_assessment_draft'},trace));
assert.equal(calls.length,before,'invalid candidates/reviews/metadata cannot write');
await assessmentAuthoringCommand(admin,w,parent,{...args,action:'create_assessment_draft'},trace);
const createdCall=calls.at(-1);assert.equal(createdCall.payload.p_parent_id,parent);assert.equal(createdCall.payload.p_payload.semantic_review.reviewed_by,parent);
await assert.rejects(()=>assessmentAuthoringTool(admin,w,parent,'publish_assessment',{request_id,candidate_sha256:'0'.repeat(64)},trace),/ASSESSMENT_RETRY_CONFLICT/);
await assert.rejects(()=>assessmentAuthoringTool(admin,w,parent,'release_assessment',{request_id:w,candidate_sha256:hash},trace),/ASSESSMENT_TARGET_INVALID/);
await assert.rejects(()=>assessmentAuthoringTool(admin,w,parent,'stage_assessment',{request_id,candidate_sha256:hash,target,candidate:{...candidate,runtime_external_dependencies:['changed']},semantic_review},trace),/ASSESSMENT_RETRY_CONFLICT/);

const deps={admin,workspaceId:w,env,trace,providerOptions:{apiKey:'synthetic-provider-key',fetchImpl:async()=>new Response(JSON.stringify({items:[{id:'qaVideo0001',status:{embeddable:true,madeForKids:true,privacyStatus:'public'}}]}),{status:200})}};
async function rpc(method,params={},headers={}) {
  const response=await assessmentMcpHttp(new Request(resource,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer opaque-test-token',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),deps);
  return {status:response.status,body:await response.json(),headers:response.headers};
}
assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-test',version:'1'}})).body.result.serverInfo.name,'family-learning-hub-assessment-authoring');
const listed=(await rpc('tools/list')).body.result.tools;
assert.deepEqual(listed.map(t=>t.name),ASSESSMENT_MCP_TOOLS.map(t=>t.name));
assert.equal(listed.find(t=>t.name==='release_assessment').annotations.readOnlyHint,false);
assert.equal(listed.find(t=>t.name==='release_assessment').annotations.destructiveHint,true);
assert.equal(listed.find(t=>t.name==='read_assessment_authoring').annotations.readOnlyHint,true);
for(const t of listed) assert.equal(t.inputSchema.additionalProperties,false,'closed top-level input');
assert.equal((await rpc('tools/call',{name:'execute_sql',arguments:{query:'select 1'}})).body.result.isError,true);
assert.equal((await rpc('tools/call',{name:'publish_assessment',arguments:{request_id,candidate_sha256:hash,parent_id:w}})).body.result.isError,true);
async function call(name,arguments_) {const r=await rpc('tools/call',{name,arguments:arguments_});assert.equal(r.status,200);assert.equal(r.body.result?.isError,undefined,JSON.stringify(r.body));return r.body.result.structuredContent;}
assert.equal((await call('validate_assessment_candidate',{candidate})).ok,true);
assert.equal((await call('create_assessment_draft',args)).state,'draft');
assert.equal((await call('stage_assessment',{request_id,candidate_sha256:hash,target,candidate,semantic_review})).status.state,'staged');
assert.equal((await call('publish_assessment',{request_id,candidate_sha256:hash})).status.state,'held');
const video={learner_id:target.learner_id,quiz_version_id:target.quiz_version_id,program_id:target.program_id,curriculum_id:w,grade_level:7,subject_id:1,concept_id:w,position:1,video_ref:'qaVideo0001',title:'Synthetic reviewed video',language:'tr',rationale:'Synthetic provider contract only'};
await call('attach_optional_video',{request_id,candidate_sha256:hash,candidate:video});
assert.equal((await call('release_assessment',{request_id,candidate_sha256:hash})).status.state,'released');
assert.equal((await call('read_assessment_authoring',{request_id})).state,'released');
lostRead=true;
const unknown=await rpc('tools/call',{name:'read_assessment_authoring',arguments:{request_id}});
assert.equal(unknown.body.result.isError,true);assert.equal(unknown.body.result.content[0].text,'ASSESSMENT_UNAVAILABLE');
assert.equal((await call('read_assessment_authoring',{request_id})).state,'released','lost result resumes by fixed request');
claims={...goodClaims,aud:'authenticated'};
const unauthorized=await rpc('tools/list');assert.equal(unauthorized.status,401);assert.match(unauthorized.headers.get('WWW-Authenticate'),/resource_metadata/);
claims=goodClaims;role='teacher';assert.equal((await rpc('tools/list')).status,403);role='owner';authError=true;assert.equal((await rpc('tools/list')).status,401);authError=false;
assert.equal((await rpc('tools/list',{}, {origin:'https://evil.example'})).status,403);
const disabled=await assessmentMcpHttp(new Request(resource),{...deps,env:{}});assert.equal(disabled.status,503);
const discovery=await assessmentMcpHttp(new Request(config.metadataUrl),deps);assert.equal((await discovery.json()).resource,resource);
assert.equal(calls.some(c=>!['flh_assessment_command','flh_assessment_authoring_command','flh_learning_video_attach'].includes(c.name)),false);
console.log('Assessment authoring validation, session/role/resource/client authorization, official MCP discovery/schemas/full synthetic flow, safe errors and resumable reads: PASS (mocked persistence)');
