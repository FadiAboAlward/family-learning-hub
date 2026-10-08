import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../program-exam-v3.js',import.meta.url),'utf8');
const start=source.indexOf('    function uniqueSteps('),end=source.indexOf('    function bindReviewHelp(');
assert.ok(start>0&&end>start);
const context={optionText:(id,position)=>({q1:{1:'26',2:'-26'},q2:{1:'4',2:'5'}}[id]?.[position]||''),questionAttrs:()=> 'dir="rtl"',renderMath:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
vm.runInNewContext(source.slice(start,end),context);
const html=context.reviewHtml([
  {question_id:'q2',is_correct:true,prompt:'سؤال صحيح',response:{option_position:1},correct_answer:{option_position:1}},
  {question_id:'q1',is_correct:false,prompt:'احسب',response:{option_position:2},correct_answer:{option_position:1},explanation:'طرح السالب يعني جمع الموجب.',hints:[]},
  {question_id:'q3',is_correct:null,prompt:'إجابة لم تُصحّح',response:{value:'تفسير الطالب'}}
]);
assert.ok(html.indexOf('exam-review-wrong')<html.indexOf('flh-correct-review'),'Actual mistakes come first');
assert.equal((html.match(/class="exam-review exam-review-wrong"/g)||[]).length,1,'Ungraded responses must not be diagnosed as mistakes');
assert.ok(html.includes('❌ السؤال 2'),'Reordering review must preserve the original question number');
assert.ok(html.includes('dir="rtl">-26</b>')&&html.includes('dir="rtl">26</b>'),'Actual selected and correct option text must come from the same question');
assert.ok(html.includes('<div class="flh-review-why"><b>لماذا؟</b><div dir="auto">طرح السالب يعني جمع الموجب.</div></div>'),'Grounded explanation is visible without opening an extra control');
assert.ok(!html.includes('misconception'),'Unsupported diagnoses must not be fabricated');
const allCorrect=context.reviewHtml([{question_id:'q2',is_correct:true,prompt:'سؤال صحيح'}]);
assert.ok(!allCorrect.includes('exam-review-wrong')&&allCorrect.includes('لا توجد إجابات خاطئة'),'All-correct result must not invent mistakes');
const missing=context.reviewHtml([{question_id:'q1',is_correct:false,response:{option_position:2},correct_answer:{option_position:1}}]);
assert.ok(!missing.includes('flh-review-why'),'Missing explanation must not become invented teaching text');
console.log('Exam mistakes unit QA passed: exact answers, source explanation, actual wrong-only grouping and original question association.');
