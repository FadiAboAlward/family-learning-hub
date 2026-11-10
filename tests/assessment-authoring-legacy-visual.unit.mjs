// FLH-FEAT-2026-046 v1.1 — immutable pre-policy visual retry regression
// Uses synthetic fixture and fake admin; never touches a live student or Storage.
import assert from 'node:assert/strict';
import {visualCandidate,version,workspace} from './fixtures/assessment-visual/candidate.mjs';
import {assessmentAuthoringCommand,validateAuthoringCandidate} from '../supabase/functions/_shared/assessment-authoring.mjs';
import {academicCandidateHash} from '../supabase/functions/_shared/assessment-publication.mjs';
import {validateAcademicPackage} from '../supabase/functions/_shared/academic-content-quality.mjs';

const parent='04410000-0000-4000-8000-000000000201';
const request_id='04410000-0000-4000-8000-000000000202';
const target={
 quiz_id:'04410000-0000-4000-8000-000000000203',
 quiz_version_id:version,
 learner_id:'04410000-0000-4000-8000-000000000204',
 program_id:'04410000-0000-4000-8000-000000000205'
};
const candidate=visualCandidate(version);
const hash=await academicCandidateHash(candidate);
const report=validateAcademicPackage(candidate);
assert.equal(report.ok,true,JSON.stringify(report.errors));
assert.equal((await validateAuthoringCandidate(candidate)).ok,false,'NEW post-policy authoring requires visual_plan');
let existing=false,readCount=0,createCount=0,mediaChecks=0;
const admin={
 rpc:async(name,args)=>{
  if(name==='flh_assessment_media_parent'){mediaChecks++;return {data:false,error:null};}
  if(name==='flh_assessment_authoring_command'){
   if(args.p_action==='read'){
    readCount++;
    return existing?{data:{ok:true,request_id,candidate_sha256:hash,target,state:'held'},error:null}:{data:null,error:{message:'ASSESSMENT_TARGET_INVALID'}};
   }
   if(args.p_action==='create'){
    createCount++;
    return {data:{ok:true,request_id,candidate_sha256:hash,target,state:'held',duplicate:true},error:null};
   }
  }
  throw Error('unexpected RPC '+name);
 },
 from:table=>{
  assert.equal(table,'learning_concepts');
  const chain={select:()=>chain,eq:()=>chain,in:(_key,codes)=>Promise.resolve({data:codes.map(code=>({code})),error:null})};
  return chain;
 }
};
const semantic_review={
 result:'PASS',...target,workspace_id:workspace,candidate_sha256:hash,
 reviewed_at:'2026-11-10T19:00:00Z',reviewer_ref:'synthetic:reviewer',
 source_review_ref:'synthetic:source',learner_scope_review_ref:'synthetic:learner',authority_ref:'synthetic:authority',
 warning_dispositions:report.warnings.map(w=>({...w,result:'ACCEPTED',reason:'Pre-policy synthetic fixture already reviewed before rollout; no new candidate is authorized.'}))
};
const args={action:'create_assessment_draft',request_id,target,candidate,semantic_review,quiz:{slug:'qa-prepolicy-retry',title:'Synthetic archived visual quiz',subject_id:1,curriculum_id:workspace}};
const trace={measure:(_label,_meta,fn)=>fn()};
await assert.rejects(()=>assessmentAuthoringCommand(admin,workspace,parent,args,trace),/ASSESSMENT_ACADEMIC_REJECTED/);
assert.equal(createCount,0,'missing plan must never create NEW visual draft');
existing=true;
const successful=await assessmentAuthoringCommand(admin,workspace,parent,args,trace);
assert.equal(successful.duplicate,true,'prior immutable request can safely resume even with new publishing disabled');
assert.equal(createCount,1);
assert.ok(readCount>=3,'existing request must be verified before replay and with disabled media');
assert.equal(mediaChecks,1);
const bad=structuredClone(args);bad.candidate.questions[0].prompt+=' altered';
await assert.rejects(()=>assessmentAuthoringCommand(admin,workspace,parent,bad,trace),/ASSESSMENT_RETRY_CONFLICT/);
assert.equal(createCount,1,'changed candidate cannot be accepted as an existing request');
const wrong=structuredClone(args);wrong.target.quiz_id='04410000-0000-4000-8000-000000000299';
await assert.rejects(()=>assessmentAuthoringCommand(admin,workspace,parent,wrong,trace),/ASSESSMENT_RETRY_CONFLICT/);
assert.equal(createCount,1,'cross-target request cannot be accepted');
console.log('FLH-046 archived visual request: new plan required, immutable pre-policy retry allowed, changed candidate/target refused, no unsafe writes: PASS');
