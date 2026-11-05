import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHmac,webcrypto} from 'node:crypto';
import {assessmentMediaContext,hydrateAssessmentMedia,requireAssessmentMediaForAnswer} from '../supabase/functions/_shared/assessment-media.mjs';
import {dispatchExamAction} from '../supabase/functions/exam-v2-api/logic.mjs';

const workspace='55f9224c-8ba7-4cbc-9f88-713e6a6b41df',learner='04410000-0000-4000-8000-000000000013';
const attempt='04410000-0000-4000-8000-000000000012',question='04410000-0000-4000-8000-000000000011',secret='synthetic-endpoint-unit-secret';
const body=Buffer.from(JSON.stringify({typ:'learner',workspace_id:workspace,learner_id:learner,exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
const token=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');

/** Execute each real TS handler with only its external dependencies substituted. */
function endpoint(name,admin){
 let handler;
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/'+name+'/index.ts','utf8')).replace(/^import .*;\s*$/gm,'');
 vm.runInNewContext(source,{
  Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?secret:'http://synthetic.invalid'},serve:fn=>handler=fn},
  createClient:()=>admin,assessmentMediaContext,hydrateAssessmentMedia,requireAssessmentMediaForAnswer,
  ASSESSMENT_ACTIONS:[],AUTHORING_ACTIONS:[],
  parseRequest:async req=>{const b=await req.json();return {action:b.action,body:b};},authenticateLearner:async()=>learner,dispatchExamAction,
  createBackendPerformanceTrace:()=>({setAction(){},measure:async(_name,_options,operation)=>operation()}),
  performanceJsonResponse:(_trace,data,status,headers)=>new Response(JSON.stringify(data),{status,headers}),
  Response,Error,TextEncoder,TextDecoder,Uint8Array,atob,btoa,crypto:webcrypto,console,
 });
 return async(action)=>handler(new Request('http://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action,attempt_id:attempt,question_id:question,option_position:1})}));
}
for(const [name,action,rpc]of [['learning-api','answer','flh_learning_answer'],['exam-v2-api','save_answer','flh_exam_save_answer']]){
 for(const metadataInvalid of [false,true]){
  let writes=0;
  const admin={rpc:async name=>{if(name===rpc){writes++;return {data:{ok:true}};}assert.equal(name,'flh_assessment_media_context');return {data:{questions:[{assets:[{required:true,...(metadataInvalid?{error:'MEDIA_METADATA_INVALID'}:{storage_path:'synthetic.png'})}]}]}};},storage:{from:()=>({download:async()=>({error:{message:'unavailable'}})})}};
  const response=await endpoint(name,admin)(action);
  const result=await response.json();assert.equal(response.status,422,JSON.stringify(result));assert.equal(result.error,'ASSESSMENT_MEDIA_UNAVAILABLE');assert.equal(writes,0,'Required-media failure must precede the actual '+rpc+' call');
 }
}
for(const [name,action,rpc]of [['learning-api','answer','flh_learning_answer'],['learning-api','finish_quiz','flh_learning_finish'],['exam-v2-api','submit_exam','flh_exam_submit']]){
 let writes=0,contexts=0;
 const native={ok:true,attempt_id:attempt,percentage:100,award:{already_awarded:false}};
 const admin={rpc:async name=>{
  if(name===rpc){writes++;return {data:structuredClone(native)};}
  assert.equal(name,'flh_assessment_media_context');contexts++;
  return action==='answer'&&contexts===1?{data:null}:{error:{message:'unavailable'}};
 }};
 const response=await endpoint(name,admin)(action);assert.equal(response.status,200);assert.deepEqual(await response.json(),{...native,media_unavailable:true});assert.equal(writes,1,'Hydration failure cannot report a failed commit or replay it');
}
for(const name of ['learning-api','exam-v2-api','attempt-history-api']){
 const admin={rpc:async(_name,args)=>{assert.equal(args.p_learner_id,learner);assert.equal(args.p_attempt_id,attempt);assert.equal(args.p_question_id,question);return {error:{message:'ASSESSMENT_MEDIA_FORBIDDEN'}};}};
 const response=await endpoint(name,admin)('refresh_question_assets');assert.equal(response.status,403,name+' maps forbidden refresh to HTTP 403');assert.equal((await response.json()).error,'ASSESSMENT_MEDIA_FORBIDDEN');
}
console.log('Actual Learning/Exam/history handlers: required media rejects before persistence; committed answer/finish/submit survive hydration outage; forbidden refresh is HTTP 403: PASS');
