import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// FLH-FEAT-2026-047 v1.1: exact-HEAD, READ-ONLY invariants for edge-only release.
// This module never mutates the database or feature flags, and never prints tokens.
export const RELEASE_TARGET='gkpoylfozvuwuwqeoduc';
export const MIGRATION_COUNT=134;
export const LATEST_MIGRATION='20261109190258';
export const BASELINE_VERSIONS=Object.freeze({'assessment-mcp':9,'learning-api':25});

/** Validate exact Production invariants and, at postflight, growth since this run's preflight. */
export function assertReleaseState({ledger,settings,functions},after=false,observedBefore=null){
  assert.ok(Array.isArray(ledger)&&ledger.length===1,'Missing migration ledger evidence');
  assert.equal(Number(ledger[0].count),MIGRATION_COUNT,'Migration ledger count drift');
  assert.equal(String(ledger[0].latest),LATEST_MIGRATION,'Latest migration drift');
  assert.ok(Array.isArray(settings)&&settings.length===1,'Visual feature settings mismatch');
  const actual=settings[0].value;
  assert.ok(actual&&typeof actual==='object'&&!Array.isArray(actual),'Missing visual flag');
  assert.equal(actual.enabled,true,'Production visual feature not enabled');
  assert.equal(actual.test_only,false,'Visual feature rollout policy drift');
  assert.ok(Array.isArray(functions),'Missing Edge function list');
  if(after){
    assert.ok(observedBefore&&typeof observedBefore==='object','Missing same-run preflight version evidence');
    for(const [slug,baseline] of Object.entries(BASELINE_VERSIONS)){
      const value=observedBefore[slug];
      assert.ok(Number.isSafeInteger(value)&&value>=baseline,'Invalid same-run preflight version: '+slug);
    }
  }
  for(const [slug,baseline] of Object.entries(BASELINE_VERSIONS)){
    const matches=functions.filter(x=>x.slug===slug);
    assert.equal(matches.length,1,'Missing or duplicate Edge function: '+slug);
    const f=matches[0];
    assert.equal(f.status,'ACTIVE','Edge function inactive: '+slug);
    assert.equal(f.verify_jwt,false,'Unexpected JWT posture: '+slug);
    assert.ok(Number.isSafeInteger(Number(f.version))&&Number(f.version)>=baseline,
      'Edge baseline version invalid: '+slug);
    if(after)assert.ok(Number(f.version)>observedBefore[slug],
      'Edge version did not advance since this run preflight: '+slug);
  }
  return Object.fromEntries(Object.keys(BASELINE_VERSIONS).map(slug=>[
    slug,Number(functions.find(x=>x.slug===slug).version)
  ]));
}

/** Read only migration state, rollout policy and Edge metadata through Management API. */
export async function readProductionState(token,fetcher=fetch){
  assert.ok(typeof token==='string'&&token.length>10,'Production token unavailable');
  const api='https://api.supabase.com/v1/projects/'+RELEASE_TARGET;
  /** Issue an authenticated API read with explicit read_only SQL mode. */
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

/** Run CLI preflight/verification and bind both phases via GitHub step outputs. */
async function main(){
  const phase=process.argv[2];
  assert.ok(phase==='preflight'||phase==='verify','Expected preflight or verify');
  const state=await readProductionState(process.env.SUPABASE_ACCESS_TOKEN);
  const before=phase==='verify'?Object.fromEntries(Object.keys(BASELINE_VERSIONS).map(slug=>{
    const raw=slug==='assessment-mcp'?process.env.FLH047_BEFORE_ASSESSMENT_MCP:process.env.FLH047_BEFORE_LEARNING_API;
    assert.ok(typeof raw==='string'&&/^[0-9]+$/.test(raw),'Missing preflight Edge version: '+slug);
    return [slug,Number(raw)];
  })):null;
  // Audit the actual active versions even when a deploy CLI step failed.
  // Avoid reporting a successful release until both services advance.
  const observed=assertReleaseState(state,false);
  if(phase==='verify')console.log('FLH-047 read-only postflight observed active versions: '+
    Object.entries(observed).map(([k,v])=>k+':'+v).join(', '));
  const versions=assertReleaseState(state,phase==='verify',before);
  if(phase==='preflight'){
    assert.ok(process.env.GITHUB_OUTPUT,'Missing bound GitHub preflight output file');
    appendFileSync(process.env.GITHUB_OUTPUT,
      'assessment_mcp='+versions['assessment-mcp']+'\nlearning_api='+versions['learning-api']+'\n');
  }
  console.log('PASS: FLH-047 exact target, existing migration ledger, visual policy ON, Edge '+phase+
    ' verified; versions '+Object.entries(versions).map(([k,v])=>k+':'+v).join(', '));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('FLH-047 Edge release guard blocked: '+error.message);process.exitCode=1;});
