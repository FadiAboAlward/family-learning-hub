import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {executeFamilyRewardsAction,publicRewardsError,rewardsErrorStatus} from '../supabase/functions/_shared/family-rewards.mjs';

const workspace='99000000-0000-4000-8000-000000000001',parent='99000000-0000-4000-8000-000000000002',learner='99000000-0000-4000-8000-000000000003',event='99000000-0000-4000-8000-000000000004';
const calls=[],deps={workspaceId:workspace,parentIdentity:async()=>({user:{id:parent},member:{role:'owner'}}),learnerIdentity:async()=>({learner_id:learner}),rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true},error:null};}};
await executeFamilyRewardsAction('return_event_create',{occurred_at:'2020-01-01T10:00:00+03:00',idempotency_key:'qa-return-create',id:event,created_by:event,workspace_id:event,learner_id:event,total_points:900},deps);
assert.deepEqual(calls.at(-1).args,{p_workspace_id:workspace,p_actor_id:parent,p_learner_id:null,p_action:'return_event_create',p_payload:{occurred_at:'2020-01-01T10:00:00+03:00',idempotency_key:'qa-return-create'}},'event UUID, actor, workspace and points are exclusively server authority');
for(const role of ['teacher','viewer',null]){
  const count=calls.length;
  await assert.rejects(()=>executeFamilyRewardsAction('return_event_create',{occurred_at:'2020-01-01T07:00:00Z',idempotency_key:'qa-return-create'},{...deps,parentIdentity:async()=>({user:{id:parent},member:{role}})}),/NOT_REWARDS_ADMIN/);
  assert.equal(calls.length,count,'denial precedes privileged RPC');
}
await assert.rejects(()=>executeFamilyRewardsAction('return_event_create',{}, {...deps,parentIdentity:async()=>{throw new Error('AUTH_REQUIRED');}}),/AUTH_REQUIRED/,'a learner session cannot create parent occasions');
await executeFamilyRewardsAction('behavior_submit',{rule_id:event,return_event_id:event,created_by:parent,occurred_at:'2020-01-01T07:00:00Z',idempotency_key:'qa-child-submit'},deps);
assert.equal(Object.hasOwn(calls.at(-1).args.p_payload,'return_event_id'),false,'the child request never binds a server event');
for(const action of ['behavior_review','behavior_record']){
  await executeFamilyRewardsAction(action,{learner_id:learner,submission_id:event,rule_id:event,decision:'approved',return_event_id:event,total_points:900,verified_occurred_at:'2099-01-01'},deps);
  assert.equal(calls.at(-1).args.p_payload.return_event_id,event);
  assert.equal(Object.hasOwn(calls.at(-1).args.p_payload,'verified_occurred_at'),false);
  assert.equal(Object.hasOwn(calls.at(-1).args.p_payload,'total_points'),false);
}
await executeFamilyRewardsAction('parent_rewards_dashboard',{return_event_day:'2020-01-01',return_event_before_at:'2020-01-01T07:00:00Z',return_event_before_id:event,return_event_page_size:20,workspace_id:event},deps);
assert.deepEqual(calls.at(-1).args.p_payload,{return_event_day:'2020-01-01',return_event_before_at:'2020-01-01T07:00:00Z',return_event_before_id:event,return_event_page_size:20},'only bounded day/cursor context crosses parent catalog boundary');
await executeFamilyRewardsAction('student_rewards_dashboard',{return_event_day:'2020-01-01'},deps);
assert.deepEqual(calls.at(-1).args.p_payload,{},'child catalog cannot query parent occasion context');
for(const code of ['RETURN_EVENT_REQUIRED','RETURN_EVENT_NOT_FOUND','INVALID_RETURN_EVENT','RETURN_EVENT_IMMUTABLE'])assert.equal(publicRewardsError({message:code}),code);
assert.equal(rewardsErrorStatus('RETURN_EVENT_REQUIRED'),400);assert.equal(rewardsErrorStatus('RETURN_EVENT_NOT_FOUND'),404);assert.equal(rewardsErrorStatus('RETURN_EVENT_IMMUTABLE'),409);

const source=fs.readFileSync(new URL('../family-rewards-v1.js',import.meta.url),'utf8'),context={Date};
const occurrence=source.slice(source.indexOf('  function exactOccurrenceKey('),source.indexOf('  function duplicateSubmissionIds('));
const duplicateWarnings=source.slice(source.indexOf('  function duplicateSubmissionIds('),source.indexOf('  function name('));
const projection=source.slice(source.indexOf('  const PREVIEW_COMPONENTS='),source.indexOf('  function selectedReturnEvent('));
vm.runInNewContext(occurrence+projection+duplicateWarnings,context);
const greeting='a315e8af-9d9b-473b-95ac-c5425ad7de5b',rule={id:greeting,base_points:2},claim=(id,clock)=>({id,rule_id:greeting,learner_id:learner,status:'pending',occurred_at:clock,snapshot:{}});
const first=claim('claim-1','2020-01-01T07:00:00Z'),second=claim('claim-2','2020-01-02T08:00:00Z'),occasion={id:event,awarded_learner_ids:[]};
assert.equal(context.pendingProjection([rule],first).conditional,true,'unverified greeting remains conditional and uncredited');
assert.equal(context.pendingSummary([rule],[first,second],()=>occasion).total,2,'different child clocks mapping to one canonical occasion count once');
assert.equal(context.pendingSummary([rule],[first,second],row=>({id:row.id,awarded_learner_ids:[]})).total,4,'two genuinely distinct occasions remain two estimates');
assert.equal(context.pendingSummary([rule],[first,second],()=>occasion).count,2,'deduplication preserves visible pending count');
assert.equal(context.pendingProjection([rule],first,{...occasion,awarded_learner_ids:[learner]}).forecast,0,'known awarded occasion forecasts zero new points');
assert.equal(context.pendingProjection([rule],first,{...occasion,awarded_learner_ids:['another-learner']}).forecast,2,'another learner independently qualifies for the same occasion');
const approved={...first,id:'approved-return',status:'approved',return_event_id:event};
const distinct={...first,id:'distinct-return',return_event_id:'another-event',possible_duplicate:false};
assert.equal(context.duplicateSubmissionIds([approved,distinct]).size,0,'equal child clocks for distinct bound occasions never imply a duplicate');
assert.equal(context.duplicateSubmissionIds([approved,{...second,return_event_id:event}]).has(second.id),true,'the same bound occasion is detected despite different child clocks');
assert.equal(context.duplicateSubmissionIds([approved,first,{...first,id:'unbound-return'}]).size,0,'unbound greeting clocks do not establish physical identity');
assert.equal(context.duplicateSubmissionIds([{...first,possible_duplicate:true}]).has(first.id),true,'a server-known duplicate remains visible without a local event binding');
assert.equal(context.duplicateSubmissionIds([first,second],()=>occasion).size,2,'two pending claims selected to one shared occasion are both flagged');
assert.equal(context.duplicateSubmissionIds([first,second],row=>row.id===first.id?occasion:{...occasion,id:'another-event'}).size,0,'distinct parent selections clear the warning immediately');
assert.equal(context.duplicateSubmissionIds([first],()=>({...occasion,awarded_learner_ids:[learner]})).has(first.id),true,'an already-awarded selected occasion remains a known duplicate');
assert.equal(context.duplicateSubmissionIds([{...approved,rule_id:'ordinary'},{...first,rule_id:'ordinary'}]).has(first.id),true,'unrelated behavior rules retain exact-clock duplicate warnings');
console.log('Parent return event API authority, canonical forecasts and identity-based duplicate warnings passed; real database contracts remain separate.');
