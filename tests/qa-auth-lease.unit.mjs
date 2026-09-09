import fs from 'node:fs';

const auth = fs.readFileSync('supabase/functions/qa-auth/index.ts', 'utf8');
const e2e = fs.readFileSync('tests/authenticated-e2e.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/qa-smoke.yml', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260909055000_harden_testing_qa_concurrency.sql', 'utf8');

const requiredAuth = [
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
];
for (const token of requiredAuth) {
  if (!auth.includes(token)) throw new Error(`qa-auth invariant missing: ${token}`);
}

for (const token of ["qaAuth('prepare')", 'prepared.run_id', "qaAuth('cleanup', prepared.run_id)", 'finally {']) {
  if (!e2e.includes(token)) throw new Error(`authenticated E2E ownership invariant missing: ${token}`);
}

for (const token of ['group: family-learning-hub-testing-learner', 'cancel-in-progress: false', 'supabase/functions/qa-auth/index.ts']) {
  if (!workflow.includes(token)) throw new Error(`QA workflow serialization invariant missing: ${token}`);
}

for (const token of [
  'private.qa_run_leases',
  'flh_qa_acquire_testing_lease',
  'flh_qa_release_testing_lease',
  'grant execute on function public.flh_qa_acquire_testing_lease',
  'to service_role',
  "'exclude_from_parent_metrics', true",
  "'show_on_login', false",
]) {
  if (!migration.includes(token)) throw new Error(`QA migration invariant missing: ${token}`);
}

console.log('Testing QA lease/OIDC regression passed.');
