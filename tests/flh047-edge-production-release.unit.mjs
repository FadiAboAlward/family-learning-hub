import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
assert.throws(()=>assertReleaseState(state(),true),/Missing same-run preflight/);
assert.throws(()=>assertReleaseState(state(),true,{'assessment-mcp':9,'learning-api':25}),/did not advance/);
const fresh=state();fresh.functions[0].version=10;fresh.functions[1].version=26;
assert.deepEqual(assertReleaseState(fresh,true,{'assessment-mcp':9,'learning-api':25}),{'assessment-mcp':10,'learning-api':26});
assert.throws(()=>assertReleaseState(fresh,true,{'assessment-mcp':10,'learning-api':26}),/did not advance/);
assert.throws(()=>assertReleaseState(fresh,true,{'assessment-mcp':11,'learning-api':25}),/did not advance/);
assert.throws(()=>assertReleaseState(fresh,true,{'assessment-mcp':NaN,'learning-api':25}),/Invalid same-run preflight/);
const later=structuredClone(fresh);later.functions[0].version=11;later.functions[1].version=27;
assert.deepEqual(assertReleaseState(later,true,{'assessment-mcp':10,'learning-api':26}),{'assessment-mcp':11,'learning-api':27});
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
// Independent contract tests for exact-SHA gating, ordered pre/postflight and two-service scope.
assert.equal(RELEASE_TARGET,'gkpoylfozvuwuwqeoduc');
assert.equal(MIGRATION_COUNT,134);
assert.equal(LATEST_MIGRATION,'20261109190258');
const workflow=readFileSync(new URL('../.github/workflows/flh047-production-edge-release.yml',import.meta.url),'utf8');
assert.ok(workflow.includes('DRIVE_REVISION_ID: 2'));
assert.ok(workflow.includes("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"));
for(const phrase of [
  'test "${EXPECTED_SHA}" = "${GITHUB_SHA}"',
  'test "$(git rev-parse HEAD)" = "${EXPECTED_SHA}"',
  'test "$(git rev-parse FETCH_HEAD)" = "${EXPECTED_SHA}"',
  'id: preflight',
  'id: deploy_assessment',
  'id: deploy_learning',
  "if: ${{ always() && steps.preflight.outcome == 'success' &&",
  "steps.deploy_assessment.outcome == 'failure'",
  "steps.deploy_learning.outcome == 'failure'",
  "if: ${{ success() && steps.deploy_assessment.outcome == 'success' && steps.deploy_learning.outcome == 'success' }}",
  'FLH047_BEFORE_ASSESSMENT_MCP: ${{ steps.preflight.outputs.assessment_mcp }}',
  'FLH047_BEFORE_LEARNING_API: ${{ steps.preflight.outputs.learning_api }}'
])assert.ok(workflow.includes(phrase),'Missing exact-SHA or step output gate: '+phrase);
const ordered=[
  'run: node tests/flh047-edge-production-release.unit.mjs',
  'id: preflight',
  'run: node scripts/flh047-edge-production-release.mjs preflight',
  'supabase functions deploy assessment-mcp',
  'supabase functions deploy learning-api',
  'run: node scripts/flh047-edge-production-release.mjs verify'
].map(x=>workflow.indexOf(x));
assert.ok(ordered.every(x=>x>=0)&&ordered.every((x,i)=>i===0||x>ordered[i-1]),'Unsafe workflow gate or deployment order');
assert.equal((workflow.match(/supabase functions deploy /g)||[]).length,2,'Only approved two functions can deploy');
assert.ok(!/supabase (?:db push|migration|db reset)/i.test(workflow),'No migration write in Edge-only workflow');
console.log('FLH-047 Edge-only exact SHA, current preflight version and scope guards PASS (synthetic).');
