import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {requireIsolatedQaBackend} from '../supabase/functions/_shared/qa-backend-isolation.mjs';
import {visualCandidate,diagram,workspace as w} from './fixtures/assessment-visual/candidate.mjs';
import {validateAuthoringCandidate} from '../supabase/functions/_shared/assessment-authoring.mjs';

/** Real Edge/Auth/Storage, called only from the inspected owned Runner stack. */
export async function verifyAssessmentVisualApi({runtime,parentId,email,password,sql}){
 const config=requireIsolatedQaBackend(runtime);assert.equal(config.mode,'runner-local');assert.equal(config.backendUrl,'http://127.0.0.1:54321');
 const query=source=>sql(runtime,source),ids=Object.fromEntries(['request','quiz','version','program'].map((k,i)=>[k,'04420000-0000-4000-8000-'+String(i+1).padStart(12,'0')]));
 const catalog=JSON.parse((await query(`select jsonb_build_object('subject_id',subject_id,'curriculum_id',curriculum_id) from public.quizzes where workspace_id='${w}' and slug='qa-assessment-authenticated';`)).trim());
 const learner=(await query(`select id from public.learners where workspace_id='${w}' and slug='test' and metadata->>'is_test'='true';`)).trim();assert.match(learner,/^[a-f0-9-]{36}$/);
 const previous=(await query(`select value::text from public.workspace_settings where workspace_id='${w}' and key='visual_assessments';`)).trim();
 const target={quiz_id:ids.quiz,quiz_version_id:ids.version,learner_id:learner,program_id:ids.program};
 const candidate=visualCandidate(ids.version),uploaded=[];let token,owned=false;
 const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
 async function api(body,bearer=token){const r=await fetch(config.backendUrl+'/functions/v1/learning-api',{method:'POST',redirect:'error',headers:{apikey:runtime.publishableKey,'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});return {status:r.status,result:await r.json()};}
 // URL signatures stay in memory. The local Edge's internal Kong origin is never a Runner destination.
 const publicUrl=value=>{const u=new URL(value,config.backendUrl);assert.ok(u.pathname.startsWith('/storage/v1/'));return config.backendUrl+u.pathname+u.search;};
 async function makeCreate(p){const validation=await validateAuthoringCandidate(p);assert.equal(validation.ok,true);return {action:'create_assessment_draft',request_id:ids.request,target,candidate:p,quiz:{slug:'qa-visual-api',title:'Synthetic visual API',...catalog},semantic_review:{...target,workspace_id:w,candidate_sha256:validation.candidate_sha256,result:'PASS',reviewed_at:new Date().toISOString(),reviewer_ref:'synthetic:owned-raster-API-contract',authority_ref:'Disposable technical fixture only',source_review_ref:'geometry-source.json; not an academic pilot',learner_scope_review_ref:'Testing only',warning_dispositions:validation.validation.warnings.map(x=>({...x,result:'ACCEPTED',reason:'Synthetic isolated transport fixture, not independent academic approval.'}))}};}
 async function upload(a,bytes){
  const allocated=await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:a});assert.equal(allocated.status,200);assert.ok(allocated.result.signed_upload_url);
  const url=publicUrl(allocated.result.signed_upload_url);
  const result=await fetch(url,{method:'PUT',redirect:'error',headers:{'content-type':a.mime_type,'x-upsert':'false'},body:bytes});assert.ok(result.ok,'real private signed upload');uploaded.push(a.storage_path);
  return url;
 }
 try{
  await query(`do $$begin if exists(select 1 from public.quizzes where id='${ids.quiz}' or slug='qa-visual-api') or exists(select 1 from public.learning_programs where id='${ids.program}' or slug='qa-visual-api') then raise exception 'VISUAL_API_NAMESPACE_NOT_EMPTY';end if;end$$;`);
  owned=true;
  await query(`begin;insert into public.learning_programs(id,workspace_id,slug,title,status,curriculum_id,grade_level) values('${ids.program}','${w}','qa-visual-api','Synthetic visual API','active','${catalog.curriculum_id}',7);insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status) values('${w}','${learner}','${ids.program}','active');commit;`);
  const login=await fetch(config.backendUrl+'/auth/v1/token?grant_type=password',{method:'POST',redirect:'error',headers:{apikey:runtime.publishableKey,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);token=(await login.json()).access_token;assert.ok(token);
  const create=await makeCreate(candidate);
  assert.equal((await api(create,'')).status,401);assert.equal((await api(create,'invalid-token')).status,401);
  assert.equal((await api(create)).result.error,'ASSESSMENT_VISUAL_DISABLED');
  await query(`insert into public.workspace_settings(workspace_id,key,value) values('${w}','visual_assessments','{"enabled":true}') on conflict(workspace_id,key) do update set value=excluded.value;`);
  await query(`update public.workspace_members set role='teacher' where workspace_id='${w}' and user_id='${parentId}';`);
  assert.equal((await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:diagram('rectangle',1,ids.version)})).status,403);
  await query(`update public.workspace_members set role='owner' where workspace_id='${w}' and user_id='${parentId}';`);
  assert.equal((await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:{...diagram('rectangle',1,ids.version),storage_path:'../escape.png'}})).result.error,'ASSESSMENT_MEDIA_INVALID');
  assert.equal((await api(create)).result.error,'ASSESSMENT_MEDIA_UNAVAILABLE','missing required bytes fail before draft');
  let firstUpload;
  for(const name of ['rectangle','triangle','composite']){const a=diagram(name,1,ids.version),bytes=await fs.readFile(new URL('./fixtures/assessment-visual/'+name+'.png',import.meta.url));const url=await upload(a,bytes);firstUpload ||= url;assert.equal((await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:a})).result.already_uploaded,true,'same bytes retry is verified, not overwritten');}
  for(const [ext,mime]of [['jpg','image/jpeg'],['webp','image/webp']]){
   const bytes=await fs.readFile(new URL('./fixtures/assessment-visual/rectangle.'+ext,import.meta.url)),sha=createHash('sha256').update(bytes).digest('hex');
   const a={...diagram('rectangle',1,ids.version),mime_type:mime,checksum_sha256:sha,storage_path:w+'/'+ids.version+'/'+sha+'.'+ext};await upload(a,bytes);
   assert.equal((await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:a})).result.already_uploaded,true,'real Edge fully decodes '+mime);
  }
  const png=await fs.readFile(new URL('./fixtures/assessment-visual/rectangle.png',import.meta.url));
  for(const bad of [{mime_type:'image/jpeg',storage_path:w+'/'+ids.version+'/'+diagram('rectangle').checksum_sha256+'.jpg'},{checksum_sha256:'0'.repeat(64),storage_path:w+'/'+ids.version+'/'+'0'.repeat(64)+'.png'}]){
   const a={...diagram('rectangle',1,ids.version),...bad};await upload(a,png);assert.equal((await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:a})).result.error,'ASSESSMENT_MEDIA_INVALID');
  }
  assert.equal((await api(create)).result.state,'draft');
  assert.equal((await api({action:'stage_assessment',target,candidate,semantic_review:create.semantic_review})).result.state,'staged');
  const pointer={quiz_version_id:ids.version,candidate_sha256:create.semantic_review.candidate_sha256};
  assert.equal((await api({action:'publish_assessment',...pointer})).result.state,'held');
  const qid=(await query(`select id from public.quiz_questions where quiz_version_id='${ids.version}' and position=1;`)).trim();
  const preview=await api({action:'preview_assessment_assets',quiz_version_id:ids.version,question_id:qid});assert.equal(preview.status,200);
  const image=await fetch(publicUrl(preview.result.questions[0].assets[0].url),{redirect:'error'});assert.equal(image.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await image.arrayBuffer())).digest('hex'),diagram('rectangle').checksum_sha256);
  const privateRead=await fetch(config.backendUrl+'/storage/v1/object/public/assessment-assets/'+diagram('rectangle',1,ids.version).storage_path,{redirect:'error'});assert.notEqual(privateRead.status,200,'private object cannot become a public hotlink');
  assert.equal((await api({action:'preview_assessment_assets',quiz_version_id:ids.version,question_id:ids.quiz})).status,403);
  const overwrite=await fetch(firstUpload,{method:'PUT',redirect:'error',headers:{'content-type':'image/png','x-upsert':'true'},body:png});assert.ok(!overwrite.ok,'issued upload token cannot overwrite a linked file');
  assert.equal((await api({action:'release_assessment',...pointer})).result.error,'ASSESSMENT_VIDEO_GATE_FAILED','real provider gate preserved');
  assert.equal((await query(`select count(*) from public.quiz_attempts where quiz_version_id='${ids.version}';`)).trim(),'0','upload/preview/retry creates no attempts');
  console.log('Authenticated visual Edge/Auth/Storage: private upload/read, PNG/JPEG/WebP decode, retry, bad bytes/MIME/hash/path, teacher/session negatives, immutable stage/HELD preview and missing-provider release gate PASS');
 }finally{
  token=undefined;
  if(owned){
   await query(`begin;do $$begin if not exists(select 1 from auth.users where id='${parentId}' and raw_app_meta_data->>'technical_qa'='true') then raise exception 'VISUAL_API_CLEANUP_OWNER_MISMATCH';end if;end$$;update public.workspace_members set role='owner' where workspace_id='${w}' and user_id='${parentId}';delete from private.assessment_authoring_requests where request_id='${ids.request}' and created_by='${parentId}';delete from public.assessment_publications where quiz_version_id='${ids.version}' and created_by='${parentId}';update public.quiz_versions set state='draft' where workspace_id='${w}' and id='${ids.version}' and created_by='${parentId}';delete from public.quizzes where workspace_id='${w}' and id='${ids.quiz}' and slug='qa-visual-api';delete from public.assets where workspace_id='${w}' and metadata->>'quiz_version_id'='${ids.version}';delete from public.learner_program_enrollments where workspace_id='${w}' and learner_id='${learner}' and program_id='${ids.program}';delete from public.learning_programs where workspace_id='${w}' and id='${ids.program}' and slug='qa-visual-api';${previous?`update public.workspace_settings set value=${json(JSON.parse(previous))} where workspace_id='${w}' and key='visual_assessments';`:`delete from public.workspace_settings where workspace_id='${w}' and key='visual_assessments';`}commit;`);
   for(const path of new Set(uploaded)){const response=await fetch(config.backendUrl+'/storage/v1/object/assessment-assets',{method:'DELETE',redirect:'error',headers:{apikey:runtime.serviceRoleKey,authorization:'Bearer '+runtime.serviceRoleKey,'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})});assert.ok(response.ok,'owned unlinked upload cleanup');}
  }
 }
}
