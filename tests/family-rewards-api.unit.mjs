import assert from 'node:assert/strict';
import {
  canManageRewardsRole, executeFamilyRewardsAction, isFamilyRewardsAction,
  learnerProfileRewards, publicRewardsError, rewardsErrorStatus,
} from '../supabase/functions/_shared/family-rewards.mjs';

const parentId = '10000000-0000-4000-8000-000000000001';
const learnerId = '20000000-0000-4000-8000-000000000001';
const otherId = '30000000-0000-4000-8000-000000000001';
const workspaceId = '40000000-0000-4000-8000-000000000001';
const scopedRewards = [
  { id: 'all', title: 'All real learners', learner_scope: 'all', reward_learner_scopes: [] },
  { id: 'own', title: 'Own reward', learner_scope: 'selected', reward_learner_scopes: [{ learner_id: learnerId }, { learner_id: otherId }] },
  { id: 'other', title: 'Sibling reward', learner_scope: 'selected', reward_learner_scopes: [{ learner_id: otherId }] },
  { id: 'unknown', title: 'Unknown scope', learner_scope: 'unknown' },
];
assert.deepEqual(learnerProfileRewards(scopedRewards, learnerId, false).map(x => x.id), ['all', 'own']);
assert.deepEqual(learnerProfileRewards(scopedRewards, learnerId, true).map(x => x.id), ['own']);
assert.ok(learnerProfileRewards(scopedRewards, learnerId, false).every(x => !Object.hasOwn(x, 'reward_learner_scopes') && !Object.hasOwn(x, 'learner_scope')));
assert.deepEqual(learnerProfileRewards(null, learnerId, false), []);
const calls = [];
const deps = {
  workspaceId,
  parentIdentity: async () => ({ user: { id: parentId }, member: { role: 'owner' } }),
  learnerIdentity: async () => ({ learner_id: learnerId, workspace_id: workspaceId }),
  rpc: async (name, parameters) => { calls.push({ name, parameters }); return { data: { ok: true }, error: null }; },
};

for (const role of ['owner', 'admin']) assert.equal(canManageRewardsRole(role), true);
for (const role of ['teacher', 'viewer', null, undefined, 'OWNER']) assert.equal(canManageRewardsRole(role), false);
const parentActions = ['parent_rewards_dashboard', 'parent_rewards_ledger', 'category_save', 'rule_save',
  'reward_save', 'behavior_record', 'behavior_review', 'reward_review', 'reward_redeem', 'points_adjust'];
for (const action of parentActions) {
  const before = calls.length;
  await assert.rejects(() => executeFamilyRewardsAction(action, { learner_id: learnerId }, {
    ...deps, parentIdentity: async () => ({ user: { id: parentId }, member: { role: 'teacher' } }),
  }), /NOT_REWARDS_ADMIN/);
  assert.equal(calls.length, before, `${action} must reject before privileged RPC`);
}
for (const action of ['student_rewards_dashboard', 'student_rewards_ledger', 'behavior_submit', 'reward_request']) {
  await executeFamilyRewardsAction(action, {
    learner_id: otherId, workspace_id: otherId, actor_id: parentId, reviewer: parentId,
    reward_points_delta: 999999, xp_delta: 999, action,
    rule_id: otherId, reward_id: otherId, initiative: true, adhkar_completed: true, idempotency_key: otherId,
  }, { ...deps, parentIdentity: async () => { throw new Error('must not use parent identity'); } });
  const { parameters } = calls.at(-1);
  assert.equal(parameters.p_learner_id, learnerId);
  assert.equal(parameters.p_actor_id, null);
  assert.equal(parameters.p_workspace_id, workspaceId);
  for (const key of ['learner_id', 'workspace_id', 'actor_id', 'reviewer', 'xp_delta', 'reward_points_delta', 'action']) {
    assert.equal(Object.hasOwn(parameters.p_payload, key), false, `${key} must not cross learner boundary`);
  }
}

await executeFamilyRewardsAction('behavior_record', { learner_id: learnerId, rule_id: otherId, initiative: true, adhkar_completed: true }, deps);
assert.equal(calls.at(-1).parameters.p_actor_id, parentId);
assert.equal(calls.at(-1).parameters.p_learner_id, learnerId);
assert.equal(calls.at(-1).parameters.p_payload.rule_id, otherId);
assert.equal(calls.at(-1).parameters.p_payload.adhkar_completed, true, 'parent prayer record may forward the linked adhkar selection');
const learnerSubmit = calls.findLast(row => row.parameters?.p_payload?.rule_id === otherId && row.parameters?.p_actor_id === null);
assert.equal(learnerSubmit.parameters.p_payload.adhkar_completed, true, 'learner prayer self-report may forward the linked adhkar selection');
for (const invalid of [undefined, '', 'another-child', 123]) {
  await assert.rejects(() => executeFamilyRewardsAction('points_adjust', { learner_id: invalid, delta: 1, reason: 'تصحيح' }, deps), /INVALID_LEARNER_ID/);
}
for (const action of parentActions) assert.equal(isFamilyRewardsAction(action), true);
assert.equal(isFamilyRewardsAction('parent_dashboard'), false, 'existing parent reporting remains unchanged');
await assert.rejects(() => executeFamilyRewardsAction('made_up', {}, deps), /UNKNOWN_ACTION/);
const beforeAuth = calls.length;
await assert.rejects(() => executeFamilyRewardsAction('behavior_submit', {}, {
  ...deps, learnerIdentity: async () => { throw new Error('SESSION_EXPIRED'); },
}), /SESSION_EXPIRED/);
assert.equal(calls.length, beforeAuth);

await assert.rejects(() => executeFamilyRewardsAction('reward_request', {}, {
  ...deps, rpc: async () => ({ error: { message: 'INSUFFICIENT_POINTS' } }),
}), /INSUFFICIENT_POINTS/);
assert.equal(publicRewardsError({ message: 'database secret or child text', detail: 'sensitive' }), 'REWARDS_SERVER_ERROR');
assert.equal(publicRewardsError({ message: 'INVALID_POINTS' }), 'INVALID_POINTS');
assert.equal(rewardsErrorStatus('SESSION_EXPIRED'), 401);
assert.equal(rewardsErrorStatus('NOT_REWARDS_ADMIN'), 403);
assert.equal(rewardsErrorStatus('RULE_NOT_FOUND'), 404);
assert.equal(rewardsErrorStatus('INSUFFICIENT_POINTS'), 409);
assert.equal(rewardsErrorStatus('INVALID_CRITERIA'), 400);
assert.equal(rewardsErrorStatus('REWARDS_SERVER_ERROR'), 500);
await assert.rejects(() => executeFamilyRewardsAction('reward_request', {}, {
  ...deps, rpc: async () => ({ data: { error: 'CLAIM_ALREADY_PENDING' }, error: null }),
}), /CLAIM_ALREADY_PENDING/);
assert.equal(rewardsErrorStatus('SELF_REPORT_FORBIDDEN'), 403);
assert.equal(rewardsErrorStatus('CLAIM_ALREADY_PENDING'), 409);
assert.equal(publicRewardsError({ message: 'INVALID_INPUT' }), 'INVALID_INPUT');
console.log('Family rewards API identity, owner/admin authorization and safe errors: PASS');
