import { assessmentStagePayload } from '../supabase/functions/_shared/assessment-publication.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessmentCandidateHash, inspectAssessmentPublication as inspect } from '../scripts/assessment-publication-preflight.mjs';
import { validateAcademicPackage } from '../scripts/academic-content-quality.mjs';

const fixture = JSON.parse(fs.readFileSync('tests/fixtures/academic-content-quality/valid-package.json','utf8'));
const sourceLearning = fixture.questions.find(q=>q.delivery_surface==='learning');
const sourceExam = fixture.questions.find(q=>q.delivery_surface==='exam');
const questions = Array.from({length:40},(_,i)=>{
  const q = structuredClone(i<20?sourceLearning:sourceExam);
  q.question_code='QA-FLH-027-'+String(i+1).padStart(4,'0');
  q.prompt+=' ('+String(i+1)+')';
  return q;
});
const candidate={...fixture,questions};
const expectedTarget={
  workspace_id:'ab000000-0000-4000-8000-000000000001',
  quiz_id:'27000000-0000-4000-8000-000000000002',
  quiz_version_id:'27000000-0000-4000-8000-000000000003'
};
/** Inspect one fixed Testing target; never derive the expected scope from the snapshot. */
const inspectAssessmentPublication=(pkg,snapshot)=>inspect(pkg,snapshot,expectedTarget);
/** Build a synthetic exported row without reading or writing any learner backend. */
function row(q,idx) {
  return {
    position:idx+1,
    question_code:q.question_code,
    question_type:q.question_type,
    prompt_language:q.prompt_language,
    difficulty_level:q.difficulty_level,
    prompt:q.prompt,
    delivery_role:q.delivery_surface==='learning'?'core':'exam_pool',
    options:q.options.map(o=>({position:o.position,content:o.content,label:o.label??String.fromCharCode(64+o.position)})),
    correct_position:q.options.find(o=>o.is_correct).position,
    key:{explanation:q.explanation??null,correct:q.correct_explanation??null,incorrect:q.final_incorrect_explanation??null},
    hints:(q.hints||[]).map(h=>({hint_level:h.level,pedagogical_role:h.role,content:h.content,metadata:{steps:h.steps??null,expanded_steps:h.expanded_steps??null}})),
    primary_concept_count:1,
    primary_concept_codes:[q.concept_code]
  };
}
const makeSnapshot=()=>({
  ...expectedTarget,
  quiz_status:'draft',
  version_state:'draft',
  questions:questions.map(row),
  semantic_review:{result:'PENDING'},
  video_candidate_reviewed:false
});
const has=(result,code)=>result.errors.some(e=>e.code===code);
const required=inspectAssessmentPublication(candidate,null);
assert.equal(required.ok,false);
assert.ok(has(required,'SNAPSHOT_REQUIRED'));

const incomplete=makeSnapshot();
incomplete.questions.pop();
assert.ok(has(inspectAssessmentPublication(candidate,incomplete),'STAGING_INCOMPLETE'));

const unsafe=makeSnapshot();
unsafe.quiz_status='published';
assert.ok(has(inspectAssessmentPublication(candidate,unsafe),'UNSAFE_VERSION_STATE'));

const drift=makeSnapshot();
drift.questions[0].options[0].content='tampered';
assert.ok(has(inspectAssessmentPublication(candidate,drift),'CANDIDATE_STAGING_DRIFT'));

const unrelated=makeSnapshot();
unrelated.questions[12].question_code='wrong-quiz-code';
assert.ok(has(inspectAssessmentPublication(candidate,unrelated),'CANDIDATE_STAGING_DRIFT'));

const matching=makeSnapshot();
const integrity=inspectAssessmentPublication(candidate,matching);
assert.ok(!has(integrity,'CANDIDATE_STAGING_DRIFT'));
assert.ok(!has(integrity,'STAGING_INCOMPLETE'));
assert.ok(has(integrity,'SEMANTIC_REVIEW_MISSING'));
assert.ok(has(integrity,'VIDEO_CANDIDATE_REQUIRED'));
assert.ok(has(integrity,'ACADEMIC_VALIDATION_FAILED'));

// No backend or real learner state/results. This fixture is explicitly Testing-only.
const validCandidate=JSON.parse(fs.readFileSync('tests/fixtures/assessment-publication/valid-package.json','utf8'));
const academic=validateAcademicPackage(validCandidate);
assert.equal(academic.ok,true,'Positive fixture must actually pass the official validator');
const valid=makeSnapshot();
valid.questions=validCandidate.questions.map(row);
valid.video_candidate_reviewed=true;
valid.semantic_review={
  result:'PASS',candidate_sha256:assessmentCandidateHash(validCandidate),
  workspace_id:valid.workspace_id,quiz_id:valid.quiz_id,quiz_version_id:valid.quiz_version_id,
  reviewer_ref:'synthetic:academic-reviewer',authority_ref:'synthetic:review-authority',
  source_review_ref:'synthetic:source-review',learner_scope_review_ref:'synthetic:scope-review',
  reviewed_at:'2026-10-12T00:00:00Z',
  warning_dispositions:academic.warnings.map(w=>({code:w.code,path:w.path,result:'ACCEPTED',reason:'Synthetic review record exercises warning disposition; no real academic review claimed.'}))
};
assert.equal(inspectAssessmentPublication(validCandidate,valid).ok,true);
assert.equal(inspectAssessmentPublication(validCandidate,valid).warning_disposition_required,false);
const feedbackCandidate=structuredClone(validCandidate);
Object.assign(feedbackCandidate.questions[0],{explanation:'Sentetik açıklama.',correct_explanation:'Sentetik doğru yanıt açıklaması.',final_incorrect_explanation:'Sentetik son yanlış yanıt açıklaması.'});
const feedbackSnapshot={...structuredClone(valid),questions:feedbackCandidate.questions.map(row)};
feedbackSnapshot.semantic_review.candidate_sha256=assessmentCandidateHash(feedbackCandidate);
feedbackSnapshot.semantic_review.warning_dispositions=validateAcademicPackage(feedbackCandidate).warnings.map(w=>({...w,result:'ACCEPTED',reason:'Synthetic review only.'}));
assert.equal(inspectAssessmentPublication(feedbackCandidate,feedbackSnapshot).ok,true);
for(const field of ['explanation','correct','incorrect']) {
 const changed=structuredClone(feedbackSnapshot);changed.questions[0].key[field]='Değiştirilmiş açıklama.';
 assert.ok(has(inspectAssessmentPublication(feedbackCandidate,changed),'CANDIDATE_STAGING_DRIFT'),'feedback drift: '+field);
}
const mixedCandidate=structuredClone(validCandidate);
mixedCandidate.questions=Array.from({length:20},(_,i)=>[validCandidate.questions[i],validCandidate.questions[i+20]]).flat();
const mixedSnapshot=structuredClone(valid);
mixedSnapshot.semantic_review.candidate_sha256=assessmentCandidateHash(mixedCandidate);
mixedSnapshot.semantic_review.warning_dispositions=validateAcademicPackage(mixedCandidate).warnings.map(w=>({...w,result:'ACCEPTED',reason:'Synthetic mode ordering review only.'}));
assert.equal(inspectAssessmentPublication(mixedCandidate,mixedSnapshot).ok,true,'existing preflight groups modes while preserving order within each');
// The exact operator-approved review must also satisfy the authoring gate unchanged.
const stageTarget={quiz_id:valid.quiz_id,quiz_version_id:valid.quiz_version_id,learner_id:'27000000-0000-4000-8000-000000000005',program_id:'27000000-0000-4000-8000-000000000006'};
const stagedReview=await assessmentStagePayload(valid.workspace_id,'27000000-0000-4000-8000-000000000007',{target:stageTarget,candidate:validCandidate,semantic_review:{...valid.semantic_review,...stageTarget}});
assert.equal(inspectAssessmentPublication(validCandidate,{...valid,semantic_review:stagedReview.semantic_review}).ok,true,'canonical preflight and staging semantic review contract agrees');
const mixedStage=await assessmentStagePayload(valid.workspace_id,'27000000-0000-4000-8000-000000000007',{target:stageTarget,candidate:mixedCandidate,semantic_review:{...mixedSnapshot.semantic_review,...stageTarget}});
assert.deepEqual(mixedStage.candidate.questions,mixedCandidate.questions,'staging retains the reviewed manifest array order');
assert.equal(mixedStage.candidate_sha256,assessmentCandidateHash(mixedCandidate));
for(const target of [undefined,null,{},[],{...expectedTarget,quiz_id:'invalid'}]) {
  assert.ok(has(inspect(validCandidate,valid,target),'TARGET_REQUIRED'));
}
for(const key of Object.keys(expectedTarget)) {
  const snapshot=structuredClone(valid);
  snapshot[key]='27000000-0000-4000-8000-000000000099';
  snapshot.semantic_review[key]=snapshot[key];
  assert.ok(has(inspectAssessmentPublication(validCandidate,snapshot),'TARGET_SCOPE_MISMATCH'),
    'Matching snapshot/review scope must not retarget the independently selected '+key);
}
assert.equal(inspect(validCandidate,valid,Object.fromEntries(Object.entries(expectedTarget).map(([k,v])=>[k,v.toUpperCase()]))).ok,true);
const reject=(code,mutate)=>{
  const snapshot=structuredClone(valid);
  mutate(snapshot);
  assert.ok(has(inspectAssessmentPublication(validCandidate,snapshot),code),code);
};
reject('SCOPE_REQUIRED',s=>{s.quiz_id='not-a-uuid';});
reject('SEMANTIC_REVIEW_MISSING',s=>{s.semantic_review.quiz_version_id='27000000-0000-4000-8000-000000000004';});
for(const key of ['reviewer_ref','authority_ref','source_review_ref','learner_scope_review_ref','reviewed_at']) {
  reject('SEMANTIC_REVIEW_MISSING',s=>{delete s.semantic_review[key];});
}
reject('WARNING_REVIEW_MISSING',s=>{s.semantic_review.warning_dispositions.pop();});
reject('WARNING_REVIEW_MISSING',s=>{s.semantic_review.warning_dispositions[0].reason=' ';});
reject('WARNING_REVIEW_MISSING',s=>{s.semantic_review.warning_dispositions[0].path='wrong';});
reject('CONCEPT_MAPPING_REQUIRED',s=>{s.questions[0].primary_concept_codes=['unrelated-concept'];});
for(const field of ['prompt_language','question_type','difficulty_level']) {
  reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0][field]='tampered';});
}
reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0].options[0].label='wrong';});
reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0].hints[0].pedagogical_role='near_solution';});
reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0].hints[0].metadata.steps=['tampered'];});
reject('STAGING_INCOMPLETE',s=>{s.questions[0]=null;});
reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0].options={};});
reject('ROW_IDENTITY_INVALID',s=>{s.questions[1].question_code=s.questions[0].question_code;});
for(const position of [null,undefined,'1','invalid',1.5,NaN]) {
  const snapshot=structuredClone(valid);
  snapshot.questions[0].position=position;
  const result=inspectAssessmentPublication(validCandidate,snapshot);
  assert.ok(has(result,'ROW_IDENTITY_INVALID'));
  assert.ok(!has(result,'CANDIDATE_STAGING_DRIFT'),'Malformed position must not create misleading content-drift diagnostics');
}
reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0].correct_position=2;});
reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0].options.pop();});
reject('CANDIDATE_STAGING_DRIFT',s=>{s.questions[0].hints.pop();});
for(const malformed of [null,{},[],{questions:[null]}]) {
  assert.equal(inspectAssessmentPublication(malformed,valid).ok,false);
}
const changed=structuredClone(validCandidate);
changed.runtime_external_dependencies=['unexpected-runtime-dependency'];
assert.notEqual(assessmentCandidateHash(changed),assessmentCandidateHash(validCandidate));
assert.equal(assessmentCandidateHash(Object.fromEntries(Object.entries(validCandidate).reverse())),assessmentCandidateHash(validCandidate));
assert.equal(inspectAssessmentPublication(validCandidate,null).candidate_sha256,assessmentCandidateHash(validCandidate));
const wrongCode=structuredClone(validCandidate);
wrongCode.questions[0].question_code='QA-INVALID';
assert.ok(has(inspectAssessmentPublication(wrongCode,valid),'QUESTION_CODE_INVALID'));
console.log('assessment publication exact-candidate preflight unit tests passed');
