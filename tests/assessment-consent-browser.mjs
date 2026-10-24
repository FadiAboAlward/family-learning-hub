// FLH-FEAT-2026-033 v1.3 / Drive revision 4. CI renders synthetic static artifacts only.
// No OAuth runtime server/listener, provider call, live grant or external egress.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { launchMockQaBrowser } from './qa-isolation.mjs';
import { consentFiles } from '../scripts/build-assessment-consent.mjs';
import { TESTING_ORIGIN,PRODUCTION_ORIGIN } from '../oauth/consent/consent.mjs';

assert.equal(process.env.GITHUB_ACTIONS,'true','Rendered synthetic consent regression runs in GitHub Actions');
const head=process.env.FLH_QA_HEAD_SHA;
assert.match(head||'',/^[0-9a-f]{40}$/);
const config={url:TESTING_ORIGIN,key:'sb_publishable_synthetic',clientId:'03320000-0000-4000-8000-000000000001',callback:'https://chatgpt.com/connector/oauth/syntheticCallback'};
const id='syntheticAuthorization0123456789',user='03320000-0000-4000-8000-000000000003';
const sdk=`window.supabase={createClient:(url,key,options)=>{
  window.__authOptions=options.auth;window.__projectUrl=url;window.__projectKey=key;const f=window.__fixture;
  const call=name=>window.__calls.push(name);
  const callback=f.callback||${JSON.stringify(config.callback)};
  const redirect=deny=>f.badRedirect?'https://unapproved.invalid/':callback+(deny?'?error=access_denied&state=synthetic':'?code=synthetic&state=synthetic');
  return {auth:{
    signInWithPassword:async()=>{call('login');return f.loginError?{error:{message:'synthetic'}}:{data:{}};},
    getUser:async()=>f.userError?{error:{message:'synthetic'}}:({data:{user:{id:${JSON.stringify(user)}}}}),
    signOut:async()=>{call('signOut');return {};},
    oauth:{getAuthorizationDetails:async()=>{
      call('details');return {data:f.priorGrant?{redirect_url:redirect(false)}:{authorization_id:${JSON.stringify(id)},client:{id:f.wrongClient?'invalid':f.clientId||${JSON.stringify(config.clientId)},name:'<img src=x onerror=alert(1)>'},user:{id:f.wrongUser?'invalid':${JSON.stringify(user)}},redirect_uri:callback,scope:f.scope??'openid email offline_access'}};
    },approveAuthorization:async()=>{call('approve');return {data:{redirect_url:redirect(false)}};},denyAuthorization:async()=>{call('deny');return {data:{redirect_url:redirect(true)}};}}
  },from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{role:f.role||'owner'}})})})})})};
}};`;
const files=await consentFiles(config,sdk,head);
const productionConfig={url:PRODUCTION_ORIGIN,key:'sb_publishable_synthetic_production',clientId:'03330000-0000-4000-8000-000000000001',callback:'https://chatgpt.com/connector/oauth/syntheticProductionCallback'};
const productionFiles=await consentFiles(productionConfig,sdk,head);
// Shared guard installs Production DNS/HTTP/WebSocket and service-worker isolation.
// All fixture HTTP requests below are fulfilled in memory; no local server starts.
const browser=await launchMockQaBrowser(chromium,'http://127.0.0.1:4173/');
const evidence=[],directory='playwright-screenshots/assessment-consent';fs.mkdirSync(directory,{recursive:true});
let cases=0;

async function fixture(viewport,state={},query='?authorization_id='+id,artifact=files) {
  const context=await browser.newContext({viewport});const blocked=[],errors=[];
  await context.addInitScript(value=>{window.__fixture=value;window.__calls=[];},state);
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin==='https://consent-testing.invalid') {
      let name=url.pathname.slice(1);if(name==='oauth/consent/')name+='index.html';
      const body=artifact.get(name);
      const type=name.endsWith('.mjs')||name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html';
      return route.fulfill({status:body?200:404,contentType:type,body:body?Buffer.from(body):'Not found',headers:{
        'cache-control':'no-store','referrer-policy':'no-referrer','x-frame-options':'DENY','x-content-type-options':'nosniff',
        'content-security-policy':artifact.get('_headers').split('Content-Security-Policy: ')[1].trim()
      }});
    }
    if(url.origin==='https://chatgpt.com'&&[new URL(config.callback).pathname,new URL(productionConfig.callback).pathname].includes(url.pathname))return route.fulfill({contentType:'text/html',body:'<title>Synthetic callback</title>'});
    blocked.push(url.origin);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://consent-testing.invalid/oauth/consent/'+query);
  cases++;
  return {context,page,async close(){assert.deepEqual(blocked,[],'No external request may escape fixture');assert.deepEqual(errors,[],'Consent must have no runtime page errors');await context.close();}};
}
async function login(page) {
  await page.locator('#login').waitFor({state:'visible'});
  await page.locator('#email').fill('parent@example.invalid');await page.locator('#password').fill('synthetic-private-input');
  await page.locator('#login button').click();
}
async function shot(page,name) {
  const path=directory+'/'+name+'.png';await page.screenshot({path,fullPage:true});
  evidence.push({name,path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')});
}
try {
  for(const viewport of [{width:390,height:844},{width:1366,height:900}]) {
    let f=await fixture(viewport);await login(f.page);await f.page.locator('#consent').waitFor({state:'visible'});
    assert.equal(await f.page.locator('html').getAttribute('dir'),'rtl');
    assert.equal(await f.page.locator('#callback').evaluate(e=>getComputedStyle(e).direction),'ltr');
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No mobile/desktop overflow');
    assert.equal(await f.page.locator('#client-name img').count(),0,'Client name is text, not markup');
    assert.equal(await f.page.locator('#scopes').innerText(),'openid email offline_access','Display the exact requested scopes');
    assert.equal(await f.page.locator('#password').inputValue(),'');
    assert.match(await f.page.locator('#environment').innerText(),/بيئة التجارب/);
    assert.equal(await f.page.evaluate(()=>window.__projectKey),config.key);
    assert.deepEqual(await f.page.evaluate(()=>window.__authOptions),{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
    await shot(f.page,'consent-'+viewport.width);
    await f.page.locator('#approve').click();await f.page.waitForURL(config.callback+'?code=synthetic&state=synthetic');await f.close();

    f=await fixture(viewport,{role:'admin'});await login(f.page);await f.page.locator('#deny').click();
    await f.page.waitForURL(config.callback+'?error=access_denied&state=synthetic');await f.close();

    f=await fixture(viewport,{scope:'offline_access openid email'});await login(f.page);
    await f.page.locator('#consent').waitFor({state:'visible'});
    assert.equal(await f.page.locator('#scopes').innerText(),'offline_access openid email');
    await f.page.locator('#deny').click();await f.page.waitForURL(config.callback+'?error=access_denied&state=synthetic');await f.close();

    for(const state of [{role:'teacher'},{role:'viewer'},{wrongClient:true},{wrongUser:true},{scope:'openid email offline_access profile'},{scope:'openid email'},{scope:'openid email email'},{loginError:true},{userError:true}]) {
      f=await fixture(viewport,state);await login(f.page);await f.page.locator('#message').filter({hasText:'تعذر متابعة الربط.'}).waitFor();
      assert.equal(await f.page.locator('#consent').isVisible(),false);
      assert.ok((await f.page.evaluate(()=>window.__calls)).includes('signOut'));
      assert.ok(!(await f.page.evaluate(()=>window.__calls)).includes('approve'));await f.close();
    }
    for(const query of ['', '?authorization_id=invalid',`?authorization_id=${id}&authorization_id=${id}`]) {
      f=await fixture(viewport,{},query);await f.page.locator('#message').filter({hasText:'تعذر متابعة الربط.'}).waitFor();
      assert.equal(await f.page.locator('#login').isVisible(),false);await f.close();
    }
    f=await fixture(viewport,{badRedirect:true});await login(f.page);await f.page.locator('#approve').click();
    await f.page.locator('#message').filter({hasText:'تعذر متابعة الربط.'}).waitFor();
    assert.ok((await f.page.evaluate(()=>window.__calls)).includes('signOut'),'Failed decision clears memory-only session');
    assert.equal(await f.page.locator('#consent').isVisible(),false);await f.close();

    f=await fixture(viewport,{priorGrant:true});await login(f.page);await f.page.locator('#deny').click();
    await f.page.waitForURL('https://consent-testing.invalid/oauth/consent/');assert.equal(await f.page.locator('#consent').isVisible(),false);await f.close();
    f=await fixture(viewport,{priorGrant:true});await login(f.page);await f.page.locator('#approve').click();
    await f.page.waitForURL(config.callback+'?code=synthetic&state=synthetic');await f.close();
    f=await fixture(viewport,{priorGrant:true,badRedirect:true});await login(f.page);
    await f.page.locator('#message').filter({hasText:'تعذر متابعة الربط.'}).waitFor();
    assert.equal(await f.page.locator('#consent').isVisible(),false);
    assert.ok((await f.page.evaluate(()=>window.__calls)).includes('signOut'));await f.close();

    // Same hosted page with an independently configured client; all traffic stays mocked.
    f=await fixture(viewport,{clientId:productionConfig.clientId,callback:productionConfig.callback},'?authorization_id='+id,productionFiles);await login(f.page);
    await f.page.locator('#consent').waitFor({state:'visible'});
    assert.match(await f.page.locator('#environment').innerText(),/البيئة الفعلية/);
    assert.ok(!(await f.page.locator('#environment').innerText()).includes('بيئة التجارب'));
    assert.equal(await f.page.evaluate(()=>window.__projectUrl),PRODUCTION_ORIGIN);
    assert.equal(await f.page.evaluate(()=>window.__projectKey),productionConfig.key);
    assert.equal(await f.page.locator('#callback').innerText(),productionConfig.callback);
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await shot(f.page,'consent-production-'+viewport.width);
    await f.page.locator('#approve').click();await f.page.waitForURL(productionConfig.callback+'?code=synthetic&state=synthetic');await f.close();
    f=await fixture(viewport,{clientId:productionConfig.clientId,callback:productionConfig.callback},'?authorization_id='+id,productionFiles);await login(f.page);
    await f.page.locator('#deny').click();await f.page.waitForURL(productionConfig.callback+'?error=access_denied&state=synthetic');await f.close();
  }
  fs.writeFileSync(directory+'/manifest.json',JSON.stringify({head,mode:'synthetic-static-browser',cases,evidence,actualOAuth:'NOT RUN'},null,2));
  console.log(`PASS: ${cases} rendered static consent cases; RTL/mobile/authorization/approve/deny/session cleanup; no runtime server or external egress`);
} finally { await browser.close(); }
