import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertAuthenticatedBrowserSafety, runAuthenticatedStage, runOwnedQaLifecycle } from './authenticated-e2e.mjs';
import {
  ACTOR_ID,
  LEASE_TTL_SECONDS,
  QA_QUIZ_SLUG,
  REPOSITORY,
  REPOSITORY_ID,
  SESSION_SECONDS,
  WORKFLOW_PREFIX,
  WORKFLOW_PREFIXES,
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

const diagnosticLines=[],privateValue='synthetic-private-token-url-body';
const emit=line=>diagnosticLines.push(line);
assert.equal(await runAuthenticatedStage('OIDC_REQUEST',async()=>privateValue,emit),privateValue);
assert.equal(diagnosticLines.length,2);
assert.ok(diagnosticLines.every(line=>!line.includes(privateValue)),'operation values never enter diagnostic markers');
const originalFailure=Object.assign(new Error(privateValue),{name:'TimeoutError'});
await assert.rejects(()=>runAuthenticatedStage('PROGRAM_READY',async()=>{throw originalFailure;},emit),error=>error===originalFailure,'stage instrumentation rethrows the actual original exception');
assert.ok(diagnosticLines.at(-1).includes('"code":"BROWSER_TIMEOUT"'));
assert.ok(!diagnosticLines.at(-1).includes(privateValue));
let invalidOperationCalls=0;
await assert.rejects(()=>runAuthenticatedStage(privateValue,async()=>{invalidOperationCalls++;},emit),/QA_AUTH_DIAGNOSTIC_STAGE_INVALID/);
assert.equal(invalidOperationCalls,0);
let guardCalls=0;
const safetyLines=[];
assert.throws(()=>assertAuthenticatedBrowserSafety({unexpected:[privateValue],assertNoUnexpectedRequests(){guardCalls++;throw new Error(privateValue);}},[privateValue],line=>safetyLines.push(line)),/QA_BROWSER_NETWORK_REJECTED/);
assert.equal(guardCalls,1);
assert.deepEqual(JSON.parse(safetyLines[0].slice('QA_AUTH_NETWORK '.length)),{status:'FAIL',unexpected_requests:1,browser_errors:1});
assert.ok(!safetyLines[0].includes(privateValue),'only network/browser-error counts escape even when the flow failed');
assert.throws(()=>assertAuthenticatedBrowserSafety({unexpected:[],assertNoUnexpectedRequests(){}},[privateValue],()=>{}),/QA_BROWSER_ERRORS/);
let cleanupAfterDiagnostic=false;
await assert.rejects(()=>runOwnedQaLifecycle({
  prepare:async()=>({run_id:'owned-synthetic',session:privateValue}),
  validate:async()=>{},
  run:()=>runAuthenticatedStage('PROGRAM_READY',async()=>{throw originalFailure;},emit),
  cleanup:async()=>{cleanupAfterDiagnostic=true;throw new Error('secondary cleanup failure');},
}),error=>error===originalFailure);
assert.equal(cleanupAfterDiagnostic,true,'original failure still triggers owned cleanup and keeps priority');

assert.equal(validateGithubClaims(validClaims), true);
assert.equal(WORKFLOW_PREFIXES.length, 2);
assert.equal(validateGithubClaims({ ...validClaims, workflow_ref: `${WORKFLOW_PREFIXES[1]}refs/pull/147/merge` }, 'runner-local'), true);
assert.throws(() => validateGithubClaims({ ...validClaims, workflow_ref: `${WORKFLOW_PREFIXES[1]}refs/pull/147/merge` }, 'isolated-testing'), /WORKFLOW_NOT_ALLOWED/);
assert.throws(() => validateGithubClaims({ ...validClaims, workflow_ref: `${REPOSITORY}/.github/workflows/qa-authenticated-local.yml.evil@refs/heads/main` }), /WORKFLOW_NOT_ALLOWED/);
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

const workflow = fs.readFileSync('.github/workflows/qa-isolated.yml', 'utf8').replace(/\r\n/g, '\n');
assert.match(workflow, /supabase\/functions\/qa-auth\/index\.ts/);
assert.match(workflow, /^  static-quality:\n(?:.*\n)*?    concurrency:\n      group: qa-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n      cancel-in-progress: true$/m, 'stale static QA should cancel without interrupting shared Testing cleanup');
assert.match(workflow, /^  browser-smoke:\n(?:.*\n)*?    concurrency:\n      group: isolated-browser-\$\{\{ github\.repository \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n      cancel-in-progress: true$/m, 'independent mock browser checks cancel superseded own-PR/ref work without cancelling unrelated heads');
const authenticatedWorkflow = fs.readFileSync('.github/workflows/qa-authenticated-local.yml', 'utf8').replace(/\r\n/g, '\n');
assert.match(authenticatedWorkflow, /concurrency:\n      group: authenticated-local-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n      cancel-in-progress: false/, 'owned authenticated lifecycle retains cleanup without cancellation');

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
