import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const OUT='ux-visual-artifacts';
await fs.mkdir(OUT,{recursive:true});

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
const page=await context.newPage();

const gamification={xp:120,reward_points:42,current_level:1,current_streak:3,longest_streak:5,last_learning_date:null,current_level_info:{level_no:1,name:'مستكشف',min_xp:0,icon:'🌱'},next_level_info:{level_no:2,name:'متعلم نشيط',min_xp:250,icon:'⭐'},xp_to_next:130,badges:[{badge:{icon:'🏅',title:'بداية قوية'},award_reason:'أكملت أول تدريب'},{badge:{icon:'⭐',title:'مثابر'},award_reason:'ثلاثة أيام متتالية'}],rewards:[{title:'وقت لعب إضافي',required_reward_points:60},{title:'رحلة صغيرة',required_reward_points:100}]};
const profile={learner:{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5,is_test:false,avatar_emoji:'🌷'},gamification};
const mathQuiz={id:'qm',slug:'math-g5-unit1',title:'الوحدة الأولى — تدريب شامل',description:'تدريب على مفاهيم الوحدة',quiz_kind:'unit',book_id:'bm',unit_id:'um1'};
const arabicQuiz={id:'qa',slug:'arabic-g5-unit1',title:'الوحدة الأولى — تدريب شامل',description:'فهم وقراءة وقواعد',quiz_kind:'unit',book_id:'ba',unit_id:'ua1'};
const mathBook={id:'bm',title:'الرياضيات - كتاب التلميذ - الصف الخامس',grade_level:5,school_year:'2025-2026',subject:{name_ar:'الرياضيات'},units:[{id:'um1',slug:'unit-1',title:'الوحدة الأولى',quizzes:[mathQuiz]},{id:'um2',slug:'unit-2',title:'الوحدة الثانية',quizzes:[]}],extras:[]};
const arabicBook={id:'ba',title:'لغتي - الصف الخامس الأساسي - الفصل الأول',grade_level:5,school_year:'2025-2026',subject:{name_ar:'اللغة العربية'},units:[{id:'ua1',slug:'unit-1',title:'الوحدة الأولى: المواطنة والانتماء',quizzes:[arabicQuiz]},{id:'ua2',slug:'unit-2',title:'الوحدة الثانية: العلم والتقانة',quizzes:[]}],extras:[]};
const program={enrollment_id:'enr-aya',is_primary:true,id:'pg5',slug:'syrian-g5-2025-2026',code:'SY-G5',title:'المنهاج السوري — الصف الخامس — 2025–2026',program_type:'curriculum',grade_level:5,school_year:'2025-2026',status:'active',books:[arabicBook,mathBook]};

await page.route('**/functions/v1/**',async route=>{
  const req=route.request();
  const url=req.url();
  let body={};
  try{body=JSON.parse(req.postData()||'{}')}catch{}
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});

  if(url.includes('/family-api')){
    if(body.action==='student_profile')return json(profile);
    if(body.action==='learner_choices')return json({learners:[{display_name:'آية',slug:'aya',avatar_emoji:'🌷',is_test:false},{display_name:'محمد',slug:'mohammad',avatar_emoji:'🚀',is_test:false},{display_name:'اختبار',slug:'test',avatar_emoji:'🧪',is_test:true}]});
    return json({ok:true});
  }
  if(url.includes('/student-library-api'))return json({programs:[program],standalone_books:[]});
  if(url.includes('/learning-api')){
    if(body.action==='start_quiz')return json({attempt_id:'visual-learning',resumed:false,quiz:{slug:body.quiz_slug,title:'الوحدة الأولى — تدريب شامل'},queue:[{id:'qr1',sequence_no:1,question_id:'lq1',source_role:'core',status:'active',draft_option_position:null,hint_level_requested:0,is_flagged:false,question:{id:'lq1',question_code:'Q-000007',prompt:'أي عدد أكبر من 35 وأصغر من 40؟',options:[{position:1,content:'34'},{position:2,content:'38'},{position:3,content:'41'}],assets:[]}}]});
    if(body.action==='save_draft')return json({ok:true,option_position:body.option_position});
    if(body.action==='request_hint')return json({ok:true,hint_level:1,hint:{hint_level:1,content:'فكّر بالأعداد بين 35 و40.'},exhausted:false});
    if(body.action==='answer')return json({is_correct:true,attempt_no:1,finalized:true,explanation:'38 يقع بين 35 و40.'});
    if(body.action==='finish_quiz')return json({percentage:100,first_try_correct:1,hints_used:0,award:{already_awarded:false,xp:10,reward_points:2},review:[]});
  }
  if(url.includes('/question-reference-api'))return json({codes:{lq1:'Q-000007'}});
  return json({ok:true});
});

await page.addInitScript(()=>localStorage.setItem('learner_session','visual-learner-token'));
await page.goto(`${BASE_URL}?visual=${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-primary-book]').first().waitFor({state:'visible',timeout:10000});
await page.screenshot({path:`${OUT}/01-student-home-mobile.png`,fullPage:true});

await page.locator('[data-primary-book]').filter({hasText:'الرياضيات'}).first().click();
await page.locator('[data-unit="0"]').waitFor({state:'visible'});
await page.screenshot({path:`${OUT}/02-book-mobile.png`,fullPage:true});

await page.locator('[data-unit="0"]').click();
await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:10000});
await page.screenshot({path:`${OUT}/03-learning-mobile.png`,fullPage:true});

await page.locator('#flhLearnExit').click();
await page.locator('[data-continue]').waitFor({state:'visible',timeout:10000});
await page.screenshot({path:`${OUT}/04-home-with-continue-mobile.png`,fullPage:true});

await page.locator('[data-achievements]').click();
await page.getByText('إنجازاتي',{exact:true}).first().waitFor({state:'visible'});
await page.screenshot({path:`${OUT}/05-achievements-mobile.png`,fullPage:true});

await browser.close();
console.log(`Visual UX screenshots saved to ${OUT}`);
