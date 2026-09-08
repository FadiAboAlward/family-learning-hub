import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd();
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const failures=[];
const fail=m=>failures.push(m);
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

const guardTests=read('tests/math-direction.mjs')+read('tests/math-direction-browser.mjs')+read('tests/smoke.mjs');
for(const value of ['19 - (-7)','(-7) - 19','-7 + 19','19 + (-7)','-21 - (-6)','-26']){
  if(!guardTests.includes(value))fail(`Regression corpus lost required math case: ${value}`);
}
for(const surface of ['learning','exam','review']){
  if(!read('tests/smoke.mjs').includes(`math-${surface}-verified`))fail(`Actual-mode smoke marker missing for ${surface}.`);
}

if(failures.length){
  console.error('\nMATH RENDERING GUARD FAILED');
  for(const message of failures)console.error(`- ${message}`);
  process.exit(1);
}
console.log('Math rendering guard passed: shared renderer load order, Learning/Exam/history surfaces, LTR isolation, numeric inputs, and real-mode regression markers are intact.');
