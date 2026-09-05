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

for(const file of new Set([...loadedScripts,'index.html','tests/smoke.mjs','tests/static-qa.mjs'])){
  if(!exists(file))continue;
  const s=read(file);
  if(mergeMarkerRe.test(s))fail(`Unresolved merge marker found in ${file}.`);
  if(/2026[-–]2025/.test(s))fail(`Reversed school-year text found in ${file}.`);
}

const localizer=read('ui-localization-v1.js');
for(const required of ['Level','Hints','Learning Mode','Exam Mode','جارٍ','متابعة الأبناء','تذكّرني']){
  if(!localizer.includes(required))fail(`Arabic copy normalizer is missing rule/content for: ${required}`);
}

const examApi=read('supabase/functions/exam-v2-api/index.ts');
if(!examApi.includes('catch{throw new Error("INVALID_SESSION");}'))fail('exam-v2-api must normalize malformed learner-token decoding/parsing failures to INVALID_SESSION.');
if(!examApi.includes('typeof b.is_flagged!=="boolean"'))fail('exam-v2-api must reject non-boolean is_flagged values.');
if(!examApi.includes('const{error:flagError}=await admin.from("quiz_attempt_question_queue").update({is_flagged:flag})'))fail('exam-v2-api must capture flag persistence errors.');
if(!examApi.includes('if(flagError)throw new Error("FLAG_UPDATE_FAILED")'))fail('exam-v2-api must propagate flag persistence failures.');
if(!examApi.includes('parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{}'))fail('exam-v2-api must normalize null/non-object JSON request bodies before action dispatch.');
const unknownActionGuard=examApi.indexOf('if(!allowedActions.has(action))return json({error:"UNKNOWN_ACTION"},400,o);');
const learnerCall=examApi.indexOf('const lid=await learner(req);');
if(unknownActionGuard<0||learnerCall<0||unknownActionGuard>learnerCall)fail('exam-v2-api must reject unknown/null actions with HTTP 400 before learner authentication.');

const activeCopyFiles=['index.html','learning-launcher-v2.js','program-exam-v3.js','student-library-v3.js','parent-center-v3.js','dynamic-login-v3.js'];
for(const file of activeCopyFiles){
  if(!exists(file))continue;
  const s=read(file);
  if(/\b(?:TODO|FIXME)\b/.test(s))warn.push(`${file}: TODO/FIXME remains in active UI source.`);
}

if(failures.length){
  console.error('\nSTATIC QA FAILED');
  for(const m of failures)console.error(`- ${m}`);
  process.exit(1);
}
console.log('Static QA passed: runtime references, Arabic/RTL shell, exam API guards, legacy guards, copy normalization and merge-marker checks are valid.');
for(const m of warn)console.warn(`WARN: ${m}`);
