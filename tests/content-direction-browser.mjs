import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const APP_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(APP_URL,{waitUntil:'domcontentloaded'});

  async function probe(width,height){
    await page.setViewportSize({width,height});
    const result=await page.evaluate(()=>{
      const helper=globalThis.FLHContentDirection;
      if(!helper)return{error:'CONTENT_DIRECTION_HELPER_MISSING'};
      const app=document.getElementById('app');
      app.innerHTML='';
      const shell=document.createElement('div');
      shell.id='qaArabicShell';
      shell.textContent='واجهة عربية';
      const q=document.createElement('div');
      q.id='qaTurkishQuestion';
      q.className='question';
      q.lang='tr';
      q.dir=helper.direction('tr');
      q.textContent=helper.normalizeText("A şehri UTC+2, B şehri UTC-4&#39;tür. B'den fark nedir?");
      const ar=document.createElement('div');
      ar.id='qaArabicQuestion';
      ar.className='question';
      ar.lang='ar';
      ar.dir=helper.direction('ar');
      ar.textContent='ما ناتج 3 - (-2)؟';

      const hint=document.createElement('div');
      hint.id='qaTurkishHint';
      hint.className='flh-hint-card';
      hint.lang='tr';
      hint.dir=helper.direction('tr');
      hint.textContent="Tam sayılarda işarete dikkat et.";

      const review=document.createElement('div');
      review.id='qaReviewExplanation';
      review.className='flh-explanation';
      review.dir='auto';
      review.textContent="B'den farkı bulmak için saat dilimlerini karşılaştır.";

      const arabicReview=document.createElement('div');
      arabicReview.id='qaArabicExplanation';
      arabicReview.className='flh-explanation';
      arabicReview.dir='auto';
      arabicReview.textContent='راجع الإشارة ثم حاول مرة أخرى.';

      app.append(shell,q,ar,hint,review,arabicReview);
      return{
        htmlDir:document.documentElement.dir,
        turkishDir:getComputedStyle(q).direction,
        turkishLang:q.lang,
        turkishText:q.textContent,
        arabicDir:getComputedStyle(ar).direction,
        arabicLang:ar.lang,
        hintDir:getComputedStyle(hint).direction,
        hintLang:hint.lang,
        reviewDir:getComputedStyle(review).direction,
        arabicReviewDir:getComputedStyle(arabicReview).direction,
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth
      };
    });
    assert.equal(result.error,undefined);
    assert.equal(result.htmlDir,'rtl');
    assert.equal(result.turkishDir,'ltr');
    assert.equal(result.turkishLang,'tr');
    assert.equal(result.turkishText,"A şehri UTC+2, B şehri UTC-4'tür. B'den fark nedir?");
    assert.equal(result.arabicDir,'rtl');
    assert.equal(result.arabicLang,'ar');
    assert.equal(result.hintDir,'ltr');
    assert.equal(result.hintLang,'tr');
    assert.equal(result.reviewDir,'ltr');
    assert.equal(result.arabicReviewDir,'rtl');
    assert.equal(result.overflow,false,`horizontal overflow at ${width}x${height}`);
  }

  await probe(1280,800);
  await probe(390,844);
  console.log('Content direction browser regression passed at desktop and 390x844.');
}finally{
  await browser.close();
}
