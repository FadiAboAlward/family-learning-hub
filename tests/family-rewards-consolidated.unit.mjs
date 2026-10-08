import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executeFamilyRewardsAction } from '../supabase/functions/_shared/family-rewards.mjs';

// These fast checks protect the release boundary; executed PostgreSQL contracts
// and overlapping transactions remain the proof of persistence and concurrency.
const migration=fs.readFileSync(new URL('../supabase/migrations/20261008044606_consolidated_family_rewards_v1_4_v1_6.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const code=migration.replace(/--[^\n]*/g,'');
const seed=code.slice(code.indexOf('do $seed_parent_return$'));
assert.doesNotMatch(code,/\b(?:alter|drop|truncate)\s+table\b/i,'feature must not rewrite schemas or erase history');
assert.doesNotMatch(seed,/\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:behavior_submissions|gamification_events|learner_gamification_state|reward_claims)\b/i,'prospective seed must not backfill wallet or history');
assert.match(code,/security invoker set search_path = ''/,'existing invoker authority remains');
assert.match(code,/revoke all on function public\.flh_family_rewards_command\([^;]+from public, anon, authenticated;/,'privileged command stays closed to browser roles');
assert.match(code,/grant execute on function public\.flh_family_rewards_command\([^;]+to service_role;/);
assert.match(seed,/v_rule constant uuid := 'a315e8af-9d9b-473b-95ac-c5425ad7de5b'/);
assert.ok(seed.includes("'parental_respect','الأدب وبرّ الوالدين'"));
assert.ok(seed.includes("'تقبيل يد الأب أو الأم عند العودة إلى المنزل'"));
assert.match(seed,/2,0,'all','day',2,true,true,0,0,0,0/,'seed canonical two points, no bonuses and combined two-slot cap');

const learnerLock=code.indexOf("select * into v_learner from public.learners where id=p_learner_id and workspace_id=p_workspace_id and is_active for update;");
const occurrenceCap=code.indexOf("(occurred_at at time zone 'Europe/Istanbul')::date=(v_submission.occurred_at at time zone 'Europe/Istanbul')::date");
assert.ok(learnerLock>=0&&occurrenceCap>learnerLock,'local occurrence cap must run under the shared wallet/learner lock');
assert.match(code.slice(learnerLock,occurrenceCap),/v_now := clock_timestamp\(\)/,'wall clock is refreshed after waiting for the shared lock');
assert.match(code.slice(occurrenceCap),/if v_count>=2 then/,'fixed cap does not trust editable max_awards');
assert.match(code,/if v_submission\.initiative or v_submission\.adhkar_completed or v_submission\.congregation_completed[\s\S]+return jsonb_build_object\('error','INVALID_INPUT'\)/,'legacy canonical pending bonus flags cannot be approved');
assert.match(code,/elsif v_rule\.cadence<>'unlimited' then[\s\S]+v_now at time zone 'UTC'[\s\S]+approved_at>=v_window/,'other rules retain UTC approval cadence');
assert.match(code,/if v_rule\.id=v_parent_return_rule then\s+v_points := 2; v_bonus := 0; v_adhkar_bonus := 0; v_congregation_bonus := 0; v_mosque_bonus := 0; v_sunnah_bonus := 0;/,'final canonical award ignores mutable component configuration');

const capture=code.indexOf("'policy_version','flh-010-v1.5','captured_at',v_now,'status','pending'");
const pendingInsert=code.indexOf('insert into public.behavior_submissions(',capture);
const pendingReturn=code.indexOf("if p_action='behavior_submit' then return",pendingInsert);
const walletGrant=code.indexOf('insert into public.learner_gamification_state(workspace_id,learner_id,reward_points)',pendingReturn);
assert.ok(capture>=0&&pendingInsert>capture&&pendingReturn>pendingInsert&&walletGrant>pendingReturn,'new pending capture precedes early return and every wallet grant');
const insertColumns=code.slice(pendingInsert,code.indexOf(')',pendingInsert));
for(const component of ['base_points','initiative_bonus_points','adhkar_bonus_points','congregation_bonus_points','mosque_bonus_points','sunnah_bonus_points','total_points']){
  assert.ok(code.slice(capture,pendingInsert).includes(`'${component}'`),`capture includes ${component}`);
  assert.ok(!insertColumns.includes(component),`pending ${component} remains the zero schema default`);
}
assert.match(code,/v_has_capture := coalesce\(v_captured->>'policy_version'='flh-010-v1\.5',false\)/);
assert.match(code,/if v_has_capture then[\s\S]+v_points := \(v_captured->>'base_points'\)::integer;[\s\S]+else\s+v_points := v_rule\.base_points;/,'legacy fallback does not invent a capture');

// Exercise the actual API adapter: browser-supplied totals, provenance and
// identities never reach the privileged command, while a retry keeps its instant/key.
const workspace='10000000-0000-4000-8000-000000000001';
const learner='10000000-0000-4000-8000-000000000002';
const parent='10000000-0000-4000-8000-000000000003';
const submission='10000000-0000-4000-8000-000000000004';
const calls=[];
const dependencies={
  workspaceId:workspace,
  learnerIdentity:async()=>({learner_id:learner}),
  parentIdentity:async()=>({user:{id:parent},member:{role:'owner'}}),
  rpc:async(name,args)=>{calls.push({name,args}); return {data:{ok:true},error:null};},
};
const browserReport={rule_id:'a315e8af-9d9b-473b-95ac-c5425ad7de5b',occurred_at:'2020-01-20T23:59:59+03:00',idempotency_key:'qa025-stable-browser-request',
  snapshot:{policy_version:'flh-010-v1.5',total_points:999},policy_version:'forged',total_points:999,base_points:999,
  learner_id:parent,workspace_id:parent,actor_id:parent,reviewer_id:parent,xp_delta:999,reward_points_delta:999};
await executeFamilyRewardsAction('behavior_submit',browserReport,dependencies);
await executeFamilyRewardsAction('behavior_submit',browserReport,dependencies);
assert.deepEqual(calls[0],calls[1],'stable browser retries forward the same immutable instant and key');
assert.deepEqual(calls[0],{name:'flh_family_rewards_command',args:{p_workspace_id:workspace,p_actor_id:null,p_learner_id:learner,p_action:'behavior_submit',
  p_payload:{rule_id:browserReport.rule_id,occurred_at:browserReport.occurred_at,idempotency_key:browserReport.idempotency_key}}},'trusted learner scope and server-only capture boundary');
await executeFamilyRewardsAction('behavior_review',{...browserReport,submission_id:submission,decision:'approved',reason:'verified genuine return'},dependencies);
assert.deepEqual(calls[2].args,{p_workspace_id:workspace,p_actor_id:parent,p_learner_id:null,p_action:'behavior_review',
  p_payload:{submission_id:submission,decision:'approved',reason:'verified genuine return'}},'parent approval passes no calculated money or forged learner identity');
console.log('Consolidated rewards prospective migration, lock/capture authority and stable API retry regressions passed (DB contracts remain separate).');
