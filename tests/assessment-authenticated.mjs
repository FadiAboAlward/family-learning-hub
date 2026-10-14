import assert from 'node:assert/strict';
import fs from 'node:fs';
import { academicCandidateHash } from '../supabase/functions/_shared/assessment-publication.mjs';
import { validateAcademicPackage } from '../scripts/academic-content-quality.mjs';
import { fetchQaBackend } from './qa-isolation.mjs';

export const assessmentQaIds={quiz:'02720000-0000-4000-8000-000000000001',version:'02720000-0000-4000-8000-000000000002',program:'02720000-0000-4000-8000-000000000003',curriculum:'02720000-0000-4000-8000-000000000004'};

/** Real parent JWT and learner HMAC against the owned Runner-local Edge/database. */
export async function verifyHeldAssessmentApi(config,parentToken,learnerToken) {
 let lastResponse;
 try {
 const candidate=JSON.parse(fs.readFileSync(new URL('./fixtures/assessment-publication/valid-package.json',import.meta.url),'utf8'));
 const hash=await academicCandidateHash(candidate),w='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
 // The QA profile deliberately omits ID. Use the already issued Testing session,
 // which the real Edge verifies cryptographically on every learner operation.
 const claims=JSON.parse(Buffer.from(learnerToken.split('.')[0],'base64url').toString('utf8'));
 assert.equal(claims.typ,'learner');assert.equal(claims.workspace_id,w);
 const learnerId=claims.learner_id;
 assert.match(learnerId,/^[a-f0-9-]{36}$/);
 const target={quiz_id:assessmentQaIds.quiz,quiz_version_id:assessmentQaIds.version,program_id:assessmentQaIds.program,learner_id:learnerId};
 const review={...target,workspace_id:w,candidate_sha256:hash,result:'PASS',reviewed_at:new Date().toISOString(),reviewer_ref:'synthetic:academic-reviewer',authority_ref:'Synthetic authenticated parent',source_review_ref:'Testing synthetic source',learner_scope_review_ref:'Testing exact scope',warning_dispositions:validateAcademicPackage(candidate).warnings.map(x=>({...x,result:'ACCEPTED',reason:'Synthetic isolated QA; no real academic sign-off.'}))};
 const invoke=async(endpoint,token,body)=>{
  const response=await fetchQaBackend(config,endpoint,{method:'POST',headers:{'content-type':'application/json',apikey:config.publishableKey,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  lastResponse={status:response.status,body:await response.json()};
  return lastResponse;
 };
 const stage={action:'stage_assessment',target,candidate,semantic_review:review};
 assert.equal((await invoke('learning-api','',stage)).status,401,'unauthenticated cannot stage');
 assert.equal((await invoke('learning-api',learnerToken,stage)).status,401,'learner cannot impersonate author');
 assert.equal((await invoke('learning-api',parentToken,stage)).body.state,'staged');
 assert.equal((await invoke('learning-api',parentToken,stage)).body.duplicate,true);
 const pointer={quiz_version_id:assessmentQaIds.version,candidate_sha256:hash};
 assert.equal((await invoke('learning-api',parentToken,{action:'publish_assessment',...pointer})).body.state,'held');
 for(const [endpoint,action] of [['learning-api','start_quiz'],['learning-api','preview_videos'],['exam-v2-api','start_exam']]) {
  const result=await invoke(endpoint,learnerToken,{action,quiz_slug:'qa-assessment-authenticated'});
  assert.equal(result.status,404,'held '+action+' remains hidden');
  assert.equal(result.body.error,'QUIZ_NOT_FOUND');
 }
 const catalog=await invoke('student-library-api',learnerToken,{action:'catalog'});
 assert.equal(catalog.status,200);
 assert.ok(!JSON.stringify(catalog.body).includes(assessmentQaIds.quiz),'held quiz absent from actual learner catalog');
 const history=await invoke('attempt-history-api',learnerToken,{action:'list_attempts'});
 assert.equal(history.status,200);
 assert.ok(!JSON.stringify(history.body).includes(assessmentQaIds.version),'held version absent from learner history');
 for(const [endpoint,action] of [['attempt-history-api','attempt_detail'],['question-reference-api','codes']]) {
  const result=await invoke(endpoint,learnerToken,{action,attempt_id:assessmentQaIds.version});
  assert.equal(result.status,404,'held version ID cannot substitute for an owned attempt');
  assert.equal(result.body.error,'ATTEMPT_NOT_FOUND');
 }
 const release=await invoke('learning-api',parentToken,{action:'release_assessment',...pointer});
 assert.equal(release.status,400);
 assert.equal(release.body.error,'ASSESSMENT_VIDEO_GATE_FAILED','provider failure cannot release');
 const inspected=await invoke('learning-api',parentToken,{action:'read_assessment',...pointer});
 assert.equal(inspected.body.publication.state,'held');
 assert.equal(inspected.body.publication.delivery_state,'pending');
 assert.equal((await invoke('learning-api',learnerToken,{action:'read_assessment',...pointer})).status,401,'private candidate cannot leak to learner');
 for(const action of ['prepare_assessment_delivery','claim_assessment_delivery','mark_assessment_delivery_uncertain','reconcile_assessment_delivery']){
  assert.equal((await invoke('learning-api',learnerToken,{action,...pointer,envelope_sha256:'0'.repeat(64)})).status,401,'learner cannot access '+action);
 }
 const heldDelivery=await invoke('learning-api',parentToken,{action:'prepare_assessment_delivery',...pointer});
 assert.equal(heldDelivery.status,409);assert.equal(heldDelivery.body.error,'ASSESSMENT_DELIVERY_STATE_CONFLICT','held content cannot enter Gmail handoff');
 console.log('Held assessment authenticated parent/learner API, real catalog, Learning/Exam/preview, retry and fail-closed release: PASS');
 } catch(error) {
  // Fixed diagnostic identities only; the original assertion and response remain private.
  const failure=new Error('QA_ASSESSMENT_FAILED',{cause:error});
  failure.qaHttpStatus=lastResponse?.status;
  failure.qaResponseError=lastResponse?.body?.error;
  throw failure;
 }
}
