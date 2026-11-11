import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// FLH-FEAT-2026-047 v1.1: exact-HEAD, READ-ONLY invariants for edge-only release.
// This module never mutates the database or feature flags, and never prints tokens.
export const RELEASE_TARGET='gkpoylfozvuwuwqeoduc';
export const MIGRATION_COUNT=134;
export const LATEST_MIGRATION='20261109190258';
export const BASELINE_VERSIONS=Object.freeze({'assessment-mcp':9,'learning-api':25});

export function assertReleaseState({ledger,settings,functions},after=false){
  assert.ok(Array.isArray(ledger)&&ledger.length===1,'Missing migration ledger evidence');
  assert.equal(Number(ledger[0].count),MIGRATION_COUNT,'Migration ledger count drift');
  assert.equal(String(ledger[0].latest),LATEST_MIGRATION,'Latest migration drift');
  assert.ok(Array.isArray(settings)&&settings.length===1,'Visual feature settings mismatch');
  const actual=settings[0].value;
  assert.ok(actual&&typeof actual==='object'&&!Array.isArray(actual),'Missing visual flag');
  assert.equal(actual.enabled,true,'Production visual feature not enabled');
  assert.equal(actual.test_only,false,'Visual feature rollout policy drift');
  assert.ok(Array.isArray(functions),'Missing Edge function list');
  for(const [slug,baseline] of Object.entries(BASELINE_VERSIONS)){
    const matches=functions.filter(x=>x.slug===slug);
    assert.equal(matches.length,1,'Missing or duplicate Edge function: '+slug);
    const f=matches[0];
    assert.equal(f.status,'ACTIVE','Edge function inactive: '+slug);
    assert.equal(f.verify_jwt,false,'Unexpected JWT posture: '+slug);
    assert.ok(Number.isInteger(Number(f.version))&&(after?Number(f.version)>baseline:Number(f.version)>=baseline),
      'Edge version did not meet '+(after?'deployment':'baseline')+' requirement: '+slug);
  }
  return Object.fromEntries(Object.keys(BASELINE_VERSIONS).map(slug=>[
    slug,Number(functions.find(x=>x.slug===slug).version)
  ]));
}

export async function readProductionState(token,fetcher=fetch){
  assert.ok(typeof token==='string'&&token.length>10,'Production token unavailable');
  const api='https://api.supabase.com/v1/projects/'+RELEASE_TARGET;
  async function request(suffix,sql){
    const response=await fetcher(api+suffix,{
      method:sql?'POST':'GET',
      headers:{Authorization:'Bearer '+token,Accept:'application/json',
        ...(sql?{'Content-Type':'application/json'}:{})},
      ...(sql?{body:JSON.stringify({query:sql,read_only:true})}:{}),
      signal:AbortSignal.timeout(30000)
    });
    if(response.status!==(sql?201:200))
      throw new Error('Production read-only API unavailable: HTTP '+response.status);
    return response.json();
  }
  const ledger=await request('/database/query',
    'select count(*)::integer as count,max(version)::text as latest from supabase_migrations.schema_migrations');
  const settings=await request('/database/query',
    "select value from public.workspace_settings where key='visual_assessments'");
  const functions=await request('/functions');
  return {ledger,settings,functions};
}

async function main(){
  const phase=process.argv[2];
  assert.ok(phase==='preflight'||phase==='verify','Expected preflight or verify');
  const state=await readProductionState(process.env.SUPABASE_ACCESS_TOKEN);
  const versions=assertReleaseState(state,phase==='verify');
  console.log('PASS: FLH-047 exact target, existing migration ledger, visual policy ON, Edge '+phase+
    ' verified; versions '+Object.entries(versions).map(([k,v])=>k+':'+v).join(', '));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('FLH-047 Edge release guard blocked: '+error.message);process.exitCode=1;});
