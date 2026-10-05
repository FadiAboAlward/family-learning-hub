import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd();
const failures=[];
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const exists=p=>fs.existsSync(path.join(ROOT,p));
const fail=m=>failures.push(m);
const index=read('index.html');

if(exists('content/tr-math-g5-meb-support-set1-v1.json')&&exists('supabase/migrations/20261005103000_register_tr_g5_meb_support_set1.sql')){
  try{
    const contentPackage=JSON.parse(read('content/tr-math-g5-meb-support-set1-v1.json'));
    const migration=read('supabase/migrations/20261005103000_register_tr_g5_meb_support_set1.sql');
    const match=migration.match(/v_pkg\s+jsonb\s*:=\s*\$pkg\$([\s\S]*?)\$pkg\$::jsonb;/);
    if(!match)fail('Support workbook migration is missing its embedded validated package payload.');
    else{
      const embedded=JSON.parse(match[1]);
      if(JSON.stringify(embedded)!==JSON.stringify(contentPackage))fail('Support workbook migration payload drifted from the validated content package.');
    }
  }catch(error){fail(`Support workbook package/migration parity check failed: ${error.message}`);}
}

/** Extract one active top-level GitHub Actions job block by YAML indentation. */
function yamlJobBlock(yaml,jobName){
  const lines=yaml.split(/\r?\n/),start=lines.findIndex(line=>line.trimEnd()===`  ${jobName}:`);
  if(start<0)return'';
  let end=lines.length;
  for(let i=start+1;i<lines.length;i++){if(/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])){end=i;break;}}
  return lines.slice(start,end).join('\n');
}
/** Return a job-level `if:` expression, or null when the job is unconditional. */
function yamlJobCondition(job){
  const lines=job.split(/\r?\n/);
  const line=lines.find(value=>/^    if:\s*/.test(value));
  return line?line.replace(/^    if:\s*/,'').trim():null;
}
/** Split an active job into its YAML step blocks, excluding commented-out text. */
function yamlStepBlocks(job){
  const lines=job.split(/\r?\n/),stepsStart=lines.findIndex(line=>/^    steps:\s*$/.test(line));
  if(stepsStart<0)return[];
  const blocks=[];
  for(let i=stepsStart+1;i<lines.length;){
    if(!/^      -(?:\s+|$)/.test(lines[i])){i++;continue;}
    const block=[lines[i++]];
    while(i<lines.length&&!/^      -(?:\s+|$)/.test(lines[i]))block.push(lines[i++]);
    blocks.push(block.join('\n'));
  }
  return blocks;
}
/** Return a step-level `if:` expression, including first-field `- if:` syntax. */
function yamlStepCondition(step){
  const lines=step.split(/\r?\n/);
  const first=lines.find(value=>/^      -\s+if:\s*/.test(value));
  if(first)return first.replace(/^      -\s+if:\s*/,'').trim();
  const nested=lines.find(value=>/^        if:\s*/.test(value));
  return nested?nested.replace(/^        if:\s*/,'').trim():null;
}
/** Return a workflow step name from first-field or nested name syntax. */
function yamlStepName(step){
  const lines=step.split(/\r?\n/);
  const first=lines.find(value=>/^      -\s+name:\s*/.test(value));
  if(first)return first.replace(/^      -\s+name:\s*/,'').trim();
  const nested=lines.find(value=>/^        name:\s*/.test(value));
  return nested?nested.replace(/^        name:\s*/,'').trim():'';
}
/** True only for explicit always() used on the named screenshot evidence upload. */
function yamlAlwaysCondition(condition){return /^always\(\)$/i.test(condition||'')||/^\$\{\{\s*always\(\)\s*\}\}$/i.test(condition||'');}
/** Extract a sole inline direct shell command from one workflow step. */
function yamlRunLines(step){
  const lines=step.split(/\r?\n/);
  let runIndex=lines.findIndex(line=>/^        run:\s*/.test(line)),prefix=/^        run:\s*/;
  if(runIndex<0){runIndex=lines.findIndex(line=>/^      -\s+run:\s*/.test(line));prefix=/^      -\s+run:\s*/;}
  if(runIndex<0)return[];
  const first=lines[runIndex].replace(prefix,'').trim();
  if(!first||/^[|>][-+0-9]*$/.test(first)||first.startsWith('#'))return[];
  return [first];
}
/** Required command execution is valid only in an unconditional job and unconditional step. */
function yamlHasDirectRequiredCommand(job,command){
  if(yamlJobCondition(job)!==null)return false;
  return yamlStepBlocks(job).some(step=>yamlStepCondition(step)===null&&yamlRunLines(step).includes(command));
}
/** Read a single active needs dependency from a job block. */
function yamlJobNeeds(job){
  const line=job.split(/\r?\n/).find(value=>/^    needs:\s*[^#\s]+\s*$/.test(value));
  return line?line.replace(/^    needs:\s*/,'').trim():'';
}
/** Find one named safe workflow step. Only callers opting in may allow always(). */
function yamlNamedSafeStep(job,name,{allowAlways=false}={}){
  if(yamlJobCondition(job)!==null)return'';
  return yamlStepBlocks(job).find(step=>{
    if(yamlStepName(step)!==name)return false;
    const condition=yamlStepCondition(step);
    return condition===null||(allowAlways&&yamlAlwaysCondition(condition));
  })||'';
}

if(!/<html[^>]+lang=["']ar["'][^>]+dir=["']rtl["']/i.test(index))fail('index.html must declare Arabic RTL.');
if(!/<meta[^>]+name=["']viewport["']/i.test(index))fail('index.html is missing mobile viewport.');
if(index.includes('جارِ'))fail('Visible Arabic typo جارِ found in index.html.');

const build=(index.match(/<body[^>]+data-build=["']([^"']+)/i)||[])[1];
if(!build)fail('Missing body data-build.');
const metaBuild=(index.match(/<meta[^>]+name=["']app-build["'][^>]+content=["']([^"']+)/i)||[])[1];
if(!metaBuild)fail('Missing app-build meta marker.');
if(build&&metaBuild&&build!==metaBuild)fail('app-build meta marker must match body data-build.');
const assetVersions=[...index.matchAll(/(?:src|href)=["']\.\/[^"'?]+\?v=([^"']+)["']/g)].map(m=>m[1]);
if(!assetVersions.length)fail('No versioned local assets found.');
if(assetVersions.some(v=>v!==build))fail(`All local CSS/JS assets must use the current build version ${build}.`);

const localRefs=[...index.matchAll(/(?:src|href)=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
for(const ref of localRefs){if(!exists(ref))fail(`index.html references missing file: ${ref}`);}
const loadedScripts=[...index.matchAll(/<script[^>]+src=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
for(const f of ['learning-launcher-v1.js','program-exam-v2.js','exam-experience-v7.js','exam-state-sync-v7.js'])if(loadedScripts.includes(f))fail(`Legacy runtime must not be loaded: ${f}`);
for(const f of ['app-version-v1.js','app.js','math-direction-v1.js','content-direction-v1.js','dynamic-login-v3.js','learning-launcher-v2.js','program-exam-v3.js','answer-layout-v8.js','student-library-v3.js','attempt-history-v1.js','parent-center-v3.js','question-reference-ui-v1.js','ui-localization-v1.js'])if(!loadedScripts.includes(f))fail(`Required runtime missing: ${f}`);
if(loadedScripts.indexOf('app-version-v1.js')>loadedScripts.indexOf('app.js'))fail('App version watcher must load before app.js.');
if(loadedScripts.indexOf('math-direction-v1.js')<loadedScripts.indexOf('app.js'))fail('Math direction runtime must load after app.js so it can wrap the shared math renderer.');
if(loadedScripts.indexOf('math-direction-v1.js')>loadedScripts.indexOf('learning-launcher-v2.js')||loadedScripts.indexOf('math-direction-v1.js')>loadedScripts.indexOf('program-exam-v3.js'))fail('Math direction runtime must load before Learning and Exam renderers.');
if(loadedScripts.indexOf('content-direction-v1.js')<loadedScripts.indexOf('math-direction-v1.js')||loadedScripts.indexOf('content-direction-v1.js')>loadedScripts.indexOf('learning-launcher-v2.js')||loadedScripts.indexOf('content-direction-v1.js')>loadedScripts.indexOf('program-exam-v3.js')||loadedScripts.indexOf('content-direction-v1.js')>loadedScripts.indexOf('attempt-history-v1.js'))fail('Content direction runtime must load after math direction and before Learning/Exam/history renderers.');

const learning=read('learning-launcher-v2.js');
const exam=read('program-exam-v3.js');
const history=read('attempt-history-v1.js');
const attemptHistoryApi=read('supabase/functions/attempt-history-api/index.ts');
const resumeHintMigration=read('supabase/migrations/20261002124500_learning_resume_last_authored_hint.sql');
const interactivePracticeHtml=read('interactive-practice.html');
const interactivePractice=read('interactive-practice-v1.js');
const layout=read('answer-layout-v8.js');
const css=read('answer-layout-v8.css');
const mathDirection=read('math-direction-v1.js');
const contentDirection=read('content-direction-v1.js');
const appVersion=read('app-version-v1.js');
const questionReference=read('question-reference-ui-v1.js');
const mathDirectionCss=read('math-direction-v1.css');
const mathGuard=read('tests/math-rendering-guard.mjs');
const screenshotEvidence=read('tests/screenshot-evidence.mjs');
const library=read('student-library-v3.js');
const academicContract=read('docs/academic-content-quality.md');
const academicValidator=read('scripts/academic-content-quality.mjs');
const academicTests=read('tests/academic-content-quality.mjs');
const agents=read('AGENTS.md');

for(const phrase of ['Student Academic State','runtime_external_dependencies','nudge','near_solution','Brisk Teaching','Snorkl','prompt_language','self-contained'])if(!academicContract.includes(phrase))fail(`Academic quality contract missing protected rule: ${phrase}`);
for(const code of ['EVIDENCE_REFS_REQUIRED','DUPLICATE_REASONING_SIGNATURE','DISTRACTOR_RATIONALE_REQUIRED','FOUR_HINT_LEVELS_REQUIRED','HINT_MIN_WORDS','HINT_BULLET_STRUCTURE','HINT_ANSWER_LEAK','NON_LEARNING_HINTS_FORBIDDEN','EXTERNAL_RUNTIME_DEPENDENCY_FORBIDDEN','PROMPT_LANGUAGE_REQUIRED','LEARNER_TEXT_MARKUP_FORBIDDEN','EXTERNAL_SOURCE_DEPENDENCY','ADJACENT_DUPLICATE_WORD'])if(!academicValidator.includes(code))fail(`Academic package validator missing rule: ${code}`);
for(const code of ['HINT_ANSWER_LEAK','NON_LEARNING_HINTS_FORBIDDEN'])if(!academicTests.includes(code))fail(`Academic content regression missing: ${code}`);
if(!agents.includes('docs/academic-content-quality.md'))fail('AGENTS.md must pin the academic content quality contract.');

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
if(!learning.includes('questionAttrs(q)')||!exam.includes('questionAttrs(q)'))fail('Learning and Exam prompts/options must use prompt_language for explicit content direction.');
if(!learning.includes('class="flh-hint-content" ${hintAttrs(currentHint,q)}'))fail('Learning authored hint content must use the hint language with question-language fallback.');
if(learning.includes('class="flh-hint-card" ${hintAttrs(currentHint,q)}'))fail('Arabic hint chrome must not inherit the authored hint language boundary.');
if(!learning.includes('hintContentHtml')||!learning.includes('flh-hint-list'))fail('Learning must render canonical hint bullets as a semantic list.');
if(!learning.includes("lines.map(x=>`<li>${renderMath(x.replace(/^•\\s+/u,''))}</li>`")||!learning.includes(':renderMath(s);'))fail('Learning hint list/fallback rendering must keep every authored hint segment behind renderMath.');
if(!learning.includes('row.hint_unavailable_local=true')||!learning.includes('flh-hint-notice'))fail('Learning must show missing/exhausted hint availability outside the numbered hint card.');
if(!learning.includes("if(!d.finalized){")||!learning.includes("else if(d.hint){")||!learning.includes("row.hint_unavailable_local=true;"))fail('Learning answer submissions with no next authored hint must preserve the last hint and enter the unavailable state.');
if(learning.includes('وصلت لآخر مستوى من التلميحات'))fail('Learning must not synthesize a fake numbered Hint 4 when authored content is missing.');
if(learning.includes("content:'تعذر تحميل التلميح الآن. جرّب مرة ثانية.'"))fail('Learning transport errors must not replace authored hint content with a synthetic numbered hint.');
if(!learning.includes("pedagogical_role==='misconception_explanation'")||!learning.includes('flh-misconception-feedback'))fail('Misconception-only feedback must render outside numbered Learning hints.');
if(!learning.includes("currentHint=queue[index]?.last_hint?.content?queue[index].last_hint:null"))fail('Learning resume must initialize from the last authored hint returned by the backend.');
if(!resumeHintMigration.includes("'last_hint', case")||!resumeHintMigration.includes('from public.quiz_question_hints h')||!resumeHintMigration.includes('h.hint_level = qq.hint_level_requested'))fail('Learning start RPC must return the last persisted authored hint without advancing progression.');
if(!learning.includes('class="flh-explanation"><b>الشرح</b><div dir="auto"'))fail('Learning feedback explanations must use automatic prose direction when no language metadata exists.');
if(!exam.includes('<li dir="auto">'))fail('Exam review explanation steps must isolate their own prose direction.');
if(!history.includes('contentAttrs(x.prompt_language)'))fail('Attempt history prompt/answer review must use prompt_language direction.');
if(!history.includes("globalThis.FLHContentDirection?.normalizeText"))fail('Attempt history must normalize legacy encoded learner text before safe escaping.');
if(!attemptHistoryApi.includes('prompt,prompt_language,points')||!attemptHistoryApi.includes('prompt_language: q.prompt_language || null'))fail('Attempt history API must return prompt_language with learner-facing review prompts.');
if(!interactivePracticeHtml.includes('content-direction-v1.js?v=20260930-quality1')||interactivePracticeHtml.indexOf('content-direction-v1.js')>interactivePracticeHtml.indexOf('interactive-practice-v1.js'))fail('Interactive practice must load the shared content-direction helper before its renderer.');
if(!interactivePractice.includes('contentAttrs(q.prompt_language)')||!interactivePractice.includes('hintAttrs(currentHint,q)')||!interactivePractice.includes('contentAttrs(r.prompt_language)'))fail('Interactive practice prompt/options/hints/review must honor language direction metadata.');
if(!interactivePractice.includes("language:'ar',content:'تعذر تحميل التلميح الآن"))fail('Interactive practice synthesized Arabic hint errors must declare Arabic language metadata.');
if(!learning.includes('questionAttrs(r)')||!exam.includes('questionAttrs(r)'))fail('Learning and Exam reviews must preserve prompt_language direction.');
if(learning.includes('flh-code-inline')||exam.includes('flh-code-inline'))fail('Question code must have one visible owner; Learning/Exam must not render duplicate inline codes.');
if(!questionReference.includes("b.dir='ltr'")||!questionReference.includes("b.lang='en'"))fail('Question reference chips must isolate the code as LTR.');
if(!questionReference.includes("document.getElementById('app')")||questionReference.includes('observe(document.documentElement'))fail('Question reference observer must be scoped to #app.');
if(!contentDirection.includes("['ar','rtl']")||!contentDirection.includes("['tr','ltr']")||!contentDirection.includes("['en','ltr']"))fail('Content direction helper must map ar/tr/en explicitly.');
if(!contentDirection.includes('normalizeText'))fail('Content direction helper must normalize legacy encoded learner text before safe escaping.');
for(const phrase of ['FLHAppVersion','visibilitychange',"cache: 'no-store'",'_flh_build','sessionStorage'])if(!appVersion.includes(phrase))fail(`App version watcher missing protected behavior: ${phrase}`);
if(!mathDirectionCss.includes('.question[dir],.answers[dir],.answer-grid[dir]'))fail('Question/answer language direction boundaries must use bidi isolation.');
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

const protectedSurfaces={
  'learning-launcher-v2.js':[
    'renderMath(q.prompt)','renderMath(o.content)','hintContentHtml(currentHint.content)','renderMath(d.explanation)',"renderMath(r.prompt||'')",'renderMath(r.explanation)'
  ],
  'program-exam-v3.js':[
    'renderMath(q.prompt)','renderMath(o.content)',"renderMath(r.prompt||'')","renderMath(selected||String(r.response?.option_position||''))","renderMath(correct||String(r.correct_answer?.option_position||''))",'steps.map(s=>`<li dir="auto">${renderMath(s)}</li>`)'
  ],
  'attempt-history-v1.js':[
    "mth(x.prompt||'')",'mth(sel)','mth(cor)','mth(x.explanation)'
  ]
};
const protectedSources={'learning-launcher-v2.js':learning,'program-exam-v3.js':exam,'attempt-history-v1.js':history};
for(const [file,needles] of Object.entries(protectedSurfaces))for(const needle of needles)if(!protectedSources[file].includes(needle))fail(`Required math rendering surface missing from ${file}: ${needle}`);

for(const surface of ['learning-launcher-v2.js','program-exam-v3.js','attempt-history-v1.js'])if(!mathGuard.includes(`'${surface}':[`))fail(`Math architecture guard no longer names protected surface: ${surface}`);
for(const phrase of ['Math/RTL rendering affected','Math rendering invariant checked','actual Learning Mode, Exam Mode, and completed/review flows'])if(!mathGuard.includes(phrase))fail(`Math architecture guard no longer protects PR checklist phrase: ${phrase}`);
for(const phrase of ['RTL-safe math rendering as a platform invariant','Never fix bidi by reversing operands','real-browser coverage of actual Learning, Exam, and review flows'])if(!mathGuard.includes(phrase))fail(`Math architecture guard no longer protects CodeRabbit policy phrase: ${phrase}`);
for(const phrase of ['Protect main','Static quality','Browser smoke'])if(!mathGuard.includes(phrase))fail(`Math architecture guard no longer protects enforcement documentation phrase: ${phrase}`);
for(const phrase of ['yamlJobCondition(staticJob)','yamlJobCondition(browserJob)','yamlHasDirectRequiredCommand(staticJob,command)','yamlHasDirectRequiredCommand(browserJob,command)',"yamlNamedSafeStep(staticJob,'Math rendering architecture guard')"])if(!mathGuard.includes(phrase))fail(`Math architecture guard no longer protects direct unconditional workflow semantics: ${phrase}`);

if(!screenshotEvidence.includes("const OUTPUT_DIR='playwright-screenshots'"))fail('Screenshot evidence must use the dedicated playwright-screenshots folder.');
if(!screenshotEvidence.includes('page.screenshot('))fail('Screenshot evidence must capture actual Playwright screenshots.');
for(const name of ['01-learning-math','02-learning-review','03-exam-math','04-exam-review'])if(!screenshotEvidence.includes(name))fail(`Screenshot evidence stage missing: ${name}`);
if(!screenshotEvidence.includes('retention_days:7'))fail('Screenshot manifest must record seven-day retention.');

if(!library.includes("observer.observe(appRoot,{childList:true,subtree:true})"))fail('Student Library observer must be scoped to #app.');
if(library.includes("observer.observe(document.documentElement"))fail('Student Library observer must not watch the whole document.');

const localizer=read('ui-localization-v1.js');
for(const required of ['Level','Hints','Learning Mode','Exam Mode','جارٍ','متابعة الأبناء','تذكّرني'])if(!localizer.includes(required))fail(`Arabic copy normalizer missing: ${required}`);

const examLogic=read('supabase/functions/exam-v2-api/logic.mjs');
const examTests=read('tests/exam-v2-api.mjs');
const qa=read('.github/workflows/qa-smoke.yml');
const staticJob=yamlJobBlock(qa,'static-quality'),browserJob=yamlJobBlock(qa,'browser-smoke');
if(!examLogic.includes('typeof body.is_flagged!=="boolean"'))fail('Exam API boolean flag guard missing.');
if(!examLogic.includes('.eq("learner_id",learnerId)'))fail('Exam API learner scope guard missing.');
for(const requiredTest of ['signed null learner payload','array action is rejected','array attempt_id is rejected','learner-content isolation','zero-row flag update','valid boolean flag persists'])if(!examTests.includes(requiredTest))fail(`Exam API regression missing: ${requiredTest}`);
if(yamlJobCondition(staticJob)!==null)fail('Static quality job must be unconditional.');
if(!qa.includes("find scripts -type f -name '*.mjs' -print0 | xargs -0 -n1 node --check"))fail('Static quality must syntax-check academic authoring scripts.');
if(yamlJobCondition(browserJob)!==null)fail('Browser smoke job must be unconditional.');
for(const command of ['node tests/static-qa.mjs','node tests/academic-content-quality.mjs','node tests/math-rendering-guard.mjs','node tests/math-direction.mjs','node tests/content-direction.mjs','node tests/exam-v2-api.mjs'])if(!yamlHasDirectRequiredCommand(staticJob,command))fail(`Static quality missing direct unconditional command: ${command}`);
for(const command of ['node tests/smoke.mjs','node tests/math-direction-browser.mjs','node tests/content-direction-browser.mjs','node tests/screenshot-evidence.mjs','node tests/performance.mjs','node tests/copy-smoke.mjs'])if(!yamlHasDirectRequiredCommand(browserJob,command))fail(`Browser smoke missing direct unconditional command: ${command}`);
if(yamlJobNeeds(browserJob)!=='static-quality')fail('Browser smoke must structurally depend on Static quality.');
const screenshotUpload=yamlNamedSafeStep(browserJob,'Upload Playwright screenshots',{allowAlways:true});
if(!screenshotUpload)fail('Playwright screenshot upload step is missing or has an unsafe condition.');
const screenshotCondition=yamlStepCondition(screenshotUpload);
if(screenshotCondition!==null&&!yamlAlwaysCondition(screenshotCondition))fail('Only always() is permitted on the Playwright screenshot upload step.');
for(const fragment of ['name: playwright-screenshots-${{ github.run_id }}','path: playwright-screenshots/','retention-days: 7'])if(!screenshotUpload.includes(fragment))fail(`Temporary screenshot artifact policy missing from safe upload step: ${fragment}`);
const uploadArtifactRefs=[...qa.matchAll(/^\s*uses:\s*actions\/upload-artifact@([^\s#]+).*$/gm)].map(match=>match[1]);
if(!uploadArtifactRefs.length)fail('QA Gate must upload screenshot/performance artifacts.');
for(const ref of uploadArtifactRefs)if(!/^[0-9a-f]{40}$/i.test(ref))fail(`actions/upload-artifact must be pinned to an immutable 40-character SHA, got: ${ref}`);

const prTemplate=read('.github/pull_request_template.md');
if(!prTemplate.includes('Playwright screenshot evidence'))fail('PR template must request Playwright screenshot evidence for user-facing UI changes.');
if(!prTemplate.includes('Screenshot artifact / evidence link, or N/A reason'))fail('Post-merge screenshot evidence field must allow an explicit N/A reason.');
const qaPolicy=read('docs/qa-policy.md');
for(const phrase of ['playwright-screenshots/','retention-days: 7','Do not commit transient QA screenshots'])if(!qaPolicy.includes(phrase))fail(`QA policy lost screenshot evidence rule: ${phrase}`);

if(failures.length){console.error('\nSTATIC QA FAILED');for(const m of failures)console.error(`- ${m}`);process.exit(1);}
console.log('Static QA passed: unified build cache busting, A-F option labels, global RTL-safe math isolation, protected math-surface semantics, direct unconditional required-job QA wiring, immutable artifact action pinning, seven-day Playwright screenshot evidence, numeric input direction, mobile full-width layout, Learning confirmation flow, active runtime/legacy guards and Exam API protections are valid.');
