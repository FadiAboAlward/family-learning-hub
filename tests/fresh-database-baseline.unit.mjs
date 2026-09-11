import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const migrationDirectory = path.join('supabase', 'migrations');
const architectureFile = '20260823213038_family_learning_hub_program_architecture.sql';
const removedSquashFile = '20260823213000_pre_program_architecture_baseline.sql';
const removedBootstrapFile = '20260823212000_enable_pgcrypto.sql';

// These are the exact 28 versions already recorded in the Production migration
// ledger before the first repository-tracked architecture migration. Keeping the
// versions as real files makes a future db push skip them instead of treating a
// synthetic squash version as pending.
const expectedHistoricalFiles = [
  '20260823110617_001_core_learning_schema.sql',
  '20260823110658_002_security_and_index_hardening.sql',
  '20260823114524_003_curricula_and_config_layer.sql',
  '20260823115419_004_adaptive_learning_engine.sql',
  '20260823115503_005_adaptive_learning_indexes.sql',
  '20260823120202_006_pedagogy_feedback_engine.sql',
  '20260823120214_007_pedagogy_indexes.sql',
  '20260823120223_008_pedagogy_feedback_constraints.sql',
  '20260823120318_009_misconception_aware_feedback.sql',
  '20260823120621_009_curriculum_language_transition.sql',
  '20260823120714_010_language_delivery_separation.sql',
  '20260823123334_009_gamification_and_rewards_engine.sql',
  '20260823123351_010_gamification_indexes.sql',
  '20260823123401_011_gamification_reward_integrity.sql',
  '20260823123409_012_gamification_level_guard.sql',
  '20260823123423_013_gamification_seed_badges.sql',
  '20260823141315_test_learner_account_policy.sql',
  '20260823141328_mark_test_learner_in_reports.sql',
  '20260823141533_repeatable_test_gamification.sql',
  '20260823142137_learner_session_tracking.sql',
  '20260823142302_session_tracking_grants_and_parent_index.sql',
  '20260823142324_learning_session_settings_update.sql',
  '20260823142337_learning_session_duration_view.sql',
  '20260823142357_session_tracking_view_security.sql',
  '20260823142803_remove_session_report_view.sql',
  '20260823150650_quiz_learning_and_exam_modes.sql',
  '20260823150758_exam_mode_attempt_reporting.sql',
  '20260823150830_exam_mode_defaults_setting.sql',
];

const migrationFiles = fs
  .readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const preArchitectureFiles = migrationFiles.filter((file) => file < architectureFile);

assert.equal(expectedHistoricalFiles.length, 28, 'the hosted historical ledger boundary must contain 28 versions');
assert.deepEqual(
  preArchitectureFiles,
  expectedHistoricalFiles,
  'pre-architecture migrations must be exactly the 28 versions already recorded in the Production ledger',
);
assert.ok(fs.existsSync(path.join(migrationDirectory, architectureFile)), 'the first tracked architecture migration must remain in place');
assert.ok(!fs.existsSync(path.join(migrationDirectory, removedSquashFile)), 'the synthetic squash version must not return');
assert.ok(!fs.existsSync(path.join(migrationDirectory, removedBootstrapFile)), 'the redundant unregistered pgcrypto bootstrap must not return');

const historicalSql = expectedHistoricalFiles
  .map((file) => fs.readFileSync(path.join(migrationDirectory, file), 'utf8').trim())
  .join('\n');
const historicalSqlSha256 = crypto.createHash('sha256').update(historicalSql).digest('hex');

assert.equal(
  historicalSqlSha256,
  '002f6b0b537652f3cf9d4c0cedb283d37e7215d2795701378119aa4a025c5931',
  'historical files must retain the exact previously verified SQL statements and ordering',
);
assert.match(
  fs.readFileSync(path.join(migrationDirectory, expectedHistoricalFiles[0]), 'utf8'),
  /^create extension if not exists pgcrypto;/i,
  'the first historical migration must install pgcrypto before any qualified pgcrypto call is parsed',
);
assert.doesNotMatch(historicalSql, /insert\s+into\s+public\.learners\b/i, 'baseline must not fabricate learner identities');
assert.doesNotMatch(historicalSql, /insert\s+into\s+public\.learner_access_tokens\b/i, 'baseline must not fabricate learner credentials');
assert.doesNotMatch(historicalSql, /insert\s+into\s+public\.quiz_attempts\b/i, 'baseline must not fabricate learner attempts');
assert.match(
  historicalSql,
  /55f9224c-8ba7-4cbc-9f88-713e6a6b41df[\s\S]+Ayaa School[\s\S]+ayaa-school/,
  'baseline must preserve the canonical workspace identity required by later migrations',
);

console.log('historical migration versions, SQL integrity, boundary, and learner-data guards passed.');
