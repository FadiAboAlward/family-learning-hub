import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { launchMockQaBrowser, PRODUCTION_HOSTS } from './qa-isolation.mjs';

const appUrl=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await launchMockQaBrowser(chromium,appUrl);
try{
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.route('**/functions/v1/family-api',route=>route.fulfill({status:200,contentType:'application/json',body:'{"learners":[]}'}));
  await page.goto(appUrl,{waitUntil:'networkidle'});
  assert.equal(await page.locator('link[rel="preconnect"],link[rel="dns-prefetch"]').count(),0,'test-served HTML never emits Production connection hints');
  const origin=await page.evaluate(()=>new URL(FAMILY_API).origin);
  assert.equal(origin,'http://qa-backend.invalid','actual application API configuration uses the synthetic backend');
  await context.close();
}finally{await browser.close();}

// Dedicated negative context: deliberately attempted escapes are intercepted, not sent.
// Its expected error is kept separate from every ordinary test's zero-egress assertion.
const { installQaBrowserIsolation, qaBrowserLaunchOptions, readMockQaConfig }=await import('./qa-isolation.mjs');
const negativeConfig=readMockQaConfig(appUrl);
const negative=await chromium.launch(qaBrowserLaunchOptions());
try{
  const context=await negative.newContext({serviceWorkers:'block'});
  const guard=await installQaBrowserIsolation(context,negativeConfig);
  const page=await context.newPage();
  const denied=await page.evaluate(async host=>{try{await fetch(`https://${host}/functions/v1/qa-auth`,{method:'POST',body:'{"action":"prepare"}'});return false;}catch{return true;}},PRODUCTION_HOSTS[0]);
  assert.equal(denied,true);
  assert.deepEqual(guard.unexpected,[`https://${PRODUCTION_HOSTS[0]}`]);
  assert.throws(()=>guard.assertNoUnexpectedRequests(),/QA_UNEXPECTED_NETWORK/,'unmocked requests fail the harness instead of becoming a hidden PASS');
  const redirects=createServer((request,response)=>{response.writeHead(302,{location:`https://${PRODUCTION_HOSTS[0]}/functions/v1/qa-auth`});response.end();});
  await new Promise(resolve=>redirects.listen(0,'127.0.0.1',resolve));
  try{
    const redirectUrl=`http://127.0.0.1:${redirects.address().port}/escape.png`;
    const redirectContext=await negative.newContext({serviceWorkers:'block'});
    const redirectGuard=await installQaBrowserIsolation(redirectContext,readMockQaConfig(redirectUrl));
    const redirectPage=await redirectContext.newPage();let productionRequests=0;
    redirectPage.on('request',request=>{if(PRODUCTION_HOSTS.includes(new URL(request.url()).hostname))productionRequests++;});
    const outcome=await redirectPage.evaluate(url=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve('loaded');image.onerror=()=>resolve('blocked');image.src=url;}),redirectUrl);
    assert.equal(outcome,'blocked');assert.equal(productionRequests,0,'local image redirect is refused before even creating a Production continuation');
    assert.deepEqual(redirectGuard.unexpected,['QA_REDIRECT_FORBIDDEN']);
    await redirectContext.close();
  }finally{await new Promise(resolve=>redirects.close(resolve));}
}finally{await negative.close();}
console.log('Isolated real-browser overlay, blocked service workers/connection hints and fail-closed Production request regression passed; all backend data synthetic.');
