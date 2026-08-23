import { chromium } from 'playwright';

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

let profileMode = 'aya';
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
const program = {
  enrollment_id: 'enr-aya', is_primary: true, slug: 'syrian-g5-2025-2026', code: 'SY-G5-2025-2026',
  title: 'المنهاج السوري — الصف الخامس — 2025–2026', program_type: 'curriculum', grade_level: 5, school_year: '2025-2026', status: 'active',
  quizzes: [
    { slug: 'fractions-pages-54-57', title: 'الكسور (1)', description: 'تدريب الكسور', quiz_kind: 'practice', status: 'active' },
    { slug: 'math-g5-unit1', title: 'الوحدة الأولى — تدريب شامل', description: 'رياضيات', quiz_kind: 'unit', status: 'active' },
    { slug: 'arabic-g5-unit1', title: 'المواطنة والانتماء — تدريب شامل', description: 'لغة عربية', quiz_kind: 'unit', status: 'active' }
  ]
};

await page.route('**/functions/v1/family-api', async route => {
  let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
  if (body.action === 'learner_choices') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners:[
    {display_name:'آية',slug:'aya',avatar_emoji:'🌷',is_test:false},
    {display_name:'محمد',slug:'mohammad',avatar_emoji:'🚀',is_test:false},
    {display_name:'اختبار',slug:'test',avatar_emoji:'🧪',is_test:true},
    {display_name:'عبد القادر',slug:'abdul-qader',avatar_emoji:'🧑‍🎓',is_test:false}
  ]})});
  if (body.action === 'student_profile') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profiles[profileMode])});
  if (body.action === 'parent_dashboard') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    parent:{id:'p1',email:'parent@example.test',relation:'father',role:'owner'},
    learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],
    states:[],attempts:[],reward_claims:[]
  })});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
});

await page.route('**/functions/v1/learning-api', async route => {
  let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
  if (body.action === 'catalog') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({programs:profileMode==='aya'?[program]:[]})});
  return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'QA_NOT_IMPLEMENTED'})});
});

await page.route('**/functions/v1/exam-v2-api', async route => {
  let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
  if (body.action === 'start_exam') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    attempt_id:'exam-attempt-1',started_at:new Date().toISOString(),quiz:{slug:body.quiz_slug,title:'امتحان QA'},questions:[
      {sequence_no:1,question_id:'q1',status:'active',saved_response:null,question:{id:'q1',prompt:'2 + 2 = ؟',options:[{position:1,content:'4'},{position:2,content:'5'}]}},
      {sequence_no:2,question_id:'q2',status:'pending',saved_response:null,question:{id:'q2',prompt:'3 + 1 = ؟',options:[{position:1,content:'4'},{position:2,content:'6'}]}}
    ]
  })});
  if (body.action === 'save_answer') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  if (body.action === 'submit_exam') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    ok:true,attempt_id:'exam-attempt-1',quiz:{slug:'fractions-pages-54-57',title:'امتحان QA'},score_points:2,max_points:2,percentage:100,
    review:[{question_id:'q1',prompt:'2 + 2 = ؟',is_correct:true,explanation:'4 هي الإجابة الصحيحة.'},{question_id:'q2',prompt:'3 + 1 = ؟',is_correct:true,explanation:'4 هي الإجابة الصحيحة.'}]
  })});
  return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'QA_NOT_IMPLEMENTED'})});
});

await page.route('**/functions/v1/parent-program-api', async route => {
  let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
  if (body.action === 'catalog') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],
    programs:[{id:'prog-g5',slug:'syrian-g5-2025-2026',title:'المنهاج السوري — الصف الخامس — 2025–2026',program_type:'curriculum',grade_level:5,school_year:'2025-2026',status:'active'}],
    enrollments:[{id:'enr-aya',learner_id:'aya-id',program_id:'prog-g5',status:'active',is_primary:true}]
  })});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
});
await page.route('**/functions/v1/activity-api', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})}));

// 1) Logged-out learner list must be backend-driven; adding a learner requires no frontend edit.
await page.goto(`${BASE_URL}?qa=learners-${Date.now()}#student`, {waitUntil:'networkidle',timeout:30000});
await page.locator('[data-dynamic-learner="abdul-qader"]').waitFor({state:'visible',timeout:10000});
if (await page.locator('[data-dynamic-learner]').count() !== 4) throw new Error('Expected 4 backend-driven learner cards');

// 2) Aya gets only her program catalog, plus Exam V2. Legacy cards must never be active.
await page.evaluate(() => localStorage.setItem('learner_session','qa-learner-token'));
profileMode='aya';
await page.reload({waitUntil:'networkidle',timeout:30000});
await page.locator('[data-program="syrian-g5-2025-2026"]').waitFor({state:'visible',timeout:10000});
if (await page.locator('.dynamic-program-quiz').count() !== 3) throw new Error('Aya should have 3 program quiz cards');
await page.waitForFunction(() => document.querySelectorAll('.exam-v2-card').length === 3, null, {timeout:5000});
if (await page.locator('#fractionExam').count() !== 0) throw new Error('Legacy #fractionExam must not exist');
if (await page.locator('#fractionQuiz').count() && await page.locator('#fractionQuiz').isVisible()) throw new Error('Legacy #fractionQuiz must stay hidden');

// 3) New server exam path: no feedback during solving; result appears only after submit.
await page.locator('.exam-v2-card').first().click();
await page.locator('#examV2Answers').waitFor({state:'visible',timeout:5000});
await page.locator('.exam-v2-answer').first().click();
await page.locator('#examV2Next').click();
await page.locator('.exam-v2-answer').first().click();
await page.locator('#examV2Submit').waitFor({state:'visible',timeout:5000});
if (await page.locator('#examV2Submit').isDisabled()) throw new Error('Exam submit should enable after all answers are saved');
await page.locator('#examV2Submit').click();
await page.getByText('100%').first().waitFor({state:'visible',timeout:5000});
if (await page.locator('.exam-review').count() !== 2) throw new Error('Exam V2 review should contain 2 questions');

// 4) Mohammed has Grade 7 but no program: absolutely no Aya quiz/exam may appear.
profileMode='mohammad';
await page.reload({waitUntil:'networkidle',timeout:30000});
await page.getByText('ما في برنامج تعليمي مربوط بهذا الحساب بعد.').waitFor({state:'visible',timeout:10000});
if (await page.locator('.dynamic-program-quiz').count() !== 0) throw new Error('Mohammad must have zero program quiz cards');
if (await page.locator('.exam-v2-card').count() !== 0) throw new Error('Mohammad must have zero exam cards');
if (await page.locator('#fractionExam').count() !== 0) throw new Error('Legacy exam leaked into Mohammad account');
if (await page.locator('#fractionQuiz').count() && await page.locator('#fractionQuiz').isVisible()) throw new Error('Legacy learning quiz leaked into Mohammad account');

// 5) Parent dashboard exposes grade/program controls for real learners.
await page.evaluate(() => {
  localStorage.removeItem('learner_session'); sessionStorage.removeItem('learner_session');
  localStorage.setItem('parent_session', JSON.stringify({access_token:'qa-parent-token',refresh_token:'qa-refresh'}));
});
await page.goto(`${BASE_URL}?qa=parent-${Date.now()}#parents`, {waitUntil:'networkidle',timeout:30000});
await page.locator('[data-parent-program-admin]').waitFor({state:'visible',timeout:10000});
if (await page.locator('.parent-program-learner').count() !== 2) throw new Error('Parent program manager should list 2 real learners');
const mohCard=page.locator('.parent-program-learner').filter({hasText:'محمد'}).first();
if ((await mohCard.locator('.parent-grade-select').inputValue()) !== '7') throw new Error('Mohammad grade should be 7 in parent controls');
if (await mohCard.locator('.parent-program-row').count() !== 1) throw new Error('Parent should see available programs for Mohammad');

if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
console.log('QA PASS: dynamic learners + strict program isolation + Exam V2 + parent program controls');
await browser.close();
