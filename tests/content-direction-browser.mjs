import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const APP_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});

async function installRoutes(page){
  let learningHintRequests=0;
  await page.route('**/functions/v1/question-reference-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"codes":{}}'}));

  await page.route('**/functions/v1/attempt-history-api',async r=>{
    let body={};
    try{body=JSON.parse(r.request().postData()||'{}')}catch{}
    if(body.action==='attempt_detail'){
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        attempt:{
          id:'11111111-1111-4111-8111-111111111111',
          delivery_mode:'exam',
          submitted_at:'2026-09-30T12:00:00Z',
          percentage:50,
          wrong_count:1,
          duration_seconds:90,
          context:{quiz:{title:'Geçmiş deneme'}}
        },
        review:[{
          sequence_no:1,
          question_id:'history-tr',
          question_code:'QA-DIR-HISTORY-TR',
          prompt:"B şehri UTC-4&amp;#39;tür. B&amp;#39;den fark nedir?",
          prompt_language:'tr',
          selected_option:{position:2,label:'B',content:'6 saat'},
          correct_option:{position:1,label:'A',content:'4 saat'},
          is_correct:false,
          points_awarded:0,
          max_points:1,
          attempts_used:1,
          hints_used:0,
          first_try_correct:false,
          explanation:'Saat dilimlerini sayı doğrusunda karşılaştır.',
          assets:[]
        }]
      })});
    }
    if(body.action==='list_attempts')return r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"has_more":false,"next_cursor":null,"mode":"all"}'});
    return r.fulfill({status:200,contentType:'application/json',body:'{"error":"UNKNOWN_ACTION"}'});
  });

  await page.route('**/functions/v1/learning-api',async r=>{
    let body={};
    try{body=JSON.parse(r.request().postData()||'{}')}catch{}
    if(body.action==='start_quiz'){
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        attempt_id:'direction-learning-attempt',
        resumed:false,
        quiz:{slug:'qa-direction',title:'Yön testi'},
        queue:[{
          question_id:'learning-tr',
          source_role:'core',
          status:'active',
          draft_option_position:null,
          hint_level_requested:0,
          question:{
            id:'learning-tr',
            question_code:'QA-DIR-LEARN-TR',
            prompt:"A şehri UTC+2, B şehri UTC-4'tür. Aradaki saat farkı kaçtır?",
            prompt_language:'tr',
            options:[{position:1,content:'4 saat'},{position:2,content:'6 saat'}],
            assets:[]
          }
        }]
      })});
    }
    if(body.action==='request_hint'){
      learningHintRequests+=1;
      if(learningHintRequests===1){
        return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          hint_level:1,
          hint:{hint_level:1,language:'tr',content:[
            '• Önce sorudaki iki saat dilimini ayrı ayrı belirle ve işaretlerin sıfıra göre hangi yönü gösterdiğine dikkat et.',
            '• Ardından iki konum arasındaki uzaklığı düşün; saat farkını bulurken yalnızca işaretleri kopyalamak yerine sayı doğrusu mantığını kullan.',
            '• Son olarak seçenekleri tek tek karşılaştır, bulduğun uzaklıkla uyuşmayanları ele ve cevabı onaylamadan önce işlemini bir kez daha kontrol et.'
          ].join('\n')}
        })});
      }
      return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"exhausted":true,"hint":null,"hint_level":1}'});
    }
    if(body.action==='save_draft')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    if(body.action==='answer')return r.fulfill({status:200,contentType:'application/json',body:'{"is_correct":false,"finalized":false}'});
    if(body.action==='finish_quiz')return r.fulfill({status:200,contentType:'application/json',body:'{"percentage":0,"review":[]}'});
    return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  });

  await page.route('**/functions/v1/exam-v2-api',async r=>{
    let body={};
    try{body=JSON.parse(r.request().postData()||'{}')}catch{}
    if(body.action==='warmup')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    if(body.action==='start_exam'){
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        attempt_id:'direction-exam-attempt',
        resumed:false,
        quiz:{slug:'qa-direction',title:'اتجاه النص'},
        questions:[
          {
            question_id:'exam-tr',
            saved_response:null,
            is_flagged:false,
            question:{
              id:'exam-tr',
              question_code:'QA-DIR-EXAM-TR',
              prompt:"B şehri UTC-4'tür. Doğru saat farkını seç.",
              prompt_language:'tr',
              options:[{position:1,content:'4 saat'},{position:2,content:'6 saat'}],
              assets:[]
            }
          },
          {
            question_id:'exam-ar',
            saved_response:null,
            is_flagged:false,
            question:{
              id:'exam-ar',
              question_code:'QA-DIR-EXAM-AR',
              prompt:'ما ناتج ٣ + ٢؟',
              prompt_language:'ar',
              options:[{position:1,content:'خمسة'},{position:2,content:'سبعة'}],
              assets:[]
            }
          }
        ]
      })});
    }
    if(body.action==='save_answer'||body.action==='set_flag'){
      return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    }
    if(body.action==='submit_exam'){
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        percentage:0,
        score_points:0,
        max_points:2,
        review:[
          {
            question_id:'exam-tr',
            question_code:'QA-DIR-EXAM-TR',
            is_correct:false,
            prompt:"B şehri UTC-4'tür. Doğru saat farkını seç.",
            prompt_language:'tr',
            response:{option_position:2},
            correct_answer:{option_position:1},
            explanation:'Saat dilimlerini sayı doğrusunda karşılaştır.',
            hints:[{hint_level:1,content:'İşaretlere dikkat et.'}]
          },
          {
            question_id:'exam-ar',
            question_code:'QA-DIR-EXAM-AR',
            is_correct:false,
            prompt:'ما ناتج ٣ + ٢؟',
            prompt_language:'ar',
            response:{option_position:2},
            correct_answer:{option_position:1},
            explanation:'اجمع العددين ثم اختر الناتج الصحيح.',
            hints:[{hint_level:1,content:'ابدأ بجمع الآحاد.'}]
          }
        ]
      })});
    }
    return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  });
}

async function computedDirection(locator){
  return locator.evaluate(el=>({dir:getComputedStyle(el).direction,lang:el.lang||'',text:el.textContent||''}));
}

async function probe(width,height){
  const page=await browser.newPage({viewport:{width,height}});
  try{
    await installRoutes(page);
    await page.goto(APP_URL+'#student',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof window.FLH?.startLearningQuiz==='function'&&typeof window.FLH?.startExamQuiz==='function');
    await page.evaluate(()=>localStorage.setItem('learner_session','qa.direction'));

    assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');

    await page.evaluate(()=>window.FLH.startLearningQuiz('qa-direction'));
    await page.locator('.question').waitFor({state:'visible',timeout:5000});
    const learningQuestion=await computedDirection(page.locator('.question'));
    assert.equal(learningQuestion.dir,'ltr');
    assert.equal(learningQuestion.lang,'tr');
    assert.match(learningQuestion.text,/UTC-4'tür/);

    const learningAnswers=await computedDirection(page.locator('.answer-grid'));
    assert.equal(learningAnswers.dir,'ltr');
    assert.equal(learningAnswers.lang,'tr');

    await page.locator('#flhHelp').click();
    await page.locator('.flh-hint-card').waitFor({state:'visible',timeout:5000});
    const hintCard=await computedDirection(page.locator('.flh-hint-card'));
    const hintHeading=await computedDirection(page.locator('.flh-hint-card > b'));
    const learningHint=await computedDirection(page.locator('.flh-hint-content'));
    assert.equal(hintCard.dir,'rtl');
    assert.equal(hintHeading.dir,'rtl');
    assert.equal(learningHint.dir,'ltr');
    assert.equal(learningHint.lang,'tr');
    assert.match(learningHint.text,/saat dilimini/);
    assert.equal(await page.locator('.flh-hint-list > li').count(),3);

    await page.locator('.flh-learn-answer').first().click();
    await page.waitForFunction(()=>{const b=document.querySelector('#flhConfirmAnswer');return b&&!b.disabled;});
    await page.locator('#flhConfirmAnswer').click();
    await page.locator('.flh-hint-notice').waitFor({state:'visible',timeout:5000});
    const retainedHint=await computedDirection(page.locator('.flh-hint-content'));
    const retainedHeading=await computedDirection(page.locator('.flh-hint-card > b'));
    const hintNotice=await computedDirection(page.locator('.flh-hint-notice'));
    assert.equal(retainedHint.dir,'ltr');
    assert.equal(retainedHint.lang,'tr');
    assert.equal(await page.locator('.flh-hint-list > li').count(),3);
    assert.match(retainedHeading.text,/تلميح 1/);
    assert.doesNotMatch(retainedHeading.text,/تلميح 4/);
    assert.match(hintNotice.text,/المساعدة الإضافية غير متاحة/);
    assert.equal(await page.locator('#flhHelp').isDisabled(),true);

    await page.evaluate(()=>window.FLH.startExamQuiz('qa-direction'));
    await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:5000});
    const examTurkish=await computedDirection(page.locator('.question'));
    assert.equal(examTurkish.dir,'ltr');
    assert.equal(examTurkish.lang,'tr');

    await page.locator('.exam-v3-answer').nth(1).click();
    await page.locator('#examNext').click();
    await page.waitForFunction(()=>document.querySelector('.question')?.getAttribute('lang')==='ar');
    const examArabic=await computedDirection(page.locator('.question'));
    assert.equal(examArabic.dir,'rtl');
    assert.equal(examArabic.lang,'ar');

    await page.locator('.exam-v3-answer').nth(1).click();
    await page.waitForFunction(()=>{const b=document.querySelector('#examSubmit');return b&&!b.disabled;});
    await page.locator('#examSubmit').click();
    await page.locator('.exam-review').first().waitFor({state:'visible',timeout:5000});

    const reviews=page.locator('.exam-review');
    assert.equal(await reviews.count(),2);

    const trReviewPrompt=await computedDirection(reviews.nth(0).locator('.question'));
    const trReviewSelected=await computedDirection(reviews.nth(0).locator('.muted b').first());
    assert.equal(trReviewPrompt.dir,'ltr');
    assert.equal(trReviewPrompt.lang,'tr');
    assert.equal(trReviewSelected.dir,'ltr');
    assert.equal(trReviewSelected.lang,'tr');

    const arReviewPrompt=await computedDirection(reviews.nth(1).locator('.question'));
    const arReviewSelected=await computedDirection(reviews.nth(1).locator('.muted b').first());
    assert.equal(arReviewPrompt.dir,'rtl');
    assert.equal(arReviewPrompt.lang,'ar');
    assert.equal(arReviewSelected.dir,'rtl');
    assert.equal(arReviewSelected.lang,'ar');

    await reviews.nth(0).locator('.exam-review-explain').click();
    await reviews.nth(1).locator('.exam-review-explain').click();
    const trExplanation=await computedDirection(reviews.nth(0).locator('.exam-explanation-steps li').first());
    const arExplanation=await computedDirection(reviews.nth(1).locator('.exam-explanation-steps li').first());
    assert.equal(trExplanation.dir,'ltr');
    assert.equal(arExplanation.dir,'rtl');

    await page.evaluate(()=>{
      document.getElementById('app').innerHTML='<section class="hero"><h1>أهلًا اختبار</h1></section><section data-student-library></section>';
    });
    await page.waitForFunction(()=>typeof window.FLH?.openAttemptHistoryAttempt==='function');
    const historyOpened=await page.evaluate(()=>window.FLH.openAttemptHistoryAttempt('11111111-1111-4111-8111-111111111111'));
    assert.equal(historyOpened,true);
    await page.locator('.flh-history-review').first().waitFor({state:'visible',timeout:5000});
    const historyPrompt=await computedDirection(page.locator('.flh-history-review .question').first());
    const historySelected=await computedDirection(page.locator('.flh-history-review .flh-review-answer b').first());
    assert.equal(historyPrompt.dir,'ltr');
    assert.equal(historyPrompt.lang,'tr');
    assert.equal(historySelected.dir,'ltr');
    assert.equal(historySelected.lang,'tr');
    assert.match(historyPrompt.text,/UTC-4'tür/);
    assert.match(historyPrompt.text,/B'den/);

    assert.equal(
      await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),
      false,
      `horizontal overflow at ${width}x${height}`
    );
  }finally{
    await page.close();
  }
}

async function probeInteractive(width,height){
  const page=await browser.newPage({viewport:{width,height}});
  try{
    await page.addInitScript(()=>localStorage.setItem('learner_session','qa.direction'));
    await installRoutes(page);
    const practiceUrl=new URL('interactive-practice.html?quiz=qa-direction',APP_URL).href;
    await page.goto(practiceUrl,{waitUntil:'domcontentloaded'});
    await page.locator('.question').waitFor({state:'visible',timeout:5000});

    const question=await computedDirection(page.locator('.question'));
    assert.equal(question.dir,'ltr');
    assert.equal(question.lang,'tr');
    assert.match(question.text,/UTC-4'tür/);

    const option=await computedDirection(page.locator('[data-answer] span').nth(1));
    assert.equal(option.dir,'ltr');
    assert.equal(option.lang,'tr');

    await page.locator('#askHint').click();
    await page.locator('.hint-content').waitFor({state:'visible',timeout:5000});
    const hintHeading=await computedDirection(page.locator('.hint > b'));
    const hint=await computedDirection(page.locator('.hint-content'));
    assert.equal(hintHeading.dir,'rtl');
    assert.equal(hint.dir,'ltr');
    assert.equal(hint.lang,'tr');
    assert.match(hint.text,/saat dilimini/);

    assert.equal(
      await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),
      false,
      `interactive-practice horizontal overflow at ${width}x${height}`
    );
  }finally{
    await page.close();
  }
}

try{
  await probe(1280,800);
  await probe(390,844);
  await probeInteractive(1280,800);
  await probeInteractive(390,844);
  console.log('Content direction browser regression passed through Learning, structured authored hints, null-hint answer exhaustion, Exam review, attempt history, and standalone interactive practice at desktop and 390x844.');
}finally{
  await browser.close();
}
