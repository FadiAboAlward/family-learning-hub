import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../math-direction-v1.js',import.meta.url),'utf8');
const context={globalThis:{}};
context.globalThis=context;
vm.runInNewContext(source,context,{filename:'math-direction-v1.js'});
const api=context.FLHMathDirection;
if(!api)throw new Error('FLHMathDirection API was not exposed.');

const cases=[
  ['احسب: 19 - (-7)','19 - (-7)'],
  ['احسب: (-7) - 19','(-7) - 19'],
  ['احسب: -7 + 19','-7 + 19'],
  ['احسب: 19 + (-7)','19 + (-7)'],
  ['احسب: -21 - (-6)','-21 - (-6)'],
  ['إجابتك: -26','-26'],
  ['العلاقة: 2/3 > 1/2','2/3 > 1/2'],
  ['الناتج ٢٦','٢٦']
];

for(const [input,expected] of cases){
  const parts=api.splitMathText(input);
  const math=parts.filter(x=>x.math).map(x=>x.text);
  if(!math.includes(expected))throw new Error(`Expected isolated math run ${JSON.stringify(expected)} in ${JSON.stringify(input)}; got ${JSON.stringify(math)}`);
  const html=api.isolateMathHtml(input);
  if(!html.includes(`<bdi class="flh-math-ltr" dir="ltr">${expected}</bdi>`))throw new Error(`Missing LTR bdi for ${JSON.stringify(expected)}.`);
}

for(const input of ['Q-20260907401','الوحدة الأولى','محمد']){
  const html=api.isolateMathHtml(input);
  if(input==='Q-20260907401'&&html.includes('>-20260907401<'))throw new Error('Question codes must not be misread as negative math expressions.');
  if(!/[0-9٠-٩]/.test(input)&&html!==input)throw new Error(`Non-math text changed unexpectedly: ${input}`);
}

const once=api.isolateMathHtml('احسب: 19 - (-7)');
const twice=api.isolateMathHtml(once);
if(once!==twice)throw new Error('Math isolation must be idempotent.');

console.log('Math direction QA passed: mixed Arabic/math expressions, negative numbers, fractions and numeric results preserve LTR order without changing stored text.');
