import { chromium } from 'playwright';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const errors=[];
page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});

let profileMode='aya',chessAssigned=false;
let learningDraft=null,learningStarts=0;
const learningCalls={draft:0,hint:0,answer:0};
const examSaved=new Map(),examFlags=new Set();
const examCalls={save:0,flag:0};
let preloadRequests=0;

const gamification={xp:120,reward_points:42,current_level:1,current_streak:3,longest_streak:5,last_learning_date:null,current_level_info:{level_no:1,name:'مستكشف',min_xp:0,icon:'🌱'},next_level_info:{level_no:2,name:'متعلم نشيط',min_xp:250,icon:'⭐'},xp_to_next:130,badges:[{badge:{icon:'🏅',title:'بداية قوية'},award_reason:'أكملت أول تدريب'}],rewards:[{title:'وقت لعب إضافي',required_reward_points:60}]};
const profiles={
  aya:{learner:{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5,is_test:false,avatar_emoji:'🌷'},gamification},
  mohammad:{learner:{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7,is_test:false,avatar_emoji:'🚀'},gamification:{...gamification,xp:0,reward_points:0,current_streak:0,badges:[],rewards:[]}}
};
const mathQuiz={id:'qm',slug:'math-g5-unit1',title:'الوحدة الأولى — تدريب شامل',description:'رياضيات',quiz_kind:'unit',book_id:'bm',unit_id:'um1'};
const mathBook={id:'bm',title:'الرياضيات - كتاب التلميذ - الصف الخامس',grade_level:5,school_year:'2025-2026',subject:{name_ar:'الرياضيات'},units:[{id:'um1',slug:'unit-1',title:'الوحدة الأولى',quizzes:[mathQuiz]}],extras:[]};
const arabicBook={id:'ba',title:'لغتي - الصف الخامس الأساسي - الفصل الأول',grade_level:5,school_year:'2025-2026',subject:{name_ar:'اللغة العربية'},units:[{id:'ua1',slug:'unit-1',title:'الوحدة الأولى: المواطنة والانتماء',quizzes:[]}],extras:[]};
const chessBook={id:'bc',title:'الشطرنج للمبتدئين',grade_level:null,school_year:null,subject:{name_ar:'الشطرنج'},units:[{id:'uc1',slug:'openings',title:'افتتاحيات بسيطة',quizzes:[{id:'qc',slug:'chess-openings-1',title:'تدريب افتتاحيات',description:'',quiz_kind:'practice',book_id:'bc',unit_id:'uc1'}]}],extras:[]};
const program={enrollment_id:'enr-aya',is_primary:true,id:'pg5',slug:'syrian-g5-2025-2026',code:'SY-G5',title:'المنهاج السوري — الصف الخامس — 2025–2026',program_type:'curriculum',grade_level:5,school_year:'2025-2026',status:'active',books:[arabicBook,mathBook]};

const fulfill=(r,data,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});

await page.route('https://assets.test/**',async r=>{preloadRequests++;await r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});});

await page.route('**/functions/v1/family-api',async r=>{
  let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{}
  if(b.action==='learner_choices')return fulfill(r,{learners:[{display_name:'آية',slug:'aya',avatar_emoji:'🌷',is_test:false},{display_name:'محمد',slug:'mohammad',avatar_emoji:'🚀',is_test:false},{display_name:'اختبار',slug:'test',avatar_emoji:'🧪',is_test:true},{display_name:'عبد القادر',slug:'abdul-qader',avatar_emoji:'🧑‍🎓',is_test:false}]});
  if(b.action==='student_profile')return fulfill(r,profiles[profileMode]);
  if(b.action==='parent_dashboard')return fulfill(r,{parent:{id:'p1',email:'parent@example.test',relation:'father',role:'owner'},learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],states:[],attempts:[],reward_claims:[]});
  return fulfill(r,{ok:true});
});

await page.route('**/functions/v1/student-library-api',r=>fulfill(r,profileMode==='aya'?{programs:[program],standalone_books:[]}:{programs:[],standalone_books:chessAssigned?[chessBook]:[]}));
await page.route('**/functions/v1/question-reference-api',async r=>{let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{};const codes=b.attempt_id==='ea'?{eq1:'Q-000051',eq2:'Q-000052'}:{lq1:'Q-000007'};return fulfill(r,{codes});});

await page.route('**/functions/v1/learning-api',async r=>{
  let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{}
  if(b.action==='start_quiz'){
    const resumed=learningStarts++>0;
    return fulfill(r,{attempt_id:'la',resumed,quiz:{slug:b.quiz_slug,title:'تدريب QA'},queue:[{id:'qr1',sequence_no:1,question_id:'lq1',source_role:'core',status:'active',draft_option_position:learningDraft,hint_level_requested:0,is_flagged:false,question:{id:'lq1',question_code:'Q-000007',prompt:'2 + 2 = ؟',options:[{position:1,content:'4'},{position:2,content:'5'}],assets:[]}}]});
  }
  if(b.action==='save_draft'){learningCalls.draft++;learningDraft=b.option_position;return fulfill(r,{ok:true,option_position:b.option_position});}
  if(b.action==='request_hint'){learningCalls.hint++;return fulfill(r,{ok:true,hint_level:1,hint:{hint_level:1,content:'اجمع 2 مع 2.'},exhausted:false});}
  if(b.action==='answer'){learningCalls.answer++;learningDraft=null;return fulfill(r,{is_correct:true,attempt_no:1,finalized:true,explanation:'صحيح'});}
  if(b.action==='finish_quiz')return fulfill(r,{percentage:100,first_try_correct:1,hints_used:1,award:{already_awarded:false,xp:10,reward_points:2},review:[{question_id:'lq1',question_code:'Q-000007',prompt:'2 + 2 = ؟',is_correct:true,explanation:'صحيح'}]});
  return fulfill(r,{error:'QA'},400);
});

await page.route('**/functions/v1/exam-v2-api',async r=>{
  let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{}
  if(b.action==='start_exam')return fulfill(r,{attempt_id:'ea',resumed:true,quiz:{slug:b.quiz_slug,title:'امتحان QA'},questions:[
    {sequence_no:1,question_id:'eq1',status:'active',is_flagged:examFlags.has('eq1'),saved_response:examSaved.has('eq1')?{option_position:examSaved.get('eq1')}:null,question:{id:'eq1',question_code:'Q-000051',prompt:'2 + 2 = ؟',options:[{position:1,content:'4'},{position:2,content:'5'}],assets:[]}},
    {sequence_no:2,question_id:'eq2',status:'pending',is_flagged:examFlags.has('eq2'),saved_response:examSaved.has('eq2')?{option_position:examSaved.get('eq2')}:null,question:{id:'eq2',question_code:'Q-000052',prompt:'3 + 1 = ؟',options:[{position:1,content:'4'},{position:2,content:'6'}],assets:[{url:'https://assets.test/q2.png',alt_text:'صورة السؤال الثاني'}]}}
  ]});
  if(b.action==='save_answer'){examCalls.save++;examSaved.set(b.question_id,b.option_position);return fulfill(r,{ok:true});}
  if(b.action==='set_flag'){examCalls.flag++;if(b.is_flagged)examFlags.add(b.question_id);else examFlags.delete(b.question_id);return fulfill(r,{ok:true,is_flagged:b.is_flagged});}
  if(b.action==='submit_exam')return fulfill(r,{percentage:100,score_points:2,max_points:2,review:[{question_id:'eq1',question_code:'Q-000051',prompt:'2 + 2 = ؟',is_correct:true,was_flagged:true,explanation:'صحيح'},{question_id:'eq2',question_code:'Q-000052',prompt:'3 + 1 = ؟',is_correct:true,was_flagged:false,explanation:'صحيح'}]});
  return fulfill(r,{error:'QA'},400);
});

await page.route('**/functions/v1/parent-program-api',async r=>{
  let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{}
  if(b.action==='set_content'){if(b.learner_id==='moh-id'&&b.resource_type==='book'&&b.resource_id==='bc')chessAssigned=b.mode==='add';return fulfill(r,{ok:true});}
  if(['set_grade','set_program'].includes(b.action))return fulfill(r,{ok:true});
  if(b.action==='catalog')return fulfill(r,{learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],programs:[{id:'pg5',slug:'syrian-g5-2025-2026',title:program.title,program_type:'curriculum',grade_level:5,school_year:'2025-2026',status:'active'}],enrollments:[{id:'enr-aya',learner_id:'aya-id',program_id:'pg5',status:'active',is_primary:true}],books:[{id:'ba',title:arabicBook.title,grade_level:5,subject:{name_ar:'اللغة العربية'}},{id:'bm',title:mathBook.title,grade_level:5,subject:{name_ar:'الرياضيات'}},{id:'bc',title:chessBook.title,grade_level:null,subject:{name_ar:'الشطرنج'}}],program_books:[{program_id:'pg5',book_id:'ba',sort_order:10},{program_id:'pg5',book_id:'bm',sort_order:20}],content_assignments:chessAssigned?[{id:'ca',learner_id:'moh-id',resource_type:'book',resource_id:'bc',status:'active'}]:[]});
  return fulfill(r,{error:'QA'},400);
});

await page.route('**/functions/v1/activity-api',async r=>{
  let b={};try{b=JSON.parse(r.request().postData()||'{}')}catch{}
  if(['learner_activity','learner_logout'].includes(b.action))return fulfill(r,{ok:true});
  const learners=[{id:'aya-id',display_name:'آية',slug:'aya'},{id:'moh-id',display_name:'محمد',slug:'mohammad'}];
  if(b.action==='parent_session_summary')return fulfill(r,{days:7,learners,summaries:[{learner_id:'aya-id',sessions:3,duration_seconds:3600,average_seconds:1200,last_session_at:new Date().toISOString()},{learner_id:'moh-id',sessions:1,duration_seconds:600,average_seconds:600,last_session_at:new Date().toISOString()}]});
  if(b.action==='parent_sessions_query')return fulfill(r,{learners,sessions:[{id:'s1',learner_id:'aya-id',entry_type:'login',started_at:new Date().toISOString(),ended_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),duration_seconds:1200}],page:Number(b.page||1),page_size:25,total:52,total_pages:3});
  return fulfill(r,{ok:true});
});

async function waitHome(){await page.locator('[data-student-library]').waitFor({state:'visible',timeout:10000});}
async function openMath(){await page.locator('[data-primary-book]').filter({hasText:'الرياضيات'}).first().click();await page.locator('[data-unit="0"]').waitFor({state:'visible',timeout:5000});}

// Dynamic learner chooser stays generic and scalable.
await page.goto(`${BASE_URL}?qa=login-${Date.now()}#student`,{waitUntil:'domcontentloaded',timeout:30000});
await page.locator('[data-dynamic-learner="abdul-qader"]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-dynamic-learner]').count()!==4)throw new Error('Dynamic learners failed');

// Primary child path: Home -> Subject -> Unit -> Learning.
await page.evaluate(()=>localStorage.setItem('learner_session','qa-learner'));
profileMode='aya';
await page.reload({waitUntil:'domcontentloaded',timeout:30000});
await waitHome();
await page.locator('[data-primary-book]').first().waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-open-program]').count())throw new Error('Primary curriculum should not add a program decision');
if(await page.locator('[data-primary-book]').count()!==2)throw new Error('Primary subjects missing');
if(await page.locator('.footer-links').isVisible().catch(()=>false))throw new Error('Parent/student footer leaked into child mode');

await openMath();
await page.locator('[data-unit="0"]').click();
await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:5000});
if(learningStarts!==1)throw new Error('Learning did not start in two child decisions');
if(await page.locator('.question-ref-chip').isVisible().catch(()=>false))throw new Error('Technical question reference visible to child');
if(await page.locator('.flh-code-inline').isVisible().catch(()=>false))throw new Error('Technical question code visible to child');

await page.locator('#flhHelp').click();
await page.getByText('اجمع 2 مع 2.').waitFor({state:'visible',timeout:5000});
if(learningCalls.hint!==1)throw new Error('Learning help failed');
await page.locator('.flh-learn-answer').first().click();
await page.getByText('تمام، جاهز للتأكيد.').waitFor({state:'visible',timeout:5000});
if(learningCalls.draft!==1||learningCalls.answer!==0)throw new Error('Answer choice must save draft without submitting');
if(await page.locator('#flhConfirmAnswer').isDisabled())throw new Error('Explicit confirm did not enable');

// Exit and one-tap Continue must restore the exact draft.
await page.locator('#flhLearnExit').click();
await page.locator('[data-continue]').waitFor({state:'visible',timeout:10000});
await page.locator('[data-continue]').click();
await page.getByText('رجعناك لنفس المكان',{exact:false}).waitFor({state:'visible',timeout:5000});
if(await page.locator('.flh-learn-answer.selected').count()!==1)throw new Error('Learning draft was not restored');
await page.locator('#flhConfirmAnswer').click();
await page.locator('#flhLearnNext').waitFor({state:'visible',timeout:5000});
if(learningCalls.answer!==1)throw new Error('Explicit learning confirmation failed');
await page.locator('#flhLearnNext').click();
await page.getByText('100%').first().waitFor({state:'visible',timeout:5000});
await page.locator('#learnHome').click();
await page.locator('[data-primary-book]').first().waitFor({state:'visible',timeout:10000});

// Exam remains available but secondary.
await openMath();
await page.locator('[data-unit-exam="0"]').click();
await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:5000});
await page.getByText('رجعناك لامتحانك',{exact:false}).waitFor({state:'visible',timeout:5000});
await page.waitForTimeout(120);
if(preloadRequests<1)throw new Error('Exam next image was not preloaded');
await page.locator('.exam-v3-answer').first().click();
await page.getByText('الإجابة محفوظة تلقائيًا.').waitFor({state:'visible',timeout:5000});
if(examCalls.save!==1)throw new Error('Exam autosave failed');
await page.locator('#examFlag').click();
if(examCalls.flag!==1)throw new Error('Exam flag failed');
await page.locator('#examNext').click();
await page.locator('.exam-v3-answer').first().click();
await page.getByText('الإجابة محفوظة تلقائيًا.').waitFor({state:'visible',timeout:5000});
await page.locator('#examSubmit').click();
await page.getByRole('heading',{name:/عندك أسئلة للمراجعة/}).waitFor({state:'visible',timeout:5000});
await page.locator('#submitAnyway').click();
await page.getByText('100%').first().waitFor({state:'visible',timeout:5000});

// Content isolation by learner remains mandatory.
profileMode='mohammad';
await page.reload({waitUntil:'domcontentloaded',timeout:30000});
await page.getByText('ما في محتوى مربوط بحسابك بعد. اطلب من ولي الأمر يضيف لك منهاجًا أو كتابًا.').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-primary-book]').count())throw new Error('Aya content leaked to Mohammad');

// Parent progressive disclosure and direct assignment still work.
await page.evaluate(()=>{localStorage.removeItem('learner_session');sessionStorage.removeItem('learner_session');localStorage.setItem('parent_session',JSON.stringify({access_token:'qa-parent'}));});
await page.goto(`${BASE_URL}?qa=parent-${Date.now()}#parents`,{waitUntil:'domcontentloaded',timeout:30000});
await page.locator('[data-parent-center-nav]').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-go="parent-access"]').count()<1||await page.locator('[data-go="parent-activity"]').count()<1)throw new Error('Parent progressive navigation missing');
await page.locator('[data-go="parent-access"]').first().click();
await page.locator('[data-access-root]').waitFor({state:'visible',timeout:10000});
await page.locator('[data-learner="moh-id"]').click();
const addBook=page.locator('[data-add-book]');
await addBook.selectOption('bc');
await page.locator('[data-add-book-btn]').click();
await page.getByText('كتب مضافة مباشرة',{exact:false}).waitFor({state:'visible',timeout:5000});
if(!chessAssigned)throw new Error('Standalone book assignment failed');

await page.evaluate(()=>{localStorage.removeItem('parent_session');localStorage.setItem('learner_session','qa-learner');});
profileMode='mohammad';
await page.goto(`${BASE_URL}?qa=moh-book-${Date.now()}#student`,{waitUntil:'domcontentloaded',timeout:30000});
await page.getByText('الشطرنج').waitFor({state:'visible',timeout:10000});
if(await page.locator('[data-primary-book]').count())throw new Error('Primary Aya program appeared for Mohammad');

if(errors.length)throw new Error(`Browser errors:\n${errors.join('\n')}`);
console.log('QA PASS: child-first path + explicit confirmation + continue + exam + isolation + parent access');
await browser.close();
