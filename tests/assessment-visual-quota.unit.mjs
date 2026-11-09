// FLH-FEAT-2026-046 v1.0 — synthetic quota contract; NOT an academic/media truth pilot.
import assert from 'node:assert/strict';
import {visualCandidate,diagram} from './fixtures/assessment-visual/candidate.mjs';
import {validateVisualContract} from '../supabase/functions/_shared/assessment-visual-contract.mjs';
const base=visualCandidate();
const check=p=>{const errors=[],warnings=[];validateVisualContract(p,errors,warnings);return {errors,warnings};};
const has=(r,code)=>r.errors.some(x=>x.code===code);
const withPlan=(source,focus='general')=>{
 const p=structuredClone(source),n=p.questions.filter(q=>q.assets?.length).length;
 p.academic_context.visual_plan={policy:'subject-aware-v1',focus,target_questions:focus==='geometry'?20:10,actual_questions:n};
 return p;
};
const addImages=(p,desired)=>{
 let current=p.questions.filter(q=>q.assets?.length).length;
 for(let i=p.questions.length-1;i>=0&&current<desired;i--){
  const q=p.questions[i];if(q.assets?.length)continue;
  // Reused synthetic raster is deliberately NOT semantically aligned to these
  // synthetic text questions. This tests distinct-question counts only.
  q.assets=[diagram('rectangle',1)];
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
