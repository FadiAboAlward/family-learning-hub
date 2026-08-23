import { chromium } from 'playwright';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});

let profileMode='aya';
let chessAssigned=false;
const gamification={xp:0,reward_points:0,current_level:1,current_streak:0,longest_streak:0,last_learning_date:null,current_level_info:{level_no:1,name:'مستكشف',min_xp:0,icon:'🌱'},next_level_info:{level_no:2,name:'متعلم نشيط',min_xp:250,icon:'⭐'},xp_to_next:250,badges:[],rewards:[]};
const profiles={
  aya:{learner:{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5,is_test:false,avatar_emoji:'🌷'},gamification},
  mohammad:{learner:{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7,is_test:false,avatar_emoji:'🚀'},gamification}
};
const mathQuiz={id:'qm',slug:'math-g5-unit1',title:'الوحدة الأولى — تدريب شامل',description:'رياضيات',quiz_kind:'unit',book_id:'bm',unit_id:'um1',delivery_config:{}};
const arabicQuiz={id:'qa',slug:'arabic-g5-unit1',title:'المواطنة والانتماء — تدريب شامل',description:'لغة عربية',quiz_kind:'unit',book_id:'ba',unit_id:'ua1',delivery_config:{}};
const chessQuiz={id:'qc',slug:'chess-openings-1',title:'افتتاحيات الشطرنج — تدريب 1',description:'تدريب مبسط',quiz_kind:'practice',book_id:'bc',unit_id:'uc1',delivery_config:{}};
const mathBook={id:'bm',code:'MATH-G5',title:'الرياضيات - كتاب التلميذ - الصف الخامس',grade_level:5,school_year:'2025-2026',language:'ar',source_kind:'textbook',subject:{name_ar:'الرياضيات'},units:[{id:'um1',slug:'unit-1',title:'الوحدة الأولى',sort_order:1,quizzes:[mathQuiz]}],extras:[]};
const arabicBook={id:'ba',code:'AR-G5',title:'لغتي - الصف الخامس الأساسي - الفصل الأول',grade_level:5,school_year:'2025-2026',language:'ar',source_kind:'textbook',subject:{name_ar:'اللغة العربية'},units:[{id:'ua1',slug:'unit-1',title:'الوحدة الأولى: المواطنة والانتماء',sort_order:1,quizzes:[arabicQuiz]}],extras:[]};
const chessBook={id:'bc',code:'CHESS',title:'الشطرنج للمبتدئين',grade_level:null,school_year:null,language:'ar',source_kind:'course_material',subject:{name_ar:'الشطرنج'},units:[{id:'uc1',slug:'openings',title:'افتتاحيات بسيطة',sort_order:1,quizzes:[chessQuiz]}],extras:[],access_origin:'book'};
const program={enrollment_id:'enr-aya',is_primary:true,id:'pg5',slug:'syrian-g5-2025-2026',code:'SY-G5',title:'المنهاج السوري — الصف الخامس — 2025–2026',program_type:'curriculum',grade_level:5,school_year:'2025-2026',status:'active',books:[arabicBook,mathBook]};

await page.route('**/functions/v1/family-api',async route=>{
  let b={};try{b=JSON.parse(route.request().postData()||'{}')}catch{}
  if(b.action==='learner_choices')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners:[{display_name:'آية',slug:'aya',avatar_emoji:'🌷',is_test:false},{display_name:'محمد',slug:'mohammad',avatar_emoji:'🚀',is_test:false},{display_name:'اختبار',slug:'test',avatar_emoji:'🧪',is_test:true},{display_name:'عبد القادر',slug:'abdul-qader',avatar_emoji:'🧑‍🎓',is_test:false}]})});
  if(b.action==='student_profile')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profiles[profileMode])});
  if(b.action==='parent_dashboard')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({parent:{id:'p1',email:'parent@example.test',relation:'father',role:'owner'},learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],states:[],attempts:[],reward_claims:[]})});
  return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
});

await page.route('**/functions/v1/student-library-api',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profileMode==='aya'?{programs:[program],standalone_books:[]}:{programs:[],standalone_books:chessAssigned?[chessBook]:[]})}));

await page.route('**/functions/v1/learning-api',async route=>{
  let b={};try{b=JSON.parse(route.request().postData()||'{}')}catch{}
  if(b.action==='start_quiz')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'la',quiz:{slug:b.quiz_slug,title:'تدريب QA'},queue:[{sequence_no:1,question_id:'lq',source_role:'core',status:'active',question:{id:'lq',prompt:'2 + 2 = ؟',options:[{position:1,content:'4'},{position:2,content:'5'}]}}]})});
  if(b.action==='answer')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({is_correct:true,attempt_no:1,finalized:true,explanation:'صحيح'})});
  if(b.action==='finish_quiz')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({percentage:100,first_try_correct:1,hints_used:0,award:{already_awarded:false,xp:10,reward_points:2},review:[]})});
  return route.fulfill({status:400,contentType:'application/json',body:'{"error":"QA"}'});
});

await page.route('**/functions/v1/exam-v2-api',async route=>{
  let b={};try{b=JSON.parse(route.request().postData()||'{}')}catch{}
  if(b.action==='start_exam')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'ea',quiz:{slug:b.quiz_slug,title:'امتحان QA'},questions:[{sequence_no:1,question_id:'eq',status:'active',saved_response:null,question:{id:'eq',prompt:'2 + 2 = ؟',options:[{position:1,content:'4'},{position:2,content:'5'}]}}]})});
  if(b.action==='save_answer')return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  if(b.action==='submit_exam')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({percentage:100,score_points:1,max_points:1,review:[]})});
  return route.fulfill({status:400,contentType:'application/json',body:'{"error":"QA"}'});
});

await page.route('**/functions/v1/parent-program-api',async route=>{
  let b={};try{b=JSON.parse(route.request().postData()||'{}')}catch{}
  if(b.action==='set_content'){if(b.learner_id==='moh-id'&&b.resource_type==='book'&&b.resource_id==='bc')chessAssigned=b.mode==='add';return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});}
  if(['set_grade','set_program'].includes(b.action))return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  if(b.action==='catalog')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],programs:[{id:'pg5',slug:'syrian-g5-2025-2026',title:program.title,program_type:'curriculum',grade_level:5,school_year:'2025-2026',status:'active'}],enrollments:[{id:'enr-aya',learner_id:'aya-id',program_id:'pg5',status:'active',is_primary:true}],books:[{id:'ba',title:arabicBook.title,grade_level:5,subject:{name_ar:'اللغة العربية'}},{id:'bm',title:mathBook.title,grade_level:5,subject:{name_ar:'الرياضيات'}},{id:'bc',title:chessBook.title,grade_level:null,subject:{name_ar:'الشطرنج'}}],program_books:[{program_id:'pg5',book_id:'ba',sort_order:10},{program_id:'pg5',book_id:'bm',sort_order:20}],content_assignments:chessAssigned?[{id:'ca',learner_id:'moh-id',resource_type:'book',resource_id:'bc',status:'active'}]:[]})});
  return route.fulfill({status:400,contentType:'application/json',body:'{"error":"QA"}'});
});

await page.route('**/functions/v1/activity-api',async route=>{
  let b={};try{b=JSON.parse(route.request().postData()||'{}')}catch{}
  if(['learner_activity','learner_logout'].includes(b.action))return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  const learners=[{id:'aya-id',display_name:'آية',slug:'aya'},{id:'moh-id',display_name:'محمد',slug:'mohammad'}];
  if(b.action==='parent_session_summary')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({days:7,learners,summaries:[{learner_id:'aya-id',sessions:3,duration_seconds:3600,average_seconds:1200,last_session_at:new Date().toISOString()},{learner_id:'moh-id',sessions:1,duration_seconds:600,average_seconds:600,last_session_at:new Date().toISOString()}]})});
  if(b.action==='parent_sessions_query')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners,sessions:[{id:'s1',learner_id:'aya-id',entry_type:'login',started_at:new Date().toISOString(),ended_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),duration_seconds:1200}],page:Number(b.page||1),page_size:25,total:52,total_pages:3})});
  if(b.action==='parent_sessions')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners,sessions:[]})});
  return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
});

// Dynamic learner list.
await page.goto(`${BASE_URL}?qa=login-${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-dynamic-learner="abdul-qader"]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-dynamic-learner]').count()!==4)throw new Error('Learner list is not backend-driven');

// Aya hierarchy: Program -> Book -> Unit -> Mode.
await page.evaluate(()=>localStorage.setItem('learner_session','qa-learner'));
profileMode='aya';
await page.reload({waitUntil:'networkidle',timeout:30000});
await page.locator('[data-student-library]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-open-program]').count()!==1)throw new Error('Aya program missing');
if(await page.locator('.dynamic-program-quiz').count()!==0)throw new Error('Retired flat quiz catalog still rendered');
await page.locator('[data-open-program="0"]').click();
if(await page.locator('[data-book]').count()!==2)throw new Error('Program should show two books');
await page.locator('[data-book]').filter({hasText:'الرياضيات'}).first().click();
await page.locator('[data-unit="0"]').click();
if(await page.locator('[data-learn="math-g5-unit1"]').count()!==1)throw new Error('Learning mode missing at unit level');
if(await page.locator('[data-exam="math-g5-unit1"]').count()!==1)throw new Error('Exam mode missing at unit level');

// Launch both engines from hierarchy.
await page.locator('[data-learn="math-g5-unit1"]').click();
await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:5000});
await page.locator('.flh-learn-answer').first().click();
await page.locator('#flhLearnNext').waitFor({state:'visible',timeout:5000});
await page.locator('#flhLearnNext').click();
await page.getByText('100%').first().waitFor({state:'visible',timeout:5000});
await page.locator('#learnHome').click();
await page.locator('[data-open-program="0"]').click();
await page.locator('[data-book]').filter({hasText:'الرياضيات'}).first().click();
await page.locator('[data-unit="0"]').click();
await page.locator('[data-exam="math-g5-unit1"]').click();
await page.locator('.exam-v2-answer').first().waitFor({state:'visible',timeout:5000});

// Mohammad starts with zero content; no Grade 5 leakage.
profileMode='mohammad';
await page.reload({waitUntil:'networkidle',timeout:30000});
await page.getByText('ما في محتوى مربوط بحسابك بعد. اطلب من ولي الأمر يضيف لك منهاجًا أو كتابًا.').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-open-program]').count()||await page.locator('[data-open-standalone]').count())throw new Error('Content leaked into Mohammad');

// Parent dashboard is summary-first.
await page.evaluate(()=>{localStorage.removeItem('learner_session');localStorage.setItem('parent_session',JSON.stringify({access_token:'qa-parent'}));});
await page.goto(`${BASE_URL}?qa=parent-${Date.now()}#parents`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-parent-center-nav]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-go="parent-access"]').count()<1)throw new Error('Parent content entry missing');
if(await page.locator('[data-go="parent-activity"]').count()<1)throw new Error('Parent activity entry missing');
const detail=page.getByText('تفاصيل المحاولات',{exact:true});if(await detail.count()&&await detail.isVisible())throw new Error('Detailed attempts still clutter dashboard');
await page.getByText('ملخص آخر 7 أيام').waitFor({state:'visible',timeout:5000});

// Parent assigns standalone chess book to Mohammad.
await page.locator('[data-go="parent-access"]').first().click();
await page.locator('[data-access-root]').waitFor({state:'visible',timeout:10000});
await page.locator('[data-learner="moh-id"]').click();
if(await page.locator('[data-grade]').inputValue()!=='7')throw new Error('Mohammad grade changed unexpectedly');
await page.locator('[data-add-book]').selectOption('bc');
await page.locator('[data-add-book-btn]').click();
await page.getByText('كتب مضافة مباشرة').waitFor({state:'visible',timeout:5000});
if(!chessAssigned)throw new Error('Direct book assignment was not sent');

// Assigned standalone book appears in Mohammad's own library.
await page.evaluate(()=>{localStorage.removeItem('parent_session');localStorage.setItem('learner_session','qa-learner');});
profileMode='mohammad';
await page.goto(`${BASE_URL}?qa=chess-${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.getByText('📖 كتبي المستقلة').waitFor({state:'visible',timeout:10000});
await page.locator('[data-open-standalone="0"]').click();
await page.locator('[data-unit="0"]').click();
if(await page.locator('[data-learn="chess-openings-1"]').count()!==1||await page.locator('[data-exam="chess-openings-1"]').count()!==1)throw new Error('Standalone book modes missing');

// Activity detail is a separate filtered, paginated page.
await page.evaluate(()=>{localStorage.removeItem('learner_session');localStorage.setItem('parent_session',JSON.stringify({access_token:'qa-parent'}));});
await page.goto(`${BASE_URL}?qa=activity-${Date.now()}#parent-activity`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-activity-root]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-act-learner]').count()!==1||await page.locator('[data-act-from]').count()!==1||await page.locator('[data-act-to]').count()!==1)throw new Error('Activity filters missing');
await page.getByText('52 جلسة ضمن الفلتر الحالي.').waitFor({state:'visible',timeout:5000});
await page.getByText('صفحة 1 من 3').waitFor({state:'visible',timeout:5000});

if(errors.length)throw new Error(`Browser errors:\n${errors.join('\n')}`);
console.log('QA PASS: hierarchical library + standalone books + modes + parent progressive disclosure + paginated activity');
await browser.close();
