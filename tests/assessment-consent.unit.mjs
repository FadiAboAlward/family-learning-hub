import assert from 'node:assert/strict';
import { request } from 'node:http';
import { consentConfiguration,authorizationId,consentDetails,consentRedirect,TESTING_ORIGIN } from '../oauth/consent/consent.mjs';
import { createConsentServer } from '../scripts/assessment-consent-server.mjs';

const config={url:TESTING_ORIGIN,key:'sb_publishable_synthetic',clientId:'03320000-0000-4000-8000-000000000001',callback:'https://chatgpt.com/connector/oauth/syntheticCallback'};
const id='03320000-0000-4000-8000-000000000002',user='03320000-0000-4000-8000-000000000003';
assert.equal(consentConfiguration(config),config);
for(const url of ['https://gkpoylfozvuwuwqeoduc.supabase.co','https://yxjkjqmstcsczfkxytxc.supabase.co','https://example.com',TESTING_ORIGIN+'/']) assert.throws(()=>consentConfiguration({...config,url}));
for(const key of ['service_role','sb_secret_synthetic','eyJhbGciOiJIUzI1NiJ9.synthetic']) assert.throws(()=>consentConfiguration({...config,key}));
for(const callback of ['https://evil.example/connector/oauth/test','javascript:alert(1)',config.callback+'?extra=1',config.callback+'#fragment','https://chatgpt.com:444/connector/oauth/test']) assert.throws(()=>consentConfiguration({...config,callback}));
assert.equal(authorizationId('?authorization_id='+id),id);
for(const query of ['', '?authorization_id=bad',`?authorization_id=${id}&authorization_id=${id}`]) assert.throws(()=>authorizationId(query));
const details={authorization_id:id,client:{id:config.clientId,name:'<img src=x onerror=alert(1)>'},user:{id:user},redirect_uri:config.callback,scope:'openid'};
assert.equal(consentDetails(details,id,user,config).name,details.client.name); // UI uses textContent, never HTML.
for(const change of [{authorization_id:user},{client:{id:user}},{user:{id:id}},{redirect_uri:config.callback+'/other'},{scope:'openid email'}]) assert.throws(()=>consentDetails({...details,...change},id,user,config));
assert.equal(consentRedirect(config.callback+'?code=synthetic&state=synthetic',config),config.callback+'?code=synthetic&state=synthetic');
for(const value of ['https://evil.example/?code=synthetic',config.callback+'/extra?code=synthetic',config.callback+'#code=synthetic','https://user@chatgpt.com/connector/oauth/syntheticCallback']) assert.throws(()=>consentRedirect(value,config));

const server=await createConsentServer(config,'/* synthetic SDK fixture; no network */');
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const page=await fetch(origin+'/oauth/consent?authorization_id='+id);
  assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');
  assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('x-frame-options'),'DENY');
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(origin+'/app.js')).status,404);
  assert.equal((await fetch(origin+'/oauth/consent',{method:'POST',body:'no credentials accepted'})).status,404);
  const denied=await new Promise((resolve,reject)=>{const req=request(origin+'/config',{headers:{host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(denied,403);
  const publicConfig=await (await fetch(origin+'/config')).json();assert.deepEqual(publicConfig,config);
} finally { await new Promise(resolve=>server.close(resolve)); }
console.log('Assessment consent: Testing isolation, client/user/scope binding, callback and local HTTP boundaries PASS');
