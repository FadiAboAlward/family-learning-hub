import { launchMockQaBrowser } from './qa-isolation.mjs';
import { chromium } from 'playwright';

const APP_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await launchMockQaBrowser(chromium,APP_URL);
try{
  const page=await browser.newPage();
  await page.route('**/functions/v1/family-api',route=>route.fulfill({status:200,contentType:'application/json',body:'{"learners":[]}'}));
  for(const viewport of [{width:390,height:844},{width:1365,height:900}]){
  await page.setViewportSize(viewport);
  await page.goto(APP_URL,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.FLHMathDirection&&typeof window.math==='function'));

  const result=await page.evaluate(async()=>{
    const app=document.getElementById('app');
    app.innerHTML=`<section class="panel">
      <div class="question" id="wrappedQuestion">احسب: ${window.math('19 - (-7)')}</div>
      <div class="question" id="fallbackQuestion">احسب: (-7) - 19</div>
      <div class="review-body" id="negativeAnswer">إجابتك: -26</div>
      <div class="question" id="arabicUnit">احسب: ${window.math('20 - 5 = 15س')}</div>
      <div class="question" id="arabicUnitFallback">احسب: ٢٠ - ٥ = ١٥سم</div>
      <div class="question" id="latexFraction">Kesir: ${window.math('\\frac{9}{8}')}</div>
      <div class="question" id="nestedFraction">احسب: ${window.math('(1/2 + 3/4) × 2 = 2.5')}</div>
      <div class="question" id="fractionDivide">احسب: ${window.math('1/2 ÷ 3/4')}</div>
      <div class="question" id="numberDivide">احسب: ${window.math('6 ÷ 2/3')}</div>
      <div class="question" id="fractionProduct">احسب: ${window.math('2/3 × 3/4')}</div>
      <div class="question" id="powerRoot">احسب: ${window.math('(-3)^2 + sqrt(16) = 13')}</div>
      <div class="question" id="unicodePower">احسب: ${window.math('2² + 3³ = 35')}</div>
      <div class="question" id="longPower">${window.math('9'.repeat(120)+'^2')}</div>
      <div class="question" id="oversizedFallback">${window.math('9'.repeat(3000))}</div>
      <div class="question" id="fallbackRoot">احسب: \\frac{1}{2} + \\sqrt{9} ≥ 3.5</div>
      <div class="question" id="partialMarkup">${window.math('2/3')} ثم 19 - (-7)</div>
      <div class="question" id="invalidMath">${window.math('\\sqrt{} و &lt;img src=x onerror=alert(1)&gt;')}</div>
      <div class="question" id="intrinsicProse" style="display:inline-block;width:min-content;max-width:none">الرياضيات</div>
      <div class="question" id="naturalProse" style="display:inline-block;width:max-content;max-width:none;white-space:nowrap">الرياضيات</div>
      <div class="question" id="longArabic" style="width:160px">${'رياضيات'.repeat(100)}</div>
      <input id="numericAnswer" inputmode="numeric" value="-26">
    </section>`;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const inspect=id=>{
      const root=document.getElementById(id);
      const math=root?.querySelector('.flh-math-ltr');
      const style=math?getComputedStyle(math):null;
      return {text:root?.textContent||'',mathText:math?.textContent||'',dir:math?.getAttribute('dir')||'',direction:style?.direction||'',unicodeBidi:style?.unicodeBidi||''};
    };
    const input=document.getElementById('numericAnswer');
    const inputStyle=getComputedStyle(input);
    const latex=document.getElementById('latexFraction');
    const frac=latex?.querySelector('.frac');
    const fracWrapper=frac?.closest('.flh-math-ltr[dir="ltr"]');
    const fracWrapperStyle=fracWrapper?getComputedStyle(fracWrapper):null;
    const structure=id=>{
      const root=document.getElementById(id), bdi=root.querySelector('.flh-math-ltr');
      const fraction=root.querySelector('.frac'), numerator=fraction?.querySelector('.n'), denominator=fraction?.querySelector('.d');
      const exponent=root.querySelector('sup'), radical=root.querySelector('.flh-math-root'), radicand=root.querySelector('.flh-math-radicand');
      const bounds=el=>el?.getBoundingClientRect();
      return {count:root.querySelectorAll('bdi').length,label:bdi?.getAttribute('aria-label'),direction:bdi&&getComputedStyle(bdi).direction,unicodeBidi:bdi&&getComputedStyle(bdi).unicodeBidi,fractions:root.querySelectorAll('.frac').length,roots:root.querySelectorAll('.flh-math-root').length,powers:root.querySelectorAll('.flh-math-power').length,stacked:!fraction||bounds(numerator).bottom<=bounds(denominator).top,raised:!exponent||bounds(exponent).top<bounds(exponent.parentElement).top,rootLine:!radical||parseFloat(getComputedStyle(radicand).borderTopWidth)>0,width:bounds(bdi)?.width||0,available:bounds(root).width};
    };
    const fractionOperands=id=>{
      const math=document.getElementById(id).querySelector('.flh-math-ltr');
      return {label:math?.getAttribute('aria-label'),operands:[...math.querySelectorAll(':scope > .frac')].map(fraction=>({numerator:fraction.querySelector(':scope > .n').textContent,denominator:fraction.querySelector(':scope > .d').textContent,nested:Boolean(fraction.querySelector('.frac'))})),between:[...math.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim()};
    };
    const textLines=(id,selector=null)=>{
      const root=document.getElementById(id),range=document.createRange();range.selectNodeContents(selector?root.querySelector(selector):root);
      return new Set([...range.getClientRects()].map(rect=>Math.round(rect.top))).size;
    };
    const prose={intrinsicWidth:document.getElementById('intrinsicProse').getBoundingClientRect().width,naturalWidth:document.getElementById('naturalProse').getBoundingClientRect().width,wordLines:textLines('intrinsicProse'),signedLines:textLines('negativeAnswer','.flh-math-ltr'),longText:document.getElementById('longArabic').textContent,longFits:document.getElementById('longArabic').scrollWidth<=document.getElementById('longArabic').clientWidth+1};
    return {wrapped:inspect('wrappedQuestion'),fallback:inspect('fallbackQuestion'),answer:inspect('negativeAnswer'),arabicUnit:{...inspect('arabicUnit'),suffix:document.querySelector('#arabicUnit .flh-math-ltr')?.nextSibling?.textContent},arabicUnitFallback:{...inspect('arabicUnitFallback'),suffix:document.querySelector('#arabicUnitFallback .flh-math-ltr')?.nextSibling?.textContent},latex:{html:latex?.innerHTML||'',text:latex?.textContent||'',fracCount:latex?.querySelectorAll('.frac').length||0,wrapperCount:frac?Number(Boolean(fracWrapper)):0,wrapperDirection:fracWrapperStyle?.direction||'',wrapperUnicodeBidi:fracWrapperStyle?.unicodeBidi||''},fractionDivide:fractionOperands('fractionDivide'),numberDivide:fractionOperands('numberDivide'),fractionProduct:fractionOperands('fractionProduct'),prose,nested:structure('nestedFraction'),powerRoot:structure('powerRoot'),unicodePower:structure('unicodePower'),longPower:structure('longPower'),oversizedFallback:document.getElementById('oversizedFallback').textContent,fallbackRoot:structure('fallbackRoot'),partialCount:document.getElementById('partialMarkup').querySelectorAll('bdi').length,invalid:{text:document.getElementById('invalidMath').textContent,unsafe:document.getElementById('invalidMath').querySelector('img,script')!==null},overflow:document.documentElement.scrollWidth>innerWidth,input:{dir:input.getAttribute('dir')||'',direction:inputStyle.direction,unicodeBidi:inputStyle.unicodeBidi||'',value:input.value}};
  });

  const assert=(ok,msg)=>{if(!ok)throw new Error(`${msg}\n${JSON.stringify(result,null,2)}`)};
  assert(result.wrapped.mathText==='19 - (-7)','Wrapped mixed Arabic/math question did not preserve source order.');
  assert(result.fallback.mathText==='(-7) - 19','DOM fallback did not preserve the opposite operand order.');
  assert(result.answer.mathText==='-26','Negative answer did not preserve the leading minus.');
  assert(result.arabicUnit.text==='احسب: 20 - 5 = 15س'&&result.arabicUnit.mathText==='20 - 5 = 15'&&result.arabicUnit.suffix==='س','An adjacent Arabic unit must stay outside the complete mathematical LTR run.');
  assert(result.arabicUnitFallback.text==='احسب: ٢٠ - ٥ = ١٥سم'&&result.arabicUnitFallback.mathText==='٢٠ - ٥ = ١٥'&&result.arabicUnitFallback.suffix==='سم','DOM fallback must preserve Arabic digits and their adjacent Arabic unit.');
  assert(result.latex.fracCount===1&&!result.latex.text.includes('\\frac'),'LaTeX-style fraction did not render through the shared fraction markup.');
  assert(result.latex.wrapperCount===1&&result.latex.wrapperDirection==='ltr'&&result.latex.wrapperUnicodeBidi==='isolate','Rendered fraction must stay inside one LTR bidi-isolation wrapper.');
  for(const entry of [result.wrapped,result.fallback,result.answer,result.arabicUnit,result.arabicUnitFallback]){
    assert(entry.dir==='ltr'&&entry.direction==='ltr',`Math run is not LTR: ${entry.mathText}`);
    assert(entry.unicodeBidi==='isolate',`Math run is not bidi-isolated: ${entry.mathText}`);
  }
  assert(result.input.value==='-26'&&result.input.dir==='ltr'&&result.input.direction==='ltr','Numeric input did not retain -26 in LTR direction.');
  assert(result.nested.label==='(1/2 + 3/4) × 2 = 2.5'&&result.nested.fractions===2,'Nested fraction expression lost its complete accessible source or stacked fractions.');
  assert(result.fractionDivide.label==='1/2 ÷ 3/4'&&JSON.stringify(result.fractionDivide.operands)===JSON.stringify([{numerator:'1',denominator:'2',nested:false},{numerator:'3',denominator:'4',nested:false}])&&result.fractionDivide.between==='÷','Fraction division must keep both authored fraction operands beside the division sign.');
  assert(result.numberDivide.label==='6 ÷ 2/3'&&JSON.stringify(result.numberDivide.operands)===JSON.stringify([{numerator:'2',denominator:'3',nested:false}])&&result.numberDivide.between==='6 ÷','Division by a fraction must not put the earlier numeric operand under its fraction bar.');
  assert(result.fractionProduct.label==='2/3 × 3/4'&&JSON.stringify(result.fractionProduct.operands)===JSON.stringify([{numerator:'2',denominator:'3',nested:false},{numerator:'3',denominator:'4',nested:false}])&&result.fractionProduct.between==='×','Fraction multiplication must keep both authored operands beside the multiplication sign.');
  assert(Math.abs(result.prose.intrinsicWidth-result.prose.naturalWidth)<1&&result.prose.wordLines===1,'Arabic prose min-content sizing must retain the whole word instead of shrinking to a single character.');
  assert(result.prose.signedLines===1,'The negative sign and digits must remain on one readable review line.');
  assert(result.prose.longText==='رياضيات'.repeat(100)&&result.prose.longFits,'Long unbroken Arabic fallback text must remain complete and wrap inside its available width.');
  assert(result.powerRoot.label==='(-3)^2 + sqrt(16) = 13'&&result.powerRoot.powers===1&&result.powerRoot.roots===1,'Power/root expression was split or lost its mathematical structure.');
  assert(result.unicodePower.label==='2² + 3³ = 35'&&result.unicodePower.powers===2,'Unicode superscripts must stay raised inside one complete accessible math expression.');
  assert(result.longPower.count===1&&result.longPower.powers===1&&result.longPower.width<=result.longPower.available,'Long supported powers must stay within the question width.');
  assert(result.oversizedFallback==='9'.repeat(3000),'Oversized notation must retain every source digit as readable fallback text.');
  assert(result.fallbackRoot.label==='\\frac{1}{2} + \\sqrt{9} ≥ 3.5'&&result.fallbackRoot.fractions===1&&result.fallbackRoot.roots===1,'DOM fallback must share the coherent source parser.');
  for(const entry of [result.nested,result.powerRoot,result.unicodePower,result.fallbackRoot])assert(entry.count===1&&entry.direction==='ltr'&&entry.unicodeBidi==='isolate'&&entry.stacked&&entry.raised&&entry.rootLine&&entry.width<=entry.available,'Structured math needs one LTR unit, visible fraction/power/root layout and responsive bounds.');
  assert(result.partialCount===2,'An existing rendered expression must not disable isolation of newly appended math.');
  assert(!result.invalid.unsafe&&result.invalid.text.includes('\\sqrt{}')&&result.invalid.text.includes('<img'),'Invalid and untrusted content must remain readable safe text.');
  assert(!result.overflow,`Math caused horizontal overflow at ${viewport.width}×${viewport.height}.`);
  console.log(`Browser math direction QA passed at ${viewport.width}×${viewport.height}: coherent LTR expressions, stacked fractions, superscripts, roots and safe readable fallbacks.`);
  }
} finally {
  await browser.close();
}
