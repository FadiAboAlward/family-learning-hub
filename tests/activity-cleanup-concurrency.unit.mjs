import assert from 'node:assert/strict';
import fs from 'node:fs';
import { forEachWithConcurrency } from '../supabase/functions/_shared/bounded-concurrency.mjs';

const items=Array.from({length:17},(_,i)=>i);
let active=0,maxActive=0;
const seen=[];

await forEachWithConcurrency(items,4,async item=>{
  active++;
  maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setTimeout(resolve,5));
  seen.push(item);
  active--;
});

assert.deepEqual([...seen].sort((a,b)=>a-b),items,'bounded worker should process every item exactly once');
assert.equal(maxActive,4,'bounded worker should use, but never exceed, the requested concurrency');

await assert.rejects(
  forEachWithConcurrency([1],8,async()=>{throw new Error('worker failed')}),
  /worker failed/,
  'worker failures should propagate to the caller'
);

const source=fs.readFileSync('supabase/functions/activity-api/index.ts','utf8');
assert.match(source,/STALE_CLOSE_CONCURRENCY=8/,'activity cleanup should use the small fixed concurrency cap');
assert.match(source,/forEachWithConcurrency\(ss\|\|\[\],STALE_CLOSE_CONCURRENCY/,'stale cleanup should use the bounded helper');
assert.match(source,/ended_at:s\.last_activity_at,duration_seconds:sec\(s\.started_at,s\.last_activity_at\),end_reason:"inactivity"/,'stale cleanup must preserve final session values');
assert.equal(
  [...source.matchAll(/Promise\.all\(\[closeStale\(\),realLearners\(\)\]\)/g)].length,
  2,
  'summary and session query should overlap stale cleanup with learner lookup'
);

console.log('Activity stale cleanup bounded concurrency: PASS');
