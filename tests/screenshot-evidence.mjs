import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const OUTPUT_DIR='playwright-screenshots';
fs.mkdirSync(OUTPUT_DIR,{recursive:true});

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

/** Capture one stable, human-readable QA screenshot without storing credentials. */
async function shot(name){
  await page.screenshot({path:`${OUTPUT_DIR}/${name}.png`,fullPage:true});
}

const profile={learner:{id:'qa-learner',display_name:'طالب QA',slug:'qa',grade_level:7,is_test:true,avatar_emoji:'🧪'},gamification:{xp:0,reward_points:0,current_level:1,current_streak:0,longest_streak:0,badges:[],rewards:[]}};
const quiz={id:'qa-quiz',slug:'qa-screenshot-unit',title:'تدريب QA',description:'دليل بصري مؤقت'};
const program={id:'qa-program',title:'منهاج QA',program_type:'curriculum',grade_level:7,school_year:'2026-2027',is_primary:true,books:[{id:'qa-book',title:'الرياضيات',grade_level:7,school_year:'2026-2027',subject:{name_ar:'الرياضيات'},units:[{id:'qa-unit',title:'الوحدة التجريبية',quizzes:[quiz]}],extras:[]}]};

await page.route('**/functions/v1/family-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='student_profile')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)});if(b.action==='learner_choices')return r.fulfill({status:200,contentType:'application/json',body:'{"learners":[]}'});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
await page.route('**/functions/v1/student-library-api',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({programs:[program],standalone_books:[]})}));
await page.route('**/functions/v1/activity-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
await page.route('**/functions/v1/question-reference-api',r=>r.fulfill({status:200,contentType:'application/json',body:'{"codes":{}}'}));
await page.route('**/functions/v1/learning-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='start_quiz')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'qa-learning-attempt',resumed:false,quiz:{slug:quiz.slug,title:quiz.title},queue:[{question_id:'lq1',source_role:'core',status:'active',draft_option_position:null,hint_level_requested:0,question:{id:'lq1',question_code:'QA-SHOT-L1',prompt:'احسب: 19 - (-7)',options:[{position:1,content:'-26'},{position:2,content:'26'}],assets:[]}}]})});if(b.action==='save_draft')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});if(b.action==='answer')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({is_correct:true,finalized:true,explanation:'القاعدة: طرح السالب = جمع الموجب. 19 - (-7) = 26'})});if(b.action==='finish_quiz')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({percentage:100,first_try_correct:1,hints_used:0,award:{already_awarded:true},review:[{is_correct:true,question_code:'QA-SHOT-L1',prompt:'احسب: 19 - (-7)',explanation:'19 - (-7) = 26'}]})});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
await page.route('**/functions/v1/exam-v2-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};if(b.action==='warmup')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});if(b.action==='start_exam')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'qa-exam-attempt',resumed:false,quiz:{slug:quiz.slug,title:'امتحان QA'},questions:[{question_id:'eq1',saved_response:null,is_flagged:false,question:{id:'eq1',question_code:'QA-SHOT-E1',prompt:'احسب: (-7) - 19',options:[{position:1,content:'-26'},{position:2,content:'26'}],assets:[]}},{question_id:'eq2',saved_response:null,is_flagged:false,question:{id:'eq2',question_code:'QA-SHOT-E2',prompt:'احسب: 19 - (-7)',options:[{position:1,content:'26'},{position:2,content:'-26'}],assets:[]}}]})});if(b.action==='save_answer'||b.action==='set_flag')return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});if(b.action==='submit_exam')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({percentage:50,score_points:1,max_points:2,review:[{question_id:'eq1',question_code:'QA-SHOT-E1',is_correct:false,prompt:'احسب: (-7) - 19',response:{option_position:2},correct_answer:{option_position:1},explanation:'(-7) - 19 = -26',hints:[]},{question_id:'eq2',question_code:'QA-SHOT-E2',is_correct:true,prompt:'احسب: 19 - (-7)',response:{option_position:1},correct_answer:{option_position:1},explanation:'19 - (-7) = 26',hints:[]}]})});return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});

await page.addInitScript(()=>localStorage.setItem('learner_session','qa-screenshot-session'));
await page.goto(`${BASE_URL}?screenshots=${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-open-program="0"]').click();
await page.locator('[data-book="0"]').click();
await page.locator('[data-unit="0"]').click();

await page.locator(`[data-learn="${quiz.slug}"]`).click();
await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:5000});
await shot('01-learning-math');
await page.locator('.flh-learn-answer').nth(1).click();
await page.locator('#flhConfirmAnswer').click();
await page.locator('#flhLearnNext').waitFor({state:'visible',timeout:5000});
await page.locator('#flhLearnNext').click();
await page.locator('#learnHome').waitFor({state:'visible',timeout:5000});
await shot('02-learning-review');

await page.evaluate(slug=>window.FLH.startExamQuiz(slug),quiz.slug);
await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:5000});
await shot('03-exam-math');
await page.locator('.exam-v3-answer').nth(1).click();
await page.locator('#examNext').click();
await page.locator('.exam-status .topline b').filter({hasText:'السؤال 2 من 2'}).waitFor({state:'visible',timeout:1000});
await page.locator('.exam-v3-answer').first().click();
await page.locator('#examSubmit').click();
await page.locator('.hero h1').filter({hasText:'نتيجة الامتحان'}).waitFor({state:'visible',timeout:5000});
const wrongReview=page.locator('.exam-review.exam-review-wrong').first();
await wrongReview.locator('.exam-review-explain').click();
await shot('04-exam-review');

fs.writeFileSync(`${OUTPUT_DIR}/manifest.json`,JSON.stringify({generated_at:new Date().toISOString(),head_sha:process.env.GITHUB_SHA||null,run_id:process.env.GITHUB_RUN_ID||null,source:'mocked local Browser smoke',retention_days:7,files:['01-learning-math.png','02-learning-review.png','03-exam-math.png','04-exam-review.png']},null,2));
console.log(`Screenshot evidence captured in ${OUTPUT_DIR}/ (4 PNGs, temporary GitHub artifact retention: 7 days).`);
await browser.close();
