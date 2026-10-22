import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { consentConfiguration,authorizationId,consentDetails,consentRedirect,TESTING_ORIGIN } from '../oauth/consent/consent.mjs';
import { consentFiles,buildConsentSite,SDK_SHA384 } from '../scripts/build-assessment-consent.mjs';

const config={url:TESTING_ORIGIN,key:'sb_publishable_synthetic',clientId:'03320000-0000-4000-8000-000000000001',callback:'https://chatgpt.com/connector/oauth/syntheticCallback'};
// Supabase exposes a 32-character opaque authorization ID, not its internal row UUID.
const id='syntheticAuthorization0123456789',user='03320000-0000-4000-8000-000000000003';
assert.equal(consentConfiguration(config),config);
for(const url of ['https://gkpoylfozvuwuwqeoduc.supabase.co','https://yxjkjqmstcsczfkxytxc.supabase.co','https://example.com',TESTING_ORIGIN+'/']) assert.throws(()=>consentConfiguration({...config,url}));
for(const key of ['service_role','sb_secret_synthetic','eyJhbGciOiJIUzI1NiJ9.synthetic']) assert.throws(()=>consentConfiguration({...config,key}));
for(const callback of ['https://evil.example/connector/oauth/test','javascript:alert(1)',config.callback+'?extra=1',config.callback+'#fragment','https://chatgpt.com:444/connector/oauth/test']) assert.throws(()=>consentConfiguration({...config,callback}));
assert.equal(authorizationId('?authorization_id='+id),id);
for(const value of ['', 'bad',id.slice(1),id+'A',id.slice(0,-1)+'-',id.slice(0,-1)+' ',id.slice(0,-1)+'é',user]) assert.throws(()=>authorizationId('?authorization_id='+encodeURIComponent(value)));
for(const query of ['',`?authorization_id=${id}&authorization_id=${id}`,`?authorization_id=${id}&authorization_id=bad`]) assert.throws(()=>authorizationId(query));
const details={authorization_id:id,client:{id:config.clientId,name:'<img src=x onerror=alert(1)>'},user:{id:user},redirect_uri:config.callback,scope:'openid email offline_access'};
assert.equal(consentDetails(details,id,user,config).name,details.client.name); // UI uses textContent, never HTML.
assert.equal(consentDetails({...details,scope:'offline_access openid email'},id,user,config).scope,'offline_access openid email');
for(const change of [{authorization_id:user},{client:{id:user}},{user:{id:id}},{redirect_uri:config.callback+'/other'},{scope:'openid email'}]) assert.throws(()=>consentDetails({...details,...change},id,user,config));
for(const scope of [undefined,null,[], '','openid','email offline_access','openid email email','openid email offline_access profile','openid email offline_access offline_access',' openid email offline_access','openid  email offline_access']) assert.throws(()=>consentDetails({...details,scope},id,user,config),/AUTHORIZATION_MISMATCH/);
assert.equal(consentRedirect(config.callback+'?code=synthetic&state=synthetic',config),config.callback+'?code=synthetic&state=synthetic');
for(const value of ['https://evil.example/?code=synthetic',config.callback+'/extra?code=synthetic',config.callback+'#code=synthetic','https://user@chatgpt.com/connector/oauth/syntheticCallback']) assert.throws(()=>consentRedirect(value,config));

const head='a'.repeat(40),files=await consentFiles({...config,unpublishedSecret:'must not enter artifact'},'/* synthetic SDK fixture */',head);
assert.deepEqual([...files.keys()],['oauth/consent/index.html','oauth/consent/consent.mjs','oauth/consent/config.json','oauth/consent/supabase.js','404.html','_headers','build.json']);
assert.deepEqual(JSON.parse(files.get('oauth/consent/config.json')),config);
assert.ok(![...files.values()].some(bytes=>String(bytes).includes('must not enter artifact')));
assert.match(String(files.get('oauth/consent/index.html')),/src="\.\/consent\.mjs"/);
assert.match(files.get('_headers'),/Referrer-Policy: no-referrer/);
assert.match(files.get('_headers'),/frame-ancestors 'none'/);
assert.equal(JSON.parse(files.get('build.json')).head,head);
await assert.rejects(consentFiles(config,'synthetic','invalid head'),/CONSENT_HEAD_REQUIRED/);
const outputDir='consent-invalid-sdk-must-not-be-created';assert.equal(existsSync(outputDir),false);
await assert.rejects(buildConsentSite({config,outputDir,head},async()=>new Response('tampered SDK')),/SDK_INTEGRITY_FAILED/);
assert.equal(existsSync(outputDir),false);
assert.ok(SDK_SHA384.length>40);
console.log('Assessment consent: Testing isolation, client/user/scope/callback and narrow static artifact integrity PASS');
