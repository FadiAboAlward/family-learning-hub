import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd();
const failures=[];

/** Read a repository text file relative to the current checkout. */
function read(file){return fs.readFileSync(path.join(ROOT,file),'utf8');}
/** Record a guard failure while allowing the remaining invariant checks to run. */
function fail(message){failures.push(message);}
/** Extract one active top-level GitHub Actions job block by YAML indentation. */
function yamlJobBlock(yaml,jobName){
  const lines=yaml.split(/\r?\n/);
  const start=lines.findIndex(line=>line.trimEnd()===`  ${jobName}:`);
  if(start<0){fail(`QA Gate missing active job: ${jobName}`);return'';}
  let end=lines.length;
  for(let i=start+1;i<lines.length;i++){
    if(/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])){end=i;break;}
  }
  return lines.slice(start,end).join('\n');
}
/** Return a job-level `if:` expression, or null when the job is unconditional. */
function yamlJobCondition(job){
  const lines=job.split(/\r?\n/);
  const line=lines.find(value=>/^    if:\s*/.test(value));
  return line?line.replace(/^    if:\s*/,'').trim():null;
}
/** Split an active job into its YAML step blocks, ignoring commented-out step text. */
function yamlStepBlocks(job){
  const lines=job.split(/\r?\n/);
  const stepsStart=lines.findIndex(line=>/^    steps:\s*$/.test(line));
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
/** Return the active `if:` expression on a step, including first-field `- if:` syntax. */
function yamlStepCondition(step){
  const lines=step.split(/\r?\n/);
  const first=lines.find(value=>/^      -\s+if:\s*/.test(value));
  if(first)return first.replace(/^      -\s+if:\s*/,'').trim();
  const nested=lines.find(value=>/^        if:\s*/.test(value));
  return nested?nested.replace(/^        if:\s*/,'').trim():null;
}
/** Return a workflow step name from either first-field or nested name syntax. */
function yamlStepName(step){
  const lines=step.split(/\r?\n/);
  const first=lines.find(value=>/^      -\s+name:\s*/.test(value));
  if(first)return first.replace(/^      -\s+name:\s*/,'').trim();
  const nested=lines.find(value=>/^        name:\s*/.test(value));
  return nested?nested.replace(/^        name:\s*/,'').trim():'';
}
/** True only for the explicit always() condition permitted on screenshot evidence upload. */
function yamlAlwaysCondition(condition){
  return /^always\(\)$/i.test(condition||'')||/^\$\{\{\s*always\(\)\s*\}\}$/i.test(condition||'');
}
/** Extract a sole inline direct shell command from one step's run field. */
function yamlRunLines(step){
  const lines=step.split(/\r?\n/);
  let runIndex=lines.findIndex(line=>/^        run:\s*/.test(line));
  let firstPrefix=/^        run:\s*/;
  if(runIndex<0){runIndex=lines.findIndex(line=>/^      -\s+run:\s*/.test(line));firstPrefix=/^      -\s+run:\s*/;}
  if(runIndex<0)return[];
  const first=lines[runIndex].replace(firstPrefix,'').trim();
  if(!first||/^[|>][-+0-9]*$/.test(first)||first.startsWith('#'))return[];
  return [first];
}
/** Required command execution is valid only in an unconditional job and unconditional step. */
function yamlHasDirectRequiredCommand(job,command){
  if(yamlJobCondition(job)!==null)return false;
  return yamlStepBlocks(job).some(step=>yamlStepCondition(step)===null&&yamlRunLines(step).includes(command));
}
/** Read a single-job needs dependency from an active, uncommented YAML key. */
function yamlJobNeeds(job){
  const line=job.split(/\r?\n/).find(value=>/^    needs:\s*[^#\s]+\s*$/.test(value));
  return line?line.replace(/^    needs:\s*/,'').trim():'';
}
/** Find one named step, requiring an unconditional job and either no condition or an explicitly allowed always(). */
function yamlNamedSafeStep(job,name,{allowAlways=false}={}){
  if(yamlJobCondition(job)!==null)return'';
  return yamlStepBlocks(job).find(step=>{
    if(yamlStepName(step)!==name)return false;
    const condition=yamlStepCondition(step);
    return condition===null||(allowAlways&&yamlAlwaysCondition(condition));
  })||'';
}

const index=read('index.html');
const scripts=[...index.matchAll(/<script[^>]+src=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
const styles=[...index.matchAll(/<link[^>]+href=["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);

const requiredFiles=['app.js','math-direction-v1.js','learning-launcher-v2.js','program-exam-v3.js','attempt-history-v1.js'];
for(const file of requiredFiles)if(!scripts.includes(file))fail(`Active runtime missing required math surface: ${file}`);
if(!styles.includes('math-direction-v1.css'))fail('math-direction-v1.css must be loaded by index.html.');

const order=file=>scripts.indexOf(file);
if(order('math-direction-v1.js')<=order('app.js'))fail('math-direction-v1.js must load after app.js so it can wrap the base math renderer.');
for(const file of ['learning-launcher-v2.js','program-exam-v3.js','attempt-history-v1.js']){
  if(order('math-direction-v1.js')>=order(file))fail(`math-direction-v1.js must load before ${file}.`);
}

const direction=read('math-direction-v1.js');
const directionCss=read('math-direction-v1.css');
for(const required of [
  "globalThis.math = directionSafeMath",
  "<bdi class=\"${MATH_CLASS}\" dir=\"ltr\">",
  "node.dir = 'ltr'",
  "document.getElementById('app')",
  "input[inputmode=\"numeric\"]",
  "input[inputmode=\"decimal\"]"
])if(!direction.includes(required))fail(`Shared math-direction invariant missing: ${required}`);
if(direction.includes('observe(document.documentElement'))fail('Math fallback observer must remain scoped to #app.');
if(!directionCss.includes('.flh-math-ltr{direction:ltr;unicode-bidi:isolate'))fail('Math runs must remain LTR with unicode-bidi:isolate.');
if(!directionCss.includes('input[inputmode="numeric"]')||!directionCss.includes('input[inputmode="decimal"]'))fail('Numeric/decimal inputs must remain LTR-isolated.');

const surfaceContracts={
  'learning-launcher-v2.js':[
    ['shared helper','const renderMath='],
    ['question prompt','renderMath(q.prompt)'],
    ['answer option','renderMath(o.content)'],
    ['hint content','renderMath(currentHint.content)'],
    ['answer feedback explanation','renderMath(d.explanation)'],
    ['completed review prompt',"renderMath(r.prompt||'')"],
    ['completed review explanation','renderMath(r.explanation)']
  ],
  'program-exam-v3.js':[
    ['shared helper','const renderMath='],
    ['question prompt','renderMath(q.prompt)'],
    ['answer option','renderMath(o.content)'],
    ['review prompt',"renderMath(r.prompt||'')"],
    ['review selected answer',"renderMath(selected||String(r.response?.option_position||''))"],
    ['review correct answer',"renderMath(correct||String(r.correct_answer?.option_position||''))"],
    ['review explanation steps','steps.map(s=>`<li>${renderMath(s)}</li>`)']
  ],
  'attempt-history-v1.js':[
    ['shared helper','const mth='],
    ['history prompt',"mth(x.prompt||'')"],
    ['learner answer','mth(sel)'],
    ['correct answer','mth(cor)'],
    ['history explanation','mth(x.explanation)']
  ]
};

for(const [file,contracts] of Object.entries(surfaceContracts)){
  const source=read(file);
  for(const [label,needle] of contracts)if(!source.includes(needle))fail(`${file} bypasses the shared math renderer for ${label}.`);
}

const rawInterpolation=/\$\{([^}]*(?:\.prompt|\.explanation)[^}]*)\}/g;
for(const file of scripts){
  if(!fs.existsSync(path.join(ROOT,file)))continue;
  const source=read(file);
  let match;
  while((match=rawInterpolation.exec(source))){
    const expr=match[1];
    if(/(?:renderMath|mth|math|isolateMathHtml)\s*\(/.test(expr))continue;
    fail(`${file} interpolates a prompt/explanation without the approved math renderer: ${expr.trim()}`);
  }
}

const smoke=read('tests/smoke.mjs');
const guardTests=read('tests/math-direction.mjs')+read('tests/math-direction-browser.mjs')+smoke;
for(const value of ['19 - (-7)','(-7) - 19','-7 + 19','19 + (-7)','-21 - (-6)','-26']){
  if(!guardTests.includes(value))fail(`Regression corpus lost required math case: ${value}`);
}
for(const surface of ['learning','exam','review']){
  if(!smoke.includes(`math-${surface}-verified`))fail(`Actual-mode smoke marker missing for ${surface}.`);
}
if(!smoke.includes('math-learning-review-verified'))fail('Learning completed-review math coverage is missing.');

const qa=read('.github/workflows/qa-smoke.yml');
const staticJob=yamlJobBlock(qa,'static-quality');
const browserJob=yamlJobBlock(qa,'browser-smoke');
if(yamlJobCondition(staticJob)!==null)fail('Static quality job must not have an if: condition.');
if(yamlJobCondition(browserJob)!==null)fail('Browser smoke job must not have an if: condition.');
for(const command of ['node tests/static-qa.mjs','node tests/math-rendering-guard.mjs','node tests/math-direction.mjs','node tests/exam-v2-api.mjs']){
  if(!yamlHasDirectRequiredCommand(staticJob,command))fail(`Static quality no longer directly runs required unconditional command: ${command}`);
}
for(const command of ['node tests/smoke.mjs','node tests/math-direction-browser.mjs','node tests/performance.mjs','node tests/copy-smoke.mjs']){
  if(!yamlHasDirectRequiredCommand(browserJob,command))fail(`Browser smoke no longer directly runs required unconditional command: ${command}`);
}
if(yamlJobNeeds(browserJob)!=='static-quality')fail('Browser smoke must structurally depend on Static quality with needs: static-quality.');
const mathGuardStep=yamlNamedSafeStep(staticJob,'Math rendering architecture guard');
if(!mathGuardStep||!yamlRunLines(mathGuardStep).includes('node tests/math-rendering-guard.mjs'))fail('Static quality must expose the math architecture guard as an unconditional direct command step.');
const screenshotUpload=yamlNamedSafeStep(browserJob,'Upload Playwright screenshots',{allowAlways:true});
if(!screenshotUpload)fail('Playwright screenshot upload must be a safe named step; only this evidence step may use always().');
const uploadArtifactRefs=[...qa.matchAll(/^\s*uses:\s*actions\/upload-artifact@([^\s#]+).*$/gm)].map(match=>match[1]);
if(!uploadArtifactRefs.length)fail('QA Gate must upload screenshot/performance artifacts.');
for(const ref of uploadArtifactRefs)if(!/^[0-9a-f]{40}$/i.test(ref))fail(`actions/upload-artifact must be pinned to an immutable 40-character SHA, got: ${ref}`);

const template=read('.github/pull_request_template.md');
for(const phrase of ['Math/RTL rendering affected','Math rendering invariant checked','actual Learning Mode, Exam Mode, and completed/review flows']){
  if(!template.includes(phrase))fail(`PR checklist lost math rendering gate: ${phrase}`);
}

const codeRabbit=read('.coderabbit.yaml');
for(const phrase of ['RTL-safe math rendering as a platform invariant','Never fix bidi by reversing operands','real-browser coverage of actual Learning, Exam, and review flows']){
  if(!codeRabbit.includes(phrase))fail(`CodeRabbit policy lost math rendering instruction: ${phrase}`);
}

const policyPath='docs/math-rendering-invariant.md';
if(!fs.existsSync(path.join(ROOT,policyPath)))fail(`${policyPath} is required.`);
else{
  const policy=read(policyPath);
  for(const phrase of ['every learner','Stored question/answer data is canonical','synthetic DOM probe','Family Learning Hub Playwright','Protect main','Static quality','Browser smoke']){
    if(!policy.includes(phrase))fail(`Math rendering policy lost required principle: ${phrase}`);
  }
}

if(failures.length){
  console.error('\nMATH RENDERING GUARD FAILED');
  for(const message of failures)console.error(`- ${message}`);
  process.exit(1);
}
console.log('Math rendering guard passed: shared renderer load order, Learning/Exam/history surfaces, LTR isolation, numeric inputs, real-mode regressions, unconditional jobs/steps, direct required command execution, immutable artifact action pinning, CodeRabbit instructions, PR checklist, and server-enforcement documentation are intact.');
