import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context={math:value=>String(value).replace(/(\d+)\/(\d+)/g,()=>{throw new Error('The old formatter must not split original expressions.');})};
context.globalThis=context;
vm.runInNewContext(fs.readFileSync(new URL('../math-direction-v1.js',import.meta.url),'utf8'),context);
const {splitMathText,isolateMathHtml}=context.FLHMathDirection;
const corpus=[
  ['(-3)^2 + sqrt(16) = 13',['flh-math-power','flh-math-root']],
  ['(1/2 + 3/4) × 2 = 2.5',['frac']],
  ['\\frac{1}{2} + \\sqrt{9} ≥ 3.5',['frac','flh-math-root']],
  ['\\frac{-3 + 1}{2^3} ≤ √(4 + 5)',['frac','flh-math-power','flh-math-root']],
  ['(2 + (3 × -4)) ÷ 5 ≠ -2',[]],
  ['-2.5 * (4 + 1) < 0',[]],
  ['2,5 >= 1,5',[]],
  ['٢٫٥ − (-١) = ٣٫٥',[]],
  ['2^{3 + 1} = 16',['flh-math-power']],
  ['2² + 3³ = 35',['flh-math-power']],
  ['(-2)⁻³ × 2¹⁰ = -128',['flh-math-power']],
  ['√9 + 1 = 4',['flh-math-root']],
  ['√9² + (√9)² = 18',['flh-math-root','flh-math-power']],
  ['x^2 + 2*x + 1 = (x + 1)^2',['flh-math-power']]
];
for(const [source,classes] of corpus){
  const mixed=`احسب: ${source} ثم اختر الجواب.`;
  const parts=splitMathText(mixed).filter(part=>part.math);
  assert.equal(parts.length,1,`Whole expression must stay together: ${source}`);
  assert.equal(parts[0].text,source);
  const html=context.math(mixed);
  assert.equal((html.match(/<bdi /g)||[]).length,1,source);
  for(const name of classes)assert.ok(html.includes(`class="${name}"`),`${source} missing ${name}`);
  if(classes.length)assert.ok(html.includes('role="math" aria-label='),'Structured expression must retain its readable canonical source label');
  assert.equal(isolateMathHtml(html),html,'Rendering must remain idempotent');
}

for(const source of ['مرحبا بكم','Select the correct answer.','Doğru yanıtı seçin.','öğrenci2','Q-20260907401',"B şehri UTC-4&#39;tür.",'A &amp; B','&#39; &#x27; &sup2;'])assert.equal(isolateMathHtml(source),source);
for(const source of ['\\frac{1}{}','sqrt()','\\unknown{2}','(2 + 3','2^^3']){
  const html=isolateMathHtml(source);
  assert.ok(html.length>0,'Unsupported notation must never blank the question');
  assert.ok(!html.includes('class="frac"')&&!html.includes('class="flh-math-root"')&&!html.includes('class="flh-math-power"'),'Invalid notation must not manufacture mathematical structure');
}
for(const source of ['<img src=x onerror=alert(1)> 2/3','<script>alert(2)</script>','&lt;img src=x onerror=alert(1)&gt; 2^3','<bdi class="flh-math-ltr" dir="ltr"><img src=x onerror=alert(1)></bdi>']){
  const html=isolateMathHtml(source);
  assert.ok(!/<(?:img|script)\b/i.test(html),'Untrusted HTML must stay escaped text');
  assert.ok(!/<[^>]*\bon(?:error|load|focus)=/i.test(html),'Generated tags must not carry event handlers');
}
const existing=isolateMathHtml('2/3 + 1/4');
assert.ok(existing.includes('<span class="n">2</span><span class="d">3</span>')&&existing.includes(' + <span class="frac"><span class="n">1</span><span class="d">4</span>'),'Operand/fraction order must survive typesetting');
assert.ok(isolateMathHtml('(-3)^2 + sqrt(16) = 13').includes('(-3)<sup>2</sup></span> + <span class="flh-math-root"><span class="flh-math-radical">√</span><span class="flh-math-radicand">16</span></span> = 13'),'Signed base, exponent, radicand and comparison operands must stay in mathematical order');
assert.ok(isolateMathHtml('2² + 3³ = 35').includes('2<sup>2</sup></span> + <span class="flh-math-power">3<sup>3</sup></span> = 35'),'Unicode exponents must be raised once inside the complete expression');
assert.ok(isolateMathHtml('(-2)⁻³').includes('(-2)<sup>-3</sup>'),'Unicode signed exponents must retain their sign');
assert.ok(isolateMathHtml('√9²').includes('<span class="flh-math-radicand"><span class="flh-math-power">9<sup>2</sup></span></span>'),'A Unicode root must retain its powered radicand beneath the radical bar');
assert.ok(isolateMathHtml('(√9)²').includes('<span class="flh-math-radicand">9</span></span>)<sup>2</sup>'),'Explicit root parentheses must keep the outer exponent outside the radical bar');
const appended=isolateMathHtml(`${existing} ثم 19 - (-7)`);
assert.equal((appended.match(/<bdi /g)||[]).length,2,'Existing markup must not disable new math isolation');
assert.ok(appended.startsWith(existing));
assert.equal(isolateMathHtml(appended),appended);
const deep='('.repeat(80)+'1/2'+')'.repeat(80);
assert.ok(isolateMathHtml(deep).length>0,'Bounded malformed input fallback stays readable');
assert.ok(isolateMathHtml('2^'+ '9'.repeat(3000)).length>0,'Oversized input fallback stays readable');
assert.ok(isolateMathHtml('2 &lt; 3 &amp; 4 &gt; 1').includes('2 &lt; 3'),'Escaped comparisons must preserve source entities');

// Count bounded numeric-token scans instead of asserting wall-clock timing,
// which varies across developer machines and CI runners.
const boundedContext={work:{scans:0,maxWindow:0}};
boundedContext.globalThis=boundedContext;
vm.runInNewContext(`const originalExec=RegExp.prototype.exec;
  RegExp.prototype.exec=function(value){
    if(this.source.startsWith('^[0-9٠-٩]')){work.scans++;work.maxWindow=Math.max(work.maxWindow,String(value).length);}
    return originalExec.call(this,value);
  };`,boundedContext);
vm.runInNewContext(fs.readFileSync(new URL('../math-direction-v1.js',import.meta.url),'utf8'),boundedContext);
for(const source of ['9'.repeat(48000),'2^'+'9'.repeat(48000),'A'.repeat(48000)+'-4']){
  boundedContext.work.scans=0;boundedContext.work.maxWindow=0;
  assert.equal(boundedContext.FLHMathDirection.isolateMathHtml(source),source,'Oversized/identifier input must retain its complete readable source');
  assert.ok(boundedContext.work.scans<=3,'Invalid runs must not be parsed again at each source offset');
  assert.ok(boundedContext.work.maxWindow<=2049,'Numeric token matching must obey the expression source limit');
}
console.log('Math typesetting unit QA passed: bounded complete expressions, all operator families, fractions/powers/roots, readable safe fallbacks, language and markup isolation.');
