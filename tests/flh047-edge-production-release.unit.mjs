import assert from 'node:assert/strict';
import { assertReleaseState,readProductionState,RELEASE_TARGET,MIGRATION_COUNT,LATEST_MIGRATION } from '../scripts/flh047-edge-production-release.mjs';

const baseline=[
  {slug:'assessment-mcp',status:'ACTIVE',version:9,verify_jwt:false},
  {slug:'learning-api',status:'ACTIVE',version:25,verify_jwt:false}
];
const state=()=>({
  ledger:[{count:MIGRATION_COUNT,latest:LATEST_MIGRATION}],
  settings:[{value:{enabled:true,test_only:false}}],
  functions:baseline.map(x=>({...x}))
});
assert.deepEqual(assertReleaseState(state()),{'assessment-mcp':9,'learning-api':25});
assert.throws(()=>assertReleaseState(state(),true),/Edge version did not meet/);
const fresh=state();fresh.functions[0].version=10;fresh.functions[1].version=26;
assert.deepEqual(assertReleaseState(fresh,true),{'assessment-mcp':10,'learning-api':26});
function rejects(mutator,pattern){
  const snapshot=state();mutator(snapshot);
  assert.throws(()=>assertReleaseState(snapshot),pattern);
}
rejects(x=>{x.ledger[0].count=135},/ledger count drift/i);
rejects(x=>{x.ledger[0].latest='20261110111111'},/Latest migration drift/);
rejects(x=>{x.settings[0].value.enabled=false},/not enabled/);
rejects(x=>{x.settings[0].value.test_only=true},/rollout policy drift/);
rejects(x=>{x.settings=[]},/settings mismatch/);
rejects(x=>{x.functions[0].status='INACTIVE'},/inactive/);
rejects(x=>{x.functions[1].verify_jwt=true},/JWT posture/);
rejects(x=>{x.functions.pop()},/Missing or duplicate Edge/);
rejects(x=>{x.functions[0].version=8},/baseline/);
const requests=[];
const response=(status,body)=>({status,json:async()=>body});
const fetcher=async(url,init)=>{
  requests.push({url,method:init.method,headers:init.headers,body:init.body});
  assert.ok(url.startsWith('https://api.supabase.com/v1/projects/'+RELEASE_TARGET));
  assert.equal(init.headers.Authorization,'Bearer testing-only-secret');
  if(url.endsWith('/functions'))return response(200,baseline);
  assert.equal(init.method,'POST');
  assert.equal(JSON.parse(init.body).read_only,true,'No SQL mutating request allowed');
  if(JSON.parse(init.body).query.includes('schema_migrations'))return response(201,state().ledger);
  return response(201,state().settings);
};
assert.deepEqual(assertReleaseState(await readProductionState('testing-only-secret',fetcher)),
  {'assessment-mcp':9,'learning-api':25});
assert.deepEqual(requests.map(r=>r.method),['POST','POST','GET']);
assert.ok(requests.every(r=>!r.body||JSON.parse(r.body).read_only===true));
await assert.rejects(()=>readProductionState('testing-only-secret',
  async()=>response(403,{error:'AUTH_DENIED'})),/HTTP 403/);
console.log('FLH-047 Production Edge-only release preflight and postflight guards PASS (mocked API, no Production calls).');
