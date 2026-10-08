import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import * as qaLogic from '../supabase/functions/qa-auth/logic.mjs';
import { requireIsolatedQaBackend } from '../supabase/functions/_shared/qa-backend-isolation.mjs';
import { fetchQaBackend, fetchQaOidc, isolatedQaSource, launchMockQaBrowser, readQaTestingConfig, verifyQaTestingBackend } from './qa-isolation.mjs';
import { verifyQaProductionDnsDenied } from './qa-ci-network.mjs';

const ref='abcdefghijklmnopqrst';
const valid={FLH_QA_ISOLATION_MODE:'isolated-testing',FLH_QA_BACKEND_URL:`https://${ref}.supabase.co`,FLH_QA_PROJECT_REF:ref,FLH_QA_PUBLISHABLE_KEY:'sb_publishable_synthetic_qa'};
const config=readQaTestingConfig(valid);
assert.equal(config.backendUrl,valid.FLH_QA_BACKEND_URL);
assert.equal(readQaTestingConfig({...valid,FLH_QA_ISOLATION_MODE:'runner-local',FLH_QA_BACKEND_URL:'http://127.0.0.1:54321',FLH_QA_PROJECT_REF:'local'}).projectRef,'local');
let requests=0;
const tripwire=async()=>{requests++;throw new Error('NETWORK_MUST_NOT_RUN');};
for(const env of [
  {}, {...valid,FLH_QA_ISOLATION_MODE:undefined}, {...valid,FLH_QA_BACKEND_URL:undefined}, {...valid,FLH_QA_PROJECT_REF:undefined},
  {...valid,FLH_QA_BACKEND_URL:'https://gkpoylfozvuwuwqeoduc.supabase.co'},
  {...valid,FLH_QA_PROJECT_REF:'gkpoylfozvuwuwqeoduc'},
  {...valid,FLH_QA_BACKEND_URL:'https://db.gkpoylfozvuwuwqeoduc.supabase.co'},
  {...valid,FLH_QA_BACKEND_URL:'https://gkpoylfozvuwuwqeoduc.supabase.co.'},
  {...valid,FLH_QA_BACKEND_URL:`https://user:password@${ref}.supabase.co`},
  {...valid,FLH_QA_BACKEND_URL:`https://${ref}.supabase.co?route=production`},
  {...valid,FLH_QA_BACKEND_URL:`https://${ref}.supabase.co/functions/v1`},
  {...valid,FLH_QA_BACKEND_URL:'https://differenttestingrefa.supabase.co'},
  {...valid,FLH_QA_BACKEND_URL:'https://independent-custom-domain.invalid'},
  {...valid,FLH_QA_PUBLISHABLE_KEY:'sb_secret_not_a_browser_key'},
  {...valid,APP_URL:'https://fadiaboalward.github.io/family-learning-hub/'},
]) {
  assert.throws(()=>readQaTestingConfig(env),/QA_/,'unsafe or incomplete configuration fails before creating a request');
}
assert.equal(requests,0);
const production={mode:'isolated-testing',backendUrl:'https://gkpoylfozvuwuwqeoduc.supabase.co',projectRef:ref};
await assert.rejects(()=>fetchQaBackend(production,'qa-auth',{},tripwire),/QA_PRODUCTION_FORBIDDEN/);
await assert.rejects(()=>fetchQaOidc(production,'https://pipelines.actions.githubusercontent.com/token','synthetic',tripwire),/QA_PRODUCTION_FORBIDDEN/);
await assert.rejects(()=>fetchQaOidc(config,'https://gkpoylfozvuwuwqeoduc.supabase.co','synthetic',tripwire),/QA_OIDC_URL_INVALID/);
assert.equal(requests,0,'Production/mismatched requests cannot reach backend or OIDC transport');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'flh-qa-isolation-'));
assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
try{
  const counter=path.join(temp,'network-called'),hook=path.join(temp,'tripwire.mjs');
  fs.writeFileSync(hook,`import fs from 'node:fs';globalThis.fetch=async()=>{fs.writeFileSync(${JSON.stringify(counter)},'called');throw new Error('NETWORK_MUST_NOT_RUN');};`);
  for(const file of ['authenticated-e2e.mjs','real-backend-performance.mjs'])for(const env of [{},{...valid,FLH_QA_BACKEND_URL:production.backendUrl},{...valid,FLH_QA_PROJECT_REF:'wrong'}]){
    const result=spawnSync(process.execPath,['--import',pathToFileURL(hook).href,path.resolve('tests',file)],{cwd:temp,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,...env},encoding:'utf8'});
    assert.equal(result.status,1,`${file}: isolation failure must be a failing process, never skipped PASS`);
    assert.match(result.stderr,/QA_/);assert.equal(fs.existsSync(counter),false,`${file}: actual entrypoint sends zero backend/OIDC/lease requests`);
  }
}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));fs.rmSync(temp,{recursive:true});}
let lastRequest;
const fakeFetch=async(url,options)=>{lastRequest={url,options};return new Response(JSON.stringify({ok:true,isolation:{mode:config.mode,project_ref:ref,backend_origin:config.backendUrl}}));};
await verifyQaTestingBackend(config,fakeFetch);
assert.equal(lastRequest.url,`${config.backendUrl}/functions/v1/qa-auth`);
assert.deepEqual(JSON.parse(lastRequest.options.body),{action:'isolation_status'},'first backend operation is read-only, with no OIDC token or prepare action');
assert.equal(lastRequest.options.redirect,'error');
await assert.rejects(()=>verifyQaTestingBackend(config,async()=>new Response(JSON.stringify({ok:true,isolation:{mode:config.mode,project_ref:'gkpoylfozvuwuwqeoduc',backend_origin:config.backendUrl}}))),/ATTESTATION_FAILED/);
await fetchQaBackend(config,'learning-api',{redirect:'follow'},fakeFetch);
assert.equal(lastRequest.options.redirect,'error','callers cannot enable automatic redirect to Production');
await fetchQaOidc(config,'https://pipelines.actions.githubusercontent.com/token?existing=1','synthetic',fakeFetch);
assert.equal(lastRequest.options.redirect,'error');
assert.equal(new URL(lastRequest.url).searchParams.get('audience'),'family-learning-hub-qa');

let launches=0;
await assert.rejects(()=>launchMockQaBrowser({launch:async()=>{launches++;}},'https://fadiaboalward.github.io/family-learning-hub/'),/QA_/);
assert.equal(launches,0,'unsafe mock app/mode fails before opening a browser');
const oldMode=process.env.FLH_QA_ISOLATION_MODE,contextOptions=[];
try{
  process.env.FLH_QA_ISOLATION_MODE='mock-local';
  const context=()=>({route:async()=>{}});
  const fakeBrowser={newContext:async options=>{contextOptions.push(options);return context();},newPage:async options=>{contextOptions.push(options);const owner=context();return{context:()=>owner};},close:async()=>{}};
  const guarded=await launchMockQaBrowser({launch:async()=>fakeBrowser},'http://127.0.0.1:4173/');
  await guarded.newContext({serviceWorkers:'allow'});await guarded.newPage({serviceWorkers:'allow'});await guarded.close();
  assert.ok(contextOptions.every(options=>options.serviceWorkers==='block'),'every new context and implicit page blocks service worker escapes');
}finally{if(oldMode===undefined)delete process.env.FLH_QA_ISOLATION_MODE;else process.env.FLH_QA_ISOLATION_MODE=oldMode;}
const overlay=isolatedQaSource(`<link rel="preconnect" href="https://gkpoylfozvuwuwqeoduc.supabase.co"><link rel='dns-prefetch' href='//gkpoylfozvuwuwqeoduc.supabase.co'><script>const U='https://gkpoylfozvuwuwqeoduc.supabase.co/functions/v1/family-api',K='sb_publishable_old_fixture';</script>`,config);
assert.doesNotMatch(overlay,/gkpoylfozvuwuwqeoduc|preconnect|dns-prefetch|sb_publishable_old_fixture/);
assert.ok(overlay.includes(`${config.backendUrl}/functions/v1/family-api`)&&overlay.includes(config.publishableKey),'browser frontend receives the same explicitly configured backend and key');
await verifyQaProductionDnsDenied(async()=>[{address:'127.0.0.1'},{address:'::1'}],{FLH_QA_DNS_DENY_EXPECTED:'1'});
await assert.rejects(()=>verifyQaProductionDnsDenied(tripwire,{}),/CONFIG_REQUIRED/);
await assert.rejects(()=>verifyQaProductionDnsDenied(async()=>[{address:'203.0.113.1'}],{FLH_QA_DNS_DENY_EXPECTED:'1'}),/DNS_NOT_DENIED/);
assert.equal(requests,0,'missing DNS-deny configuration sends zero lookup/network requests');

// Execute the actual TypeScript server startup/attestation with transport/client tripwires.
const source=fs.readFileSync('supabase/functions/qa-auth/index.ts','utf8').replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'');
const server=stripTypeScriptTypes(source,{mode:'strip'});
function serverContext(env) {
  const counts={clients:0,oidc:0,fetch:0};let handler;
  const sandbox={...qaLogic,requireIsolatedQaBackend,URL,Response,Request,TextEncoder,atob,btoa,crypto:globalThis.crypto,
    console:{log(){}},Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},
    createClient(){counts.clients++;throw new Error('DB_CLIENT_MUST_NOT_RUN');},createRemoteJWKSet:()=>null,
    jwtVerify:async()=>{counts.oidc++;throw new Error('OIDC_MUST_NOT_RUN');},fetch:async()=>{counts.fetch++;throw new Error('FETCH_MUST_NOT_RUN');}};
  return {counts,start:()=>vm.runInNewContext(server,sandbox),request:body=>handler(new Request('http://127.0.0.1:54321/functions/v1/qa-auth',{method:'POST',body:JSON.stringify(body)}))};
}
for(const env of [{},{SUPABASE_URL:production.backendUrl,FLH_QA_ISOLATION_MODE:'isolated-testing',FLH_QA_PROJECT_REF:'gkpoylfozvuwuwqeoduc'}]){
  const test=serverContext(env);assert.throws(test.start,/QA_/);assert.deepEqual(test.counts,{clients:0,oidc:0,fetch:0},'server rejects unsafe config before client/DB/OIDC construction');
}
const localServer=serverContext({SUPABASE_URL:'http://kong:8000',FLH_QA_BACKEND_URL:'http://127.0.0.1:54321',FLH_QA_ISOLATION_MODE:'runner-local',FLH_QA_PROJECT_REF:'local'});
localServer.start();
const attestation=await (await localServer.request({action:'isolation_status'})).json();
assert.deepEqual(attestation,{ok:true,isolation:{mode:'runner-local',project_ref:'local',backend_origin:'http://127.0.0.1:54321'}});
assert.deepEqual(localServer.counts,{clients:0,oidc:0,fetch:0},'read-only attestation creates no DB client or lease and requests no OIDC/JWKS');
assert.equal((await localServer.request({action:'prepare'})).status,401);
assert.equal(localServer.counts.clients,0,'unauthenticated preparation remains closed before database use');

const workflow=fs.readFileSync('.github/workflows/qa-isolated.yml','utf8').replace(/\r\n/g,'\n');
assert.equal(fs.existsSync('.github/workflows/qa-smoke.yml'),false,'disabled legacy workflow is retired from candidate sources');
assert.doesNotMatch(workflow,/pull_request_target|pages:\s*write|id-token:\s*write|continue-on-error|authenticated-e2e\.mjs|real-backend-performance\.mjs|supabase[^\n]+(?:db push|--linked|--db-url|functions deploy)/);
assert.match(workflow,/FLH_QA_ISOLATION_MODE: mock-local/);
for(const name of ['static-quality','browser-smoke']){
  const job=workflow.split(`  ${name}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/)[0];assert.ok(job);
  assert.doesNotMatch(job,/^    if:/m);
  const deny=job.indexOf('name: Deny Production backend traffic'),verify=job.indexOf('run: node tests/qa-ci-network.mjs');
  assert.ok(deny>=0&&verify>deny,'DNS deny is installed and verified before test execution');
  assert.ok(verify<job.indexOf(name==='static-quality'?'name: JavaScript and TypeScript syntax checks':'name: Install browser QA tools'));
  assert.match(job,/127\.0\.0\.1 gkpoylfozvuwuwqeoduc\.supabase\.co/);assert.match(job,/::1 gkpoylfozvuwuwqeoduc\.supabase\.co/);
}
for(const file of [...workflow.matchAll(/run: node (tests\/[^\s]+\.mjs)/g)].map(match=>match[1])){
  const text=fs.readFileSync(file,'utf8');
  if(/from ['"]playwright['"]|import\(['"]playwright['"]\)/.test(text))assert.ok(text.includes('launchMockQaBrowser'),'every automatic browser entrypoint uses guarded launch before navigation: '+file);
}
for(const required of ['db start','db reset --local --no-seed','tests/fresh-database-rebuild.sql','tests/auth-session-privacy.contract.sql','tests/workspace-relational-integrity.contract.sql','tests/family-rewards.contract.sql','tests/family-rewards.concurrency.mjs','tests/learning-answer-rpc.concurrency.mjs','tests/exam-save-submit-race.concurrency.mjs','db lint --local'])assert.ok(workflow.includes(required),'existing Runner-local deterministic layer retained: '+required);
console.log('QA isolation config, zero-transport denials, server attestation/client boundary, frontend overlay, DNS and automatic-workflow regressions passed; no hosted QA/DB executed.');
