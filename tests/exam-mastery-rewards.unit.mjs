import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20261006172419_exam_mastery_rewards.sql','utf8').replace(/\r\n/g,'\n');

for(const fragment of [
  'FLH-FEAT-2026-010 v1.2',
  'create or replace function public.flh_exam_reward_target',
  'when coalesce(p_percentage, 0) < 80',
  `jsonb_build_object('xp', 30, 'reward_points', 5)`,
  `jsonb_build_object('xp', 40, 'reward_points', 7)`,
  `jsonb_build_object('xp', 50, 'reward_points', 10)`,
  `jsonb_build_object('xp', 60, 'reward_points', 12)`,
  `jsonb_build_object('xp', 75, 'reward_points', 15)`,
  `v_cached_result := v_attempt.metadata->'exam_submit_last_result'`,
  `and e.source_type = 'exam'`,
  `and e.source_id = v_quiz_id::text`,
  `v_xp_delta := greatest(0, v_target_xp - v_prior_xp)`,
  `v_reward_points_delta := greatest(0, v_target_reward_points - v_prior_reward_points)`,
  `'reward_policy', 'exam-mastery-v1.2'`,
  `'exam_submit_last_result',v_result`,
  `v_is_paper := nullif(v_attempt.metadata->>'paper_model_code','') is not null`,
  `'reason', 'paper_exam_unchanged'`,
  `for update;`,
  `revoke all on function public.flh_exam_submit(uuid,uuid,uuid) from anon, authenticated`,
  `grant execute on function public.flh_exam_submit(uuid,uuid,uuid) to service_role`,
  `'exam',\n        v_quiz_id::text`
]){
  assert.ok(migration.includes(fragment),`Exam mastery reward migration missing invariant: ${fragment}`);
}

assert.ok(
  migration.indexOf('for update;') < migration.indexOf(`and e.source_type = 'exam'`),
  'attempt/learner serialization must happen before reading prior Exam reward state'
);

const learnerQueryIndex=migration.indexOf('and l.is_active');
const learnerLockIndex=migration.indexOf('for update;',learnerQueryIndex);
const priorExamRewardIndex=migration.indexOf(`and e.source_type = 'exam'`);
assert.ok(
  learnerQueryIndex >= 0 && learnerLockIndex > learnerQueryIndex &&
  priorExamRewardIndex >= 0 && learnerLockIndex < priorExamRewardIndex,
  'active learner serialization must happen before reading prior Exam reward state'
);

assert.ok(
  migration.includes(`if v_xp_delta > 0 or v_reward_points_delta > 0 then`) &&
  migration.includes(`insert into public.gamification_events(`),
  'ledger event must be written only for a positive Exam reward increment'
);

console.log('Exam mastery reward migration invariants passed');
