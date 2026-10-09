import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertQaParent, assertQaResume } from './authenticated-e2e.mjs';
import { command, denyContainerProduction, teardownLocal } from './qa-authenticated-local.mjs';
import { assertContainerProductionDenied, assertOwnedContainer, fetchRunnerLocalAuth, localFunctionConfig, ownedContainerHostsPath, qaProcessDiagnostic, readLocalRuntime, requireRunnerLocal, requireSuccessfulCoreEvidence, safeQaFailure, safeQaProcessDiagnostic } from './qa-runner-local.mjs';

const env = { FLH_QA_ISOLATION_MODE: 'runner-local', FLH_QA_BACKEND_URL: 'http://127.0.0.1:54321', FLH_QA_PROJECT_REF: 'local', APP_URL: 'http://localhost:4173/',
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'FadiAboAlward/family-learning-hub', GITHUB_ACTOR_ID: '320162789',
  GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2', FLH_QA_HEAD_SHA: 'a'.repeat(40), RUNNER_TEMP: os.tmpdir() };
const config = requireRunnerLocal(env);
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
let processFailure;
try {
  await command(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(syntheticPrivate)});process.stderr.write(${JSON.stringify('invalid config\n' + syntheticPrivate)});process.exit(23);`]);
} catch (error) { processFailure = error; }
assert.equal(processFailure.message, 'QA_LOCAL_COMMAND_FAILED');
assert.deepEqual(safeQaProcessDiagnostic(processFailure), { command: 'unknown_command', exit_code: 23, exit_kind: 'PROCESS_EXIT', category: 'CONFIG_INVALID' });
assert.doesNotMatch(JSON.stringify(processFailure), /PRIVATE_PASSWORD|sb_secret_|stderr|stdout/);
const harnessSource = fs.readFileSync('tests/qa-authenticated-local.mjs', 'utf8');
for (const phase of ['supabase_start', 'owned_container_inspection', 'container_deny_before_reset', 'supabase_db_reset', 'container_deny_after_reset', 'supabase_status']) assert.ok(harnessSource.includes(`substep('${phase}'`), 'fixed before/after phase markers must distinguish first full-stack failure: ' + phase);

const response = body => new Response(JSON.stringify(body));
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
  return response(url.includes('/token?') ? { access_token: 'synthetic-parent-token' } : url.includes('/family-api') ? { parent: { role: 'owner' }, learners: [], states: [], attempts: [] } : {});
});
assert.equal(parentCalls.length, 3);
let loggedOut = false;
await assert.rejects(() => assertQaParent(runtime, 'synthetic@example.test', 'synthetic-password', async url => {
  if (url.endsWith('/logout')) { loggedOut = true; return response({}); }
  return response(url.includes('/token?') ? { access_token: 'synthetic' } : { parent: { role: 'owner' }, learners: [{ slug: 'test' }] });
}), /TEST_EXCLUSION_FAILED/);
assert.equal(loggedOut, true, 'a failed parent assertion still revokes the owned synthetic parent session');

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
  const operations = [];
  assert.equal(await teardownLocal(testConfig, async (_file, args) => { operations.push(args); return ''; }), 'PASS');
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
assert.match(workflow, /qa-authenticated-evidence\/attempt-deep-link-mobile\.png\n          retention-days: 7/);
assert.doesNotMatch(workflow, /path: qa-authenticated-evidence\//, 'artifacts enumerate safe files; the whole runtime/evidence directory is never uploaded');
const fixture = fs.readFileSync('tests/qa-authenticated-local.fixtures.sql', 'utf8');
assert.doesNotMatch(fixture, /grant\s|disable.*(?:trigger|row level)|replication_role|insert into public\.quiz_attempts|\b(?:aya|mohammad)\b/i);
assert.match(fixture, /technical_qa/); assert.match(fixture, /for position in 1\.\.3/);
console.log('Authenticated Runner config/actual CLI zero-transport guards, owned target/teardown, hidden-key resume, parent Auth cleanup, local-only workflow and synthetic fixture regressions passed. No Docker/backend/network executed.');
