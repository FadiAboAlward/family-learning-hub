// FLH-FEAT-2026-046 v1.0 — synthetic quota contract; NOT an academic/media truth pilot.
import assert from 'node:assert/strict';
import {visualCandidate,visualCandidateWithQuota,diagram} from './fixtures/assessment-visual/candidate.mjs';
import {validateAcademicPackage} from '../scripts/academic-content-quality.mjs';
import {validateVisualContract} from '../supabase/functions/_shared/assessment-visual-contract.mjs';
const base=visualCandidate();
const check=p=>{const errors=[],warnings=[];validateVisualContract(p,errors,warnings);return {errors,warnings};};
const has=(r,code)=>r.errors.some(x=>x.code===code);
const withPlan=(source,focus='general')=>{
 const p=structuredClone(source),n=p.questions.filter(q=>q.assets?.length).length;
 p.academic_context.visual_plan={policy:'subject-aware-v1',focus,target_questions:focus==='geometry'?20:10,actual_questions:n};
 for(const q of p.questions.filter(q=>q.assets?.length))p.blueprint.find(b=>b.question_code===q.question_code).visual_purpose='The verified geometry drawing supplies the visible lengths or angle relationships required to interpret this synthetic item.';
 return p;
};
const addImages=(p,desired)=>{
 let current=p.questions.filter(q=>q.assets?.length).length;
 for(let i=p.questions.length-1;i>=0&&current<desired;i--){
  const q=p.questions[i];if(q.assets?.length)continue;
  // Reused synthetic raster is deliberately NOT semantically aligned to these
  // synthetic text questions. This tests distinct-question counts only.
  q.assets=[diagram('rectangle',1)];
  p.blueprint.find(b=>b.question_code===q.question_code).visual_purpose='Synthetic image-slot QA only: figure must be independently matched to the assessed skill before any real academic publication.';
  current++;
 }
 p.academic_context.visual_plan.actual_questions=current;
};
const prePolicy=check(base);
assert.ok(!prePolicy.errors.some(e=>e.code?.startsWith('VISUAL_')&&e.code!=='VISUAL_SEMANTIC_REVIEW_REQUIRED'));
assert.ok(prePolicy.warnings.some(w=>w.code==='VISUAL_PLAN_MISSING_NEW_AUTHORING'),'frozen pre-policy candidate remains readable; new authoring needs a reviewed plan');
const under=check(withPlan(base));assert.ok(has(under,'VISUAL_MATH_QUOTA'),'mathematics <10/40 rejected');
const passing=withPlan(base);addImages(passing,10);
assert.equal(check(passing).errors.length,0,'10 distinct questions with existing assets and both modes can satisfy general math count');
const mislabeled=structuredClone(passing);mislabeled.academic_context.visual_plan.actual_questions=11;
assert.ok(has(check(mislabeled),'VISUAL_PLAN_INVALID'),'declared count must match the final candidate');
const missingPurpose=structuredClone(passing);delete missingPurpose.blueprint.find(b=>b.question_code===missingPurpose.questions[0].question_code).visual_purpose;
assert.ok(has(check(missingPurpose),'VISUAL_PURPOSE_REQUIRED'),'image in an authored question requires a concrete educational purpose for independent review');
const onlyLearning=structuredClone(passing);for(const q of onlyLearning.questions.filter(q=>q.delivery_surface==='exam'))q.assets=[];
onlyLearning.academic_context.visual_plan.actual_questions=onlyLearning.questions.filter(q=>q.assets?.length).length;
assert.ok(has(check(onlyLearning),'VISUAL_MODE_COVERAGE'),'one mode alone does not satisfy math distribution');
const geo=withPlan(base,'geometry');addImages(geo,19);
assert.ok(has(check(geo),'VISUAL_GEOMETRY_QUOTA'),'geometry <20/40 rejected');
addImages(geo,20);assert.equal(check(geo).errors.length,0,'20 relevant image-question slots satisfy geometry count structurally');
const science=withPlan(base);science.academic_context.subject='Fen Bilimleri';science.academic_context.visual_plan.target_questions=8;science.academic_context.visual_plan.actual_questions=3;
assert.ok(check(science).warnings.some(w=>w.code==='VISUAL_SCIENCE_MIX_REVIEW'),'science 20-40% is academic target warning, not decorative forced art');
const language=withPlan(base);language.academic_context.subject='English';language.academic_context.visual_plan.target_questions=0;
assert.ok(!has(check(language),'VISUAL_MATH_QUOTA'),'languages have no fake math quota');
const multimodal=withPlan(base);multimodal.questions[10].assets=[diagram('rectangle',1),diagram('triangle',2)];
assert.ok(has(check(multimodal),'VISUAL_MATH_QUOTA'),'two files on one question count once');
console.log('FLH-046 prospective quota: math 25%, geometry 50%, subject mixes, distinct-question and two-mode counts, declarative mismatch and frozen legacy: PASS');

const full=visualCandidateWithQuota(),fullReport=validateAcademicPackage(full);
assert.equal(full.questions.length,40);
assert.equal(full.questions.filter(q=>q.assets.length>0).length,10,'one-quarter of 40 image-bearing question codes');
assert.equal(full.questions.filter(q=>q.delivery_surface==='learning'&&q.assets.length>0).length,6);
assert.equal(full.questions.filter(q=>q.delivery_surface==='exam'&&q.assets.length>0).length,4);
assert.equal(check(full).errors.length,0,JSON.stringify(check(full).errors));
assert.equal(fullReport.ok,true,JSON.stringify(fullReport.errors));
const answers=new Map([[3,'24 cm²'],[5,'2 cm'],[7,'12 cm²'],[13,'4 cm'],[23,'4 cm'],[26,'6 cm'],[31,'10 cm']]);
for(const [i,value] of answers){
 const question=full.questions[i];assert.equal(question.options.find(o=>o.is_correct).content,value);
 assert.ok(question.assets.length>0);
}
console.log('FLH-046 full synthetic 40 questions / 10 image-backed mathematically checked items: PASS (not an academic release)');
