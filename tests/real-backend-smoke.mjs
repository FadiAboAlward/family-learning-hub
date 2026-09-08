import { chromium } from 'playwright';

const APP_URL=process.env.APP_URL||'http://localhost:4173/';
const QA_SESSION_API='https://gkpoylfozvuwuwqeoduc.supabase.co/functions/v1/qa-session-api';
const QA_AUDIENCE='family-learning-hub-qa';

async function getGithubOidcToken(){
  const requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'';
  const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN||'';
  if(!requestUrl||!requestToken)throw new Error('GitHub OIDC environment is unavailable');
  const url=new URL(requestUrl);
  url.searchParams.set('audience',QA_AUDIENCE);
  const response=await fetch(url,{headers:{authorization:`Bearer ${requestToken}`}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.value)throw new Error(`GitHub OIDC request failed (${response.status})`);
  return body.value;
}

async function qaCall(action,oidc){
  const response=await fetch(QA_SESSION_API,{
    method:'POST',
    headers:{'content-type':'application/json',authorization:`Bearer ${oidc}`},
    body:JSON.stringify({action}),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`QA session API ${action} failed (${response.status}): ${body.error||'unknown'}`);
  return body;
}

function actionFromResponse(response){
  try{return JSON.parse(response.request().postData()||'{}')?.action||'';}catch{return '';}
}

function waitForAction(page,urlPart,action,timeout=15000){
  return page.waitForResponse(response=>response.url().includes(urlPart)&&actionFromResponse(response)===action,{timeout});
}

const oidc=await getGithubOidcToken();
const prepared=await qaCall('prepare',oidc);
if(prepared?.learner?.display_name!=='Testing'||prepared?.learner?.slug!=='test'||prepared?.learner?.is_test!==true){
  throw new Error('qa-session-api did not return the canonical isolated Testing learner');
}
if(!prepared.session||!prepared.quiz_slug)throw new Error('qa-session-api did not return a Testing session and QA quiz');

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const errors=[];
const badBackend=[];
page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});
page.on('response',response=>{
  if(!response.url().includes('/functions/v1/'))return;
  if(response.status()>=400)badBackend.push(`${response.status()} ${response.url().split('/functions/v1/')[1]} action=${actionFromResponse(response)||'-'}`);
});

try{
  await page.addInitScript(session=>localStorage.setItem('learner_session',session),prepared.session);
  await page.goto(`${APP_URL}?realqa=${Date.now()}#student`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByText('Testing',{exact:true}).first().waitFor({state:'visible',timeout:15000});
  await page.locator('[data-dynamic-test-banner]').waitFor({state:'visible',timeout:10000});

  const learnStart=waitForAction(page,'/learning-api','start_quiz');
  await page.evaluate(slug=>window.FLH.startLearningQuiz(slug),prepared.quiz_slug);
  const learnStartResponse=await learnStart;
  if(!learnStartResponse.ok())throw new Error(`Learning start failed (${learnStartResponse.status()})`);
  await page.locator('.flh-learn-answer').first().waitFor({state:'visible',timeout:10000});

  const draftSave=waitForAction(page,'/learning-api','save_draft');
  await page.locator('.flh-learn-answer').first().click();
  const draftResponse=await draftSave;
  if(!draftResponse.ok())throw new Error(`Learning draft save failed (${draftResponse.status()})`);
  await page.locator('#flhConfirmAnswer:not([disabled])').waitFor({state:'visible',timeout:5000});

  const answerSave=waitForAction(page,'/learning-api','answer');
  await page.locator('#flhConfirmAnswer').click();
  const answerResponse=await answerSave;
  if(!answerResponse.ok())throw new Error(`Learning answer failed (${answerResponse.status()})`);

  const examStart=waitForAction(page,'/exam-v2-api','start_exam');
  await page.evaluate(slug=>window.FLH.startExamQuiz(slug),prepared.quiz_slug);
  const examStartResponse=await examStart;
  if(!examStartResponse.ok())throw new Error(`Exam start failed (${examStartResponse.status()})`);
  await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:10000});

  const statusText=await page.locator('.exam-status .topline b').innerText();
  const match=statusText.match(/من\s+(\d+)/);
  const questionCount=Number(match?.[1]||0);
  if(!Number.isInteger(questionCount)||questionCount<2||questionCount>20)throw new Error(`Unexpected QA exam question count: ${questionCount}`);

  for(let i=0;i<questionCount;i++){
    await page.locator('.exam-v3-answer').first().waitFor({state:'visible',timeout:5000});
    const saveAnswer=waitForAction(page,'/exam-v2-api','save_answer');
    await page.locator('.exam-v3-answer').first().click();
    const saveResponse=await saveAnswer;
    if(!saveResponse.ok())throw new Error(`Exam answer ${i+1} failed (${saveResponse.status()})`);
    if(i<questionCount-1){
      await page.locator('#examNext').click();
      await page.locator('.exam-status .topline b').filter({hasText:`السؤال ${i+2} من ${questionCount}`}).waitFor({state:'visible',timeout:5000});
    }
  }

  await page.locator('#examSubmit:not([disabled])').waitFor({state:'visible',timeout:10000});
  const submitExam=waitForAction(page,'/exam-v2-api','submit_exam',20000);
  await page.locator('#examSubmit').click();
  const submitResponse=await submitExam;
  if(!submitResponse.ok())throw new Error(`Exam submit failed (${submitResponse.status()})`);
  await page.getByText('مراجعة',{exact:false}).first().waitFor({state:'visible',timeout:10000});

  if(badBackend.length)throw new Error(`Backend errors: ${badBackend.join('; ')}`);
  if(errors.length)throw new Error(errors.join('; '));
  console.log(`Real backend smoke passed for Testing: Learning start/draft/answer and Exam start/${questionCount} saves/submit.`);
} finally {
  await browser.close().catch(()=>{});
  await qaCall('cleanup',oidc).catch(error=>{throw error;});
}
