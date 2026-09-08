import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const errors=[];
const calls={draft:0,answer:0,examSave:0};
const mark=(stage,extra={})=>fs.writeFileSync('smoke-debug.json',JSON.stringify({stage,...extra,errors,calls},null,2));
page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});
mark('init');

async function assertMath(locator,expected,label){
  const result=await locator.evaluate((el,target)=>{
    const runs=[...el.querySelectorAll('.flh-math-ltr')];
    const math=runs.find(x=>(x.textContent||'').trim()===target)||null;
    if(!math)return{found:false,runs:runs.map(x=>(x.textContent||'').trim())};
    const style=getComputedStyle(math);
    return{found:true,text:(math.textContent||'').trim(),dir:math.getAttribute('dir'),direction:style.direction,unicodeBidi:style.unicodeBidi};
  },expected);
  if(!result.found)throw new Error(`${label}: math run ${JSON.stringify(expected)} not found; got ${JSON.stringify(result.runs||[])}`);
  if(result.dir!=='ltr'||result.direction!=='ltr'||result.unicodeBidi!=='isolate')throw new Error(`${label}: ${expected} is not LTR/bidi-isolated: ${JSON.stringify(result)}`);
}

const profile={learner:{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5,is_test:false,avatar_emoji:'🌷'},gamification:{xp:0,reward_points:0,current_level:1,current_streak:0,longest_streak:0,badges:[],rewards:[]}};
const quiz={id:'q',slug:'qa-unit',title:'تدريب QA',description:'اختبار الواجهة'};
const program={id:'p',title:'المنهاج التجريبي',program_type:'curriculum',grade_level:5,school_year:'2026-2027',is_primary:true,books:[{id:'b',title:'الرياضيات',grade_level:5,school_year:'2026-2027',subject:{name_ar:'الرياضيات'},units:[{id:'u',title:'الوحدة الأولى',quizzes:[quiz]}],extras:[]}]};

await page.route('**/functions/v1/family-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='student_profile')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)});if(b.action==='learner_choices')return r.fulfill({status:200,contentType:'application/json',body:'{"learners":[]}'});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
await page.route('**/functions/v1/student-library-api',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({programs:[program],standalone_books:[]})}));
await page.route('**/functions/v1/activity-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
await page.route('**/functions/v1/question-reference-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"codes":{}}'}));
await page.route('**/functions/v1/learning-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='start_quiz')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'la',resumed:false,quiz:{slug:'qa-unit',title:'تدريب QA'},queue:[{question_id:'lq1',source_role:'core',status:'active',draft_option_position:null,hint_level_requested:0,question:{id:'lq1',question_code:'QA-LTR-1',prompt:'احسب: 19 - (-7)',options:[{position:1,content:'-26'},{position:2,content:'26'}],assets:[]}}]})});if(b.action==='save_draft'){calls.draft++;await new Promise(x=>setTimeout(x,800));try{return await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})}catch{return;}}if(b.action==='answer'){calls.answer++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({is_correct:true,finalized:true,explanation:'القاعدة: طرح السالب = جمع الموجب. 19 - (-7) = 26'})});}if(b.action==='finish_quiz')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({percentage:100,first_try_correct:1,hints_used:0,award:{already_awarded:true},review:[{is_correct:true,question_code:'QA-LTR-1',prompt:'احسب: 19 - (-7)',explanation:'19 - (-7) = 26'}]})});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
await page.route('**/functions/v1/exam-v2-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='warmup')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});if(b.action==='start_exam')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'ea',resumed:false,quiz:{slug:'qa-unit',title:'امتحان QA'},questions:[{question_id:'eq1',saved_response:null,is_flagged:false,question:{id:'eq1',question_code:'QA-LTR-E1',prompt:'احسب: (-7) - 19',options:[{position:1,content:'-26'},{position:2,content:'26'}],assets:[]}},{question_id:'eq2',saved_response:null,is_flagged:false,question:{id:'eq2',question_code:'QA-LTR-E2',prompt:'احسب: 19 - (-7)',options:[{position:1,content:'26'},{position:2,content:'-26'}],assets:[]}}]})});if(b.action==='save_answer'){calls.examSave++;await new Promise(x=>setTimeout(x,1200));try{return await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})}catch{return;}}if(b.action==='set_flag')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});if(b.action==='submit_exam')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({percentage:50,score_points:1,max_points:2,review:[{question_id:'eq1',question_code:'QA-LTR-E1',is_correct:false,prompt:'احسب: (-7) - 19',response:{option_position:2},correct_answer:{option_position:1},explanation:'(-7) - 19 = -26',hints:[]},{question_id:'eq2',question_code:'QA-LTR-E2',is_correct:true,prompt:'احسب: 19 - (-7)',response:{option_position:1},correct_answer:{option_position:1},explanation:'19 - (-7) = 26',hints:[]}]})});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});

await page.addInitScript(()=>localStorage.setItem('learner_session','qa-session'));
mark('before-navigation');
await page.goto(`${BASE_URL}?smoke=${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
mark('after-navigation');
await page.locator('[data-open-program="0"]').waitFor({state:'visible',timeout:10000});
mark('library-ready');
await page.locator('[data-open-program="0"]').click();await page.locator('[data-book="0"]').click();await page.locator('[data-unit="0"]').click();
mark('unit-open');

await page.locator('[data-learn="qa-unit"]').click();
await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:5000});
mark('learning-open');
await assertMath(page.locator('.question'),'19 - (-7)','Learning question');
await assertMath(page.locator('.flh-learn-answer').first(),'-26','Learning negative option');
mark('math-learning-verified');
await page.waitForFunction(()=>[...document.querySelectorAll('.flh-learn-answer .answer-number')].map(x=>x.textContent.trim()).join(',')==='A,B');
mark('learning-labels');
const learnWidth=await page.locator('.flh-learn-answer').first().evaluate(el=>el.getBoundingClientRect().width);
mark('learning-width',{learnWidth});
if(learnWidth<300)throw new Error(`Learning option not full width on mobile: ${learnWidth}`);
await page.locator('.flh-learn-answer').first().click();
await page.locator('.flh-learn-answer.selected').waitFor({state:'visible',timeout:500});
mark('learning-first-select',{learnWidth});
if(await page.locator('#flhConfirmAnswer').isDisabled())throw new Error('Learning confirm button did not enable after one click');
if((await page.locator('body').innerText()).includes('اضغط مرة ثانية'))throw new Error('Old double-tap prompt is still visible');
await page.locator('.flh-learn-answer').nth(1).click();
mark('learning-reselect',{learnWidth});
if(await page.locator('.flh-learn-answer.selected').getAttribute('data-pos')!=='2')throw new Error('Learning selection could not change while draft save was pending');
await page.locator('#flhConfirmAnswer').click();
await page.locator('#flhLearnNext').waitFor({state:'visible',timeout:5000});
await assertMath(page.locator('.flh-explanation'),'19 - (-7) = 26','Learning feedback explanation');
mark('learning-confirmed',{learnWidth});
if(calls.answer!==1)throw new Error('Learning confirm did not submit exactly once');
await page.locator('#flhLearnNext').click();
await page.locator('#learnHome').waitFor({state:'visible',timeout:5000});
await assertMath(page.locator('.exam-review').first(),'19 - (-7)','Learning completed review prompt');
await assertMath(page.locator('.exam-review').first(),'19 - (-7) = 26','Learning completed review explanation');
mark('math-learning-review-verified');

await page.evaluate(()=>window.FLH.startExamQuiz('qa-unit'));
await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:5000});
mark('exam-open',{learnWidth});
await assertMath(page.locator('.question'),'(-7) - 19','Exam question');
await assertMath(page.locator('.exam-v3-answer').first(),'-26','Exam negative option');
mark('math-exam-verified');
await page.waitForFunction(()=>[...document.querySelectorAll('.exam-v3-answer .answer-number')].map(x=>x.textContent.trim()).join(',')==='A,B');
mark('exam-labels',{learnWidth});
const examWidth=await page.locator('.exam-v3-answer').first().evaluate(el=>el.getBoundingClientRect().width);
mark('exam-width',{learnWidth,examWidth});
if(examWidth<300)throw new Error(`Exam option not full width on mobile: ${examWidth}`);
await page.locator('.exam-v3-answer').nth(1).click();
await page.locator('.exam-v3-answer.selected').waitFor({state:'visible',timeout:500});
mark('exam-selected',{learnWidth,examWidth});
await page.locator('#examNext').click();
await page.locator('.exam-status .topline b').filter({hasText:'السؤال 2 من 2'}).waitFor({state:'visible',timeout:500});
await assertMath(page.locator('.question'),'19 - (-7)','Exam second question');
mark('exam-next',{learnWidth,examWidth});
if(calls.examSave<1)throw new Error('Exam save was not started');
await page.locator('.exam-v3-answer').first().click();
await page.locator('#examSubmit').click();
await page.locator('.hero h1').filter({hasText:'نتيجة الامتحان'}).waitFor({state:'visible',timeout:6000});
const wrongReview=page.locator('.exam-review.exam-review-wrong').first();
await assertMath(wrongReview,'(-7) - 19','Exam review prompt');
await assertMath(wrongReview,'26','Exam review learner answer');
await assertMath(wrongReview,'-26','Exam review correct answer');
await wrongReview.locator('.exam-review-explain').click();
await assertMath(wrongReview,'(-7) - 19 = -26','Exam review explanation');
mark('math-review-verified',{learnWidth,examWidth});

if(errors.length)throw new Error(errors.join('; '));
mark('passed',{learnWidth,examWidth});
console.log(`Smoke passed: Learning width=${Math.round(learnWidth)}px, Exam width=${Math.round(examWidth)}px, A-F labels, one-click flows, and RTL-safe math are active in Learning, Exam, and review.`);
await browser.close();
