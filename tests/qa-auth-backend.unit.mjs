import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOwnedQaLifecycle } from './authenticated-e2e.mjs';
import {
  ACTOR_ID,
  LEASE_TTL_SECONDS,
  QA_QUIZ_SLUG,
  REPOSITORY,
  REPOSITORY_ID,
  SESSION_SECONDS,
  WORKFLOW_PREFIX,
  executeQaAction,
  validateGithubClaims,
} from '../supabase/functions/qa-auth/logic.mjs';

const validClaims = {
  repository: REPOSITORY,
  repository_id: REPOSITORY_ID,
  actor_id: ACTOR_ID,
  workflow_ref: `${WORKFLOW_PREFIX}refs/heads/main`,
  event_name: 'pull_request',
  runner_environment: 'github-hosted',
};

assert.equal(validateGithubClaims(validClaims), true);
for (const [field, value, expected] of [
  ['repository', 'other/repo', 'REPOSITORY_NOT_ALLOWED'],
  ['repository_id', '1', 'REPOSITORY_NOT_ALLOWED'],
  ['actor_id', '1', 'ACTOR_NOT_ALLOWED'],
  ['workflow_ref', `${REPOSITORY}/.github/workflows/other.yml@refs/heads/main`, 'WORKFLOW_NOT_ALLOWED'],
  ['event_name', 'schedule', 'EVENT_NOT_ALLOWED'],
  ['runner_environment', 'self-hosted', 'RUNNER_NOT_ALLOWED'],
]) {
  assert.throws(() => validateGithubClaims({ ...validClaims, [field]: value }), new RegExp(expected));
}
for (const eventName of ['pull_request', 'push', 'workflow_dispatch']) {
  assert.equal(validateGithubClaims({ ...validClaims, event_name: eventName }), true);
}

const learner = { id: 'learner-test', display_name: 'Testing', slug: 'test' };
const generatedIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
let idIndex = 0;
let leaseOwner = null;
let cleared = 0;
let lastLeaseTtl = null;
const deps = {
  createRunId: () => generatedIds[idIndex++],
  acquireLease: async (runId, ttl) => {
    lastLeaseTtl = ttl;
    if (leaseOwner === null || leaseOwner === runId) {
      leaseOwner = runId;
      return true;
    }
    return false;
  },
  releaseLease: async runId => {
    if (leaseOwner !== runId) return false;
    leaseOwner = null;
    return true;
  },
  clearAttempts: async id => {
    assert.equal(id, learner.id);
    cleared += 1;
    return 1;
  },
  issueSession: async id => `session:${id}`,
};

const firstPrepare = await executeQaAction({ action: 'prepare', learner }, deps);
assert.equal(firstPrepare.status, 200);
assert.equal(firstPrepare.body.run_id, generatedIds[0]);
assert.equal(firstPrepare.body.quiz_slug, QA_QUIZ_SLUG);
assert.equal(firstPrepare.body.session, `session:${learner.id}`);
assert.equal(firstPrepare.body.expires_in, SESSION_SECONDS);
assert.equal(lastLeaseTtl, LEASE_TTL_SECONDS);
assert.equal(leaseOwner, generatedIds[0]);

const busyPrepare = await executeQaAction({ action: 'prepare', learner }, deps);
assert.deepEqual(busyPrepare, { status: 409, body: { error: 'QA_BUSY' } });
assert.equal(leaseOwner, generatedIds[0]);

const malformedCleanup = await executeQaAction({ action: 'cleanup', runId: 'not-a-uuid', learner }, deps);
assert.deepEqual(malformedCleanup, { status: 400, body: { error: 'INVALID_RUN_ID' } });
assert.equal(leaseOwner, generatedIds[0]);

const cleanup = await executeQaAction({ action: 'cleanup', runId: generatedIds[0], learner }, deps);
assert.equal(cleanup.status, 200);
assert.equal(cleanup.body.ok, true);
assert.equal(leaseOwner, null);

const secondPrepare = await executeQaAction({ action: 'prepare', learner }, deps);
assert.equal(secondPrepare.status, 200);
assert.equal(secondPrepare.body.run_id, generatedIds[2]);
assert.equal(leaseOwner, generatedIds[2]);
await executeQaAction({ action: 'cleanup', runId: generatedIds[2], learner }, deps);
assert.equal(leaseOwner, null);
assert.ok(cleared >= 4);

const missingAction = await executeQaAction({ action: null, learner }, deps);
assert.deepEqual(missingAction, { status: 400, body: { error: 'UNKNOWN_ACTION' } });
assert.equal(leaseOwner, null);

const validationFailureRunId = '44444444-4444-4444-8444-444444444444';
let browserFlowRan = false;
const lifecycleCleanupIds = [];
await assert.rejects(
  () => runOwnedQaLifecycle({
    prepare: async () => ({ run_id: validationFailureRunId }),
    validate: async () => { throw new Error('synthetic validation failure'); },
    run: async () => { browserFlowRan = true; },
    cleanup: async runId => { lifecycleCleanupIds.push(runId); },
  }),
  /synthetic validation failure/,
);
assert.equal(browserFlowRan, false, 'browser flow must not run after validation failure');
assert.deepEqual(lifecycleCleanupIds, [validationFailureRunId], 'owned run must be cleaned after validation failure');

const workflow = fs.readFileSync('.github/workflows/qa-smoke.yml', 'utf8').replace(/\r\n/g, '\n');
assert.match(workflow, /supabase\/functions\/qa-auth\/index\.ts/);
assert.match(workflow, /^concurrency:\n  group: qa-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: false$/m, 'workflow-level cancellation must preserve cleanup');
assert.match(workflow, /^  browser-smoke:\n(?:.*\n)*?    concurrency:\n      group: family-learning-hub-testing-learner\n      cancel-in-progress: false$/m, 'Testing browser job must be serialized without cancellation');

const migration = fs.readFileSync('supabase/migrations/20260909055000_harden_testing_qa_concurrency.sql', 'utf8');
assert.match(migration, /on conflict \(workspace_id, slug\) do update/);
assert.match(migration, /alter table private\.qa_run_leases enable row level security/);
assert.match(migration, /revoke all on table private\.qa_run_leases from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.flh_qa_acquire_testing_lease\(uuid, uuid, integer\) to service_role/);
assert.match(migration, /grant execute on function public\.flh_qa_release_testing_lease\(uuid, uuid\) to service_role/);

const logic = fs.readFileSync('supabase/functions/qa-auth/logic.mjs', 'utf8');
assert.doesNotMatch(logic, /LEGACY_LEASE_TTL_SECONDS|normalized === 'legacy'/);

const e2e = fs.readFileSync('tests/authenticated-e2e.mjs', 'utf8');
assert.match(e2e, /requestQaAuth\('prepare'\)/);
assert.match(e2e, /ownedRunId = prepared\?\.run_id \|\| null/);
assert.match(e2e, /finally \{/);
assert.match(e2e, /await cleanup\(ownedRunId\)/);
assert.match(e2e, /payload\.error === 'QA_BUSY'/);
assert.doesNotMatch(e2e, /v1 compatibility|ownsRun/);

console.log('qa-auth owned lifecycle, behavioral security, serialization, cleanup regression, and migration guards passed.');
