import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const actorId = '97000000-0000-4000-8000-000000000001';
const categoryId = '97000000-0000-4000-8000-000000000002';
const ruleId = '97000000-0000-4000-8000-000000000003';
const secondRuleId = '97000000-0000-4000-8000-000000000004';
const rewardA = '97000000-0000-4000-8000-000000000005';
const rewardB = '97000000-0000-4000-8000-000000000006';
const expiringReward = '97000000-0000-4000-8000-000000000007';
const args = ['exec',containerName,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-t','-A','-c'];
async function psql(sql) {
  const { stdout } = await execFileAsync('docker',[...args,sql],{maxBuffer:1024*1024});
  return stdout.trim();
}
function start(sql) {
  const process = spawn('docker',[...args,sql],{stdio:['ignore','pipe','pipe']});
  let stdout=''; let stderr='';
  process.stdout.on('data',chunk=>{stdout+=chunk;});
  process.stderr.on('data',chunk=>{stderr+=chunk;});
  return new Promise((resolve,reject)=>{
    process.on('error',reject);
    process.on('close',code=>code===0?resolve(stdout.trim()):reject(new Error(`Disposable family rewards SQL exited ${code}: ${stderr}`)));
  });
}
const learnerId = await psql(`select id::text from public.learners where workspace_id='${workspaceId}' and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false)`);
assert.match(learnerId,/^[0-9a-f-]{36}$/,'only the dedicated test learner may be used');
const quotedJson = (object) => `'${JSON.stringify(object).replaceAll("'","''")}'::jsonb`;
const command = (action,payload={},actor=actorId,learner=null) => `set role service_role; select public.flh_family_rewards_command('${workspaceId}'::uuid,${actor?`'${actor}'::uuid`:'null'},${learner?`'${learner}'::uuid`:'null'},'${action}',${quotedJson(payload)})::text; reset role;`;
await psql(`
  insert into auth.users(id,email) values('${actorId}','qa-family-concurrency@example.invalid');
  insert into public.workspace_members(workspace_id,user_id,role) values('${workspaceId}','${actorId}','owner');
  insert into public.behavior_categories(id,workspace_id,title) values('${categoryId}','${workspaceId}','QA concurrent category');
  insert into public.behavior_rules(id,workspace_id,category_id,title,base_points,learner_scope,cadence,max_awards,self_report_allowed) values
    ('${ruleId}','${workspaceId}','${categoryId}','QA duplicate award',5,'selected','day',1,true),
    ('${secondRuleId}','${workspaceId}','${categoryId}','QA concurrent cadence',5,'selected','day',1,true);
  insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values
    ('${workspaceId}','${ruleId}','${learnerId}'),('${workspaceId}','${secondRuleId}','${learnerId}');
  insert into public.gamification_rewards(id,workspace_id,title,reward_type,required_reward_points,learner_scope) values
    ('${rewardA}','${workspaceId}','QA spend A','activity',15,'selected'),
    ('${rewardB}','${workspaceId}','QA spend B','activity',15,'selected');
  insert into public.reward_learner_scopes(workspace_id,reward_id,learner_id) values
    ('${workspaceId}','${rewardA}','${learnerId}'),('${workspaceId}','${rewardB}','${learnerId}');
  insert into public.learner_gamification_state(workspace_id,learner_id,xp,reward_points) values('${workspaceId}','${learnerId}',100,15)
    on conflict(learner_id) do update set xp=100,reward_points=15;
`);

/** Force both real database transactions to overlap behind the shared learner lock. */
async function race(firstSql,secondSql,marker) {
  const blocker = start(`begin; select id from public.learners where id='${learnerId}' for update; select pg_advisory_xact_lock(${marker}); select pg_sleep(8); commit;`);
  const lockDeadline=Date.now()+4000;
  let ready=false;
  while(!ready&&Date.now()<lockDeadline){
    ready=await psql(`select count(*)::text from pg_locks where locktype='advisory' and objid=${marker} and granted`)==='1';
    if(!ready) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(ready,true,'test blocker must own the learner lock before commands');
  const first=start(firstSql); const second=start(secondSql);
  let waiters=0; const waiterDeadline=Date.now()+4000;
  while(waiters<2&&Date.now()<waiterDeadline){
    waiters=Number(await psql(`select count(*)::text from pg_stat_activity where wait_event_type='Lock' and query like '%flh_family_rewards_command%'`));
    if(waiters<2) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(waiters,2,'both financial commands must demonstrably overlap');
  const [,a,b]=await Promise.all([blocker,first,second]);
  return [JSON.parse(a),JSON.parse(b)];
}
const duplicatePayload={rule_id:ruleId,initiative:false,idempotency_key:'qa-family-concurrent-duplicate'};
const duplicateResults=await race(command('behavior_record',duplicatePayload,actorId,learnerId),command('behavior_record',duplicatePayload,actorId,learnerId),97000101);
assert.ok(duplicateResults.every(result=>result.ok));
assert.equal(duplicateResults[0].submission.id,duplicateResults[1].submission.id);
assert.equal(Number(await psql(`select reward_points from public.learner_gamification_state where learner_id='${learnerId}'`)),20);
assert.equal(Number(await psql(`select count(*) from public.gamification_events where learner_id='${learnerId}' and source_type='family_behavior' and metadata->>'rule_id'='${ruleId}'`)),1);

const cadenceResults=await race(
  command('behavior_record',{rule_id:secondRuleId,idempotency_key:'qa-family-cadence-one'},actorId,learnerId),
  command('behavior_record',{rule_id:secondRuleId,idempotency_key:'qa-family-cadence-two'},actorId,learnerId),97000102);
assert.equal(cadenceResults.filter(result=>result.ok).length,1);
assert.equal(cadenceResults.filter(result=>result.error==='CADENCE_LIMIT').length,1);
assert.equal(Number(await psql(`select reward_points from public.learner_gamification_state where learner_id='${learnerId}'`)),25);

await psql(`update public.learner_gamification_state set reward_points=15 where learner_id='${learnerId}'`);
const requestA=JSON.parse(await psql(command('reward_request',{reward_id:rewardA,idempotency_key:'qa-family-concurrent-request-a'},null,learnerId)));
const requestB=JSON.parse(await psql(command('reward_request',{reward_id:rewardB,idempotency_key:'qa-family-concurrent-request-b'},null,learnerId)));
assert.ok(requestA.ok&&requestB.ok,'both reward requests initially see sufficient unreserved points');
const spendResults=await race(
  command('reward_review',{claim_id:requestA.claim.id,decision:'approved'}),
  command('reward_review',{claim_id:requestB.claim.id,decision:'approved'}),97000103);
assert.equal(spendResults.filter(result=>result.ok).length,1,'only one claim may spend the shared balance');
assert.equal(spendResults.filter(result=>result.error==='INSUFFICIENT_POINTS').length,1,'the competing claim must fail after server revalidation');
const approved=spendResults.find(result=>result.ok).claim;
const retry=JSON.parse(await psql(command('reward_review',{claim_id:approved.id,decision:'approved'})));
assert.equal(retry.already_reviewed,true);
const redeemed=JSON.parse(await psql(command('reward_redeem',{claim_id:approved.id})));
assert.equal(redeemed.claim.status,'redeemed');
const final=JSON.parse(await psql(`select jsonb_build_object('xp',xp,'points',reward_points,'spends',(select count(*) from public.gamification_events where learner_id='${learnerId}' and source_type='reward_claim' and source_id='${approved.id}'))::text from public.learner_gamification_state where learner_id='${learnerId}'`));
assert.deepEqual(final,{xp:100,points:0,spends:1});
// Availability must be re-evaluated after waiting, not at transaction BEGIN.
await psql(`insert into public.gamification_rewards(id,workspace_id,title,reward_type,required_reward_points,learner_scope,available_until)
  values('${expiringReward}','${workspaceId}','QA expiring reward','activity',0,'selected',clock_timestamp()+interval '5 seconds');
  insert into public.reward_learner_scopes(workspace_id,reward_id,learner_id) values('${workspaceId}','${expiringReward}','${learnerId}');`);
const expiringRequest=JSON.parse(await psql(command('reward_request',{reward_id:expiringReward,idempotency_key:'qa-family-expiring-request'},null,learnerId)));
assert.ok(expiringRequest.ok,'reward must be available when requested before lock wait');
const expiredResults=await race(
  command('reward_review',{claim_id:expiringRequest.claim.id,decision:'approved'}),
  command('reward_review',{claim_id:expiringRequest.claim.id,decision:'approved'}),97000104);
assert.ok(expiredResults.every(result=>result.error==='REWARD_UNAVAILABLE'),'a reward expired during lock wait must never approve');
assert.equal(Number(await psql(`select count(*) from public.gamification_events where source_type='reward_claim' and source_id='${expiringRequest.claim.id}'`)),0);
console.log('Family rewards real concurrent duplicate award, cadence, competing claims, no overdraft/double spend, availability after lock wait, and XP preservation passed.');
