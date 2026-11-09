import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildTransaction,guardLedger,ledgerDigest,migrate} from '../scripts/flh046-production-release.mjs';

const sql=fs.readFileSync('supabase/migrations/20261109190258_legacy_visual_authoring_eligibility.sql','utf8');
assert.ok(sql.includes('legacy_visual_eligible boolean not null default false'));
assert.ok(sql.includes('security invoker'));
assert.ok(sql.includes('grant execute on function'));
assert.ok(!sql.includes('drop table'));
const tx=buildTransaction(sql);
assert.match(tx,/^BEGIN;\n/);
assert.match(tx,/COMMIT;\n$/);
assert.match(tx,/pg_advisory_xact_lock\(460462026\)/);
assert.match(tx,/FLH046_PRODUCTION_LEDGER_DIGEST_DRIFT/);
assert.match(tx,/FLH046_PRODUCTION_LEDGER_COUNT_DRIFT/);
assert.match(tx,/20261109190258.*legacy_visual_authoring_eligibility/);
assert.equal((tx.match(/INSERT INTO supabase_migrations.schema_migrations/g)||[]).length,1);
assert.equal((tx.match(/alter table private.assessment_authoring_requests/g)||[]).length,2,'once executed and once immutably recorded inside migration history');
assert.throws(()=>buildTransaction(sql+'\n-- '+ '$flh046_source_sql$'),/delimiter/);
const rows=Array.from({length:133},(_,i)=>({version:String(20260901000000+i),name:'synthetic_'+i}));
assert.equal(ledgerDigest(rows),createHash('sha256').update(rows.map(x=>x.version+'\t'+x.name+'\n').join('')).digest('hex'));
assert.throws(()=>guardLedger(rows.slice(1)),/count drift/);
assert.throws(()=>guardLedger(rows),/Wrong baseline latest version/);
assert.throws(()=>guardLedger([...rows,{version:'20261109190258',name:'unexpected'}],{after:true}),/Canonical version\/name/);

assert.match(tx,/a881da0b3a2ed9c73506eea1bc646637678bbe4f4035d6fdf379e99474d911e3/);
assert.match(tx,/<> 133 THEN/);
const valid=rows.map((x,i)=>i===132?{...x,version:'20261105134103'}:x);
const hash=ledgerDigest(valid);
assert.equal(guardLedger(valid,{expectedDigest:hash}).length,133);
const applied=[...valid,{version:'20261109190258',name:'legacy_visual_authoring_eligibility'}];
assert.equal(guardLedger(applied,{expectedDigest:hash,after:true}).length,133);
assert.throws(()=>guardLedger(applied.slice(0,-2),{expectedDigest:hash,after:true}),/count drift/);
assert.throws(()=>guardLedger([...valid,{version:valid[0].version,name:'legacy_visual_authoring_eligibility'}],{expectedDigest:hash,after:true}),/Duplicate migration version/);
assert.throws(()=>guardLedger(valid.map((x,i)=>i===0?{...x,name:'bad space'}:x),{expectedDigest:hash}),/Unexpected migration metadata/);

const baseline='a881da0b3a2ed9c73506eea1bc646637678bbe4f4035d6fdf379e99474d911e3';
async function scenario(mode){
 let writes=0,reads=0;
 const api=async(_token,suffix,opts={})=>{
  assert.equal(suffix,'/database/query');
  if(opts.query.startsWith('select version,name')){
   reads++;
   return [{phase:reads===1?'before':(mode.endsWith('After')?'after':'before')}];
  }
  if(opts.query.startsWith('BEGIN;')){
   writes++;assert.equal(opts.read_only,false);
   if(mode==='timeoutAfter'||mode==='timeoutBefore')throw new Error('synthetic ETIMEDOUT');
   if(mode==='rejectedBefore'){
    const e=new Error('synthetic HTTP 409');e.httpStatus=409;throw e;
   }
   return {};
  }
  if(opts.query.includes('visual_assessments'))return [{enabled:0}];
  if(opts.query.startsWith('select (SELECT count'))return [{count:133,digest:baseline}];
  throw Error('unexpected synthetic SQL');
 };
 const checkLedger=(v,{after=false}={})=>{
  assert.equal(v[0].phase,after?'after':'before','synthetic migration receipt not confirmed');
  return v;
 };
 const run=()=>migrate('synthetic-test-token',{api,checkLedger,sourceBytes:sql});
 if(mode==='successAfter'||mode==='timeoutAfter')await run();
 else{
  await assert.rejects(run,
   mode==='rejectedBefore'?/definitively rejected.*HTTP 409.*Post-state/s:
   /outcome unverified.*Post-state/s);
 }
 assert.equal(writes,1,'never repeat an ambiguous or rejected Production migration write');
}
await scenario('successAfter');
await scenario('timeoutAfter');
await scenario('timeoutBefore');
await scenario('rejectedBefore');
await scenario('successBefore');
console.log('FLH046 transactional release guards, SQL digest and migration response reconciliation: PASS');
