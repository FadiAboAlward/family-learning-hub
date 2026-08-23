import { chromium } from 'playwright';

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

let profileMode = 'aya';
let directChessAssigned = false;
const gamification = {
  xp: 0, reward_points: 0, current_level: 1, current_streak: 0, longest_streak: 0,
  last_learning_date: null,
  current_level_info: { level_no: 1, name: 'مستكشف', min_xp: 0, icon: '🌱' },
  next_level_info: { level_no: 2, name: 'متعلم نشيط', min_xp: 250, icon: '⭐' },
  xp_to_next: 250, badges: [], rewards: []
};
const profiles = {
  aya: { learner: { id: 'aya-id', display_name: 'آية', slug: 'aya', grade_level: 5, is_test: false, avatar_emoji: '🌷' }, gamification },
  mohammad: { learner: { id: 'moh-id', display_name: 'محمد', slug: 'mohammad', grade_level: 7, is_test: false, avatar_emoji: '🚀' }, gamification }
};
const mathQuiz = { id:'quiz-math-u1', slug:'math-g5-unit1', title:'الوحدة الأولى — تدريب شامل', description:'رياضيات', quiz_kind:'unit', book_id:'book-math', unit_id:'unit-math-1', delivery_config:{} };
const arabicQuiz = { id:'quiz-ar-u1', slug:'arabic-g5-unit1', title:'المواطنة والانتماء — تدريب شامل', description:'لغة عربية', quiz_kind:'unit', book_id:'book-ar', unit_id:'unit-ar-1', delivery_config:{} };
const fractionQuiz = { id:'quiz-frac', slug:'fractions-pages-54-57', title:'Quiz الكسور (1) — الصفحات 54–57', description:'تدريب الكسور', quiz_kind:'practice', book_id:'book-math', unit_id:null, delivery_config:{} };
const chessQuiz = { id:'quiz-chess-1', slug:'chess-openings-1', title:'افتتاحيات الشطرنج — تدريب 1', description:'تدريب مبسط', quiz_kind:'practice', book_id:'book-chess', unit_id:'unit-chess-1', delivery_config:{} };
const mathBook = { id:'book-math', code:'MATH-G5', title:'الرياضيات - كتاب التلميذ - الصف الخامس', grade_level:5, school_year:'2025-2026', language:'ar', source_kind:'textbook', subject:{id:1,code:'math',name_ar:'الرياضيات'}, units:[{id:'unit-math-1',slug:'unit-1',title:'الوحدة الأولى',sort_order:1,quizzes:[mathQuiz]}], extras:[fractionQuiz] };
const arabicBook = { id:'book-ar', code:'AR-G5', title:'لغتي - الصف الخامس الأساسي - الفصل الأول', grade_level:5, school_year:'2025-2026', language:'ar', source_kind:'textbook', subject:{id:2,code:'arabic',name_ar:'اللغة العربية'}, units:[{id:'unit-ar-1',slug:'unit-1',title:'الوحدة الأولى: المواطنة والانتماء',sort_order:1,quizzes:[arabicQuiz]}], extras:[] };
const chessBook = { id:'book-chess', code:'CHESS-START', title:'الشطرنج للمبتدئين', grade_level:null, school_year:null, language:'ar', source_kind:'course_material', subject:{id:3,code:'chess',name_ar:'الشطرنج'}, units:[{id:'unit-chess-1',slug:'openings',title:'افتتاحيات بسيطة',sort_order:1,quizzes:[chessQuiz]}], extras:[], access_origin:'book' };
const program = { enrollment_id:'enr-aya', is_primary:true, started_at:'2026-08-23', id:'prog-g5', slug:'syrian-g5-2025-2026', code:'SY-G5', title:'المنهاج السوري — الصف الخامس — 2025–2026', description:'', program_type:'curriculum', grade_level:5, school_year:'2025-2026', status:'active', books:[arabicBook, mathBook] };

await page.route('**/functions/v1/family-api', async route => {
  let body={}; try{body=JSON.parse(route.request().postData()||'{}')}catch{}
  if(body.action==='learner_choices') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners:[
    {display_name:'آية',slug:'aya',avatar_emoji:'🌷',is_test:false},
    {display_name:'محمد',slug:'mohammad',avatar_emoji:'🚀',is_test:false},
    {display_name:'اختبار',slug:'test',avatar_emoji:'🧪',is_test:true},
    {display_name:'عبد القادر',slug:'abdul-qader',avatar_emoji:'🧑‍🎓',is_test:false}
  ]})});
  if(body.action==='student_profile') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profiles[profileMode])});
  if(body.action==='parent_dashboard') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    parent:{id:'p1',email:'parent@example.test',relation:'father',role:'owner'},
    learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],
    states:[],attempts:[{id:'a1',learner_id:'aya-id',percentage:88,submitted_at:new Date().toISOString(),metadata:{first_try_correct:4,hints_used:1},delivery_mode:'learning'}],reward_claims:[]
  })});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
});

await page.route('**/functions/v1/student-library-api', async route => {
  const data = profileMode==='aya'
    ? {programs:[program],standalone_books:[]}
    : {programs:[],standalone_books:directChessAssigned?[chessBook]:[]};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});

await page.route('**/functions/v1/learning-api', async route => {
  let body={}; try{body=JSON.parse(route.request().postData()||'{}')}catch{}
  if(body.action==='start_quiz') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'learn-attempt',started_at:new Date().toISOString(),quiz:{slug:body.quiz_slug,title:'تدريب QA'},version:{id:'v1',version_no:1,settings:{}},queue:[{sequence_no:1,question_id:'lq1',source_role:'core',status:'active',question:{id:'lq1',prompt:'2 + 2 = ؟',max_attempts:4,options:[{position:1,content:'4'},{position:2,content:'5'}]}}]})});
  if(body.action==='answer') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({is_correct:true,attempt_no:1,finalized:true,hint:null,remediation_added:null,explanation:'الإجابة 4.'})});
  if(body.action==='finish_quiz') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,percentage:100,first_try_correct:1,hints_used:0,award:{already_awarded:false,xp:10,reward_points:2},review:[{question_id:'lq1',prompt:'2 + 2 = ؟',is_correct:true,explanation:'الإجابة 4.'}]})});
  return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'QA_NOT_IMPLEMENTED'})});
});

await page.route('**/functions/v1/exam-v2-api', async route => {
  let body={}; try{body=JSON.parse(route.request().postData()||'{}')}catch{}
  if(body.action==='start_exam') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({attempt_id:'exam-attempt',started_at:new Date().toISOString(),quiz:{slug:body.quiz_slug,title:'امتحان QA'},questions:[
    {sequence_no:1,question_id:'eq1',status:'active',saved_response:null,question:{id:'eq1',prompt:'2 + 2 = ؟',options:[{position:1,content:'4'},{position:2,content:'5'}]}},
    {sequence_no:2,question_id:'eq2',status:'pending',saved_response:null,question:{id:'eq2',prompt:'3 + 1 = ؟',options:[{position:1,content:'4'},{position:2,content:'6'}]}}
  ]})});
  if(body.action==='save_answer') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  if(body.action==='submit_exam') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,score_points:2,max_points:2,percentage:100,review:[{question_id:'eq1',prompt:'2 + 2 = ؟',is_correct:true,explanation:'4'},{question_id:'eq2',prompt:'3 + 1 = ؟',is_correct:true,explanation:'4'}]})});
  return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'QA_NOT_IMPLEMENTED'})});
});

await page.route('**/functions/v1/parent-program-api', async route => {
  let body={}; try{body=JSON.parse(route.request().postData()||'{}')}catch{}
  if(body.action==='set_content'){
    if(body.learner_id==='moh-id'&&body.resource_type==='book'&&body.resource_id==='book-chess') directChessAssigned=body.mode==='add';
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  }
  if(['set_grade','set_program'].includes(body.action)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  if(body.action==='catalog') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],
    programs:[{id:'prog-g5',slug:'syrian-g5-2025-2026',title:'المنهاج السوري — الصف الخامس — 2025–2026',program_type:'curriculum',grade_level:5,school_year:'2025-2026',status:'active'}],
    enrollments:[{id:'enr-aya',learner_id:'aya-id',program_id:'prog-g5',status:'active',is_primary:true}],
    books:[
      {id:'book-ar',title:arabicBook.title,grade_level:5,school_year:'2025-2026',subject:{name_ar:'اللغة العربية'}},
      {id:'book-math',title:mathBook.title,grade_level:5,school_year:'2025-2026',subject:{name_ar:'الرياضيات'}},
      {id:'book-chess',title:chessBook.title,grade_level:null,school_year:null,subject:{name_ar:'الشطرنج'}}
    ],
    program_books:[{id:'pb1',program_id:'prog-g5',book_id:'book-ar',sort_order:10},{id:'pb2',program_id:'prog-g5',book_id:'book-math',sort_order:20}],
    content_assignments:directChessAssigned?[{id:'ca1',learner_id:'moh-id',resource_type:'book',resource_id:'book-chess',status:'active'}]:[]
  })});
  return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'QA_NOT_IMPLEMENTED'})});
});

await page.route('**/functions/v1/activity-api', async route => {
  let body={}; try{body=JSON.parse(route.request().postData()||'{}')}catch{}
  if(['learner_activity','learner_logout'].includes(body.action)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  const learners=[{id:'aya-id',display_name:'آية',slug:'aya'},{id:'moh-id',display_name:'محمد',slug:'mohammad'}];
  if(body.action==='parent_session_summary') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({days:Number(body.days||7),learners,summaries:[{learner_id:'aya-id',sessions:3,logins:2,duration_seconds:3600,average_seconds:1200,last_session_at:new Date().toISOString()},{learner_id:'moh-id',sessions:1,logins:1,duration_seconds:600,average_seconds:600,last_session_at:new Date().toISOString()}],inactivity_minutes:10})});
  if(body.action==='parent_sessions_query') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners,sessions:[{id:'s1',learner_id:'aya-id',entry_type:'login',started_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),ended_at:new Date().toISOString(),duration_seconds:1200,end_reason:'logout'},{id:'s2',learner_id:'moh-id',entry_type:'login',started_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),ended_at:new Date().toISOString(),duration_seconds:600,end_reason:'logout'}],page:Number(body.page||1),page_size:25,total:52,total_pages:3,inactivity_minutes:10})});
  if(body.action==='parent_sessions') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners,sessions:[],inactivity_minutes:10})});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
});

// 1) Login choices are fully backend-driven.
await page.goto(`${BASE_URL}?qa=learners-${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-dynamic-learner="abdul-qader"]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-dynamic-learner]').count()!==4) throw new Error('Expected 4 dynamic learner cards');

// 2) Aya: Program -> Book -> Unit -> Learning/Exam, no flat quiz wall.
await page.evaluate(()=>localStorage.setItem('learner_session','qa-learner-token'));
profileMode='aya';
await page.reload({waitUntil:'networkidle',timeout:30000});
await page.locator('[data-student-library]').waitFor({state:'visible',timeout:10000});
await page.getByText('🎓 مناهجي وكورساتي').waitFor({state:'visible',timeout:5000});
if(await page.locator('[data-open-program]').count()!==1) throw new Error('Aya should see one top-level program');
if(await page.locator('.dynamic-program-quiz').count()!==0) throw new Error('Flat program quiz cards should no longer be rendered');
await page.locator('[data-open-program="0"]').click();
await page.getByText('اختَر الكتاب').waitFor({state:'visible',timeout:5000});
if(await page.locator('[data-book]').count()!==2) throw new Error('Grade 5 program should expose two books');
const mathCard=page.locator('[data-book]').filter({hasText:'الرياضيات'}).first();
await mathCard.click();
await page.getByText('اختَر الوحدة').waitFor({state:'visible',timeout:5000});
await page.locator('[data-unit="0"]').click();
await page.getByText('كيف بدك تشتغل على هالوحدة؟').waitFor({state:'visible',timeout:5000});
if(await page.locator('[data-learn="math-g5-unit1"]').count()!==1) throw new Error('Learning Mode should be available at unit level');
if(await page.locator('[data-exam="math-g5-unit1"]').count()!==1) throw new Error('Exam Mode should be available at unit level');

// 3) Learning Mode launches from the unit and returns to the hierarchical library.
await page.locator('[data-learn="math-g5-unit1"]').click();
await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:5000});
await page.locator('.flh-learn-answer').first().click();
await page.locator('#flhLearnNext').waitFor({state:'visible',timeout:5000});
await page.locator('#flhLearnNext').click();
await page.getByText('100%').first().waitFor({state:'visible',timeout:5000});
await page.locator('#learnHome').click();
await page.locator('[data-student-library]').waitFor({state:'visible',timeout:5000});

// 4) Exam Mode launches from the hierarchy and saves answers before submit.
await page.locator('[data-open-program="0"]').click();
await page.locator('[data-book]').filter({hasText:'الرياضيات'}).first().click();
await page.locator('[data-unit="0"]').click();
await page.locator('[data-exam="math-g5-unit1"]').click();
await page.locator('.exam-v2-answer').first().waitFor({state:'visible',timeout:5000});
await page.locator('.exam-v2-answer').first().click();
await page.getByText('1/2 مجاب').waitFor({state:'visible',timeout:5000});
await page.locator('#examV2Next').click();
await page.locator('.exam-v2-answer').first().click();
await page.getByText('2/2 مجاب').waitFor({state:'visible',timeout:5000});
if(await page.locator('#examV2Submit').isDisabled()) throw new Error('Exam submit must enable after persistence');
await page.locator('#examV2Submit').click();
await page.getByText('100%').first().waitFor({state:'visible',timeout:5000});

// 5) Mohammad before any assignment: no Grade 5 leakage and no content.
profileMode='mohammad';
await page.reload({waitUntil:'networkidle',timeout:30000});
await page.getByText('ما في محتوى مربوط بحسابك بعد. اطلب من ولي الأمر يضيف لك منهاجًا أو كتابًا.').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-open-program]').count()!==0) throw new Error('Mohammad must have zero programs initially');
if(await page.locator('[data-open-standalone]').count()!==0) throw new Error('Mohammad must have zero standalone books initially');
if(await page.locator('#fractionQuiz').count()&&await page.locator('#fractionQuiz').isVisible()) throw new Error('Legacy Grade 5 quiz leaked to Mohammad');

// 6) Parent dashboard is summary-first; details live on separate pages.
await page.evaluate(()=>{localStorage.removeItem('learner_session');sessionStorage.removeItem('learner_session');localStorage.setItem('parent_session',JSON.stringify({access_token:'qa-parent-token',refresh_token:'qa-refresh'}));});
await page.goto(`${BASE_URL}?qa=parent-${Date.now()}#parents`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-parent-center-nav]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-go="parent-access"]').count()!==1) throw new Error('Parent content-management entry missing');
if(await page.locator('[data-go="parent-activity"]').count()!==1) throw new Error('Parent activity entry missing');
const oldDetail=page.getByText('تفاصيل المحاولات',{exact:true});if(await oldDetail.count()&&await oldDetail.isVisible()) throw new Error('Detailed attempts must not clutter main parent dashboard');
await page.getByText('ملخص آخر 7 أيام').waitFor({state:'visible',timeout:5000});

// 7) Parent assigns a standalone chess book to Mohammad without a fake curriculum.
await page.locator('[data-go="parent-access"]').click();
await page.locator('[data-access-root]').waitFor({state:'visible',timeout:10000});
await page.locator('[data-learner="moh-id"]').click();
if(await page.locator('[data-grade]').inputValue()!=='7') throw new Error('Mohammad grade must remain 7');
await page.locator('[data-add-book]').selectOption('book-chess');
await page.locator('[data-add-book-btn]').click();
await page.getByText('كتب مضافة مباشرة').waitFor({state:'visible',timeout:5000});
await page.getByText('الشطرنج للمبتدئين').waitFor({state:'visible',timeout:5000});
if(!directChessAssigned) throw new Error('Direct book assignment request was not sent');

// 8) Mohammad now sees the chess book as a standalone book and can drill down to modes.
await page.evaluate(()=>{localStorage.removeItem('parent_session');localStorage.setItem('learner_session','qa-learner-token');});
profileMode='mohammad';
await page.goto(`${BASE_URL}?qa=moh-chess-${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.getByText('📖 كتبي المستقلة').waitFor({state:'visible',timeout:10000});
await page.locator('[data-open-standalone="0"]').click();
await page.getByText('افتتاحيات بسيطة').waitFor({state:'visible',timeout:5000});
await page.locator('[data-unit="0"]').click();
if(await page.locator('[data-learn="chess-openings-1"]').count()!==1||await page.locator('[data-exam="chess-openings-1"]').count()!==1) throw new Error('Standalone book unit must expose both modes');

// 9) Activity details are separate, filtered and paginated.
await page.evaluate(()=>{localStorage.removeItem('learner_session');localStorage.setItem('parent_session',JSON.stringify({access_token:'qa-parent-token',refresh_token:'qa-refresh'}));});
await page.goto(`${BASE_URL}?qa=activity-${Date.now()}#parent-activity`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-activity-root]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-act-learner]').count()!==1||await page.locator('[data-act-from]').count()!==1||await page.locator('[data-act-to]').count()!==1) throw new Error('Activity filters missing');
await page.getByText('52 جلسة ضمن الفلتر الحالي.').waitFor({state:'visible',timeout:5000});
await page.getByText('صفحة 1 من 3').waitFor({state:'visible',timeout:5000});

if(errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
console.log('QA PASS: hierarchy + direct books + learning/exam modes + parent progressive disclosure + paginated activity');
await browser.close();
