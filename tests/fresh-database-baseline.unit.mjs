import assert from 'node:assert/strict';
import fs from 'node:fs';

const baselinePath = 'supabase/migrations/20260823213000_pre_program_architecture_baseline.sql';
const architecturePath = 'supabase/migrations/20260823213038_family_learning_hub_program_architecture.sql';
const baseline = fs.readFileSync(baselinePath, 'utf8');

const expectedHistoricalSources = [
  '20260823110617_001_core_learning_schema',
  '20260823110658_002_security_and_index_hardening',
  '20260823114524_003_curricula_and_config_layer',
  '20260823115419_004_adaptive_learning_engine',
  '20260823115503_005_adaptive_learning_indexes',
  '20260823120202_006_pedagogy_feedback_engine',
  '20260823120214_007_pedagogy_indexes',
  '20260823120223_008_pedagogy_feedback_constraints',
  '20260823120318_009_misconception_aware_feedback',
  '20260823120621_009_curriculum_language_transition',
  '20260823120714_010_language_delivery_separation',
  '20260823123334_009_gamification_and_rewards_engine',
  '20260823123351_010_gamification_indexes',
  '20260823123401_011_gamification_reward_integrity',
  '20260823123409_012_gamification_level_guard',
  '20260823123423_013_gamification_seed_badges',
  '20260823141315_test_learner_account_policy',
  '20260823141328_mark_test_learner_in_reports',
  '20260823141533_repeatable_test_gamification',
  '20260823142137_learner_session_tracking',
  '20260823142302_session_tracking_grants_and_parent_index',
  '20260823142324_learning_session_settings_update',
  '20260823142337_learning_session_duration_view',
  '20260823142357_session_tracking_view_security',
  '20260823142803_remove_session_report_view',
  '20260823150650_quiz_learning_and_exam_modes',
  '20260823150758_exam_mode_attempt_reporting',
  '20260823150830_exam_mode_defaults_setting',
];

const sourceMarkers = [...baseline.matchAll(/^-- Historical source: (\d{14})_([^\r\n]+)$/gm)];
assert.deepEqual(
  sourceMarkers.map(([, version, name]) => `${version}_${name}`),
  expectedHistoricalSources,
  'baseline must preserve the exact ordered pre-architecture migration boundary',
);
assert.ok(
  sourceMarkers.every(([, version]) => version < '20260823213038'),
  'baseline must contain only migrations from before the first tracked architecture migration',
);
assert.equal(
  sourceMarkers.at(-1)?.[1],
  '20260823150830',
  'baseline boundary must end at the last known pre-architecture migration',
);
assert.ok(fs.existsSync(architecturePath), 'the first tracked architecture migration must remain in place');
assert.doesNotMatch(baseline, /insert\s+into\s+public\.learners\b/i, 'baseline must not fabricate learner identities');
assert.doesNotMatch(baseline, /insert\s+into\s+public\.learner_access_tokens\b/i, 'baseline must not fabricate learner credentials');
assert.doesNotMatch(baseline, /insert\s+into\s+public\.quiz_attempts\b/i, 'baseline must not fabricate learner attempts');
assert.match(
  baseline,
  /55f9224c-8ba7-4cbc-9f88-713e6a6b41df[\s\S]+Ayaa School[\s\S]+ayaa-school/,
  'baseline must preserve the canonical workspace identity required by later migrations',
);

console.log('fresh database baseline boundary and learner-data guards passed.');
