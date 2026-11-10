import { syntheticSemanticEvidence } from './fixtures/assessment-publication/synthetic-semantic-evidence.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,createHmac} from 'node:crypto';
import {requireIsolatedQaBackend} from '../supabase/functions/_shared/qa-backend-isolation.mjs';
import {visualCandidateWithQuota,diagram,workspace as w} from './fixtures/assessment-visual/candidate.mjs';
import {validateAuthoringCandidate} from '../supabase/functions/_shared/assessment-authoring.mjs';
import {visualAuthenticatedBrowser} from './assessment-visual-auth-browser.mjs';

/** Real Edge/Auth/Storage, called only from the inspected owned Runner stack. */
export async function verifyAssessmentVisualApi({runtime,parentId,email,password,sql,appUrl}){
 const config=requireIsolatedQaBackend(runtime);assert.equal(config.mode,'runner-local');assert.equal(config.backendUrl,'http://127.0.0.1:54321');
 const query=source=>sql(runtime,source),ids=Object.fromEntries(['request','quiz','version','program'].map((k,i)=>[k,'04420000-0000-4000-8000-'+String(i+1).padStart(12,'0')]));
 const catalog=JSON.parse((await query(`select jsonb_build_object('subject_id',subject_id,'curriculum_id',curriculum_id) from public.quizzes where workspace_id='${w}' and slug='qa-assessment-authenticated';`)).trim());
 const learner=(await query(`select id from public.learners where workspace_id='${w}' and slug='test' and metadata->>'is_test'='true';`)).trim();assert.match(learner,/^[a-f0-9-]{36}$/);
 const previousVideos=(await query(`select value::text from public.workspace_settings where workspace_id='${w}' and key='optional_learning_videos';`)).trim();
 const previous=(await query(`select value::text from public.workspace_settings where workspace_id='${w}' and key='visual_assessments';`)).trim();
 const target={quiz_id:ids.quiz,quiz_version_id:ids.version,learner_id:learner,program_id:ids.program};
 const candidate=visualCandidateWithQuota(ids.version),uploaded=[];let token,owned=false;
 const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
 async function api(body,bearer=token,endpoint='learning-api'){const r=await fetch(config.backendUrl+'/functions/v1/'+endpoint,{method:'POST',redirect:'error',headers:{apikey:runtime.publishableKey,'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});return {status:r.status,result:await r.json()};}
 // URL signatures stay in memory. The local Edge's internal Kong origin is never a Runner destination.
 const publicUrl=value=>{const u=new URL(value,config.backendUrl);assert.ok(u.pathname.startsWith('/storage/v1/'));return config.backendUrl+u.pathname+u.search;};
 async function makeCreate(p){const validation=await validateAuthoringCandidate(p);assert.equal(validation.ok,true);return {action:'create_assessment_draft',request_id:ids.request,target,candidate:p,quiz:{slug:'qa-visual-api',title:'Synthetic visual API',...catalog},semantic_review:{...target,workspace_id:w,candidate_sha256:validation.candidate_sha256,result:'PASS',reviewed_at:new Date().toISOString(),item_evidence:syntheticSemanticEvidence(p),reviewer_ref:'synthetic:owned-raster-API-contract',authority_ref:'Disposable technical fixture only',source_review_ref:'geometry-source.json; not an academic pilot',learner_scope_review_ref:'Testing only',warning_dispositions:validation.validation.warnings.map(x=>({...x,result:'ACCEPTED',reason:'Synthetic isolated transport fixture, not independent academic approval.'}))}};}
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
  assert.equal(candidate.questions.length,40);
  assert.equal(candidate.questions.filter(q=>q.assets.length>0).length,10,'FLH-046 math 25% visual blueprint');
  assert.ok(candidate.questions.some(q=>q.delivery_surface==='learning'&&q.assets.length));
  assert.ok(candidate.questions.some(q=>q.delivery_surface==='exam'&&q.assets.length));
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
   const a={...diagram('rectangle',1,ids.version),mime_type:mime,checksum_sha256:sha,storage_path:w+'/'+ids.version+'/'+sha+'.'+ext};
   if(ext==='jpg'){
    // This is the exact small inline-image data transport used by ChatGPT's
    // existing MCP tool; the blob is uploaded to real isolated private Storage.
    const inline=await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:a,image_base64:bytes.toString('base64')});
    assert.equal(inline.status,200,JSON.stringify({status:inline.status,error:inline.result?.error}));
    assert.equal(inline.result.verified,true,'inline data stored and re-downloaded');
    assert.equal(inline.result.uploaded_bytes,bytes.length);
    assert.equal(inline.result.signed_upload_url,undefined,'ChatGPT never sees temporary upload credential in inline mode');
    uploaded.push(a.storage_path);
   }else await upload(a,bytes);
   assert.equal((await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:a})).result.already_uploaded,true,'real Edge fully decodes '+mime);
  }
  const inlineAsset=diagram('rectangle',1,ids.version);
  // Invalid base64, empty bytes and mismatched hashes all fail before object write.
  for(const badData of ['not-base64!!','',Buffer.from('not an image').toString('base64')]){
    const denied=await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:inlineAsset,image_base64:badData});
    assert.equal(denied.result.error,'ASSESSMENT_MEDIA_INVALID');
  }
  const png=await fs.readFile(new URL('./fixtures/assessment-visual/rectangle.png',import.meta.url));
  for(const bad of [{mime_type:'image/jpeg',storage_path:w+'/'+ids.version+'/'+diagram('rectangle').checksum_sha256+'.jpg'},{checksum_sha256:'0'.repeat(64),storage_path:w+'/'+ids.version+'/'+'0'.repeat(64)+'.png'}]){
   const a={...diagram('rectangle',1,ids.version),...bad};await upload(a,png);assert.equal((await api({action:'prepare_assessment_upload',quiz_version_id:ids.version,asset:a})).result.error,'ASSESSMENT_MEDIA_INVALID');
  }
  assert.equal((await api(create)).result.state,'draft');
  console.log('Authenticated visual checkpoint: private upload/codecs and byte verification PASS');
  assert.equal((await api({action:'stage_assessment',target,candidate,semantic_review:create.semantic_review})).result.state,'staged');
  const pointer={quiz_version_id:ids.version,candidate_sha256:create.semantic_review.candidate_sha256};
  assert.equal((await api({action:'publish_assessment',...pointer})).result.state,'held');
  assert.equal((await api(create)).result.duplicate,true,'Create retry converges after immutable staging and HELD');
  await query(`update public.workspace_settings set value='{"enabled":false}' where workspace_id='${w}' and key='visual_assessments';`);
  assert.equal((await api(create)).result.duplicate,true,'Disabling new publishing preserves existing request retry/readback');
  await query(`update public.workspace_settings set value='{"enabled":true}' where workspace_id='${w}' and key='visual_assessments';`);
  const qid=(await query(`select id from public.quiz_questions where quiz_version_id='${ids.version}' and position=1;`)).trim();
  const preview=await api({action:'preview_assessment_assets',quiz_version_id:ids.version,question_id:qid});assert.equal(preview.status,200);
  const image=await fetch(publicUrl(preview.result.questions[0].assets[0].url),{redirect:'error'});assert.equal(image.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await image.arrayBuffer())).digest('hex'),diagram('rectangle').checksum_sha256);
  const expiry=await fetch(config.backendUrl+'/storage/v1/object/sign/assessment-assets/'+diagram('rectangle',1,ids.version).storage_path,{method:'POST',redirect:'error',headers:{apikey:runtime.serviceRoleKey,authorization:'Bearer '+runtime.serviceRoleKey,'content-type':'application/json'},body:JSON.stringify({expiresIn:1})});assert.ok(expiry.ok);
  const temporary=await expiry.json(),shortUrl=config.backendUrl+'/storage/v1'+temporary.signedURL;
  assert.equal((await fetch(shortUrl,{redirect:'error'})).status,200);await new Promise(resolve=>setTimeout(resolve,2100));assert.notEqual((await fetch(shortUrl,{redirect:'error'})).status,200,'Real Storage URL expiration is enforced');
  const privateRead=await fetch(config.backendUrl+'/storage/v1/object/public/assessment-assets/'+diagram('rectangle',1,ids.version).storage_path,{redirect:'error'});assert.notEqual(privateRead.status,200,'private object cannot become a public hotlink');
  assert.equal((await api({action:'preview_assessment_assets',quiz_version_id:ids.version,question_id:ids.quiz})).status,403);
  const overwrite=await fetch(firstUpload,{method:'PUT',redirect:'error',headers:{'content-type':'image/png','x-upsert':'true'},body:png});assert.ok(!overwrite.ok,'issued upload token cannot overwrite a linked file');
  assert.equal((await api({action:'release_assessment',...pointer})).result.error,'ASSESSMENT_VIDEO_GATE_FAILED','real provider gate preserved');
  assert.equal((await query(`select count(*) from public.quiz_attempts where quiz_version_id='${ids.version}';`)).trim(),'0','upload/preview/retry creates no attempts');
  console.log('Authenticated visual checkpoint: stage/HELD/preview/expiry and absent-provider release denial PASS');
  // Technical runtime fixture only: seed the same synthetic provider evidence
  // used by the DB contract AFTER proving real release fails without it.
  await query(`begin;insert into public.workspace_settings(workspace_id,key,value) values('${w}','optional_learning_videos','{"enabled":true,"test_only":true}') on conflict(workspace_id,key) do update set value=excluded.value;
   select public.flh_learning_video_attach('${w}','${parentId}',jsonb_build_object('learner_id','${learner}','quiz_version_id','${ids.version}','program_id','${ids.program}','curriculum_id','${catalog.curriculum_id}','grade_level',7,'subject_id','${catalog.subject_id}'::bigint,'concept_id',(select concept_id from public.quiz_question_concepts where question_id='${qid}' and is_primary),'position',1,'video_ref','qaVideo0001','title','Synthetic geometry video','language','tr','rationale','Disposable transport fixture only','embeddable',true,'made_for_kids',true,'verified_at',now(),'verification_expires_at',now()+interval '1 hour'));commit;`);
  assert.equal((await api({action:'release_assessment',...pointer})).result.state,'released','Real release RPC with explicit synthetic provider fixture');
  // Provider playback is outside this visual-media smoke. Use the existing
  // rollout control, rather than allowing external YouTube traffic or mocking it.
  await query(`update public.workspace_settings set value='{"enabled":false}' where workspace_id='${w}' and key='optional_learning_videos';`);
  console.log('Authenticated visual checkpoint: isolated synthetic-provider release PASS; playback rollout OFF');
  const learnerToken=id=>{const data=Buffer.from(JSON.stringify({typ:'learner',workspace_id:w,learner_id:id,exp:Math.floor(Date.now()/1000)+600})).toString('base64url');return data+'.'+createHmac('sha256',runtime.serviceRoleKey).update(data).digest('base64url');};
  const ownToken=learnerToken(learner),otherToken=learnerToken('02610000-0000-4000-8000-000000000102');
  const started=await api({action:'start_quiz',quiz_slug:'qa-visual-api'},ownToken);assert.equal(started.status,200);assert.equal(started.result.queue.length,20);
  const outside=(await query(`select id from public.quiz_questions where quiz_version_id='${ids.version}' and position=21;`)).trim();
  for(const endpoint of ['learning-api','exam-v2-api','attempt-history-api'])for(const [bearer,question_id]of [[otherToken,qid],[ownToken,outside]]){
   const denied=await api({action:'refresh_question_assets',attempt_id:started.result.attempt_id,question_id},bearer,endpoint);assert.equal(denied.status,403,endpoint+' wrong learner/outside question');assert.equal(denied.result.error,'ASSESSMENT_MEDIA_FORBIDDEN');
  }
  assert.equal((await api({action:'prune_assessment_uploads'})).status,200,'Parent maintenance preserves all linked images');
  console.log('Authenticated visual checkpoint: real learner sessions and all three cross-learner/outside-question denials PASS');
  await visualAuthenticatedBrowser(runtime,appUrl,ownToken,create.semantic_review.candidate_sha256);
  console.log('Authenticated visual Edge/Auth/Storage: private upload/read, PNG/JPEG/WebP decode, retry, bad bytes/MIME/hash/path, teacher/session negatives, immutable stage/HELD preview and missing-provider release gate PASS');
 }finally{
  token=undefined;
  if(owned){
   await query(`begin;do $$begin if not exists(select 1 from auth.users where id='${parentId}' and raw_app_meta_data->>'technical_qa'='true') then raise exception 'VISUAL_API_CLEANUP_OWNER_MISMATCH';end if;end$$;update public.workspace_members set role='owner' where workspace_id='${w}' and user_id='${parentId}';delete from private.assessment_authoring_requests where request_id='${ids.request}' and created_by='${parentId}';delete from public.assessment_publications where quiz_version_id='${ids.version}' and created_by='${parentId}';delete from public.learning_video_assignments where workspace_id='${w}' and quiz_version_id='${ids.version}';delete from public.quiz_attempts where workspace_id='${w}' and quiz_version_id='${ids.version}';update public.quiz_versions set state='draft' where workspace_id='${w}' and id='${ids.version}' and created_by='${parentId}';delete from public.quizzes where workspace_id='${w}' and id='${ids.quiz}' and slug='qa-visual-api';delete from public.assets where workspace_id='${w}' and metadata->>'quiz_version_id'='${ids.version}';delete from public.learner_program_enrollments where workspace_id='${w}' and learner_id='${learner}' and program_id='${ids.program}';delete from public.learning_programs where workspace_id='${w}' and id='${ids.program}' and slug='qa-visual-api';${previousVideos?`update public.workspace_settings set value=${json(JSON.parse(previousVideos))} where workspace_id='${w}' and key='optional_learning_videos';`:`delete from public.workspace_settings where workspace_id='${w}' and key='optional_learning_videos';`}${previous?`update public.workspace_settings set value=${json(JSON.parse(previous))} where workspace_id='${w}' and key='visual_assessments';`:`delete from public.workspace_settings where workspace_id='${w}' and key='visual_assessments';`}commit;`);
   for(const path of new Set(uploaded)){const response=await fetch(config.backendUrl+'/storage/v1/object/assessment-assets',{method:'DELETE',redirect:'error',headers:{apikey:runtime.serviceRoleKey,authorization:'Bearer '+runtime.serviceRoleKey,'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})});assert.ok(response.ok,'owned unlinked upload cleanup');}
  }
 }
}
