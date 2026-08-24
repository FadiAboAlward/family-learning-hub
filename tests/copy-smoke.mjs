import { chromium } from 'playwright';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const badVisible=[/\bLevel\s+\d+\b/i,/\bHints?\b/i,/\bLearning Mode\b/i,/\bExam Mode\b/i,/جارِ/,/2026[-–]2025/];

function assertCopy(label,text){
  for(const re of badVisible){if(re.test(text))throw new Error(`${label}: forbidden visible copy matched ${re}`);}
}

const profile={learner:{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5,is_test:false,avatar_emoji:'🌷'},gamification:{xp:0,reward_points:0,current_level:1,current_streak:0,longest_streak:0,last_learning_date:null,current_level_info:{level_no:1,name:'مستكشف',min_xp:0,icon:'🌱'},next_level_info:{level_no:2,name:'متعلم نشيط',min_xp:250,icon:'⭐'},xp_to_next:250,badges:[],rewards:[]}};

await page.route('**/functions/v1/family-api',async route=>{
  let b={};try{b=JSON.parse(route.request().postData()||'{}')}catch{}
  if(b.action==='learner_choices')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners:[{display_name:'آية',slug:'aya',avatar_emoji:'🌷',is_test:false},{display_name:'محمد',slug:'mohammad',avatar_emoji:'🚀',is_test:false},{display_name:'اختبار',slug:'test',avatar_emoji:'🧪',is_test:true}]})});
  if(b.action==='student_profile')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)});
  if(b.action==='parent_dashboard')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({parent:{id:'p',email:'parent@example.test',relation:'father',role:'owner'},learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],states:[],attempts:[],reward_claims:[]})});
  return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
});
await page.route('**/functions/v1/student-library-api',route=>route.fulfill({status:200,contentType:'application/json',body:'{"programs":[],"standalone_books":[]}'}));
await page.route('**/functions/v1/activity-api',async route=>{
  let b={};try{b=JSON.parse(route.request().postData()||'{}')}catch{}
  if(b.action==='parent_session_summary')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({days:7,learners:[{id:'aya-id',display_name:'آية'},{id:'moh-id',display_name:'محمد'}],summaries:[]})});
  return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
});

// Public landing copy must be generic and Arabic-first.
await page.goto(`${BASE_URL}?copy=${Date.now()}`,{waitUntil:'networkidle',timeout:30000});
await page.getByText('متابعة الأبناء والنتائج والمكافآت.').waitFor({state:'visible',timeout:5000});
assertCopy('landing',await page.locator('body').innerText());

// Student chooser and its loading state must stay Arabic and correctly spelled.
await page.goto(`${BASE_URL}?copy=student-${Date.now()}#student`,{waitUntil:'networkidle',timeout:30000});
await page.locator('[data-dynamic-learner="aya"]').waitFor({state:'visible',timeout:5000});
assertCopy('student-login',await page.locator('body').innerText());

// Logged-in learner surfaces must not leak old English labels or the old Arabic typo.
await page.evaluate(()=>localStorage.setItem('learner_session','copy-qa-token'));
await page.reload({waitUntil:'networkidle',timeout:30000});
await page.getByText('ما في محتوى مربوط بحسابك بعد.',{exact:false}).waitFor({state:'visible',timeout:5000});
assertCopy('student-home',await page.locator('body').innerText());

// Parent dashboard gets the same copy check.
await page.evaluate(()=>{localStorage.removeItem('learner_session');localStorage.setItem('parent_session',JSON.stringify({access_token:'copy-parent'}));});
await page.goto(`${BASE_URL}?copy=parent-${Date.now()}#parents`,{waitUntil:'networkidle',timeout:30000});
await page.getByText('لوحة الأهل',{exact:false}).first().waitFor({state:'visible',timeout:5000});
assertCopy('parent-dashboard',await page.locator('body').innerText());

console.log('Rendered copy QA passed: Arabic localization, generic family copy, school-year direction and known spelling regressions are clean.');
await browser.close();
