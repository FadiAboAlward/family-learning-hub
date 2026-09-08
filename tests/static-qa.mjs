import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd();
const failures=[];
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const exists=p=>fs.existsSync(path.join(ROOT,p));
const fail=m=>failures.push(m);
const index=read('index.html');

if(!/<html[^>]+lang=["']ar["'][^>]+dir=["']rtl["']/i.test(index))fail('index.html must declare Arabic RTL.');
if(!/<meta[^>]+name=["']viewport["']/i.test(index))fail('index.html is missing mobile viewport.');
if(index.includes('جارِ'))fail('Visible Arabic typo جارِ found in index.html.');

const build=(index.match(/<body[^>]+data-build=["']([^"']+)/i)||[])[1];
if(!build)fail('Missing body data-build.');
const assetVersions=[...index.matchAll(/(?:src|href)=["']\.\/[^"'?]+\?v=([^"']+)["']/g)].map(m=>m[1]);
if(!assetVersions.length)fail('No versioned local assets found.');
if(assetVersions.some(v=>v!==build))fail(`All local CSS/JS assets must use the current build version ${build}.`);

const localRefs=[...index.matchAll(/(?:src|href)=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
for(const ref of localRefs){if(!exists(ref))fail(`index.html references missing file: ${ref}`);}
const loadedScripts=[...index.matchAll(/<script[^>]+src=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
for(const f of ['learning-launcher-v1.js','program-exam-v2.js','exam-experience-v7.js','exam-state-sync-v7.js'])if(loadedScripts.includes(f))fail(`Legacy runtime must not be loaded: ${f}`);
for(const f of ['app.js','math-direction-v1.js','dynamic-login-v3.js','learning-launcher-v2.js','program-exam-v3.js','answer-layout-v8.js','student-library-v3.js','parent-center-v3.js','question-reference-ui-v1.js','ui-localization-v1.js'])if(!loadedScripts.includes(f))fail(`Required runtime missing: ${f}`);
if(loadedScripts.indexOf('math-direction-v1.js')<loadedScripts.indexOf('app.js'))fail('Math direction runtime must load after app.js so it can wrap the shared math renderer.');
if(loadedScripts.indexOf('math-direction-v1.js')>loadedScripts.indexOf('learning-launcher-v2.js')||loadedScripts.indexOf('math-direction-v1.js')>loadedScripts.indexOf('program-exam-v3.js'))fail('Math direction runtime must load before Learning and Exam renderers.');

const learning=read('learning-launcher-v2.js');
const exam=read('program-exam-v3.js');
const layout=read('answer-layout-v8.js');
const css=read('answer-layout-v8.css');
const mathDirection=read('math-direction-v1.js');
const mathDirectionCss=read('math-direction-v1.css');
const library=read('student-library-v3.js');

if(learning.includes('اضغط مرة ثانية'))fail('Learning Mode must not ask for a second tap on the option.');
if(!learning.includes('id="flhConfirmAnswer"'))fail('Learning Mode needs a dedicated confirm button.');
if(!learning.includes('تم اختيار الإجابة. اضغط «تأكيد الإجابة» عندما تتأكد.'))fail('Learning selection guidance missing.');
if(!learning.includes('row.draft_option_position=pos;\n      render();'))fail('Learning selection must render locally before draft persistence.');
if(!learning.includes("call('save_draft'"))fail('Learning draft persistence missing.');
if(!learning.includes('draftController?.abort()'))fail('Learning must cancel stale draft requests before newer/final state.');
if(!learning.includes('class="answer-grid answer-layout-v8"'))fail('Learning answer grid must opt into shared layout immediately.');
if(!exam.includes('class="answers answer-layout-v8"'))fail('Exam must use shared answer layout.');

if(!layout.includes("const OPTION_LABELS = ['A','B','C','D','E','F'];"))fail('Shared option labels must be A-F.');
if(layout.includes("const OPTION_PREFIX = 'الخيار';")||layout.includes("const AR_NUM = ['١'"))fail('Old visible Arabic-number option mapping must be removed.');
if(!layout.includes('`الخيار ${label}: ${text}'))fail('Accessibility label must retain the word الخيار without showing it as the badge.');
if(!layout.includes("setAttrIfChanged(answer, 'aria-pressed', String(selected))"))fail('Answer choices must expose aria-pressed.');
if(!layout.includes("const appRoot = document.getElementById('app');"))fail('Answer observer must be scoped to #app.');
if(layout.includes("observer.observe(document.documentElement"))fail('Answer observer must not scan the whole document.');
if(layout.includes("document.addEventListener('click'"))fail('Answer enhancer must not re-scan on every click.');
if(!css.includes(':is(.answers,.answer-grid).answer-layout-v8'))fail('CSS must cover both Exam .answers and Learning .answer-grid.');
if(!/@media \(max-width:719px\)[\s\S]*grid-template-columns:minmax\(0,1fr\)/.test(css))fail('Mobile answer layout must force one column.');
if(!/\.answer-content-v8\.math-choice\{[^}]*direction:ltr/.test(css))fail('Math choices must retain LTR isolation.');

for(const literal of ['19 - (-7)','(-7) - 19','-7 + 19','19 + (-7)','-21 - (-6)','-26']){
  if(!read('tests/math-direction.mjs').includes(literal))fail(`Math direction regression missing: ${literal}`);
}
if(!mathDirection.includes("globalThis.math = directionSafeMath"))fail('Global math renderer must be direction-safe before Learning/Exam use it.');
if(!mathDirection.includes("new MutationObserver"))fail('Math direction fallback observer is missing.');
if(!mathDirection.includes("document.getElementById('app')"))fail('Math direction observer must be scoped to #app.');
if(mathDirection.includes('observe(document.documentElement'))fail('Math direction observer must not watch the full document.');
if(!mathDirection.includes("node.dir = 'ltr'"))fail('Generated math nodes must declare LTR direction.');
if(!mathDirectionCss.includes('.flh-math-ltr{direction:ltr;unicode-bidi:isolate'))fail('Math runs must use LTR unicode-bidi isolation.');
if(!mathDirectionCss.includes('input[inputmode="numeric"]')||!mathDirectionCss.includes('input[inputmode="decimal"]'))fail('Numeric answer inputs must be LTR-isolated.');

if(!library.includes("observer.observe(appRoot,{childList:true,subtree:true})"))fail('Student Library observer must be scoped to #app.');
if(library.includes("observer.observe(document.documentElement"))fail('Student Library observer must not watch the whole document.');

const localizer=read('ui-localization-v1.js');
for(const required of ['Level','Hints','Learning Mode','Exam Mode','جارٍ','متابعة الأبناء','تذكّرني'])if(!localizer.includes(required))fail(`Arabic copy normalizer missing: ${required}`);

const examLogic=read('supabase/functions/exam-v2-api/logic.mjs');
const examTests=read('tests/exam-v2-api.mjs');
const qa=read('.github/workflows/qa-smoke.yml');
if(!examLogic.includes('typeof body.is_flagged!=="boolean"'))fail('Exam API boolean flag guard missing.');
if(!examLogic.includes('.eq("learner_id",learnerId)'))fail('Exam API learner scope guard missing.');
for(const requiredTest of ['signed null learner payload','array action is rejected','array attempt_id is rejected','learner-content isolation','zero-row flag update','valid boolean flag persists'])if(!examTests.includes(requiredTest))fail(`Exam API regression missing: ${requiredTest}`);
for(const command of ['node tests/static-qa.mjs','node tests/math-direction.mjs','node tests/exam-v2-api.mjs','node tests/smoke.mjs','node tests/performance.mjs','node tests/copy-smoke.mjs'])if(!qa.includes(command))fail(`QA workflow missing command: ${command}`);

if(failures.length){console.error('\nSTATIC QA FAILED');for(const m of failures)console.error(`- ${m}`);process.exit(1);}
console.log('Static QA passed: unified build cache busting, A-F option labels, global RTL-safe math isolation, numeric input direction, mobile full-width layout, Learning confirmation flow, scoped dynamic observers, active runtime/legacy guards and Exam API protections are valid.');