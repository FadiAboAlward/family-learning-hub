import { chromium } from 'playwright';

const APP_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(APP_URL,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.FLHMathDirection&&typeof window.math==='function'));

  const result=await page.evaluate(async()=>{
    const app=document.getElementById('app');
    app.innerHTML=`<section class="panel">
      <div class="question" id="wrappedQuestion">احسب: ${window.math('19 - (-7)')}</div>
      <div class="question" id="fallbackQuestion">احسب: (-7) - 19</div>
      <div class="review-body" id="negativeAnswer">إجابتك: -26</div>
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
    return {wrapped:inspect('wrappedQuestion'),fallback:inspect('fallbackQuestion'),answer:inspect('negativeAnswer'),input:{dir:input.getAttribute('dir')||'',direction:inputStyle.direction,unicodeBidi:inputStyle.unicodeBidi,value:input.value}};
  });

  const assert=(ok,msg)=>{if(!ok)throw new Error(`${msg}\n${JSON.stringify(result,null,2)}`)};
  assert(result.wrapped.mathText==='19 - (-7)','Wrapped mixed Arabic/math question did not preserve source order.');
  assert(result.fallback.mathText==='(-7) - 19','DOM fallback did not preserve the opposite operand order.');
  assert(result.answer.mathText==='-26','Negative answer did not preserve the leading minus.');
  for(const entry of [result.wrapped,result.fallback,result.answer]){
    assert(entry.dir==='ltr'&&entry.direction==='ltr',`Math run is not LTR: ${entry.mathText}`);
    assert(entry.unicodeBidi==='isolate',`Math run is not bidi-isolated: ${entry.mathText}`);
  }
  assert(result.input.value==='-26'&&result.input.dir==='ltr'&&result.input.direction==='ltr','Numeric input did not retain -26 in LTR direction.');
  console.log('Browser math direction QA passed: RTL Arabic shell preserves LTR operand order and leading negative signs.');
} finally {
  await browser.close();
}
