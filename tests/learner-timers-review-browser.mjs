import { launchMockQaBrowser } from './qa-isolation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const baseUrl=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await launchMockQaBrowser(chromium,baseUrl);
const files=[];
fs.mkdirSync('playwright-screenshots',{recursive:true});
try{
  for(const viewport of [{width:390,height:844},{width:1365,height:900}]){
    const page=await browser.newPage({viewport});
    page.setDefaultTimeout(10000);
    const errors=[],calls=[];
    const base=Date.parse('2026-10-08T12:00:00Z');let now=base;
    const examStarted=new Date(base-120000).toISOString(),saved=new Map();let examStarts=0,learningAnswers=0;
    let holdFinalSave=false, releaseFinalSave, notifyFinalSave, holdSubmission=false, releaseSubmission, notifySubmission;
    const finalSaveHeld=new Promise(resolve=>{notifyFinalSave=resolve;});
    const submissionHeld=new Promise(resolve=>{notifySubmission=resolve;});
    const profile={learner:{id:'testing-timer-learner',slug:'test',display_name:'Testing',grade_level:7,is_test:true},gamification:{xp:0,reward_points:0,current_level:1,badges:[],rewards:[]}};
    const question=(id,prompt,options)=>({question_id:id,status:'active',source_role:'core',question:{id,prompt,prompt_language:'ar',options:options.map((content,index)=>({position:index+1,content})),assets:[]}});
    const learningQuestions=[question('lq1','احسب: 19 - (-7)',['-26','26']),question('lq2','احسب: 2 + 2',['4','5'])];
    const examQuestions=[question('eq1','احسب: (-7) - 19',['-26','26']),question('eq2','احسب: 2 + 2',['4','5'])];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.addInitScript(time=>{window.__qaNow=time;Date.now=()=>window.__qaNow;localStorage.setItem('learner_session','mock-testing-timer-session');},base);
    await page.route('**/functions/v1/**',async route=>{
      const body=JSON.parse(route.request().postData()||'{}'),service=new URL(route.request().url()).pathname.split('/').pop();calls.push({service,...body});
      let output={ok:true};
      if(service==='family-api'&&body.action==='student_profile')output=profile;
      if(service==='student-library-api')output={programs:[],standalone_books:[]};
      if(service==='question-reference-api')output={codes:{}};
      if(service==='learning-api'){
        if(body.action==='start_quiz')output={attempt_id:'testing-learning-attempt',resumed:false,quiz:{slug:'testing-timers',title:'تدريب Testing'},queue:learningQuestions};
        if(body.action==='request_hint')output={hint_level:1,hint:{hint_level:1,content:'تذكّر أن طرح السالب يعني جمع الموجب.',language:'ar'}};
        if(body.action==='answer'){learningAnswers++;output=learningAnswers===1?{is_correct:false,finalized:false,hint_level:1,hint:{hint_level:1,content:'تذكّر أن طرح السالب يعني جمع الموجب.',language:'ar'}}:{is_correct:true,finalized:true,explanation:'19 - (-7) = 26'};}
      }
      if(service==='exam-v2-api'){
        if(body.action==='start_exam'){examStarts++;output={attempt_id:'testing-exam-attempt',started_at:examStarted,resumed:examStarts>1,quiz:{slug:'testing-timers',title:'امتحان Testing'},questions:examQuestions.map(row=>({...row,saved_response:saved.has(row.question_id)?{option_position:saved.get(row.question_id)}:null,is_flagged:false}))};}
        if(body.action==='save_answer'){
          if(holdFinalSave&&body.question_id==='eq2'){
            notifyFinalSave();
            await new Promise(resolve=>{releaseFinalSave=resolve;});
          }
          saved.set(body.question_id,body.option_position);
        }
        if(body.action==='submit_exam'&&holdSubmission){
          notifySubmission();
          await new Promise(resolve=>{releaseSubmission=resolve;});
        }
        if(body.action==='submit_exam')output={percentage:50,score_points:1,max_points:2,review:[{question_id:'eq1',is_correct:false,prompt:'احسب: (-7) - 19',prompt_language:'ar',response:{option_position:2},correct_answer:{option_position:1},explanation:'نطرح 19 من -7؛ لذلك نتحرك إلى -26.',hints:[]},{question_id:'eq2',is_correct:true,prompt:'احسب: 2 + 2',prompt_language:'ar',response:{option_position:1},correct_answer:{option_position:1},explanation:'2 + 2 = 4',hints:[]}]};
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(output)});
    });
    const advance=async milliseconds=>{now+=milliseconds;await page.evaluate(time=>window.__qaNow=time,now);};
    const expectTime=async(id,value)=>{await page.waitForFunction(({id,value})=>document.getElementById(id)?.textContent===value,{id,value});};
    const shot=async name=>{const file=`batch2-${name}-${viewport.width}.png`;await page.screenshot({path:`playwright-screenshots/${file}`,fullPage:true});files.push(file);};
    await page.goto(`${baseUrl}#student`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Boolean(window.FLH?.startLearningQuiz&&window.FLHElapsedTimer));
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.learnerProfile?.learner?.id==='testing-timer-learner');
    await page.evaluate(()=>window.FLH.startLearningQuiz('testing-timers'));
    await expectTime('flhLearningElapsed','00:00');
    await advance(5000);await expectTime('flhLearningElapsed','00:05');
    await page.locator('.flh-learn-answer').first().click();await expectTime('flhLearningElapsed','00:05');
    await page.locator('#flhHelp').click();await page.locator('.flh-hint-card').waitFor();await expectTime('flhLearningElapsed','00:05');
    await page.locator('#flhConfirmAnswer').click();await page.locator('.error').filter({hasText:'جرّب من جديد'}).waitFor();await expectTime('flhLearningElapsed','00:05');
    await page.locator('.flh-learn-answer').nth(1).click();await page.locator('#flhConfirmAnswer').click();await page.locator('#flhLearnNext').waitFor();
    await advance(3000);await expectTime('flhLearningElapsed','00:08');
    await page.locator('#flhLearnNext').click();await expectTime('flhLearningElapsed','00:00');
    await advance(2000);await expectTime('flhLearningElapsed','00:02');
    assert.equal(await page.locator('#flhLearningElapsed').getAttribute('aria-live'),'off');
    assert.equal(await page.locator('#flhLearningElapsed').getAttribute('dir'),'ltr');
    await shot('learning-timer');
    await page.locator('#flhLearnExit').click();await page.locator('#flhLearningElapsed').waitFor({state:'detached'});assert.equal(await page.locator('#flhLearningElapsed').count(),0);

    await page.evaluate(()=>window.FLH.startExamQuiz('testing-timers'));await expectTime('flhExamElapsed','02:10');
    assert.equal(await page.locator('.exam-review,.flh-review-why').count(),0,'Exam must not show correction before submission');
    assert.ok(!(await page.locator('body').innerText()).includes('نطرح 19 من -7؛ لذلك'));
    await page.locator('.exam-v3-answer').nth(1).click();await page.locator('#examNext').click();
    await advance(3000);await expectTime('flhExamElapsed','02:13');
    await page.locator('.exam-v3-answer').first().click();await page.locator('#examExit').click();
    await page.locator('#flhExamElapsed').waitFor({state:'detached'});
    assert.equal(await page.locator('#flhExamElapsed').count(),0);
    await page.evaluate(()=>window.FLH.startExamQuiz('testing-timers'));await expectTime('flhExamElapsed','02:13');
    assert.equal(await page.locator('.exam-v3-answer.selected').getAttribute('data-pos'),'1','Resume preserves the saved answer');
    await advance(2000);await expectTime('flhExamElapsed','02:15');
    await shot('exam-timer-resume');
    // Race regression: a slow last answer-save must not re-render the Exam
    // (or restart its timer) while the final submit is awaiting backend ACK.
    holdFinalSave=true;holdSubmission=true;
    await page.locator('.exam-v3-answer').nth(1).click();
    await finalSaveHeld;
    await page.locator('#examSubmit').click();
    await page.locator('.loading-card').filter({hasText:'لحظة'}).waitFor();
    // Arm only AFTER the submitting shell is visible: ordinary timer ticks
    // before clicking Submit are not evidence of a post-submit resurrection.
    await page.evaluate(()=>{
      window.__qaExamResurrected=false;
      window.__qaSubmittingObserver=new MutationObserver(()=>{
        if(document.querySelector('#flhExamElapsed,.exam-v3-answer'))window.__qaExamResurrected=true;
      });
      window.__qaSubmittingObserver.observe(document.body,{subtree:true,childList:true});
    });
    releaseFinalSave();
    await submissionHeld;
    assert.equal(await page.locator('#flhExamElapsed,.exam-v3-answer').count(),0,'Delayed answer-save may not restore the Exam/timer while submitting');
    assert.equal(await page.evaluate(()=>window.__qaExamResurrected),false,'Mutation trace catches transient Exam/timer resurrection');
    releaseSubmission();
    await page.locator('.flh-mistake-review').waitFor();
    await page.evaluate(()=>{window.__qaSubmittingObserver.disconnect();});
    const wrong=page.locator('.exam-review-wrong');assert.equal(await wrong.count(),1);
    assert.equal(await wrong.getAttribute('open'),'');
    assert.ok((await wrong.locator('.flh-review-response').innerText()).includes('26'));
    assert.ok((await wrong.locator('.flh-review-correct').innerText()).includes('-26'));
    await wrong.locator('.flh-review-why').waitFor({state:'visible'});
    assert.ok((await wrong.locator('.flh-review-why').innerText()).includes('نطرح 19 من -7؛ لذلك نتحرك إلى -26.'));
    const correctGroup=page.locator('.flh-correct-review');
    assert.equal(await correctGroup.getAttribute('open'),null);
    await correctGroup.locator('summary').first().click();
    const correctItem=correctGroup.locator('.exam-review').first();
    await correctItem.locator('summary').click();
    assert.match(await correctItem.locator('.flh-review-response').innerText(),/4/,'Even collapsed-by-default correct answers must reveal the learner-recorded answer');
    assert.equal(await correctItem.locator('.flh-review-correct').count(),0,'Correct rows should not show a mistake-only comparison');
    await correctGroup.locator('summary').first().click();
    assert.ok(await page.evaluate(()=>document.querySelector('.flh-mistake-review').getBoundingClientRect().top<document.querySelector('.stats').getBoundingClientRect().top),'Mistakes must appear before aggregate statistics');
    assert.equal(await page.locator('#flhExamElapsed').count(),0,'Submitted results must not keep an active Exam timer');
    assert.ok(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'Timer/review UI must not overflow');
    await shot('exam-mistakes');
    assert.equal(calls.filter(call=>call.action==='submit_exam').length,1);
    assert.ok(calls.filter(call=>['save_answer','answer','request_hint'].includes(call.action)).every(call=>!('duration_seconds' in call)),'Informational timers must not add duration writes');
    assert.deepEqual(errors,[]);
    console.log(`Learner timers/review browser QA passed at ${viewport.width}×${viewport.height}: question continuity, Exam resume, safe correction boundary and prominent grounded mistakes.`);
    await page.close();
  }
  fs.writeFileSync('playwright-screenshots/batch2-timers-review-manifest.json',JSON.stringify({head_sha:process.env.FLH_QA_HEAD_SHA||process.env.GITHUB_SHA||null,run_id:process.env.GITHUB_RUN_ID||null,source:'isolated synthetic Testing learner runtime',retention_days:7,files},null,2));
}finally{await browser.close();}
