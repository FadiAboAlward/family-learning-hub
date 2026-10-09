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

// Slash notation is a fraction operand, including beside × and ÷. A fraction
// bar must not swallow an earlier multiplication/division into its numerator.
for(const [source,operator,left,right] of [
  ['1/2 ÷ 3/4','÷',['1','2'],['3','4']],
  ['6 ÷ 2/3','÷','6',['2','3']],
  ['2/3 × 3/4','×',['2','3'],['3','4']],
  ['2 * 3/4','*','2',['3','4']],
  ['-1/2 ÷ -3/4','÷',['-1','2'],['-3','4']]
]){
  const mixed=`احسب: ${source} ثم اختر الجواب.`;
  const parts=splitMathText(mixed),runs=parts.filter(part=>part.math);
  assert.equal(runs.length,1,source);
  assert.equal(parts.map(part=>part.text).join(''),mixed,'Every authored character must survive fraction parsing');
  assert.equal(runs[0].text,source);
  const node=runs[0].node;
  assert.equal(node.kind,'binary',`${source} must retain its outer ${operator} operator`);
  assert.equal(node.between.trim(),operator);
  for(const [operand,expected] of [[node.left,left],[node.right,right]]){
    if(Array.isArray(expected)){
      assert.equal(operand.kind,'fraction',source);
      assert.equal(operand.numerator.source,expected[0],`${source} numerator`);
      assert.equal(operand.denominator.source,expected[1],`${source} denominator`);
    }else{
      assert.equal(operand.kind,'text',source);
      assert.equal(operand.source,expected);
    }
  }
  const html=isolateMathHtml(mixed);
  assert.equal((html.match(/class="frac"/g)||[]).length,[left,right].filter(Array.isArray).length,source);
  assert.ok(html.includes(`aria-label="${source}"`),'The complete canonical source must remain accessible');
  assert.equal(isolateMathHtml(html),html,'Fraction operand rendering must remain idempotent');
}
const nestedDivision=splitMathText('(1/2 ÷ 3/4)/5').find(part=>part.math).node;
assert.equal(nestedDivision.kind,'fraction');
assert.equal(nestedDivision.numerator.kind,'group','Explicit parentheses must remain the outer fraction numerator');
assert.equal(nestedDivision.numerator.inner.kind,'binary');
assert.equal(nestedDivision.numerator.inner.left.numerator.source,'1');
assert.equal(nestedDivision.numerator.inner.right.denominator.source,'4');
assert.equal(nestedDivision.denominator.source,'5');

// An unanswered exercise is not a malformed left-hand expression. Keep its
// complete valid prefix isolated while the unparsed operator/blank stays text.
for(const [prefix,classes] of [
  ['19 - (-7)',[]],
  ['(1/2 + 3/4) × 2',['frac']],
  ['(-3)^2 + sqrt(16)',['flh-math-power','flh-math-root']]
]){
  for(const suffix of [' = ____',' = ',' = (']){
    const source=`احسب: ${prefix}${suffix}`;
    const parts=splitMathText(source);
    assert.equal(parts.filter(part=>part.math).length,1,'An incomplete RHS must retain one complete valid prefix');
    assert.equal(parts.find(part=>part.math).text,prefix,source);
    assert.equal(parts.map(part=>part.text).join(''),source,'Backtracking must preserve every authored character');
    const html=isolateMathHtml(source);
    assert.equal((html.match(/<bdi /g)||[]).length,1,source);
    assert.ok(html.endsWith(suffix),'The unparsed operator and blank must remain readable text');
    for(const name of classes)assert.ok(html.includes(`class="${name}"`),`${source} lost its valid prefix structure`);
    assert.equal(isolateMathHtml(html),html,'Incomplete RHS rendering must remain idempotent');
  }
}

for(const operator of ['=','+','−','×','÷','/','<=','&gt;=']){
  for(const rhs of ['____','(','\\frac{1}{}','sqrt()']){
    const source=`19 - (-7) ${operator} ${rhs}`;
    assert.equal(splitMathText(source).find(part=>part.math)?.text,'19 - (-7)',`Ordinary failed RHS must restore the operator position: ${source}`);
  }
}

// Resource-limit failures are fatal for that parse, never ordinary incomplete
// operands that permit partial rendering of the prefix.
for(const source of ['2 + '+'9'.repeat(48000),'2 + '+' '.repeat(3000)+'1','2 + '+Array(300).fill('1').join(' + '),'2 + '+'('.repeat(80)+'1'+')'.repeat(80)]){
  assert.ok(!splitMathText(source).some(part=>part.math&&part.text==='2'),'MATH_LIMIT must not be downgraded into a rendered valid prefix');
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
