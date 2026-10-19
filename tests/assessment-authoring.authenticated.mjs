import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { requireIsolatedQaBackend } from '../supabase/functions/_shared/qa-backend-isolation.mjs';
import { assessmentStagePayload } from '../supabase/functions/_shared/assessment-publication.mjs';
import { validateAuthoringCandidate } from '../supabase/functions/_shared/assessment-authoring.mjs';

/** Called only inside the existing inspected Runner stack; never accept a hosted backend. */
export async function verifyAssessmentAuthoringApi({runtime,parentId,email,password,sql}) {
 const checked=requireIsolatedQaBackend(runtime);
 assert.equal(checked.mode,'runner-local');assert.equal(checked.backendUrl,'http://127.0.0.1:54321');
 // Load the real Deno/npm SDK module graph too, not just the Node transport test.
 const mcp=await fetch(`${checked.backendUrl}/functions/v1/assessment-mcp/mcp`,{method:'POST',redirect:'error',headers:{apikey:runtime.publishableKey,'content-type':'application/json'},body:'{}'});
 const mcpBody=await mcp.json();
 if(mcp.status!==503 || mcpBody.error!=='ASSESSMENT_MCP_DISABLED') {
  const allowedCodes=new Set(['BOOT_ERROR','WORKER_ERROR','INVALID_JWT','NOT_FOUND','ASSESSMENT_MCP_DISABLED']);
  const code=mcpBody.code||mcpBody.error;
  console.error('Authoring MCP boot diagnostic',JSON.stringify({http_status:mcp.status,code:allowedCodes.has(code)?code:'UNCLASSIFIED'}));
 }
 assert.equal(mcp.status,503,'unconfigured real Edge MCP stays disabled');
 assert.equal(mcpBody.error,'ASSESSMENT_MCP_DISABLED','SDK/import-map boot errors are not a disabled PASS');
 const w='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
 const ids=Object.fromEntries(['quiz','version','request','program','curriculum'].map((k,i)=>[k,`03320000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const query=source=>sql(runtime,source);
 const learner=(await query(`select id from public.learners where workspace_id='${w}' and slug='test' and is_active and metadata->>'is_test'='true';`)).trim();assert.match(learner,/^[a-f0-9-]{36}$/);
 const candidate=JSON.parse(await fs.readFile('tests/fixtures/assessment-publication/valid-package.json','utf8'));
 const validation=await validateAuthoringCandidate(candidate);assert.equal(validation.ok,true);
 const target={quiz_id:ids.quiz,quiz_version_id:ids.version,learner_id:learner,program_id:ids.program};
 const semantic_review={...target,workspace_id:w,result:'PASS',candidate_sha256:validation.candidate_sha256,reviewed_at:new Date().toISOString(),reviewer_ref:'synthetic:API-review',source_review_ref:'synthetic:source',learner_scope_review_ref:'synthetic:Testing',authority_ref:'synthetic:parent',warning_dispositions:validation.validation.warnings.map(d=>({...d,result:'ACCEPTED',reason:'Synthetic isolated transport QA only.'}))};
 await assessmentStagePayload(w,parentId,{target,candidate,semantic_review}); // Exact fixture gate before setup/publication.
 const subject=Number((await query('select coalesce(max(id),0)+1 from public.subjects;')).trim());
 const quiz={slug:'qa-authoring-api',title:'Synthetic authoring API',subject_id:subject,curriculum_id:ids.curriculum};
 let token,owned=false,failure;
 async function api(body,bearer=token) {
  const response=await fetch(`${checked.backendUrl}/functions/v1/learning-api`,{method:'POST',redirect:'error',headers:{apikey:runtime.publishableKey,'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)});
  const result=await response.json();return {status:response.status,result};
 }
 try {
  await query(`do $$ begin if exists(select 1 from public.quizzes where id='${ids.quiz}' or slug='qa-authoring-api')
   or exists(select 1 from public.learning_programs where id='${ids.program}' or slug='qa-authoring-api')
   or exists(select 1 from public.curricula where id='${ids.curriculum}' or code='qa-authoring-api')
   or exists(select 1 from public.subjects where id=${subject} or code='qa-authoring-api')
   then raise exception 'AUTHORING_API_NAMESPACE_NOT_EMPTY';end if;end$$;`);
  owned=true; // The commit may succeed even if its transport result is lost.
  await query(`begin;
   insert into public.curricula(id,code,name_ar) values('${ids.curriculum}','qa-authoring-api','Synthetic curriculum');
   insert into public.subjects(id,code,name_ar) overriding system value values(${subject},'qa-authoring-api','Synthetic subject');
   insert into public.learning_programs(id,workspace_id,slug,title,status,curriculum_id,grade_level) values('${ids.program}','${w}','qa-authoring-api','Synthetic authoring','active','${ids.curriculum}',7);
   insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status) values('${w}','${learner}','${ids.program}','active');
   ${[...new Set(candidate.questions.map(q=>q.concept_code))].map(code=>`insert into public.learning_concepts(workspace_id,subject_id,curriculum_id,grade_level,code,title) values('${w}',${subject},'${ids.curriculum}',7,'${code}','Synthetic concept');`).join('\n')}
   commit;`);
  const login=await fetch(`${checked.backendUrl}/auth/v1/token?grant_type=password`,{method:'POST',redirect:'error',headers:{apikey:runtime.publishableKey,'content-type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(login.status,200,'synthetic parent normal Auth grant');token=(await login.json()).access_token;assert.ok(token);
  const create={action:'create_assessment_draft',request_id:ids.request,target,quiz,candidate,semantic_review};
  assert.equal((await api(create,'')).status,401);
  assert.equal((await api(create,'invalid-token')).status,401);
  await query(`update public.workspace_members set role='teacher' where workspace_id='${w}' and user_id='${parentId}';`);
  assert.equal((await api(create)).status,403);
  await query(`update public.workspace_members set role='owner' where workspace_id='${w}' and user_id='${parentId}';`);
  assert.equal((await api({...create,quiz:{...quiz,title:''}})).result.error,'ASSESSMENT_AUTHORING_INPUT_INVALID');
  assert.equal((await api({...create,semantic_review:{...semantic_review,result:'FAIL'}})).result.error,'ASSESSMENT_SEMANTIC_REVIEW_REQUIRED');
  const upperTarget=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,v.toUpperCase()]));
  let r=await api({...create,target:upperTarget,semantic_review:{...semantic_review,...upperTarget,workspace_id:w.toUpperCase()}});assert.equal(r.status,200);assert.equal(r.result.state,'draft');
  r=await api(create);assert.equal(r.result.duplicate,true);
  assert.equal((await api({...create,quiz:{...quiz,title:'Conflicting retry'}})).result.error,'ASSESSMENT_RETRY_CONFLICT');
  const pointer={quiz_version_id:ids.version,candidate_sha256:validation.candidate_sha256};
  r=await api({action:'stage_assessment',target,candidate,semantic_review});assert.equal(r.status,200);assert.equal(r.result.state,'staged');
  r=await api({action:'publish_assessment',...pointer});assert.equal(r.status,200);assert.equal(r.result.state,'held');
  r=await api({action:'release_assessment',...pointer});assert.equal(r.result.error,'ASSESSMENT_VIDEO_GATE_FAILED','no provider credentials/receipt, cannot release');
  r=await api({action:'read_assessment_authoring',request_id:ids.request});assert.equal(r.status,200);assert.equal(r.result.state,'held');assert.equal(r.result.question_count,40);assert.equal(r.result.quiz_status,'draft');assert.equal(r.result.learning_path,null);
 } catch(error) { failure=error;throw error; }
 finally {
  token=undefined;
  try { if(owned) await query(`begin;
   do $$ begin if not exists(select 1 from auth.users where id='${parentId}' and raw_app_meta_data->>'technical_qa'='true') then raise exception 'AUTHORING_API_CLEANUP_OWNER_MISMATCH';end if;end$$;
   update public.workspace_members set role='owner' where workspace_id='${w}' and user_id='${parentId}';
   delete from private.assessment_authoring_requests where workspace_id='${w}' and request_id='${ids.request}' and created_by='${parentId}';
   delete from public.assessment_publications where workspace_id='${w}' and quiz_version_id='${ids.version}' and created_by='${parentId}';
   delete from public.quizzes where workspace_id='${w}' and id='${ids.quiz}' and slug='qa-authoring-api';
   delete from public.learner_program_enrollments where workspace_id='${w}' and learner_id='${learner}' and program_id='${ids.program}';
   delete from public.learning_programs where workspace_id='${w}' and id='${ids.program}';
   delete from public.learning_concepts where workspace_id='${w}' and subject_id=${subject};
   delete from public.subjects where id=${subject} and code='qa-authoring-api';
   delete from public.curricula where id='${ids.curriculum}' and code='qa-authoring-api';commit;`); }
  catch(cleanupError) { if(!failure) throw cleanupError; console.error('ASSESSMENT_AUTHORING_API_CLEANUP_FAILED'); }
 }
 assert.equal((await query(`select count(*) from public.quizzes where id='${ids.quiz}';`)).trim(),'0');
 console.log('Authenticated isolated authoring API: normal parent Auth, missing/invalid session, teacher denial, exact academic/semantic draft/stage/held, duplicate/conflict, missing-video release denial, status and owned cleanup PASS');
}
