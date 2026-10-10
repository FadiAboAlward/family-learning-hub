import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { handleQaParentBulkConfirmation, assertQaExamCompletion, assertQaParent, assertQaResume, qaEvidenceDirectory } from './authenticated-e2e.mjs';
import { command, denyContainerProduction, qaOidcOriginEvidence, teardownLocal } from './qa-authenticated-local.mjs';
import { assertContainerProductionDenied, assertOwnedContainer, fetchRunnerLocalAuth, localFunctionConfig, ownedContainerHostsPath, qaProcessDiagnostic, readLocalRuntime, requireRunnerLocal, requireSuccessfulCoreEvidence, safeAuthenticatedFailure, safeQaFailure, safeQaProcessDiagnostic, AUTHENTICATED_QA_STAGES } from './qa-runner-local.mjs';

assert.ok(AUTHENTICATED_QA_STAGES.includes('LEARNER_REWARDS'), 'Student rewards diagnostics must use a dedicated allowlisted stage');
assert.ok(AUTHENTICATED_QA_STAGES.includes('PARENT_RETURN_EVENT_API_AUTH'), 'Isolated parent canonical return-event authenticated stage must be allowlisted');
assert.ok(AUTHENTICATED_QA_STAGES.includes('PARENT_INDIVIDUAL_SIBLING_REVIEW'), 'Every real authenticated synthetic QA stage must be allowlisted before it starts');
assert.equal(qaEvidenceDirectory('runner-local'),'qa-authenticated-evidence', 'Runner-owned screenshots stay with runner evidence');
assert.equal(qaEvidenceDirectory('isolated-testing'),'playwright-screenshots', 'Isolated-testing screenshots stay in the browser evidence folder');

const env = { FLH_QA_ISOLATION_MODE: 'runner-local', FLH_QA_BACKEND_URL: 'http://127.0.0.1:54321', FLH_QA_PROJECT_REF: 'local', APP_URL: 'http://localhost:4173/',
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'FadiAboAlward/family-learning-hub', GITHUB_ACTOR_ID: '320162789',
  GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2', FLH_QA_HEAD_SHA: 'a'.repeat(40), RUNNER_TEMP: os.tmpdir() };
const config = requireRunnerLocal(env);
const oidcEvidence=qaOidcOriginEvidence({ACTIONS_ID_TOKEN_REQUEST_URL:'https://regional-qa.actions.githubusercontent.com/synthetic-private-path?private=synthetic-private-query',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic-private-bearer'});
assert.deepEqual(oidcEvidence,{origin:'https://regional-qa.actions.githubusercontent.com'});
assert.equal(Object.isFrozen(oidcEvidence),true);
assert.doesNotMatch(JSON.stringify(oidcEvidence),/private|token|query|bearer|path/,'only the validated GitHub origin enters the safe evidence');
for(const requestUrl of [undefined,'https://synthetic-private.invalid/path?token=synthetic-private','https://regional.actions.githubusercontent.com.evil.invalid/token']){
  let failure;try{qaOidcOriginEvidence({ACTIONS_ID_TOKEN_REQUEST_URL:requestUrl});}catch(error){failure=error;}
  assert.equal(failure?.message,'QA_OIDC_URL_INVALID');
  assert.doesNotMatch(String(failure),/private|invalid\/path|token=|evil/,'foreign or malformed origins fail with a fixed error without the input URL');
}
const core = { status: 'PASS', headSha: config.headSha, requesterRunId: Number(config.runId), coreWorkflow: '.github/workflows/qa-isolated.yml', coreRunId: 123, coreRunAttempt: 2, coreRunStatus: 'completed', coreRunConclusion: 'success',
  checkedJobs: ['Static quality', 'Browser smoke'].map(name => ({ name, status: 'completed', conclusion: 'success', runAttempt: 2 })) };
assert.equal(requireSuccessfulCoreEvidence(config, core), true);
for (const changed of [{}, { ...core, headSha: 'b'.repeat(40) }, { ...core, status: 'FAIL' }, { ...core, requesterRunId: 1 }, { ...core, checkedJobs: [] }, { ...core, coreRunAttempt: 3 }]) assert.throws(() => requireSuccessfulCoreEvidence(config, changed), /CORE_EVIDENCE_REQUIRED/);
const hosts = '127.0.0.1 gkpoylfozvuwuwqeoduc.supabase.co db.gkpoylfozvuwuwqeoduc.supabase.co\n::1 gkpoylfozvuwuwqeoduc.supabase.co db.gkpoylfozvuwuwqeoduc.supabase.co\n';
assert.equal(assertContainerProductionDenied(hosts), true);
assert.throws(() => assertContainerProductionDenied(hosts + '203.0.113.1 gkpoylfozvuwuwqeoduc.supabase.co\n'), /DNS_NOT_DENIED/);
assert.throws(() => assertContainerProductionDenied(hosts.split('\n')[0]), /DNS_NOT_DENIED/);
for (const changed of [{}, { ...env, FLH_QA_ISOLATION_MODE: 'isolated-testing' }, { ...env, FLH_QA_BACKEND_URL: 'https://gkpoylfozvuwuwqeoduc.supabase.co' },
  { ...env, APP_URL: 'http://127.0.0.1:4173/' }, { ...env, GITHUB_ACTOR_ID: '1' }, { ...env, RUNNER_ENVIRONMENT: 'self-hosted' },
  { ...env, SUPABASE_ACCESS_TOKEN: 'synthetic-remote' }, { ...env, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-remote' }, { ...env, DATABASE_URL: 'postgres://remote' }]) assert.throws(() => requireRunnerLocal(changed), /QA_/);
const owned = { Name: `/supabase_db_${config.projectId}`, Config: { Labels: { 'com.supabase.cli.project': config.projectId } }, State: { Running: true } };
assert.equal(assertOwnedContainer(config, owned), true);
for (const changed of [{ ...owned, Name: '/supabase_db_other' }, { ...owned, Config: { Labels: {} } }, { ...owned, State: { Running: false } }]) assert.throws(() => assertOwnedContainer(config, changed), /NOT_OWNED/);
const dockerRoot = '/var/lib/docker', fullId = 'a'.repeat(64), secondId = 'b'.repeat(64);
const hostTarget = id => ({ ...owned, Id: id, HostsPath: `${dockerRoot}/containers/${id}/hosts` });
assert.equal(ownedContainerHostsPath(config, dockerRoot, hostTarget(fullId), fullId), hostTarget(fullId).HostsPath);
assert.equal(ownedContainerHostsPath(config, dockerRoot, { ...hostTarget(fullId), Name: `/realtime-dev.supabase_realtime_${config.projectId}` }, fullId), hostTarget(fullId).HostsPath);
const invalidTargets = [
  { ...hostTarget(fullId), Id: fullId.slice(0, 12) }, { ...hostTarget(fullId), Id: secondId },
  { ...hostTarget(fullId), Name: '/foreign_container' }, { ...hostTarget(fullId), Config: { Labels: { 'com.supabase.cli.project': 'other' } } },
  { ...hostTarget(fullId), State: { Running: false } }, { ...hostTarget(fullId), HostsPath: '/etc/hosts' },
  { ...hostTarget(fullId), HostsPath: `${dockerRoot}/containers/${secondId}/hosts` },
  { ...hostTarget(fullId), HostsPath: `${dockerRoot}/containers/${fullId}/../hosts` },
  { ...hostTarget(fullId), HostsPath: `${dockerRoot}/containers/${fullId}//hosts` },
];
for (const value of invalidTargets) assert.throws(() => ownedContainerHostsPath(config, dockerRoot, value, fullId), /QA_LOCAL_/);
for (const root of ['/', 'relative/docker', '//var/lib/docker', '/var/lib/docker/', '/var/lib/../docker', '/var/lib/docker\n', 'C:\\Docker']) assert.throws(() => ownedContainerHostsPath(config, root, hostTarget(fullId), fullId), /DOCKER_ROOT_INVALID/);

function hostsExec(targets, { changed, readback = hosts, root = dockerRoot } = {}) {
  const operations = [], writes = [];
  let inspected = 0;
  return { operations, writes, run: async (file, args, options) => {
    operations.push({ file, args });
    if (file === 'docker') {
      assert.notEqual(args[0], 'exec', 'DNS containment never depends on executables inside container images');
      if (args[0] === 'info') return JSON.stringify(root);
      if (args[0] === 'ps') { assert.ok(args.includes('--no-trunc')); return targets.map(value => value.Id === fullId.slice(0, 12) ? fullId : value.Id).join('\n'); }
      if (args[0] === 'inspect') { inspected++; return JSON.stringify([inspected > targets.length && changed ? changed : targets.find(value => value.Id === args[1]) || targets[0]]); }
    }
    assert.equal(file, 'sudo'); assert.equal(args[0], '-n');
    if (args[1] === 'tee') { assert.equal(args[2], '-a'); assert.equal(args.length, 4); assert.equal(options.input, hosts); writes.push(args[3]); return ''; }
    assert.deepEqual(args.slice(0, 2), ['-n', 'cat']); assert.equal(args.length, 3); return readback;
  } };
}
const validHostExec = hostsExec([hostTarget(fullId), { ...hostTarget(secondId), Name: `/supabase_rest_${config.projectId}` }]);
await denyContainerProduction(config, validHostExec.run);
assert.deepEqual(validHostExec.writes, [hostTarget(fullId).HostsPath, hostTarget(secondId).HostsPath], 'every inspected container receives both IPv4/IPv6 denies through separate Runner argv');
for (const invalid of invalidTargets) {
  const invalidExec = hostsExec([invalid]);
  await assert.rejects(() => denyContainerProduction(config, invalidExec.run), /QA_LOCAL_/);
  assert.equal(invalidExec.writes.length, 0, 'foreign/malformed targets perform zero privileged writes');
}
const mixedExec = hostsExec([hostTarget(fullId), { ...hostTarget(secondId), HostsPath: '/etc/hosts' }]);
await assert.rejects(() => denyContainerProduction(config, mixedExec.run), /HOSTS_PATH_INVALID/); assert.equal(mixedExec.writes.length, 0, 'all paths validate before the batch writes any file');
const racedExec = hostsExec([hostTarget(fullId)], { changed: { ...hostTarget(fullId), State: { Running: false } } });
await assert.rejects(() => denyContainerProduction(config, racedExec.run), /NOT_OWNED/); assert.equal(racedExec.writes.length, 0, 'a stopped/replaced target cannot reuse earlier approval');
for (const root of ['relative/docker', '/var/lib/../docker', '/var/lib/docker/']) {
  const rootExec = hostsExec([hostTarget(fullId)], { root });
  await assert.rejects(() => denyContainerProduction(config, rootExec.run), /DOCKER_ROOT_INVALID/); assert.equal(rootExec.writes.length, 0, 'malformed daemon root performs zero privileged writes');
}
await assert.rejects(() => denyContainerProduction(config, hostsExec([hostTarget(fullId)], { readback: '' }).run), /DNS_NOT_DENIED/, 'failed readback remains a hard failure');
const jwt = role => `header.${Buffer.from(JSON.stringify({ role, iss: 'supabase-demo' })).toString('base64url')}.synthetic`;
const runtime = readLocalRuntime(config, { API_URL: config.backendUrl, ANON_KEY: jwt('anon'), SERVICE_ROLE_KEY: jwt('service_role') });
assert.equal(runtime.publishableKey, jwt('anon'));
assert.throws(() => readLocalRuntime(config, { API_URL: 'https://gkpoylfozvuwuwqeoduc.supabase.co', ANON_KEY: jwt('anon'), SERVICE_ROLE_KEY: jwt('service_role') }), /TARGET_MISMATCH/);
assert.throws(() => readLocalRuntime(config, { API_URL: config.backendUrl, ANON_KEY: jwt('service_role'), SERVICE_ROLE_KEY: jwt('service_role') }), /QA_/);
for (const claims of [null, 'scalar', 123, []]) assert.throws(() => readLocalRuntime(config, { API_URL: config.backendUrl, ANON_KEY: jwt('anon'), SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic` }), /^Error: QA_LOCAL_SERVER_KEY_INVALID$/);
let calls = 0;
const tripwire = async () => { calls++; throw new Error('MUST_NOT_RUN'); };
for (const target of [{}, { ...runtime, backendUrl: 'https://gkpoylfozvuwuwqeoduc.supabase.co' }, { ...runtime, backendUrl: 'http://localhost:9999' }]) await assert.rejects(() => fetchRunnerLocalAuth(target, '/auth/v1/admin/users', {}, tripwire), /QA_/);
await assert.rejects(() => fetchRunnerLocalAuth(runtime, '/rest/v1/learners', {}, tripwire), /QA_/);
assert.equal(calls, 0, 'missing/Production/mismatched runtime cannot mutate synthetic accounts or start transport');
await fetchRunnerLocalAuth(runtime, '/auth/v1/admin/users', { redirect: 'follow' }, async (url, options) => { assert.equal(url, `${config.backendUrl}/auth/v1/admin/users`); assert.equal(options.redirect, 'error'); return new Response('{}'); });

// Actual CLI entrypoint refuses unsafe configuration before fetch AND before Docker/CLI spawn.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'flh-auth-local-unit-'));
try {
  const marker = path.join(temporary, 'transport-called'), hook = path.join(temporary, 'tripwire.mjs');
  fs.writeFileSync(hook, `import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const fail=()=>{fs.writeFileSync(${JSON.stringify(marker)},'called');throw new Error('TRANSPORT_MUST_NOT_RUN');};globalThis.fetch=fail;cp.spawn=fail;syncBuiltinESMExports();`);
  for (const changed of [{}, { ...env, FLH_QA_BACKEND_URL: 'https://gkpoylfozvuwuwqeoduc.supabase.co' }, { ...env, FLH_QA_PROJECT_REF: 'remote' }]) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, path.resolve('tests/qa-authenticated-local.mjs')], { cwd: temporary, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...changed } });
    assert.equal(result.status, 1); assert.match(result.stderr, /QA_/); assert.equal(fs.existsSync(marker), false);
  }
} finally { assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir())); fs.rmSync(temporary, { recursive: true }); }

const overlay = localFunctionConfig(fs.readFileSync('supabase/config.toml', 'utf8'), config.projectId);
assert.match(overlay, new RegExp(`project_id = "${config.projectId}"`));
assert.match(overlay, /\[functions.qa-auth\]\nverify_jwt = false/);
assert.doesNotMatch(overlay, /no-verify-jwt/);
assert.throws(() => localFunctionConfig(overlay, config.projectId), /CONFIG_UNEXPECTED/);
assert.equal(safeQaFailure(new Error('authorization: secret-token https://private.test/?session=private')), 'QA_LOCAL_STAGE_FAILED');
assert.equal(safeQaFailure(new Error('QA_LOCAL_PARENT_CREATE_FAILED')), 'QA_LOCAL_PARENT_CREATE_FAILED');
const syntheticPrivate = 'SYNTHETIC_PRIVATE_PASSWORD sb_secret_synthetic_private_token';
for (const [file, args, stderr, expectedCommand, category] of [
  ['/private/node_modules/.bin/supabase', ['start', '--workdir', '/private/run'], 'unhealthy container', 'supabase_start', 'HEALTH_CHECK_FAILED'],
  ['supabase', ['db', 'reset', '--local'], 'SQLSTATE 42601 syntax error', 'supabase_db_reset', 'DATABASE_OR_MIGRATION_FAILED'],
  ['supabase', ['status', '-o', 'json'], 'connection refused', 'supabase_status', 'LOCAL_TRANSPORT_FAILED'],
  ['docker', ['inspect', 'private-container'], 'permission denied', 'docker_inspect', 'PERMISSION_DENIED'],
  ['docker', ['info', '--format', '{{json .DockerRootDir}}'], 'permission denied', 'docker_info', 'PERMISSION_DENIED'],
  ['sudo', ['-n', 'tee', '-a', '/private/hosts'], 'permission denied', 'container_hosts_append', 'PERMISSION_DENIED'],
  ['sudo', ['-n', 'cat', '/private/hosts'], 'permission denied', 'container_hosts_read', 'PERMISSION_DENIED'],
  ['docker', ['exec', 'private-container', 'sh', '-c', 'cat >> /etc/hosts'], 'exec: "sh": executable file not found in $PATH', 'docker_exec_hosts', 'EXECUTABLE_OR_FILE_MISSING'],
  ['supabase', ['start'], 'manifest unknown', 'supabase_start', 'IMAGE_PULL_FAILED'],
  ['supabase', ['start'], 'failed to parse configuration', 'supabase_start', 'CONFIG_INVALID'],
  ['supabase', ['start'], 'unrecognized message', 'supabase_start', 'UNKNOWN_FAILURE'],
]) {
  const diagnostic = qaProcessDiagnostic(file, args, stderr + '\n' + syntheticPrivate, 23);
  assert.deepEqual(diagnostic, { command: expectedCommand, exit_code: 23, exit_kind: 'PROCESS_EXIT', category });
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|PASSWORD|sb_secret_|unhealthy container|configuration/);
}
const timeoutDiagnostic = qaProcessDiagnostic('supabase', ['start'], syntheticPrivate, null, 'TIMEOUT');
assert.equal(qaProcessDiagnostic('docker', ['exec', 'private', 'sh'], '', 127).category, 'EXECUTABLE_OR_FILE_MISSING', 'actual command-not-found 127 has a stable category even when stderr is empty');
assert.deepEqual(timeoutDiagnostic, { command: 'supabase_start', exit_code: -1, exit_kind: 'NO_PROCESS_EXIT', category: 'PROCESS_TIMEOUT' });
assert.equal(safeQaProcessDiagnostic({ diagnostic: { command: syntheticPrivate, category: 'UNKNOWN_FAILURE', exit_code: 23, exit_kind: 'PROCESS_EXIT' } }), null);
assert.deepEqual(safeQaProcessDiagnostic({ diagnostic: { ...timeoutDiagnostic, stderr: syntheticPrivate, stdout: syntheticPrivate } }), timeoutDiagnostic, 'raw subprocess fields never enter the artifact allowlist');
for (const [message, expected] of [
  ['Error: QA_OIDC_URL_INVALID', 'OIDC_URL_REJECTED'], ['Error: GitHub OIDC environment is unavailable', 'OIDC_ENV_MISSING'],
  ['Error: GitHub OIDC request failed: 403', 'OIDC_REQUEST_FAILED'], ['Error: GitHub OIDC token missing', 'OIDC_TOKEN_MISSING'],
  ['Error: QA_ISOLATION_ATTESTATION_FAILED', 'ATTESTATION_FAILED'], ['Error: QA_PUBLISHABLE_KEY_INVALID', 'TESTING_CONFIG_INVALID'],
  ["Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'", 'MODULE_MISSING'],
  ["browserType.launch: Executable doesn't exist at /private/browser", 'BROWSER_EXECUTABLE_MISSING'],
  ['Error: QA auth prepare failed: 403 WORKFLOW_NOT_ALLOWED', 'AUTH_PREPARE_FAILED'],
  ['Error: QA auth cleanup failed: 409 QA_LEASE_NOT_OWNED', 'AUTH_CLEANUP_FAILED'],
  ['Error: '+syntheticPrivate, 'UNCLASSIFIED'], ['Error: QA_OIDC_URL_INVALID '+syntheticPrivate, 'UNCLASSIFIED'],
]) {
  const diagnostic = qaProcessDiagnostic(process.execPath, ['tests/authenticated-e2e.mjs'], message+'\n'+syntheticPrivate, 1);
  assert.equal(diagnostic.authenticated_failure, expected);
  assert.deepEqual(safeQaProcessDiagnostic({diagnostic}), diagnostic);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|PASSWORD|sb_secret_|WORKFLOW_NOT_ALLOWED|playwright/);
  assert.equal(safeQaProcessDiagnostic({diagnostic:{...diagnostic,authenticated_failure:syntheticPrivate}}).authenticated_failure, undefined);
}
let processFailure;
const primaryMarkers=[
  'QA_AUTH_STAGE '+JSON.stringify({stage:'AUTH_PREPARE',status:'START',raw:syntheticPrivate}),
  'QA_AUTH_FAILURE '+JSON.stringify({stage:'AUTH_PREPARE',code:'AUTH_PREPARE_FAILED',http_status:401,response_error:'QA_AUTH_FAILED',raw:syntheticPrivate}),
  'QA_AUTH_NETWORK '+JSON.stringify({status:'FAIL',unexpected_requests:2,browser_errors:1,origins:[syntheticPrivate]}),
  'QA_AUTH_FAILURE '+JSON.stringify({stage:'AUTH_CLEANUP',code:'AUTH_CLEANUP_FAILED',http_status:500,raw:syntheticPrivate}),
  'QA_AUTH_TERMINAL '+JSON.stringify({code:'AUTH_PREPARE_FAILED',http_status:401,response_error:'QA_AUTH_FAILED',stack:syntheticPrivate}),
].join('\n');
const markerDiagnostic=qaProcessDiagnostic(process.execPath,['tests/authenticated-e2e.mjs'],primaryMarkers,1);
assert.equal(markerDiagnostic.authenticated_stage,'AUTH_PREPARE','cleanup markers cannot replace the primary failure stage');
assert.equal(markerDiagnostic.authenticated_failure,'AUTH_PREPARE_FAILED');
assert.equal(markerDiagnostic.authenticated_http_status,401);
assert.equal(markerDiagnostic.authenticated_response_error,'QA_AUTH_FAILED');
assert.deepEqual(markerDiagnostic.authenticated_network,{status:'FAIL',unexpected_requests:2,browser_errors:1});
assert.deepEqual(safeQaProcessDiagnostic({diagnostic:markerDiagnostic}),markerDiagnostic);
assert.doesNotMatch(JSON.stringify(markerDiagnostic),/private|PASSWORD|sb_secret_|origins|raw|stack/);
const poisonedMarkers=[
  'QA_AUTH_FAILURE '+JSON.stringify({stage:syntheticPrivate,code:syntheticPrivate,http_status:syntheticPrivate}),
  'QA_AUTH_STAGE '+JSON.stringify({stage:'PROGRAM_READY',status:syntheticPrivate}),
  'QA_AUTH_NETWORK '+JSON.stringify({status:'FAIL',unexpected_requests:syntheticPrivate,browser_errors:1}),
  'QA_AUTH_FAILURE malformed '+syntheticPrivate,
].join('\n');
const poisoned=qaProcessDiagnostic(process.execPath,['tests/authenticated-e2e.mjs'],poisonedMarkers,1);
assert.equal(poisoned.authenticated_failure,'UNCLASSIFIED');
assert.equal(poisoned.authenticated_stage,undefined);
assert.equal(poisoned.authenticated_network,undefined);
assert.doesNotMatch(JSON.stringify(poisoned),/private|PASSWORD|sb_secret_/);
assert.deepEqual(safeAuthenticatedFailure(Object.assign(new Error(syntheticPrivate),{name:'TimeoutError',qaHttpStatus:503,qaResponseError:syntheticPrivate})),{code:'BROWSER_TIMEOUT',http_status:503});
assert.deepEqual(safeAuthenticatedFailure({message:syntheticPrivate,qaHttpStatus:1000,qaResponseError:syntheticPrivate}),{code:'UNCLASSIFIED'});
try {
  await command(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(syntheticPrivate)});process.stderr.write(${JSON.stringify('invalid config\n' + syntheticPrivate)});process.exit(23);`]);
} catch (error) { processFailure = error; }
assert.equal(processFailure.message, 'QA_LOCAL_COMMAND_FAILED');
assert.deepEqual(safeQaProcessDiagnostic(processFailure), { command: 'unknown_command', exit_code: 23, exit_kind: 'PROCESS_EXIT', category: 'CONFIG_INVALID' });
assert.doesNotMatch(JSON.stringify(processFailure), /PRIVATE_PASSWORD|sb_secret_|stderr|stdout/);
const harnessSource = fs.readFileSync('tests/qa-authenticated-local.mjs', 'utf8');
assert.ok(harnessSource.indexOf('const oidcOrigin = qaOidcOriginEvidence();')<harnessSource.indexOf('await fs.mkdir(config.directory);'),'origin validation precedes any owned provisioning');
for (const phase of ['supabase_start', 'owned_container_inspection', 'container_deny_before_reset', 'supabase_db_reset', 'container_deny_after_reset', 'supabase_status']) assert.ok(harnessSource.includes(`substep('${phase}'`), 'fixed before/after phase markers must distinguish first full-stack failure: ' + phase);

const response = body => new Response(JSON.stringify(body));
function examCompletionPage({ grouped = false, rowCount = 3, open = null, wrongCount = 0, hidden = [] } = {}) {
  const waits = [];
  const locator = selector => ({
    first: () => locator(selector),
    locator: child => { assert.equal(child, ':scope > summary'); return locator('group-summary'); },
    count: async () => selector === '.exam-review' ? rowCount : selector === '.flh-correct-review' ? Number(grouped) : wrongCount,
    getAttribute: async name => { assert.equal(name, 'open'); return open; },
    waitFor: async options => {
      waits.push({ selector, ...options });
      assert.equal(options.timeout, 30000);
      if (options.state === 'visible' && hidden.includes(selector)) throw new Error('QA_TEST_RESULT_NOT_VISIBLE');
    },
  });
  return { waits, locator, getByText: (text, options) => { assert.equal(text, '100%'); assert.deepEqual(options, { exact: true }); return locator('percentage'); } };
}
const groupedCompletion = examCompletionPage({ grouped: true, hidden: ['.exam-review'] });
await assertQaExamCompletion(groupedCompletion);
assert.ok(groupedCompletion.waits.some(wait => wait.selector === 'group-summary' && wait.state === 'visible'));
assert.ok(!groupedCompletion.waits.some(wait => wait.selector === '.exam-review' && wait.state === 'visible'), 'correct rows intentionally remain hidden inside the closed group');
const flatCompletion = examCompletionPage();
await assertQaExamCompletion(flatCompletion);
assert.ok(flatCompletion.waits.some(wait => wait.selector === '.exam-review' && wait.state === 'visible'), 'the original visible review assertion remains for the flat renderer');
for (const changed of [{ rowCount: 2 }, { grouped: true, open: '' }, { grouped: true, wrongCount: 1 }]) {
  await assert.rejects(() => assertQaExamCompletion(examCompletionPage(changed)), /QA_LOCAL_EXAM_REVIEW_INVALID/);
}
for (const changed of [{ hidden: ['#examHome'] }, { hidden: ['percentage'] }, { hidden: ['.exam-review'] }, { grouped: true, hidden: ['group-summary'] }]) {
  await assert.rejects(() => assertQaExamCompletion(examCompletionPage(changed)), /QA_TEST_RESULT_NOT_VISIBLE/, 'attached rows alone cannot pass a missing visible completion result');
}
let resumeCalls = 0;
await assertQaResume(runtime, 'synthetic-session', 'learning-api', 'start_quiz', async (_url, options) => {
  resumeCalls++; assert.equal(options.redirect, 'error'); return response({ attempt_id: 'synthetic-owned-attempt', resumed: true, queue: [] });
});
assert.equal(resumeCalls, 2);
await assert.rejects(() => assertQaResume(runtime, 'synthetic-session', 'learning-api', 'start_quiz', async () => response({ attempt_id: 'same', resumed: true, queue: [{ question: { correct_answer: { position: 1 } } }] })), /ANSWER_KEY_LEAK/);
let nextId = 0;
await assert.rejects(() => assertQaResume(runtime, 'synthetic-session', 'exam-v2-api', 'start_exam', async () => response({ attempt_id: String(++nextId), resumed: true })), /RESUME_ID_CHANGED/);
const parentCalls = [];
await assertQaParent(runtime, 'synthetic@example.test', 'synthetic-password', async (url, options) => {
  parentCalls.push(url); assert.equal(options.redirect, 'error');
  return response(url.includes('/token?') ? { access_token: 'synthetic-parent-token' } : url.includes('/family-api') ? { parent: { role: 'owner' }, learners: [{ id: '02610000-0000-4000-8000-000000000101', slug: 'qa-parent-visible' }, { id: '02610000-0000-4000-8000-000000000102', slug: 'qa-sibling-visible' }], states: [], attempts: [] } : {});
});
assert.equal(parentCalls.length, 3);
let parentBrowserCalls = 0;
await assertQaParent(runtime, 'synthetic@example.test', 'synthetic-password', async url => {
  return response(url.includes('/token?') ? { access_token: 'synthetic-parent-token' } : url.includes('/family-api') ? { parent: { role: 'owner' }, learners: [{ id: '02610000-0000-4000-8000-000000000101', slug: 'qa-parent-visible' }, { id: '02610000-0000-4000-8000-000000000102', slug: 'qa-sibling-visible' }], states: [], attempts: [] } : {});
}, async token => { parentBrowserCalls++; assert.equal(token, 'synthetic-parent-token'); });
assert.equal(parentBrowserCalls, 1, 'authenticated browser callback runs after Testing-only exclusion');
let loggedOut = false;
await assert.rejects(() => assertQaParent(runtime, 'synthetic@example.test', 'synthetic-password', async url => {
  if (url.endsWith('/logout')) { loggedOut = true; return response({}); }
  return response(url.includes('/token?') ? { access_token: 'synthetic' } : { parent: { role: 'owner' }, learners: [{ slug: 'test' }] });
}), /TEST_EXCLUSION_FAILED/);
assert.equal(loggedOut, true, 'a failed parent assertion still revokes the owned synthetic parent session');

// The dialog handler must be armed before the triggering click; otherwise Playwright blocks the click itself.
const checkConfirmation = async (message, type = 'confirm') => {
  let handler, accepted = 0, dismissed = 0;
  const page = { once: (name, callback) => { assert.equal(name, 'dialog'); handler = callback; } };
  const button = { click: async () => {
    assert.equal(typeof handler, 'function', 'dialog listener must exist before click');
    await handler({ type: () => type, message: () => message,
      accept: async () => { accepted++; }, dismiss: async () => { dismissed++; } });
  } };
  return { run: (accept = true) => handleQaParentBulkConfirmation(page, button, 2, accept), state: () => ({ accepted, dismissed }) };
};
const approvedDialog = await checkConfirmation('اعتماد طلبات QA؟ عدد الطلبات: 2');
await approvedDialog.run();
assert.deepEqual(approvedDialog.state(), { accepted: 1, dismissed: 0 });
const cancelledDialog = await checkConfirmation('اعتماد طلبات QA؟ عدد الطلبات: 2');
await cancelledDialog.run(false);
assert.deepEqual(cancelledDialog.state(), { accepted: 0, dismissed: 1 });
const rejectedDialog = await checkConfirmation('عدد الطلبات: 3');
await assert.rejects(rejectedDialog.run(), /QA_LOCAL_PARENT_CONFIRMATION_INVALID/);
assert.deepEqual(rejectedDialog.state(), { accepted: 0, dismissed: 1 });

// Owned teardown retries preserve foreign fixtures and fail honestly if resources remain.
const originalTemp = process.env.RUNNER_TEMP;
const teardownRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flh-local-teardown-'));
try {
  process.env.RUNNER_TEMP = teardownRoot;
  const testConfig = { ...config, directory: path.join(teardownRoot, config.projectId) };
  fs.mkdirSync(testConfig.directory);
  const owner = { project_id: config.projectId, head_sha: config.headSha, run_id: config.runId, run_attempt: config.runAttempt };
  const ownerPath = path.join(testConfig.directory, 'owner.json');
  fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, head_sha: 'b'.repeat(40) }));
  let commands = 0;
  const fakeExec = async () => { commands++; return ''; };
  await assert.rejects(() => teardownLocal(testConfig, fakeExec), /OWNERSHIP_INVALID/); assert.equal(commands, 0); assert.equal(fs.existsSync(ownerPath), true);
  fs.writeFileSync(ownerPath, JSON.stringify(owner));
  await assert.rejects(() => teardownLocal(testConfig, async (_file, args) => args.includes('{{.ID}}') ? 'remaining' : ''), /TEARDOWN_INCOMPLETE/);
  assert.equal(fs.existsSync(ownerPath), true, 'incomplete Docker teardown preserves ownership for the always() retry');
  await assert.rejects(() => teardownLocal(testConfig, async (_file,args) => args.includes('{{.Names}}') ? 'realtime-dev.supabase_realtime_foreign' : ''), /CONTAINER_NOT_OWNED/);
  assert.equal(fs.existsSync(ownerPath),true,'Unowned container preserves the owner marker and skips destructive teardown');
  const operations = [];
  assert.equal(await teardownLocal(testConfig, async (_file, args) => {
    operations.push(args);
    return args.includes('{{.Names}}') ? `realtime-dev.supabase_realtime_${config.projectId}` : '';
  }), 'PASS');
  assert.equal(fs.existsSync(testConfig.directory), false);
  assert.ok(operations.some(args => args.includes('--no-backup') && args.includes(config.projectId) && !args.includes('--all')));
  assert.equal(await teardownLocal(testConfig, fakeExec), 'NOT_PROVISIONED');
} finally {
  if (originalTemp === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = originalTemp;
  assert.equal(path.dirname(path.resolve(teardownRoot)), path.resolve(os.tmpdir())); fs.rmSync(teardownRoot, { recursive: true });
}

const workflow = fs.readFileSync('.github/workflows/qa-authenticated-local.yml', 'utf8').replaceAll('\r\n', '\n');
assert.match(fs.readFileSync('supabase/functions/qa-auth/index.ts', 'utf8'), /validateGithubClaims\(payload, isolatedBackend\.mode\)/, 'server supplies guard-validated isolation mode to the narrow workflow allowlist');
assert.doesNotMatch(workflow, /pull_request_target|workflow_run|continue-on-error|pages:\s*write|secrets\.|--linked|--db-url|db push|functions deploy|--no-verify-jwt/);
assert.equal((workflow.match(/id-token: write/g) || []).length, 1);
assert.match(workflow, /actions: read/);
assert.match(workflow, /FLH_QA_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
assert.match(workflow, /APP_URL: http:\/\/localhost:4173\//);
assert.ok(workflow.indexOf('Deny Production backend traffic') < workflow.indexOf('Require successful core gates'));
assert.ok(workflow.indexOf('run: node tests/qa-core-prerequisite.mjs') < workflow.indexOf('run: node tests/qa-authenticated-local.mjs'));
assert.match(workflow, /name: Verify owned local teardown\n        if: always\(\)/);
for (const screenshot of ['attempt-deep-link-mobile', 'attempt-deep-link-desktop', 'parent-dashboard-mobile', 'student-rewards-mobile', 'student-rewards-desktop', 'parent-rewards-mobile', 'parent-rewards-desktop']) {
  assert.ok(workflow.includes(`qa-authenticated-evidence/${screenshot}.png`), 'Only enumerated synthetic screenshots are uploaded');
}
assert.match(workflow, /qa-authenticated-evidence\/parent-rewards-desktop\.png\n          retention-days: 7/);
assert.doesNotMatch(workflow, /path: qa-authenticated-evidence\//, 'artifacts enumerate safe files; the whole runtime/evidence directory is never uploaded');
const fixture = fs.readFileSync('tests/qa-authenticated-local.fixtures.sql', 'utf8');
assert.doesNotMatch(fixture, /grant\s|disable.*(?:trigger|row level)|replication_role|insert into public\.quiz_attempts|\b(?:aya|mohammad)\b/i);
assert.match(fixture, /technical_qa/); assert.match(fixture, /for position in 1\.\.3/);
const keyLiteral = fixture.match(/insert into public\.quiz_question_answer_keys\([^;]+values\(workspace,question,'([^']+)'/);
assert.ok(keyLiteral, 'the synthetic MCQ fixture must provide its server-side grading key');
assert.deepEqual(JSON.parse(keyLiteral[1]), { option_position: 1 }, 'the real MCQ grader consumes option_position; the legacy position field caused ANSWER_KEY_NOT_FOUND');
assert.match(fixture, /QA_LOCAL_ANSWER_KEY_INVALID/, 'a mismatched fixture key must fail SQL preflight before the browser');
console.log('Authenticated Runner config/actual CLI zero-transport guards, owned target/teardown, hidden-key resume, parent Auth cleanup, local-only workflow and synthetic fixture regressions passed. No Docker/backend/network executed.');
