import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../family-rewards-v1.js',import.meta.url),'utf8');
let now=Date.parse('2026-10-08T09:15:37.123Z');
class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const context={Date:ClockDate,Intl,value:(form,id)=>String(form.values[id]?.value??'').trim(),checked:(form,id)=>Boolean(form.values[id]?.checked)};
const read=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);};
read("  const OCCURRENCE_TIME_ZONE=",'  function ruleEligibleForLearner(');
read('  function recentBehaviorOrder(','  function occurrenceCategories(');
read('  function occurrenceAt(','  function duplicateSubmissionIds(');
read('  const PREVIEW_COMPONENTS=','  function statusBadge(');
read('  function approvalOutcome(','  async function approveAllForLearner(');

const rule={id:'rule',base_points:50,initiative_bonus_points:3},snapshot={rule_id:'rule',policy_version:'flh-010-v1.5',status:'pending',base_points:5,initiative_bonus_points:3,congregation_bonus_points:0,mosque_bonus_points:0,sunnah_bonus_points:0,adhkar_bonus_points:0,total_points:8};
const pending={id:'s1',learner_id:'test',rule_id:'rule',status:'pending',occurred_at:'2026-10-08T09:00:00Z',initiative:true,total_points:0,snapshot};
assert.equal(context.pendingProjection([rule],pending).total,8,'Captured pending estimate survives a current rule edit');
assert.equal(context.pendingProjection([rule],pending).source,'captured');
assert.equal(pending.total_points,0,'Preview must never write credited points');
assert.equal(context.pendingProjection([rule],{...pending,snapshot:{}}).total,53);
assert.equal(context.pendingProjection([rule],{...pending,snapshot:{}}).source,'current','Legacy estimate must be distinguished from a captured amount');
assert.equal(context.pendingProjection([rule],{...pending,snapshot:{...snapshot,total_points:9}}).total,null,'Broken component reconciliation must not invent a total');
assert.equal(context.pendingProjection([rule],{...pending,snapshot:{...snapshot,rule_id:'other'}}).total,null,'A captured amount must belong to the actual rule');
assert.equal(context.pendingProjection([rule],{...pending,snapshot:{...snapshot,base_points:100001,total_points:100004}}).total,null,'Captured components respect the server amount bounds');
const duplicate=context.pendingProjection([rule],{...pending,possible_duplicate:true});assert.equal(duplicate.total,8);assert.equal(duplicate.forecast,0,'Known approved duplicate retains its nominal snapshot without promising another grant');
assert.equal(context.pendingProjection([],{...pending,snapshot:{}}).total,null,'Missing legacy rule has no reliable estimate');
const summary=context.pendingSummary([rule],[pending,{...pending,id:'s2',occurred_at:'2026-10-08T12:00:00+03:00'},{...pending,id:'s3',status:'approved'}]);
assert.equal(summary.count,2);assert.equal(summary.uniqueCount,1);assert.equal(summary.total,8,'One exact occurrence contributes once while the visible pending count retains both rows');
assert.equal(context.pendingSummary([rule],[pending,{...pending,id:'other',rule_id:'missing',snapshot:{}}]).total,null,'Unavailable items must not silently disappear from the aggregate estimate');

const rules=[{id:'never'},{id:'once'},{id:'frequent'}];
assert.deepEqual(Array.from(context.recentBehaviorOrder(rules,[],'test'),row=>row.id),['never','once','frequent'],'No usage evidence keeps stable catalog order');
const usage=[{learner_id:'test',rule_id:'once',status:'approved',occurred_at:'2026-10-08T10:00:00Z'},...['01','02'].map(day=>({learner_id:'test',rule_id:'frequent',status:'pending',occurred_at:`2026-10-${day}T09:00:00Z`})),{learner_id:'sibling',rule_id:'never',status:'approved',occurred_at:'2026-10-08T11:00:00Z'}];
assert.deepEqual(Array.from(context.recentBehaviorOrder(rules,usage,'test'),row=>row.id),['frequent','once','never'],'Only the actual learner usage can influence direct behavior order');

const form={dataset:{},values:{frSelfReportRule:{value:'rule'},frSelfReportDateMode:{value:'custom'},frSelfReportDate:{value:'2026-10-03'},frSelfReportReason:{value:''}}};
const first=context.occurrenceAt(form,'frSelfReport');assert.equal(first,'2026-10-03T09:15:37.123Z','Automatic past-day time retains Istanbul local clock and subsecond precision');
form.dataset.idempotencyKey='stable-retry';now+=3600000;
assert.equal(context.occurrenceAt(form,'frSelfReport'),first);assert.equal(form.dataset.idempotencyKey,'stable-retry','Lost-response retry preserves the occurrence and request key');
form.values.frSelfReportReason.value='ملاحظة معدّلة';assert.equal(context.occurrenceAt(form,'frSelfReport'),first);assert.equal(form.dataset.idempotencyKey,'stable-retry','A note edit must not silently create another physical occurrence after an uncertain response');
delete form.dataset.occurredAt;delete form.dataset.occurrenceSignature;delete form.dataset.idempotencyKey;
assert.notEqual(context.occurrenceAt(form,'frSelfReport'),first,'An intentional new report must not collapse into one fixed morning timestamp');
form.values.frSelfReportDateMode.value='today';assert.equal(context.occurrenceAt(form,'frSelfReport'),null);form.dataset.idempotencyKey='server-now';now+=86400000;
assert.equal(context.occurrenceAt(form,'frSelfReport'),null);assert.equal(form.dataset.idempotencyKey,'server-now','Today retries keep the server-bound timestamp across midnight');
form.values.frSelfReportRule.value='new-rule';context.occurrenceAt(form,'frSelfReport');assert.equal(form.dataset.idempotencyKey,undefined,'A changed semantic request gets a fresh identity');

assert.equal(context.approvalOutcome({submission:{...pending,status:'approved',total_points:8}},pending).points,8);
assert.equal(context.approvalOutcome({already_reviewed:true,submission:{...pending,status:'approved',total_points:8}},pending).points,0,'Previously approved result is not a new grant');
assert.equal(context.approvalOutcome({submission:{...pending,learner_id:'sibling',status:'approved',total_points:8}},pending).state,'failed','Wrong learner response cannot count as an approval');
assert.equal(context.approvalOutcome({submission:{...pending,status:'rejected',total_points:0}},pending).state,'failed');
console.log('Family rewards UI unit QA passed: captured/legacy estimates, exact-occurrence summaries, real usage order, stable timestamps and actual approval outcomes.');
