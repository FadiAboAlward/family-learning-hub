import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const SAVE_DELAY_MS=Number(process.env.PERF_SAVE_DELAY_MS||2500);
const LIMITS={
  appReadyMs:Number(process.env.PERF_APP_READY_LIMIT_MS||2500),
  examOpenUiMs:Number(process.env.PERF_EXAM_OPEN_LIMIT_MS||800),
  answerVisualMs:Number(process.env.PERF_ANSWER_VISUAL_LIMIT_MS||250),
  nextQuestionMs:Number(process.env.PERF_NEXT_QUESTION_LIMIT_MS||250),
};

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const errors=[];
let saveStartedAt=0,saveCompletedAt=0,saveCalls=0;

page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});

await page.route('**/functions/v1/**',async route=>{
  const req=route.request();
  let body={};
  try{body=JSON.parse(req.postData()||'{}')}catch{}
  const url=new URL(req.url());
  const slug=url.pathname.split('/').pop();

  if(slug==='exam-v2-api'&&body.action==='start_exam'){
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      attempt_id:'perf-attempt',resumed:false,quiz:{slug:'perf-exam',title:'امتحان الأداء'},questions:[
        {sequence_no:1,question_id:'perf-q1',status:'active',is_flagged:false,saved_response:null,question:{id:'perf-q1',question_code:'PERF-1',prompt:'2 + 2 = ؟',options:[{position:1,content:'4'},{position:2,content:'5'}],assets:[]}},
        {sequence_no:2,question_id:'perf-q2',status:'pending',is_flagged:false,saved_response:null,question:{id:'perf-q2',question_code:'PERF-2',prompt:'3 + 1 = ؟',options:[{position:1,content:'4'},{position:2,content:'6'}],assets:[]}}
      ]
    })});
  }
  if(slug==='exam-v2-api'&&body.action==='save_answer'){
    saveCalls++;
    saveStartedAt=Date.now();
    await new Promise(r=>setTimeout(r,SAVE_DELAY_MS));
    saveCompletedAt=Date.now();
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  }
  if(slug==='exam-v2-api'&&body.action==='submit_exam'){
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({percentage:100,score_points:2,max_points:2,review:[]})});
  }
  if(slug==='exam-v2-api'&&body.action==='set_flag'){
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"is_flagged":true}'});
  }
  if(slug==='family-api'&&body.action==='student_profile'){
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learner:{id:'perf-learner',display_name:'اختبار الأداء',slug:'performance',grade_level:5,is_test:true,avatar_emoji:'🧪'},gamification:{xp:0,reward_points:0,current_level:1,current_streak:0,longest_streak:0,badges:[],rewards:[]}})});
  }
  if(slug==='family-api'&&body.action==='learner_choices'){
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({learners:[]})});
  }
  if(slug==='student-library-api'){
    return route.fulfill({status:200,contentType:'application/json',body:'{"programs":[],"standalone_books":[]}'});
  }
  if(slug==='activity-api'){
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  }
  return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
});

await page.addInitScript(()=>localStorage.setItem('learner_session','perf-test-session'));
const navStart=Date.now();
await page.goto(`${BASE_URL}?performance=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForFunction(()=>Boolean(window.FLH?.startExamQuiz),null,{timeout:10000});
const appReadyMs=Date.now()-navStart;

const examStart=Date.now();
await page.evaluate(()=>window.FLH.startExamQuiz('perf-exam'));
await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:5000});
const examOpenUiMs=Date.now()-examStart;

const answerVisualMs=await page.evaluate(async()=>{
  const btn=document.querySelector('.exam-v3-answer');
  if(!btn)throw new Error('NO_ANSWER_BUTTON');
  const start=performance.now();
  btn.click();
  return await new Promise((resolve,reject)=>{
    const tick=()=>{
      if(document.querySelector('.exam-v3-answer.selected'))return resolve(performance.now()-start);
      if(performance.now()-start>1200)return reject(new Error('ANSWER_VISUAL_TIMEOUT'));
      requestAnimationFrame(tick);
    };
    tick();
  });
});

await page.waitForFunction(()=>document.body.textContent.includes('يتم حفظها بالخلفية'),null,{timeout:1000});
await page.waitForTimeout(50);
if(!saveStartedAt)await page.waitForTimeout(100);

const nextQuestionMs=await page.evaluate(async()=>{
  const btn=document.querySelector('#examNext');
  if(!btn)throw new Error('NO_NEXT_BUTTON');
  const start=performance.now();
  btn.click();
  return await new Promise((resolve,reject)=>{
    const tick=()=>{
      if(document.body.textContent.includes('السؤال 2 من 2'))return resolve(performance.now()-start);
      if(performance.now()-start>1200)return reject(new Error('NEXT_QUESTION_TIMEOUT'));
      requestAnimationFrame(tick);
    };
    tick();
  });
});

const saveWasStillPendingDuringNavigation=Boolean(saveStartedAt&&!saveCompletedAt);
await page.waitForTimeout(SAVE_DELAY_MS+150);

const report={
  generated_at:new Date().toISOString(),
  base_url:BASE_URL,
  injected_save_delay_ms:SAVE_DELAY_MS,
  measurements:{app_ready_ms:appReadyMs,exam_open_ui_ms:examOpenUiMs,answer_visual_ms:Math.round(answerVisualMs*10)/10,next_question_ms:Math.round(nextQuestionMs*10)/10},
  limits:{app_ready_ms:LIMITS.appReadyMs,exam_open_ui_ms:LIMITS.examOpenUiMs,answer_visual_ms:LIMITS.answerVisualMs,next_question_ms:LIMITS.nextQuestionMs},
  save_calls:saveCalls,
  save_was_still_pending_during_navigation:saveWasStillPendingDuringNavigation,
  browser_errors:errors,
};
fs.writeFileSync('performance-report.json',JSON.stringify(report,null,2));

const failures=[];
if(appReadyMs>LIMITS.appReadyMs)failures.push(`app ready ${appReadyMs}ms > ${LIMITS.appReadyMs}ms`);
if(examOpenUiMs>LIMITS.examOpenUiMs)failures.push(`exam UI ${examOpenUiMs}ms > ${LIMITS.examOpenUiMs}ms`);
if(answerVisualMs>LIMITS.answerVisualMs)failures.push(`answer visual ${answerVisualMs.toFixed(1)}ms > ${LIMITS.answerVisualMs}ms`);
if(nextQuestionMs>LIMITS.nextQuestionMs)failures.push(`next question ${nextQuestionMs.toFixed(1)}ms > ${LIMITS.nextQuestionMs}ms`);
if(!saveWasStillPendingDuringNavigation)failures.push('navigation was not tested while save_answer was still pending');
if(saveCalls<1)failures.push('save_answer was never called');
if(errors.length)failures.push(...errors);

const markdown=[
  '## Family Learning Hub performance smoke',
  '',
  '| Metric | Result | Limit |',
  '|---|---:|---:|',
  `| App ready | ${appReadyMs} ms | ${LIMITS.appReadyMs} ms |`,
  `| Exam UI open | ${examOpenUiMs} ms | ${LIMITS.examOpenUiMs} ms |`,
  `| Answer visual response | ${answerVisualMs.toFixed(1)} ms | ${LIMITS.answerVisualMs} ms |`,
  `| Next-question navigation | ${nextQuestionMs.toFixed(1)} ms | ${LIMITS.nextQuestionMs} ms |`,
  '',
  `Injected backend save delay: **${SAVE_DELAY_MS} ms**`,
  `Navigation while save pending: **${saveWasStillPendingDuringNavigation?'PASS':'FAIL'}**`,
  failures.length?`\n❌ ${failures.join('; ')}`:'\n✅ Performance smoke passed.'
].join('\n');
fs.writeFileSync('performance-summary.md',markdown);
console.log(markdown);

await browser.close();
if(failures.length)throw new Error(`Performance regression: ${failures.join('; ')}`);
