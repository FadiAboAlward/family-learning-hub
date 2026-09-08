import { chromium } from 'playwright';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const errors=[];
const calls={draft:0,answer:0,examSave:0};
page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});

const profile={learner:{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5,is_test:false,avatar_emoji:'🌷'},gamification:{xp:0,reward_points:0,current_level:1,current_streak:0,longest_streak:0,badges:[],rewards:[]}};
const quiz={id:'q',slug:'qa-unit',title:'تدريب QA',description:'اختبار الواجهة'};
const program={id:'p',title:'المنهاج التجريبي',program_type:'curriculum',grade_level:5,school_year:'2026-2027',is_primary:true,books:[{id:'b',title:'الرياضيات',grade_level:5,school_year:'2026-2027',subject:{name_ar:'الرياضيات'},units:[{id:'u',title:'الوحدة الأولى',quizzes:[quiz]}],extras:[]}]};

await page.route('**/functions/v1/family-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='student_profile')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)});if(b.action==='learner_choices')return r.fulfill({status:200,contentType:'application/json',body:'{"learners":[]}'});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
await page.route('**/functions/v1/student-library-api',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({programs:[program],standalone_books:[]})}));
await page.route('**/functions/v1/activity-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
await page.route('**/functions/v1/question-reference-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"codes":{}}'}));
await page.route('**/functions/v1/learning-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='start_quiz')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'la',resumed:false,quiz:{slug:'qa-unit',title:'تدريب QA'},queue:[{question_id:'lq1',source_role:'core',status:'active',draft_option_position:null,hint_level_requested:0,question:{id:'lq1',prompt:'اختر الإجابة الصحيحة',options:[{position:1,content:'الأولى'},{position:2,content:'الثانية'}],assets:[]}}]})});if(b.action==='save_draft'){calls.draft++;await new Promise(x=>setTimeout(x,800));return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});}if(b.action==='answer'){calls.answer++;return r.fulfill({status:200,contentType:'application/json',body:'{"is_correct":true,"finalized":true,"explanation":"صحيح"}'});}if(b.action==='finish_quiz')return r.fulfill({status:200,contentType:'application/json',body:'{"percentage":100,"first_try_correct":1,"hints_used":0,"award":{"already_awarded":true},"review":[]}'});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
await page.route('**/functions/v1/exam-v2-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='warmup')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});if(b.action==='start_exam')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'ea',resumed:false,quiz:{slug:'qa-unit',title:'امتحان QA'},questions:[{question_id:'eq1',saved_response:null,is_flagged:false,question:{id:'eq1',prompt:'السؤال الأول',options:[{position:1,content:'واحد'},{position:2,content:'اثنان'}],assets:[]}},{question_id:'eq2',saved_response:null,is_flagged:false,question:{id:'eq2',prompt:'السؤال الثاني',options:[{position:1,content:'ثلاثة'},{position:2,content:'أربعة'}],assets:[]}}]})});if(b.action==='save_answer'){calls.examSave++;await new Promise(x=>setTimeout(x,1200));return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});}if(b.action==='set_flag')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});if(b.action==='submit_exam')return r.fulfill({status:200,contentType:'application/json',body:'{"percentage":100,"score_points":2,"max_points":2,"review":[]}'});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});

await page.addInitScript(()=>localStorage.setItem('learner_session','qa-session'));
await page.goto(`${BASE_URL}?smoke=${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-open-program="0"]').waitFor({state:'visible',timeout:10000});
await page.locator('[data-open-program="0"]').click();await page.locator('[data-book="0"]').click();await page.locator('[data-unit="0"]').click();

await page.locator('[data-learn="qa-unit"]').click();
await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:5000});
await page.waitForFunction(()=>[...document.querySelectorAll('.flh-learn-answer .answer-number')].map(x=>x.textContent.trim()).join(',')==='A,B');
const learnWidth=await page.locator('.flh-learn-answer').first().evaluate(el=>el.getBoundingClientRect().width);
if(learnWidth<300)throw new Error(`Learning option not full width on mobile: ${learnWidth}`);
await page.locator('.flh-learn-answer').first().click();
await page.locator('.flh-learn-answer.selected').waitFor({state:'visible',timeout:500});
if(await page.locator('#flhConfirmAnswer').isDisabled())throw new Error('Learning confirm button did not enable after one click');
if((await page.locator('body').innerText()).includes('اضغط مرة ثانية'))throw new Error('Old double-tap prompt is still visible');
await page.locator('.flh-learn-answer').nth(1).click();
if(await page.locator('.flh-learn-answer.selected').getAttribute('data-pos')!=='2')throw new Error('Learning selection could not change while draft save was pending');
await page.locator('#flhConfirmAnswer').click();
await page.locator('#flhLearnNext').waitFor({state:'visible',timeout:5000});
if(calls.answer!==1)throw new Error('Learning confirm did not submit exactly once');

await page.evaluate(()=>window.FLH.startExamQuiz('qa-unit'));
await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:5000});
await page.waitForFunction(()=>[...document.querySelectorAll('.exam-v3-answer .answer-number')].map(x=>x.textContent.trim()).join(',')==='A,B');
const examWidth=await page.locator('.exam-v3-answer').first().evaluate(el=>el.getBoundingClientRect().width);
if(examWidth<300)throw new Error(`Exam option not full width on mobile: ${examWidth}`);
await page.locator('.exam-v3-answer').first().click();
await page.locator('.exam-v3-answer.selected').waitFor({state:'visible',timeout:500});
await page.locator('#examNext').click();
await page.getByText('السؤال 2 من 2',{exact:false}).waitFor({state:'visible',timeout:500});
if(calls.examSave<1)throw new Error('Exam save was not started');
if(errors.length)throw new Error(errors.join('; '));
console.log(`Smoke passed: Learning width=${Math.round(learnWidth)}px, Exam width=${Math.round(examWidth)}px, A-F labels and one-click flows are active.`);
await browser.close();