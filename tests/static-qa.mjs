import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd();
const failures=[];
const warn=[];
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const exists=p=>fs.existsSync(path.join(ROOT,p));
const fail=m=>failures.push(m);
const mergeMarkerRe=new RegExp(`${'<'.repeat(7)}|${'='.repeat(7)}|${'>'.repeat(7)}`);

const index=read('index.html');

if(!/<html[^>]+lang=["']ar["'][^>]+dir=["']rtl["']/i.test(index))fail('index.html must declare lang="ar" and dir="rtl".');
if(!/<meta[^>]+name=["']viewport["']/i.test(index))fail('index.html is missing the mobile viewport meta tag.');
if(index.includes('جارِ'))fail('Arabic copy typo found in index.html: use "جارٍ" not "جارِ".');
if(/2026[-–]2025/.test(index))fail('Reversed school-year text found in index.html.');

const localRefs=[...index.matchAll(/(?:src|href)=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
for(const ref of localRefs){if(!exists(ref))fail(`index.html references missing file: ${ref}`);}

const loadedScripts=[...index.matchAll(/<script[^>]+src=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
const forbiddenLegacy=['learning-launcher-v1.js','program-exam-v2.js','exam-experience-v7.js','exam-state-sync-v7.js'];
for(const f of forbiddenLegacy){if(loadedScripts.includes(f))fail(`Legacy runtime must not be loaded: ${f}`);}

const requiredRuntime=['app.js','dynamic-login-v3.js','learning-launcher-v2.js','program-exam-v3.js','student-library-v3.js','parent-center-v3.js','question-reference-ui-v1.js','ui-localization-v1.js'];
for(const f of requiredRuntime){if(!loadedScripts.includes(f))fail(`Required runtime script is not loaded: ${f}`);}

for(const file of new Set([...loadedScripts,'index.html','tests/smoke.mjs','tests/static-qa.mjs','tests/exam-v2-api.mjs','supabase/functions/exam-v2-api/logic.mjs'])){
  if(!exists(file))continue;
  const source=read(file);
  if(mergeMarkerRe.test(source))fail(`Unresolved merge marker found in ${file}.`);
  if(/2026[-–]2025/.test(source))fail(`Reversed school-year text found in ${file}.`);
}

const localizer=read('ui-localization-v1.js');
for(const required of ['Level','Hints','Learning Mode','Exam Mode','جارٍ','متابعة الأبناء','تذكّرني']){
  if(!localizer.includes(required))fail(`Arabic copy normalizer is missing rule/content for: ${required}`);
}

const examIndex=read('supabase/functions/exam-v2-api/index.ts');
const examLogic=read('supabase/functions/exam-v2-api/logic.mjs');
const examTests=read('tests/exam-v2-api.mjs');
const qaWorkflow=read('.github/workflows/qa-smoke.yml');

if(!examIndex.includes('authenticateLearner')||!examIndex.includes('parseRequest')||!examIndex.includes('dispatchExamAction'))fail('exam-v2-api index must use the shared validated request/auth/dispatch core.');
if(!examLogic.includes('payload===null||typeof payload!=="object"||Array.isArray(payload)'))fail('exam-v2-api must reject null, array, and non-object signed learner payloads.');
if(!examLogic.includes('typeof body.action==="string"?body.action:""'))fail('exam-v2-api must reject non-string action values instead of coercing them.');
if(!examLogic.includes('typeof body.is_flagged!=="boolean"'))fail('exam-v2-api must reject non-boolean is_flagged values.');
if(!examLogic.includes('.update({is_flagged:flag}).eq("id",queueRow.id).select("id").single()'))fail('exam-v2-api must require exactly one persisted flag update row.');
if(!examLogic.includes('if(updateError||!updated)throw new Error("FLAG_UPDATE_FAILED")'))fail('exam-v2-api must reject failed or zero-row flag persistence.');
if(!examLogic.includes('.eq("learner_id",learnerId)'))fail('exam-v2-api flag lookup must remain scoped to the authenticated learner.');

for(const requiredTest of ['signed null learner payload','array action is rejected','learner-content isolation','zero-row flag update','valid boolean flag persists']){
  if(!examTests.includes(requiredTest))fail(`Executable Exam API regression coverage missing: ${requiredTest}.`);
}
if(!qaWorkflow.includes('run: node tests/exam-v2-api.mjs'))fail('QA Gate must execute Exam API unit tests.');
const headRef='ref: ${{ github.event_name == \'pull_request\' && github.event.pull_request.head.sha || github.sha }}';
if(qaWorkflow.split(headRef).length-1<2)fail('Both QA jobs must checkout the exact PR-head SHA for pull_request runs.');
if(qaWorkflow.split('run: test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"').length-1<2)fail('Both QA jobs must assert the checked-out SHA before QA evidence is accepted.');

const activeCopyFiles=['index.html','learning-launcher-v2.js','program-exam-v3.js','student-library-v3.js','parent-center-v3.js','dynamic-login-v3.js'];
for(const file of activeCopyFiles){
  if(!exists(file))continue;
  const source=read(file);
  if(/\b(?:TODO|FIXME)\b/.test(source))warn.push(`${file}: TODO/FIXME remains in active UI source.`);
}

if(failures.length){
  console.error('\nSTATIC QA FAILED');
  for(const message of failures)console.error(`- ${message}`);
  process.exit(1);
}
console.log('Static QA passed: runtime references, Arabic/RTL shell, executable exam API guards, exact-head QA binding, legacy guards, copy normalization and merge-marker checks are valid.');
for(const message of warn)console.warn(`WARN: ${message}`);
