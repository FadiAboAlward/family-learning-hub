import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {installQaBrowserIsolation,qaBrowserLaunchOptions,readQaTestingConfig} from './qa-isolation.mjs';

/** Actual app, learner bearer, Edge APIs and private Storage on the owned Runner. */
export async function visualAuthenticatedBrowser(runtime,appUrl,bearer,candidateHash){
 const config=readQaTestingConfig({FLH_QA_ISOLATION_MODE:runtime.mode,FLH_QA_BACKEND_URL:runtime.backendUrl,FLH_QA_PROJECT_REF:runtime.projectRef,FLH_QA_PUBLISHABLE_KEY:runtime.publishableKey,APP_URL:appUrl});
 const {chromium}=await import('playwright'),browser=await chromium.launch(qaBrowserLaunchOptions()),files=[];
 try{
  for(const [device,viewport]of [['mobile',{width:390,height:844}],['desktop',{width:1365,height:900}]]){
   const context=await browser.newContext({viewport,isMobile:device==='mobile',hasTouch:device==='mobile',serviceWorkers:'block'});
   try{
    const guard=await installQaBrowserIsolation(context,config);
    // Local Edge uses Kong's container origin. Only translate that transport
    // origin; API payloads/authorization and private image bytes are unmocked.
    await context.route(config.backendUrl+'/functions/v1/**',async route=>{
     const response=await route.fetch({maxRedirects:0});assert.ok(response.status()<300||response.status()>=400,'No backend redirects');
     const headers={...response.headers()};delete headers['content-length'];delete headers['content-encoding'];
     const body=(await response.text()).replaceAll('http://kong:8000/storage/v1/',config.backendUrl+'/storage/v1/');
     await route.fulfill({response,headers,body});
    });
    await context.addInitScript(value=>localStorage.setItem('learner_session',value),bearer);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.name));
    await page.goto(appUrl+'#student',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.FLH?.startLearningQuiz==='function');
    for(const [mode,entry,selector]of [['learning','startLearningQuiz','.flh-learn-answer'],['exam','startExamQuiz','.exam-v3-answer']]){
     await page.evaluate(fn=>window.FLH[fn]('qa-visual-api'),entry);
     await page.waitForFunction(()=>document.querySelector('.flh-visual-enlarge')?.disabled===false);
     assert.equal(await page.locator(selector+':enabled').count(),4,'Authorized actual runtime shows answer controls after the required bytes load');
     assert.equal(await page.locator('.flh-visual-asset img').count(),1);
     assert.equal(await page.locator('.flh-visual-asset img').evaluate(img=>img.naturalWidth>0),true);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
     if(mode==='exam')assert.equal(await page.locator('#flhHelp').count(),0);
     const file='flh-044-auth-'+device+'-'+mode+'.png',path='qa-authenticated-evidence/'+file;
     await fs.mkdir('qa-authenticated-evidence',{recursive:true});await page.screenshot({path,fullPage:true});files.push({file,sha256:createHash('sha256').update(await fs.readFile(path)).digest('hex')});
    }
    assert.deepEqual(errors,[]);guard.assertNoUnexpectedRequests();
   }finally{await context.close();}
  }
  await fs.writeFile('qa-authenticated-evidence/flh-044-auth-manifest.json',JSON.stringify({feature_id:'FLH-FEAT-2026-044',spec_version:'1.1',drive_revision_id:'4',head_sha:process.env.FLH_QA_HEAD_SHA,run_id:process.env.GITHUB_RUN_ID,candidate_sha256:candidateHash,retention_days:7,source:'Actual disposable Auth/Edge/Storage and app; synthetic provider record, not independent academic/provider approval',files},null,2));
  console.log('Authenticated visual40 fixture: actual Learning and Exam, private bytes, mobile/desktop, keyboard-ready controls and no overflow PASS (synthetic provider; no academic approval)');
 }finally{await browser.close();}
}
