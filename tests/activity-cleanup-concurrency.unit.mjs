import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeStaleRows, forEachWithConcurrency } from '../supabase/functions/_shared/bounded-concurrency.mjs';

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

const rows=[
  {id:'s1',started_at:'2026-10-01T10:00:00.000Z',last_activity_at:'2026-10-01T10:05:30.000Z'},
  {id:'s2',started_at:'2026-10-01T11:00:00.000Z',last_activity_at:'2026-10-01T11:02:00.000Z'},
];
const updates=[];
await closeStaleRows(
  rows,
  2,
  async(id,values)=>{updates.push({id,values})},
  (start,end)=>Math.round((new Date(end).getTime()-new Date(start).getTime())/1000),
);

assert.deepEqual(updates,[
  {id:'s1',values:{ended_at:'2026-10-01T10:05:30.000Z',duration_seconds:330,end_reason:'inactivity'}},
  {id:'s2',values:{ended_at:'2026-10-01T11:02:00.000Z',duration_seconds:120,end_reason:'inactivity'}},
],'stale-session closure should preserve the production update payload for every selected session');

const source=fs.readFileSync('supabase/functions/activity-api/index.ts','utf8');
assert.match(source,/STALE_CLOSE_CONCURRENCY=8/,'activity cleanup should use the small fixed concurrency cap');
assert.match(source,/closeStaleRows\(ss\|\|\[\],STALE_CLOSE_CONCURRENCY/,'stale cleanup should use the tested bounded closure helper');
assert.equal(
  [...source.matchAll(/Promise\.all\(\[closeStale\(\),realLearners\(\)\]\)/g)].length,
  2,
  'summary and session query should overlap stale cleanup with learner lookup'
);

console.log('Activity stale cleanup bounded concurrency: PASS');
