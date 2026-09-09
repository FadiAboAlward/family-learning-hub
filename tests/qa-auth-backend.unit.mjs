import fs from 'node:fs';

const auth = fs.readFileSync('supabase/functions/qa-auth/index.ts', 'utf8');
const workflow = fs.readFileSync('.github/workflows/qa-smoke.yml', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260909055000_harden_testing_qa_concurrency.sql', 'utf8');

for (const token of [
  'REPOSITORY_ID = "1343709875"',
  'ACTOR_ID = "320162789"',
  'runner_environment',
  'metadata.exclude_from_parent_metrics !== true',
  'flh_qa_acquire_testing_lease',
  'flh_qa_release_testing_lease',
  'QA_BUSY',
  'QA_LEASE_NOT_OWNED',
  'QA_QUIZ_SLUG = "qa-automation-core"',
  '.eq("learner_id", learnerId)',
  '.eq("quiz_version_id", versionId)',
  'body.action == null ? "legacy"',
  'LEGACY_LEASE_TTL_SECONDS = 3 * 60',
  'if (action === "legacy")',
]) {
  if (!auth.includes(token)) throw new Error(`qa-auth invariant missing: ${token}`);
}

const legacyBlock = auth.slice(auth.indexOf('if (action === "legacy")'), auth.indexOf('if (action === "prepare")'));
for (const token of [
  'acquireTestingLease(runId, LEGACY_LEASE_TTL_SECONDS)',
  'clearTestingAttempts(learner.id)',
  'issueLearnerSession(learner.id)',
  'legacy_lock_seconds: LEGACY_LEASE_TTL_SECONDS',
]) {
  if (!legacyBlock.includes(token)) throw new Error(`Legacy rollout protection missing: ${token}`);
}
if (legacyBlock.includes('run_id:')) {
  throw new Error('Legacy compatibility response must not expose run ownership that the old E2E cannot clean up.');
}

if (!workflow.includes('supabase/functions/qa-auth/index.ts')) {
  throw new Error('qa-auth TypeScript must be compile-checked by Static quality.');
}

for (const token of [
  'private.qa_run_leases',
  'flh_qa_acquire_testing_lease',
  'flh_qa_release_testing_lease',
  'grant execute on function public.flh_qa_acquire_testing_lease',
  'to service_role',
  "'exclude_from_parent_metrics', true",
  "'show_on_login', false",
  "'canonical_qa_quiz_slug', 'qa-automation-core'",
]) {
  if (!migration.includes(token)) throw new Error(`QA migration invariant missing: ${token}`);
}

console.log('qa-auth backend security and rollout regression passed.');
