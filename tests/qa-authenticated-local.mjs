// FLH026 v1.1 / Drive revision2. Fresh GitHub Runner only; never a hosted project.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_HOSTS } from '../supabase/functions/_shared/qa-backend-isolation.mjs';
import { readQaTestingConfig, requireQaOidcUrl, verifyQaTestingBackend } from './qa-isolation.mjs';
import { assertContainerProductionDenied, assertOwnedContainer, fetchRunnerLocalAuth, localFunctionConfig, ownedContainerHostsPath, qaProcessDiagnostic, readLocalRuntime, requireRunnerLocal, requireSuccessfulCoreEvidence, safeQaFailure, safeQaProcessDiagnostic } from './qa-runner-local.mjs';

const evidenceDirectory = path.resolve('qa-authenticated-evidence');
const cli = path.resolve('node_modules/.bin/supabase');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Verified GitHub origin only: path, query, request bearer and JWT never enter evidence. */
export function qaOidcOriginEvidence(env = process.env) {
  return Object.freeze({ origin: requireQaOidcUrl(env.ACTIONS_ID_TOKEN_REQUEST_URL).origin });
}

/** Capture output in memory only: CLI status/start can include runtime credentials. */
export function command(file, args, { input, env = process.env, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = '', errors = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { errors += bytes; });
    const fail = (code, exitCode, reason) => {
      const error = new Error(code);
      error.diagnostic = qaProcessDiagnostic(file, args, errors, exitCode, reason);
      reject(error);
    };
    const timer = setTimeout(() => { child.kill('SIGTERM'); fail('QA_LOCAL_COMMAND_TIMEOUT', null, 'TIMEOUT'); }, timeout);
    child.on('error', () => { clearTimeout(timer); fail('QA_LOCAL_COMMAND_UNAVAILABLE', null, 'UNAVAILABLE'); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else {
        fail('QA_LOCAL_COMMAND_FAILED', code, 'FAILED');
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function inspect(config, service) {
  const rows = JSON.parse(await command('docker', ['inspect', `supabase_${service}_${config.projectId}`]));
  assertOwnedContainer(config, rows[0], service);
  return rows[0];
}

/** Provisioned containers have their own hosts files; Runner /etc/hosts alone is insufficient. */
export async function denyContainerProduction(config, exec = command) {
  const dockerRootDir = JSON.parse(await exec('docker', ['info', '--format', '{{json .DockerRootDir}}']));
  const ids = (await exec('docker', ['ps', '--no-trunc', '--filter', `label=com.supabase.cli.project=${config.projectId}`, '--format', '{{.ID}}'])).trim().split(/\s+/).filter(Boolean);
  if (!ids.length) throw new Error('QA_LOCAL_CONTAINERS_MISSING');
  const targets = [];
  for (const id of ids) {
    const [data] = JSON.parse(await exec('docker', ['inspect', id]));
    targets.push({ id, hostsPath: ownedContainerHostsPath(config, dockerRootDir, data, id) });
  }
  // Validate the complete batch before any write, then re-inspect immediately
  // before appending so a recreated/stopped container cannot retain stale approval.
  for (const target of targets) {
    const [current] = JSON.parse(await exec('docker', ['inspect', target.id]));
    if (ownedContainerHostsPath(config, dockerRootDir, current, target.id) !== target.hostsPath) throw new Error('QA_LOCAL_CONTAINER_HOSTS_PATH_INVALID');
    const deny = `127.0.0.1 ${PRODUCTION_HOSTS.join(' ')}\n::1 ${PRODUCTION_HOSTS.join(' ')}\n`;
    await exec('sudo', ['-n', 'tee', '-a', target.hostsPath], { input: deny });
    const hosts = await exec('sudo', ['-n', 'cat', target.hostsPath]);
    assertContainerProductionDenied(hosts);
  }
}

async function sql(config, source) {
  await inspect(config, 'db');
  return command('docker', ['exec', '-i', `supabase_db_${config.projectId}`, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: source });
}

async function ownedSourceCopy(config) {
  // Copy only tracked runtime/migration sources; no linked ref, .temp, .env or local key.
  const files = (await command('git', ['ls-files', 'supabase'])).trim().split('\n');
  for (const relative of files) {
    if (!(relative === 'supabase/config.toml' || relative === 'supabase/roles.sql' || /^supabase\/(migrations|functions)\//.test(relative))) continue;
    if (/\/(?:\.env|\.temp|\.branches)(?:\.|\/|$)/.test(relative)) throw new Error('QA_LOCAL_TRACKED_SECRET_FORBIDDEN');
    const source = path.resolve(relative), target = path.join(config.directory, relative);
    if (!(await fs.lstat(source)).isFile()) throw new Error('QA_LOCAL_SOURCE_NOT_FILE');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  const target = path.join(config.directory, 'supabase/config.toml');
  await fs.writeFile(target, localFunctionConfig(await fs.readFile(target, 'utf8'), config.projectId));
}

function mask(value) { console.log(`::add-mask::${value}`); }
function ownedProcess(file, args, env) {
  const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  // Keep stderr private in bounded memory; expose only the fixed classifier result.
  let stderr = '';
  child.stdout.on('data', () => {}); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
  child.on('error', () => { child.qaSpawnFailed = true; });
  child.qaDiagnostic = () => qaProcessDiagnostic(file, args, stderr, child.exitCode, child.qaSpawnFailed ? 'UNAVAILABLE' : 'FAILED');
  return child;
}

function ownedProcessFailure(code, child) {
  const error = new Error(code); error.diagnostic = child.qaDiagnostic(); return error;
}

async function saveEvidence(config, stages, auth, teardown) {
  await fs.mkdir(evidenceDirectory, { recursive: true });
  if ((await fs.lstat(evidenceDirectory)).isSymbolicLink()) throw new Error('QA_LOCAL_EVIDENCE_PATH_INVALID');
  for (const name of ['lifecycle.json', 'manifest.json', 'attempt-deep-link-mobile.png', 'attempt-deep-link-desktop.png', 'parent-dashboard-mobile.png', 'student-rewards-mobile.png', 'student-rewards-desktop.png', 'parent-rewards-mobile.png', 'parent-rewards-desktop.png']) {
    try { if ((await fs.lstat(path.join(evidenceDirectory, name))).isSymbolicLink()) throw new Error('QA_LOCAL_EVIDENCE_PATH_INVALID'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await fs.writeFile(path.join(evidenceDirectory, 'lifecycle.json'), JSON.stringify({
    schema: 1, feature: 'FLH-FEAT-2026-026', spec_version: '1.1', drive_revision: '2',
    status: auth === 'PASS' && stages.every(item => item.status === 'PASS') && teardown === 'PASS' ? 'PASS' : stages.some(item => item.status === 'FAIL') || teardown === 'FAIL' ? 'FAIL' : 'NOT_RUN',
    head_sha: config.headSha, run_id: config.runId, run_attempt: config.runAttempt,
    backend_origin: config.backendUrl, app_origin: new URL(config.appUrl).origin,
    isolation_mode: 'runner-local', fixture_kind: 'synthetic_technical_qa',
    authentication: auth, teardown, stages,
    product_acceptance: 'NOT_ASSERTED_BY_TECHNICAL_SMOKE', hosted_authentication: 'NOT_RUN',
  }, null, 2));
  const screenshots = [];
  for (const name of ['attempt-deep-link-mobile.png', 'attempt-deep-link-desktop.png', 'parent-dashboard-mobile.png', 'student-rewards-mobile.png', 'student-rewards-desktop.png', 'parent-rewards-mobile.png', 'parent-rewards-desktop.png']) {
    try {
      const bytes = await fs.readFile(path.join(evidenceDirectory, name));
      screenshots.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await fs.writeFile(path.join(evidenceDirectory, 'manifest.json'), JSON.stringify({
    head_sha: config.headSha, run_id: config.runId, run_attempt: config.runAttempt,
    captured_at: new Date().toISOString(), fixture_kind: 'synthetic_technical_qa', screenshots,
  }, null, 2));
}

async function stopProcess(pid, expected) {
  if (!Number.isInteger(pid) || pid < 2) return;
  let cmdline;
  try { cmdline = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!expected.every(value => cmdline.split('\0').includes(value))) throw new Error('QA_LOCAL_PROCESS_NOT_OWNED');
  process.kill(pid, 'SIGTERM');
}

/** Retryable final workflow step: destroys only the recorded run/attempt's CLI project. */
export async function teardownLocal(config, exec = command) {
  if (path.dirname(path.resolve(config.directory)) !== path.resolve(process.env.RUNNER_TEMP || '')) throw new Error('QA_LOCAL_TEMP_INVALID');
  let owner;
  try { owner = JSON.parse(await fs.readFile(path.join(config.directory, 'owner.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return 'NOT_PROVISIONED'; throw new Error('QA_LOCAL_OWNERSHIP_INVALID'); }
  if (owner.project_id !== config.projectId || owner.head_sha !== config.headSha || owner.run_id !== config.runId || owner.run_attempt !== config.runAttempt) throw new Error('QA_LOCAL_OWNERSHIP_INVALID');
  if (owner.app_pid) await stopProcess(owner.app_pid, ['http.server', path.resolve('.')]);
  if (owner.functions_pid) await stopProcess(owner.functions_pid, ['functions', 'serve', config.directory]);
  const names = (await exec('docker', ['ps', '-a', '--filter', `label=com.supabase.cli.project=${config.projectId}`, '--format', '{{.Names}}'])).trim().split(/\s+/).filter(Boolean);
  const ownedName = name => (name.startsWith('supabase_') && name.endsWith(`_${config.projectId}`))
    || name === `realtime-dev.supabase_realtime_${config.projectId}`;
  for (const name of names) if (!ownedName(name)) throw new Error('QA_LOCAL_CONTAINER_NOT_OWNED');
  await exec(cli, ['stop', '--project-id', config.projectId, '--no-backup', '--workdir', config.directory]);
  const remaining = (await exec('docker', ['ps', '-a', '--filter', `label=com.supabase.cli.project=${config.projectId}`, '--format', '{{.ID}}'])).trim();
  if (remaining) throw new Error('QA_LOCAL_TEARDOWN_INCOMPLETE');
  const volumes = (await exec('docker', ['volume', 'ls', '--filter', `label=com.supabase.cli.project=${config.projectId}`, '--format', '{{.Name}}'])).trim();
  if (volumes) throw new Error('QA_LOCAL_VOLUMES_REMAIN');
  if (path.dirname(path.resolve(config.directory)) !== path.resolve(process.env.RUNNER_TEMP)) throw new Error('QA_LOCAL_TEMP_INVALID');
  await fs.rm(config.directory, { recursive: true });
  return 'PASS';
}

async function main() {
  const config = requireRunnerLocal();
  if (process.argv[2] === 'teardown') {
    let result, failure;
    try { result = await teardownLocal(config); }
    catch (error) { result = 'FAIL'; failure = error; process.exitCode = 1; }
    let existing;
    try { existing = JSON.parse(await fs.readFile(path.join(evidenceDirectory, 'lifecycle.json'), 'utf8')); } catch {}
    if (existing && existing.head_sha === config.headSha && existing.run_id === config.runId) {
      existing.final_teardown = result === 'NOT_PROVISIONED' && existing.teardown === 'PASS' ? 'PASS_ALREADY_VERIFIED' : result;
      if (failure) {
        existing.status = 'FAIL';
        const diagnostic = safeQaProcessDiagnostic(failure);
        existing.final_teardown_failure = { code: safeQaFailure(failure), ...(diagnostic ? { process: diagnostic } : {}) };
      }
      await fs.writeFile(path.join(evidenceDirectory, 'lifecycle.json'), JSON.stringify(existing, null, 2));
    } else await saveEvidence(config, [], 'NOT_RUN', result);
    console.log(`Owned local teardown: ${result}`);
    if (failure) {
      console.error(`Owned local teardown failed: ${safeQaFailure(failure)}`);
      const diagnostic = safeQaProcessDiagnostic(failure);
      if (diagnostic) console.error(`Local authenticated QA process: ${JSON.stringify(diagnostic)}`);
    }
    return;
  }
  const stages = [];
  let stage = 'preflight', authentication = 'NOT_RUN', teardown = 'NOT_PROVISIONED', failure;
  let runtime, parentId;
  const owner = { project_id: config.projectId, head_sha: config.headSha, run_id: config.runId, run_attempt: config.runAttempt };
  const mark = name => { stages.push({ stage: name, status: 'PASS' }); console.log(`Local authenticated QA: ${name} PASS`); };
  const substep = async (name, operation) => {
    const entry = { stage: name, status: 'IN_PROGRESS' }; stages.push(entry);
    console.log(`Local authenticated QA: ${name} START`);
    try { const result = await operation(); entry.status = 'PASS'; console.log(`Local authenticated QA: ${name} PASS`); return result; }
    catch (error) { entry.status = 'FAIL'; entry.code = safeQaFailure(error); const diagnostic = safeQaProcessDiagnostic(error); if (diagnostic) entry.process = diagnostic; throw error; }
  };
  try {
    let core;
    try { core = JSON.parse(await fs.readFile(path.join(evidenceDirectory, 'core-prerequisite.json'), 'utf8')); } catch { throw new Error('QA_LOCAL_CORE_EVIDENCE_REQUIRED'); }
    requireSuccessfulCoreEvidence(config, core);
    if ((await command('git', ['rev-parse', 'HEAD'])).trim() !== config.headSha) throw new Error('QA_LOCAL_HEAD_MISMATCH');
    const oidcOrigin = qaOidcOriginEvidence();
    stages.push({ stage: 'oidc_origin', status: 'PASS', ...oidcOrigin });
    console.log(`Local authenticated QA OIDC origin: ${JSON.stringify(oidcOrigin)}`);
    if ((await command(cli, ['--version'])).trim() !== '2.117.0') throw new Error('QA_LOCAL_CLI_VERSION_MISMATCH');
    await fs.mkdir(config.directory); // Existing directories are never reset/reused silently.
    await fs.writeFile(path.join(config.directory, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
    await ownedSourceCopy(config); mark(stage);
    stage = 'full_local_stack';
    await substep('supabase_start', () => command(cli, ['start', '--workdir', config.directory], { timeout: 360000 }));
    await substep('owned_container_inspection', async () => { await inspect(config, 'db'); await inspect(config, 'kong'); });
    await substep('container_deny_before_reset', () => denyContainerProduction(config));
    await substep('supabase_db_reset', () => command(cli, ['db', 'reset', '--local', '--no-seed', '--workdir', config.directory], { timeout: 180000 }));
    await substep('container_deny_after_reset', () => denyContainerProduction(config));
    runtime = await substep('supabase_status', async () => readLocalRuntime(config, JSON.parse(await command(cli, ['status', '-o', 'json', '--workdir', config.directory]))));
    mask(runtime.publishableKey); mask(runtime.serviceRoleKey);
    mark(stage);
    stage = 'fresh_database_and_synthetic_preflight';
    await sql(config, await fs.readFile('tests/fresh-database-rebuild.sql', 'utf8'));
    await sql(config, "do $$ begin if exists(select 1 from auth.users) or exists(select 1 from public.quiz_attempts) or exists(select 1 from private.qa_run_leases) then raise exception 'QA_LOCAL_FRESH_STATE_INVALID'; end if; end; $$;");
    mark(stage);
    stage = 'local_edge_attestation';
    const envFile = path.join(config.directory, 'edge.env');
    await fs.writeFile(envFile, `FLH_QA_ISOLATION_MODE=runner-local\nFLH_QA_PROJECT_REF=local\nFLH_QA_BACKEND_URL=${config.backendUrl}\n`, { mode: 0o600 });
    const serve = ownedProcess(cli, ['functions', 'serve', '--env-file', envFile, '--workdir', config.directory], process.env);
    owner.functions_pid = serve.pid;
    await fs.writeFile(path.join(config.directory, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
    const started = Date.now(); let ready = false;
    await pause(1500); // Let serve replace its initial Edge runtime before applying container denies.
    while (Date.now() - started < 90000) {
      if (serve.qaSpawnFailed || serve.exitCode !== null) throw ownedProcessFailure('QA_LOCAL_EDGE_START_FAILED', serve);
      try {
        await inspect(config, 'edge_runtime'); await denyContainerProduction(config);
        const edgeBefore = (await inspect(config, 'edge_runtime')).Id;
        await verifyQaTestingBackend({ ...runtime, appUrl: config.appUrl });
        if ((await inspect(config, 'edge_runtime')).Id !== edgeBefore) throw new Error('QA_LOCAL_EDGE_CHANGED');
        ready = true; break;
      } catch { await pause(1500); }
    }
    if (!ready) throw new Error('QA_LOCAL_EDGE_ATTESTATION_FAILED');
    mark(stage);
    stage = 'synthetic_accounts_and_content';
    const password = randomBytes(32).toString('base64url'); mask(password);
    const email = `flh-qa-parent-${config.runId}-${config.runAttempt}@example.test`;
    const created = await fetchRunnerLocalAuth(runtime, '/auth/v1/admin/users', { method: 'POST', headers: { apikey: runtime.serviceRoleKey, authorization: `Bearer ${runtime.serviceRoleKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { technical_qa: true }, user_metadata: { relation: 'parent' } }) });
    if (!created.ok) throw new Error('QA_LOCAL_PARENT_CREATE_FAILED');
    parentId = (await created.json()).id;
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(parentId || '')) throw new Error('QA_LOCAL_PARENT_ID_INVALID');
    await sql(config, (await fs.readFile('tests/qa-authenticated-local.fixtures.sql', 'utf8')).replaceAll('__QA_PARENT_ID__', parentId));
    mark(stage);
    stage = 'local_application';
    const app = ownedProcess('python3', ['-m', 'http.server', '4173', '--bind', '127.0.0.1', '--directory', path.resolve('.')], process.env);
    owner.app_pid = app.pid;
    await fs.writeFile(path.join(config.directory, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
    const appStart = Date.now(); ready = false;
    while (Date.now() - appStart < 15000) {
      if (app.qaSpawnFailed || app.exitCode !== null) throw ownedProcessFailure('QA_LOCAL_APP_START_FAILED', app);
      try { if ((await fetch(config.appUrl, { redirect: 'error' })).ok) { ready = true; break; } } catch {}
      await pause(250);
    }
    if (!ready) throw new Error('QA_LOCAL_APP_START_FAILED'); mark(stage);
    stage = 'unmocked_authenticated_browser'; authentication = 'FAIL';
    const childEnv = { ...process.env, FLH_QA_PUBLISHABLE_KEY: runtime.publishableKey, FLH_QA_PARENT_EMAIL: email, FLH_QA_PARENT_PASSWORD: password };
    readQaTestingConfig(childEnv); // Publishable/anon only; service key never reaches the browser child.
    await command(process.execPath, ['tests/authenticated-e2e.mjs'], { env: childEnv, timeout: 240000 });
    authentication = 'PASS'; mark(stage);
    stage = 'authenticated_parent_rewards_persistence';
    await sql(config, `do $qa$ begin
      if (select count(*) from public.behavior_submissions
          where learner_id='02610000-0000-4000-8000-000000000101' and status='approved') <> 2
        or (select reward_points from public.learner_gamification_state
          where learner_id='02610000-0000-4000-8000-000000000101') <> 6
        or (select count(*) from public.gamification_events
          where learner_id='02610000-0000-4000-8000-000000000101' and reward_points_delta=3) <> 2
        or (select count(*) from public.behavior_submissions
          where learner_id='02610000-0000-4000-8000-000000000102' and status='approved') <> 1
        or (select count(*) from public.behavior_submissions
          where learner_id='02610000-0000-4000-8000-000000000102' and status='rejected') <> 1
        or (select count(*) from public.behavior_submissions
          where learner_id='02610000-0000-4000-8000-000000000102' and status='pending') <> 0
        or (select reward_points from public.learner_gamification_state
          where learner_id='02610000-0000-4000-8000-000000000102') <> 3
        or (select count(*) from public.gamification_events
          where learner_id='02610000-0000-4000-8000-000000000102' and reward_points_delta=3) <> 1
      then raise exception 'QA_LOCAL_PARENT_AWARDS_INCORRECT'; end if;
    end $qa$;`);
    mark(stage);
    stage = 'owned_lease_cleanup';
    await sql(config, "do $$ begin if exists(select 1 from private.qa_run_leases) or exists(select 1 from public.quiz_attempts a join public.quiz_versions v on v.id=a.quiz_version_id join public.quizzes q on q.id=v.quiz_id where q.slug='qa-automation-core') then raise exception 'QA_LOCAL_LEASE_OR_ATTEMPTS_REMAIN'; end if; end; $$;");
    mark(stage);
  } catch (error) {
    const diagnostic = safeQaProcessDiagnostic(error);
    failure = error; stages.push({ stage, status: 'FAIL', code: safeQaFailure(error), ...(diagnostic ? { process: diagnostic } : {}) });
    console.error(`Local authenticated QA failed at ${stage}: ${safeQaFailure(error)}`);
    if (diagnostic) console.error(`Local authenticated QA process: ${JSON.stringify(diagnostic)}`);
  } finally {
    try {
      if (runtime && parentId) {
        const removed = await fetchRunnerLocalAuth(runtime, `/auth/v1/admin/users/${parentId}`, { method: 'DELETE', headers: { apikey: runtime.serviceRoleKey, authorization: `Bearer ${runtime.serviceRoleKey}` } });
        if (!removed.ok) throw new Error('QA_LOCAL_PARENT_DELETE_FAILED');
      }
    } catch (error) { stages.push({ stage: 'synthetic_parent_cleanup', status: 'FAIL', code: safeQaFailure(error) }); failure ||= error; }
    try { teardown = await teardownLocal(config); }
    catch (error) { const diagnostic = safeQaProcessDiagnostic(error); teardown = 'FAIL'; stages.push({ stage: 'teardown', status: 'FAIL', code: safeQaFailure(error), ...(diagnostic ? { process: diagnostic } : {}) }); failure ||= error; }
    await saveEvidence(config, stages, authentication, teardown);
  }
  if (failure) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
