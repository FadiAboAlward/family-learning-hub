import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {launchMockQaBrowser} from './qa-isolation.mjs';
import {visualCandidate} from './fixtures/assessment-visual/candidate.mjs';
import {academicCandidateHash} from '../supabase/functions/_shared/assessment-publication.mjs';
import {conceptGuidance} from '../supabase/functions/_shared/assessment-visual-contract.mjs';
const base=process.env.APP_URL||'http://127.0.0.1:4173/',candidate=visualCandidate(),learning=candidate.questions.filter(q=>q.delivery_surface==='learning'),exam=candidate.questions.filter(q=>q.delivery_surface==='exam');
const browser=await launchMockQaBrowser(chromium,base),shots=[];
// Chromium 104 does not support :has(): the submitted-result override must
// remain a plain class selector, separately from the live Chromium visual QA.
const reviewStyle=fs.readFileSync(new URL('../mobile-quiz-ux-v1.css',import.meta.url),'utf8');
assert.match(reviewStyle,/\.flh-sticky-action\.flh-exam-results-action\s*\{\s*position:static;bottom:auto;z-index:auto\}/,
  'Submitted Exam footer must use class-only static CSS supported before Chromium 105');
assert.doesNotMatch(reviewStyle,/(?:\.panel|\.flh-sticky-action):has\(#examHome\)/,
  'Submitted Exam footer must not rely on unsupported :has() browser behavior');
const attempt='04430000-0000-4000-8000-000000000001',examAttempt='04430000-0000-4000-8000-000000000002';
const profile={learner:{id:'04430000-0000-4000-8000-000000000003',slug:'qa-visual',display_name:'متعلم الاختبار',grade_level:7,is_test:true},gamification:{xp:0,reward_points:0,current_level:1,current_streak:0,longest_streak:0,badges:[],rewards:[]}};
const id=q=>'04430000-0000-4000-8000-'+String(candidate.questions.indexOf(q)+101).padStart(12,'0');
const names=new Map(['rectangle','triangle','composite'].map((n,i)=>['04410000-0000-4000-8000-'+String(i+101).padStart(12,'0'),n]));
const reply=(route,payload,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(payload)});
/** Exercise the rendered Learning and Exam visual journey on an isolated browser viewport.
 * @param {{name: string, viewport: {width: number,height: number}, mobile: boolean}} device
 */
async function run(device){
 const page=await browser.newPage({viewport:device.viewport,isMobile:device.mobile,hasTouch:device.mobile||device.name==='tablet'});
 const completed=new Set(),draft=new Map(),hints=new Map(),answers=new Map(),calls=[],errors=[];let failComposite=false,urlRevision=0,finishCalls=0;
 page.on('pageerror',e=>errors.push(e.name));
 /** Build one strictly synthetic question response with ordered optional media. */
 const question=q=>({id:id(q),question_code:q.question_code,question_type:q.question_type,prompt:q.prompt,prompt_language:q.prompt_language,assessment_profile:candidate.assessment_profile,learning_stage:q.learning_stage,options:q.options.map(o=>({position:o.position,label:o.label,content:o.content})),assets:q.assets.map(a=>({...a,url:new URL('/qa-visual-assets/'+names.get(a.asset_id)+'.png?r='+urlRevision,base).href}))});
 /** Map completed synthetic Learning questions into server-shaped concept evidence. */
 const evidence=()=>learning.map(q=>({question_id:id(q),question_code:q.question_code,concept_id:q.concept_code,concept_label:'مراجعة -26 و (-7) - 19 <img src=x>',learning_stage:q.learning_stage,status:completed.has(id(q))?'completed':'pending',is_correct:completed.has(id(q))?true:null,attempts_used:completed.has(id(q))?1:null,hints_used:completed.has(id(q))?hints.get(id(q))||0:null,explanation:completed.has(id(q))?q.explanation:null}));
 /** Derive expected per-stage Learning guidance without changing the API contract. */
 const guidance=()=>({assessment_profile:candidate.assessment_profile,learning_evidence:evidence(),learning_guidance:Object.fromEntries(['FOUNDATION','BRIDGE'].map(stage=>[stage,conceptGuidance(evidence(),stage)]))});
 /** Build the submitted Exam review containing a deliberately incorrect response. */
 const examReview=()=>exam.map(q=>({...question(q),question_id:id(q),response:{option_position:answers.get(id(q))},correct_answer:{option_position:q.options.find(o=>o.is_correct).position},is_correct:answers.get(id(q))===q.options.find(o=>o.is_correct).position,explanation:q.explanation}));
 try{
  await page.route('**/qa-visual-assets/**',route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);if(failComposite&&name==='composite.png')return route.fulfill({status:503,body:'Synthetic required-media outage'});return route.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'no-store'},body:fs.readFileSync(new URL('./fixtures/assessment-visual/'+name,import.meta.url))});});
  await page.route('**/functions/v1/**',route=>route.abort('blockedbyclient'));
  await page.route('**/functions/v1/family-api',route=>reply(route,route.request().postDataJSON()?.action==='student_profile'?profile:{learners:[]}));
  await page.route('**/functions/v1/student-library-api',route=>reply(route,{programs:[],standalone_books:[]}));
  await page.route('**/functions/v1/activity-api',route=>reply(route,{ok:true}));
  await page.route('**/functions/v1/question-reference-api',route=>reply(route,{codes:{}}));
  await page.route('**/functions/v1/attempt-history-api',route=>{const b=route.request().postDataJSON();if(b.action==='attempt_detail')return reply(route,{attempt:{id:examAttempt,delivery_mode:'exam',submitted_at:'2026-11-05T12:00:00Z',percentage:95,wrong_count:1,context:{quiz:{title:'اختبار الرسوم',slug:'qa-visual'}}},review:examReview()});if(b.action==='refresh_question_assets'){urlRevision++;return reply(route,{questions:exam.map(q=>({question_id:id(q),assets:question(q).assets}))});}return reply(route,{items:[],has_more:false,next_cursor:null});});
  await page.route('**/functions/v1/learning-api',route=>{
   const b=route.request().postDataJSON();calls.push(b.action);
   if(b.action==='start_quiz')return reply(route,{attempt_id:attempt,resumed:completed.size>0,quiz:{title:'اختبار الرسوم',slug:'qa-visual'},...guidance(),queue:learning.map((q,i)=>({question_id:id(q),source_role:'core',status:completed.has(id(q))?'completed':i===completed.size?'active':'pending',draft_option_position:draft.get(id(q))||null,hint_level_requested:hints.get(id(q))||0,question:question(q)}))});
   if(b.action==='save_draft'){draft.set(b.question_id,b.option_position);return reply(route,{ok:true});}
   if(b.action==='request_hint'){const level=Math.min(4,(hints.get(b.question_id)||0)+1);hints.set(b.question_id,level);const q=learning.find(q=>id(q)===b.question_id);return reply(route,{ok:true,hint_level:level,hint:{hint_level:level,content:q.hints[level-1].content,language:'tr'}});}
   if(b.action==='answer'){completed.add(b.question_id);return reply(route,{is_correct:true,finalized:true,explanation:learning.find(q=>id(q)===b.question_id).explanation,...guidance()});}
   if(b.action==='finish_quiz'){finishCalls++;assert.equal(completed.size,20,'UI must never fake completion');return reply(route,{percentage:100,first_try_correct:20,hints_used:1,award:{already_awarded:true},...guidance(),review:learning.map(q=>({...question(q),question_id:id(q),is_correct:true,explanation:q.explanation}))});}
   if(b.action==='refresh_question_assets'){urlRevision++;return reply(route,{questions:learning.map(q=>({question_id:id(q),assets:question(q).assets}))});}
   return reply(route,{optional_video:null});
  });
  await page.route('**/functions/v1/exam-v2-api',route=>{
   const b=route.request().postDataJSON();calls.push(b.action);
   if(b.action==='start_exam')return reply(route,{attempt_id:examAttempt,quiz:{title:'امتحان الرسوم',slug:'qa-visual'},assessment_profile:candidate.assessment_profile,questions:exam.map(q=>({question_id:id(q),question:question(q),saved_response:answers.has(id(q))?{option_position:answers.get(id(q))}:null}))});
   if(b.action==='save_answer'){answers.set(b.question_id,b.option_position);return reply(route,{ok:true});}
   if(b.action==='refresh_question_assets'){urlRevision++;return reply(route,{questions:exam.map(q=>({question_id:id(q),assets:question(q).assets}))});}
   if(b.action==='submit_exam')return reply(route,{percentage:95,score_points:19,max_points:20,review:examReview()});
   return reply(route,{ok:true});
  });
  await page.addInitScript(()=>localStorage.setItem('learner_session','qa.visual'));
  async function start(){await page.goto(base+'#student',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.FLH?.startLearningQuiz==='function');await page.evaluate(()=>window.FLH.startLearningQuiz('qa-visual'));}
  async function shot(name){fs.mkdirSync('playwright-screenshots',{recursive:true});const path='playwright-screenshots/flh-044-'+device.name+'-'+name+'.png';await page.screenshot({path,fullPage:true});shots.push({file:path.split('/').at(-1),sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')});}
  async function layout(){assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2||document.body.scrollWidth>innerWidth+2),false);assert.ok(await page.locator('.question').first().evaluate(el=>el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0));}
  /**
   * Verify actual mobile/desktop viewport hit testing for reviewed artwork or an answer.
   * Protects against the #207 sticky action overlay without changing any assessment state.
   * @param {string} targetSelector CSS selector of visible question or answer content.
   * @param {string} actionButton CSS selector for the action enclosed in the footer.
   * @param {string} caseName Regression scenario label for assertion diagnostics.
   */
  async function assertActionClear(targetSelector,actionButton,caseName){
    const action=page.locator(actionButton).locator('xpath=..');
    assert.equal(await action.evaluate(el=>getComputedStyle(el).position),'static',caseName+': action must participate in document flow');
    await page.locator(targetSelector).last().scrollIntoViewIfNeeded();
    const state=await page.evaluate(({targetSelector,actionButton})=>{
      const target=[...document.querySelectorAll(targetSelector)].at(-1);
      const footer=document.querySelector(actionButton)?.closest('.flh-sticky-action');
      if(!target||!footer)return null;
      const a=target.getBoundingClientRect(),b=footer.getBoundingClientRect();
      const overlap=Math.min(a.right,b.right)>Math.max(a.left,b.left)+.5&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+.5;
      const x=(a.left+a.right)/2,y=(a.top+a.bottom)/2;
      const hit=document.elementFromPoint(x,y);
      return {overlap,coveredByAction:!!hit?.closest('.flh-sticky-action'),visible:a.top>=-1&&a.bottom<=innerHeight+1,
        targetHit:target.contains(hit),rtl:document.documentElement.dir==='rtl',
        overflow:document.documentElement.scrollWidth>innerWidth+2};
    },{targetSelector,actionButton});
    assert.ok(state,caseName+': required review/answer or button missing');
    assert.equal(state.rtl,true,caseName+': RTL direction');
    assert.equal(state.overflow,false,caseName+': horizontal overflow');
    assert.equal(state.visible,true,caseName+': target clipped');
    assert.equal(state.overlap,false,caseName+': footer intersects target');
    assert.equal(state.coveredByAction,false,caseName+': footer intercepts target center');
    assert.equal(state.targetHit,true,caseName+': target not hit-testable');
  }
  /**
   * Answer one synthetic Learning question, and regression-test a zero-image mobile item.
   * All answer persistence remains handled by the existing student UI and synthetic API.
   * @param {number} i Ordered zero-based Learning question index.
   */
  async function answerLearning(i){const q=learning[i];await page.waitForFunction(code=>document.querySelector('.question')?.textContent?.length>0&&document.querySelector('.flh-learner-status b')?.textContent==='السؤال '+code,i+1);if(i===1){assert.equal(q.assets.length,0,'Zero-image question fixture');assert.equal(await page.locator('.flh-learn-answer').count(),4,'Four answers render without media');if(device.mobile){await page.evaluate(()=>scrollTo(0,0));await assertActionClear('.flh-learn-answer:last-of-type','#flhConfirmAnswer','Mobile zero-image Learning initial');await shot('learning-no-image-mobile-clear');}}const button=page.locator('.flh-learn-answer[data-pos="'+q.options.find(o=>o.is_correct).position+'"]');await button.click();if(i===1&&device.mobile)await assertActionClear('.flh-learn-answer:last-of-type','#flhConfirmAnswer','Mobile zero-image Learning selected');await page.locator('#flhConfirmAnswer').click();await page.locator('#flhLearnNext').waitFor();if(i===0){assert.equal(await page.locator('.flh-visual-asset img').count(),1,'Learning feedback retains the drawing');await shot('learning-feedback');}await page.locator('#flhLearnNext').click();}
  await start();await page.locator('.flh-visual-asset img').waitFor();await page.waitForFunction(()=>document.querySelector('.flh-visual-enlarge')?.disabled===false);await layout();await shot('learning-one-image');
  await page.evaluate(async()=>{window.qaAssetHelper=window.FLHAssessmentAssets;delete window.FLHAssessmentAssets;await window.FLH.startLearningQuiz('qa-visual');});
  assert.equal(await page.locator('.flh-learn-answer:enabled').count(),0,'Missing helper must fail closed in Learning');
  const blockedCalls=calls.length;await page.evaluate(()=>{const b=document.querySelector('.flh-learn-answer');b.disabled=false;b.click();document.querySelector('#flhConfirmAnswer').click();});assert.equal(calls.length,blockedCalls,'Missing helper cannot persist drafts or answers');await shot('missing-helper-learning');
  await page.evaluate(async()=>{window.FLHAssessmentAssets=window.qaAssetHelper;await window.FLH.startLearningQuiz('qa-visual');});await page.waitForFunction(()=>document.querySelector('.flh-visual-enlarge')?.disabled===false);
  await page.locator('#flhHelp').click();await page.locator('.flh-hint-card').waitFor();
  for(let i=0;i<9;i++)await answerLearning(i);
  await start();assert.equal(completed.size,9);await answerLearning(9);
  await page.locator('#learnContinueBridge').waitFor();assert.equal(await page.locator('#learnContinueBridge').isEnabled(),true);assert.ok(await page.locator('.flh-stage-summary details').count()>0,'Hint use recommends optional concept review');await shot('foundation-summary');
  assert.ok((await page.locator('.flh-stage-summary summary .flh-math-ltr[dir="ltr"]').allTextContents()).some(t=>t.includes('-26')),'Concept negatives use the shared LTR math renderer');assert.equal(await page.locator('.flh-stage-summary summary img').count(),0,'Concept labels remain escaped');
  await page.locator('#learnContinueBridge').click();await page.waitForFunction(()=>document.querySelectorAll('.flh-visual-asset img').length===2&&[...document.querySelectorAll('.flh-visual-enlarge')].every(b=>!b.disabled));
  assert.deepEqual(await page.locator('.flh-visual-asset figcaption').allTextContents(),['Dikdörtgen','Üçgen']);await layout();assert.equal(await page.locator('.flh-sticky-action').evaluate(el=>getComputedStyle(el).position),'static','Confirmation must not cover required diagrams');await shot('bridge-two-images');
  await start();await page.locator('#learnContinueBridge').click();assert.deepEqual(await page.locator('.flh-visual-asset figcaption').allTextContents(),['Dikdörtgen','Üçgen'],'Reload preserves image order and the same attempt');await answerLearning(10);
  await start();assert.equal(completed.size,11);for(let i=11;i<20;i++)await answerLearning(i);
  await page.locator('#learnOpenExam').waitFor();assert.equal(finishCalls,1);assert.equal(await page.locator('#learnOpenExam').isEnabled(),true);assert.ok(await page.locator('.flh-stage-summary details').count()>0,'Finish retains Foundation review needs even when Bridge is correct');await shot('learning-final-review');
  failComposite=true;await page.locator('#learnOpenExam').click();await page.locator('.flh-visual-retry').waitFor({state:'visible'});assert.equal(await page.locator('.exam-v3-answer:enabled').count(),0);assert.equal(answers.size,0,'Required-media failure must not create a false answer');await shot('required-media-error');
  failComposite=false;await page.locator('.flh-visual-retry').click();await page.waitForFunction(()=>document.querySelector('.flh-visual-enlarge')?.disabled===false);assert.equal(answers.size,0,'URL refresh has zero answer side effects');
  await page.evaluate(async()=>{delete window.FLHAssessmentAssets;await window.FLH.startExamQuiz('qa-visual');});assert.equal(await page.locator('.exam-v3-answer:enabled').count(),0,'Missing helper must fail closed in Exam');
  const blockedExamCalls=calls.length;await page.evaluate(()=>{const b=document.querySelector('.exam-v3-answer');b.disabled=false;b.click();});assert.equal(calls.length,blockedExamCalls);assert.equal(answers.size,0);await shot('missing-helper-exam');
  await page.evaluate(async()=>{window.FLHAssessmentAssets=window.qaAssetHelper;await window.FLH.startExamQuiz('qa-visual');});await page.waitForFunction(()=>document.querySelector('.flh-visual-enlarge')?.disabled===false);
  const zoom=page.locator('.flh-visual-enlarge');await zoom.focus();await page.keyboard.press('Enter');await page.locator('.flh-visual-dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await zoom.evaluate(el=>el===document.activeElement),true,'Keyboard zoom returns focus');await layout();await shot('exam-composite');
  for(let i=0;i<20;i++){const pos=i===0?2:exam[i].options.find(o=>o.is_correct).position;await page.locator('.exam-v3-answer[data-pos="'+pos+'"]').click();if(i<19)await page.locator('#examNext').click();}
  assert.equal(await page.locator('#flhHelp').count(),0,'Active Exam has no hints');await page.locator('#examSubmit').click();await page.locator('.exam-review-wrong .flh-visual-asset img').waitFor();await layout();await shot('exam-review');assert.equal(await page.locator('.flh-exam-results-action').count(),1,'Submitted Exam footer must have review-only class');await page.evaluate(()=>scrollTo(0,0));await assertActionClear('.exam-review-wrong .flh-visual-asset img','#examHome',device.name+' submitted Exam review artwork');if(!device.mobile)await shot('exam-review-desktop-clear');if(device.mobile){await page.evaluate(()=>scrollTo(0,0));await assertActionClear('.exam-review-wrong .question','#examHome','Mobile submitted Exam question');await assertActionClear('.exam-review-wrong .flh-review-response','#examHome','Mobile submitted Exam selected answer');await page.locator('#examHome').focus();assert.equal(await page.locator('#examHome').evaluate(el=>el===document.activeElement),true,'Review return is keyboard focusable');await shot('exam-review-mobile-clear');}
  await page.locator('#examHome').click();await page.waitForFunction(()=>document.querySelector('.hero h1')?.textContent?.includes('أهلًا'));await page.evaluate(id=>window.FLH.openAttemptHistoryAttempt(id),examAttempt);await page.locator('.flh-history-review-list .flh-visual-asset img').waitFor();await layout();await shot('history');
  assert.deepEqual(errors,[]);assert.equal(calls.filter(x=>x==='submit_exam').length,1);console.log('FLH-044 exact candidate rendered Learning/Exam/history, 0/1/2 images, required failure/read-only refresh, keyboard/RTL and 9/10/11/20 resume: PASS '+device.name+' (synthetic APIs)');
 }finally{await page.close();}
}
try{await run({name:'mobile',viewport:{width:390,height:844},mobile:true});await run({name:'tablet',viewport:{width:768,height:1024},mobile:false});await run({name:'desktop',viewport:{width:1365,height:900},mobile:false});
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(process.env.FLH_QA_HEAD_SHA)assert.equal(head,process.env.FLH_QA_HEAD_SHA);
 fs.writeFileSync('playwright-screenshots/flh-044-manifest.json',JSON.stringify({feature_id:'FLH-FEAT-2026-044',spec_version:'1.1',drive_revision_id:'4',head_sha:head,candidate_sha256:await academicCandidateHash(candidate),run_id:process.env.GITHUB_RUN_ID||null,source:'synthetic APIs, actual runtimes; not authenticated provider/academic pilot PASS',retention_days:7,files:shots},null,2));
}finally{await browser.close();}
