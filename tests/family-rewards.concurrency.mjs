import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
// Optional scoped local QA container; CI retains its established default.
const containerName = process.env.FLH_TEST_DB_CONTAINER || 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const actorId = '97000000-0000-4000-8000-000000000001';
const categoryId = '97000000-0000-4000-8000-000000000002';
const ruleId = '97000000-0000-4000-8000-000000000003';
const secondRuleId = '97000000-0000-4000-8000-000000000004';
const rewardA = '97000000-0000-4000-8000-000000000005';
const rewardB = '97000000-0000-4000-8000-000000000006';
const expiringReward = '97000000-0000-4000-8000-000000000007';
const learnerId = '97000000-0000-4000-8000-000000000008';
const secondActorId = '97000000-0000-4000-8000-000000000009';
const greetingRuleId = 'a315e8af-9d9b-473b-95ac-c5425ad7de5b';
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
const seededLearnerId = await psql(`select id::text from public.learners where workspace_id='${workspaceId}' and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false)`);
assert.match(seededLearnerId,/^[0-9a-f-]{36}$/,'a rebuilt Testing environment must contain the dedicated test learner');
assert.notEqual(learnerId,seededLearnerId,'concurrent fixtures must never modify the existing test account');
const quotedJson = (object) => `'${JSON.stringify(object).replaceAll("'","''")}'::jsonb`;
const command = (action,payload={},actor=actorId,learner=null) => `set role service_role; select public.flh_family_rewards_command('${workspaceId}'::uuid,${actor?`'${actor}'::uuid`:'null'},${learner?`'${learner}'::uuid`:'null'},'${action}',${quotedJson(payload)})::text; reset role;`;
const originalRule = JSON.parse(await psql(`select to_jsonb(r)::text from public.behavior_rules r where id='${greetingRuleId}' and workspace_id='${workspaceId}'`));
const ruleScopes = () => psql(`select coalesce(jsonb_agg(to_jsonb(s) order by learner_id),'[]'::jsonb)::text from public.behavior_rule_learners s where rule_id='${greetingRuleId}' and workspace_id='${workspaceId}'`);
const originalScopes = await ruleScopes();
const seededHistory = () => psql(`select jsonb_build_object(
  'state',(select to_jsonb(s) from public.learner_gamification_state s where learner_id='${seededLearnerId}'),
  'submissions',(select coalesce(jsonb_object_agg(id::text,md5(to_jsonb(s)::text)),'{}'::jsonb) from public.behavior_submissions s where learner_id='${seededLearnerId}'),
  'ledger',(select coalesce(jsonb_object_agg(id::text,md5(to_jsonb(e)::text)),'{}'::jsonb) from public.gamification_events e where learner_id='${seededLearnerId}')
)::text`);
const originalSeededHistory = await seededHistory();
// Fail closed on stale/unknown fixtures; never delete somebody else's work to begin a run.
assert.equal(await psql(`select (exists(select 1 from public.learners where id='${learnerId}' or (workspace_id='${workspaceId}' and slug='qa-family-concurrency'))
  or exists(select 1 from auth.users where id in ('${actorId}','${secondActorId}'))
  or exists(select 1 from public.behavior_categories where id='${categoryId}')
  or exists(select 1 from public.behavior_rules where id in ('${ruleId}','${secondRuleId}'))
  or exists(select 1 from public.gamification_rewards where id in ('${rewardA}','${rewardB}','${expiringReward}')))::text`),'false','fixture IDs must be unused in the disposable database');
let setupComplete=false;
try {
await psql(`
  begin;
  insert into auth.users(id,email) values('${actorId}','qa-family-concurrency@example.invalid'),('${secondActorId}','qa-family-concurrency-admin@example.invalid');
  insert into public.workspace_members(workspace_id,user_id,role) values('${workspaceId}','${actorId}','owner'),('${workspaceId}','${secondActorId}','admin');
  insert into public.learners(id,workspace_id,display_name,slug,metadata) values('${learnerId}','${workspaceId}','QA disposable concurrent Testing learner','qa-family-concurrency','{"is_test":true,"exclude_from_parent_metrics":true,"qa_fixture":"family-rewards-concurrency"}');
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
    on conflict(learner_id) do nothing;
  update public.behavior_rules set learner_scope='selected',is_active=true,self_report_allowed=true where id='${greetingRuleId}' and workspace_id='${workspaceId}';
  insert into public.behavior_rule_learners(workspace_id,rule_id,learner_id) values('${workspaceId}','${greetingRuleId}','${learnerId}');
  commit;
`);
setupComplete=true;

/** Force both real database transactions to overlap behind the shared learner lock. */
async function race(firstSql,secondSql,marker) {
  const pending=[];
  const track=sql=>{const promise=start(sql); promise.catch(()=>{}); pending.push(promise); return promise;};
  try {
  const blocker = track(`begin; select id from public.learners where id='${learnerId}' for update; select pg_advisory_xact_lock(${marker}); select pg_sleep(8); commit;`);
  const lockDeadline=Date.now()+4000;
  let ready=false;
  while(!ready&&Date.now()<lockDeadline){
    ready=await psql(`select count(*)::text from pg_locks where locktype='advisory' and objid=${marker} and granted`)==='1';
    if(!ready) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(ready,true,'test blocker must own the learner lock before commands');
  const first=track(firstSql); const second=track(secondSql);
  let waiters=0; const waiterDeadline=Date.now()+4000;
  while(waiters<2&&Date.now()<waiterDeadline){
    waiters=Number(await psql(`select count(*)::text from pg_stat_activity where wait_event_type='Lock' and query like '%flh_family_rewards_command%' and query like '%${workspaceId}%'`));
    if(waiters<2) await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(waiters,2,'both financial commands must demonstrably overlap');
  const [,a,b]=await Promise.all([blocker,first,second]);
  return [JSON.parse(a),JSON.parse(b)];
  } finally {
    // An assertion failure must not race fixture cleanup against still-running grants.
    await Promise.allSettled(pending);
  }
}
const duplicatePayload={rule_id:ruleId,initiative:false,idempotency_key:'qa-family-concurrent-duplicate'};
const duplicateResults=await race(command('behavior_record',duplicatePayload,actorId,learnerId),command('behavior_record',duplicatePayload,actorId,learnerId),97000101);
assert.ok(duplicateResults.every(result=>result.ok));
assert.equal(duplicateResults[0].submission.id,duplicateResults[1].submission.id);
assert.equal(Number(await psql(`select reward_points from public.learner_gamification_state where learner_id='${learnerId}'`)),20);
assert.equal(Number(await psql(`select count(*) from public.gamification_events where learner_id='${learnerId}' and source_type='family_behavior' and metadata->>'rule_id'='${ruleId}'`)),1);

const sameOccurrence = new Date(Date.now()-60_000).toISOString();
const pendingResults=await race(
  command('behavior_submit',{rule_id:ruleId,occurred_at:sameOccurrence,idempotency_key:'qa-family-pending-one'},null,learnerId),
  command('behavior_submit',{rule_id:ruleId,occurred_at:sameOccurrence,idempotency_key:'qa-family-pending-two'},null,learnerId),97000105);
assert.ok(pendingResults.every(result=>result.ok),'concurrent exact self-reports both return a safe result');
assert.equal(pendingResults[0].submission.id,pendingResults[1].submission.id,'concurrent exact self-reports converge on one pending submission');
assert.equal(pendingResults.filter(result=>result.duplicate_pending===true).length,1,'the waiter explicitly reports pending occurrence reuse');
assert.equal(Number(await psql(`select count(*) from public.behavior_submissions where learner_id='${learnerId}' and rule_id='${ruleId}' and status='pending' and occurred_at='${sameOccurrence}'::timestamptz`)),1,'concurrent exact self-reports persist one pending row');

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
// FLH025: fixed greeting grants use occurrence-local-day buckets across both parents.
const greetingRecord = (occurredAt,key,actor=actorId) => command('behavior_record',{rule_id:greetingRuleId,occurred_at:occurredAt,idempotency_key:key},actor,learnerId);
const greetingSubmit = (occurredAt,key) => command('behavior_submit',{rule_id:greetingRuleId,occurred_at:occurredAt,idempotency_key:key},null,learnerId);
const approve = (id,actor=actorId) => command('behavior_review',{submission_id:id,decision:'approved'},actor);
const readCommand = async sql => JSON.parse(await psql(sql));
const greetingDay = day => psql(`select jsonb_build_object('approved',count(*) filter(where status='approved'),
  'points',coalesce(sum(total_points) filter(where status='approved'),0),
  'pending_points',coalesce(sum(total_points) filter(where status='pending'),0))::text
  from public.behavior_submissions where learner_id='${learnerId}' and rule_id='${greetingRuleId}' and (occurred_at at time zone 'Europe/Istanbul')::date='${day}'::date`).then(JSON.parse);

const firstSlot=await readCommand(greetingRecord('2020-01-10T10:00:00+03:00','qa025-race-slot-first'));
assert.equal(firstSlot.submission.total_points,2);
const slotA=await readCommand(greetingSubmit('2020-01-10T12:00:00+03:00','qa025-race-slot-a'));
const slotB=await readCommand(greetingSubmit('2020-01-10T18:00:00+03:00','qa025-race-slot-b'));
assert.ok(slotA.ok&&slotB.ok&&slotA.submission.total_points===0&&slotB.submission.total_points===0);
const finalSlot=await race(approve(slotA.submission.id),approve(slotB.submission.id,secondActorId),97000106);
assert.equal(finalSlot.filter(result=>result.ok&&result.submission.total_points===2).length,1,'only one parent can grant the final shared occasion slot');
assert.equal(finalSlot.filter(result=>result.error==='CADENCE_LIMIT').length,1);
assert.deepEqual(await greetingDay('2020-01-10'),{approved:2,points:4,pending_points:0},'losing pending submission grants zero points');
assert.equal(Number(await psql(`select count(*) from public.gamification_events where learner_id='${learnerId}' and source_type='family_behavior' and metadata->>'rule_id'='${greetingRuleId}'`)),2,'two shared slots create two grants');

const pendingGreeting=await race(
  greetingSubmit('2020-01-11T10:00:00+03:00','qa025-race-pending-a'),
  greetingSubmit('2020-01-11T07:00:00Z','qa025-race-pending-b'),97000107);
assert.ok(pendingGreeting.every(result=>result.ok&&result.submission.total_points===0));
assert.equal(pendingGreeting[0].submission.id,pendingGreeting[1].submission.id,'equivalent timezone forms reuse one pending event');
assert.equal(pendingGreeting.filter(result=>result.duplicate_pending===true).length,1);
assert.deepEqual(pendingGreeting[0].submission.snapshot,pendingGreeting[1].submission.snapshot,'occurrence alias retains the first server snapshot');
const concurrentReview=await race(approve(pendingGreeting[0].submission.id),approve(pendingGreeting[1].submission.id,secondActorId),97000108);
assert.ok(concurrentReview.every(result=>result.ok));
assert.equal(concurrentReview.filter(result=>result.already_reviewed===true).length,1,'concurrent duplicate reviews return the original grant');
assert.equal(Number(await psql(`select count(*) from public.gamification_events where source_type='family_behavior' and source_id='${pendingGreeting[0].submission.id}'`)),1);

const exactGreeting=await race(
  greetingRecord('2020-01-12T10:00:00+03:00','qa025-race-exact-a'),
  greetingRecord('2020-01-12T07:00:00Z','qa025-race-exact-b',secondActorId),97000109);
assert.equal(exactGreeting.filter(result=>result.ok).length,1,'one exact instant can produce only one direct grant across parents');
assert.equal(exactGreeting.filter(result=>result.error==='DUPLICATE_OCCURRENCE').length,1);
assert.deepEqual(await greetingDay('2020-01-12'),{approved:1,points:2,pending_points:0});

// Both boundary events share a UTC date. Each learner-local occurrence day has its own final slot.
await readCommand(greetingRecord('2020-01-20T08:00:00+03:00','qa025-race-boundary-seed-a'));
await readCommand(greetingRecord('2020-01-21T08:00:00+03:00','qa025-race-boundary-seed-b'));
const boundaryA=await readCommand(greetingSubmit('2020-01-20T23:59:59+03:00','qa025-race-boundary-a'));
const boundaryB=await readCommand(greetingSubmit('2020-01-21T00:00:00+03:00','qa025-race-boundary-b'));
assert.ok(boundaryA.ok&&boundaryB.ok);
assert.equal(await psql(`select (('${boundaryA.submission.occurred_at}'::timestamptz at time zone 'UTC')::date= ('${boundaryB.submission.occurred_at}'::timestamptz at time zone 'UTC')::date)::text`),'true','boundary fixture shares one UTC date');
const boundary=await race(approve(boundaryA.submission.id),approve(boundaryB.submission.id,secondActorId),97000110);
assert.ok(boundary.every(result=>result.ok&&result.submission.total_points===2),'parallel late approvals consume independent local occurrence-day final slots');
assert.deepEqual(await greetingDay('2020-01-20'),{approved:2,points:4,pending_points:0});
assert.deepEqual(await greetingDay('2020-01-21'),{approved:2,points:4,pending_points:0});
const cappedBoundary=await race(
  greetingRecord('2020-01-20T12:00:00+03:00','qa025-race-boundary-third-a'),
  greetingRecord('2020-01-21T12:00:00+03:00','qa025-race-boundary-third-b',secondActorId),97000111);
assert.ok(cappedBoundary.every(result=>result.error==='CADENCE_LIMIT'));
assert.deepEqual(JSON.parse(await psql(`select jsonb_build_object('xp',xp,'points',reward_points)::text from public.learner_gamification_state where learner_id='${learnerId}'`)),{xp:100,points:16},'all overlapping greeting grants change Reward Points only');
} finally {
  if(setupComplete){
    // Delete only this run's known synthetic learner. The established FK cascade permits
    // its immutable ledger cleanup; no ledger deletes, trigger bypass or history edits.
    await psql(`begin;
      delete from public.learners where id='${learnerId}' and workspace_id='${workspaceId}'
        and slug='qa-family-concurrency' and metadata->>'qa_fixture'='family-rewards-concurrency' and coalesce((metadata->>'is_test')::boolean,false);
      delete from public.gamification_rewards where id in ('${rewardA}','${rewardB}','${expiringReward}') and workspace_id='${workspaceId}';
      delete from public.behavior_rules where id in ('${ruleId}','${secondRuleId}') and workspace_id='${workspaceId}';
      delete from public.behavior_categories where id='${categoryId}' and workspace_id='${workspaceId}';
      update public.behavior_rules set learner_scope=${quotedJson(originalRule)}->>'learner_scope',
        is_active=(${quotedJson(originalRule)}->>'is_active')::boolean,
        self_report_allowed=(${quotedJson(originalRule)}->>'self_report_allowed')::boolean
        where id='${greetingRuleId}' and workspace_id='${workspaceId}';
      delete from auth.users where id in ('${actorId}','${secondActorId}');
      commit;`);
    const restoredRule=JSON.parse(await psql(`select to_jsonb(r)::text from public.behavior_rules r where id='${greetingRuleId}' and workspace_id='${workspaceId}'`));
    // The normal set_updated_at trigger records the reversible preference restoration.
    delete restoredRule.updated_at;
    const expectedRule={...originalRule}; delete expectedRule.updated_at;
    assert.deepEqual(restoredRule,expectedRule,'canonical rule preferences restored');
    assert.equal(await ruleScopes(),originalScopes,'canonical original learner scopes restored');
    assert.equal(await seededHistory(),originalSeededHistory,'seeded Testing wallet and all history remain unchanged');
    assert.equal(await psql(`select (exists(select 1 from public.learners where id='${learnerId}') or exists(select 1 from public.gamification_events where learner_id='${learnerId}') or exists(select 1 from public.behavior_submissions where learner_id='${learnerId}') or exists(select 1 from public.reward_claims where learner_id='${learnerId}'))::text`),'false','synthetic financial fixtures fully cleaned');
  }
}
console.log('Family rewards concurrent duplicate grants, exact pending reuse, shared final slots, local midnight buckets, claim spending/expiry and XP preservation passed; synthetic fixtures cleaned.');
