// FLH026 v1.1 / Drive revision2. Only the disposable authenticated Runner stack.
import path from 'node:path';
import { PRODUCTION_HOSTS, requireIsolatedQaBackend, requireQaAppUrl, requireQaPublishableKey } from '../supabase/functions/_shared/qa-backend-isolation.mjs';

export const LOCAL_API = 'http://127.0.0.1:54321';
export const LOCAL_APP = 'http://localhost:4173/';
export const QA_REPOSITORY = 'FadiAboAlward/family-learning-hub';

/** Validate the target before starting a subprocess, creating fixtures or requesting HTTP. */
export function requireRunnerLocal(env = process.env) {
  const config = requireIsolatedQaBackend({ mode: env.FLH_QA_ISOLATION_MODE, backendUrl: env.FLH_QA_BACKEND_URL, projectRef: env.FLH_QA_PROJECT_REF });
  if (config.mode !== 'runner-local' || config.backendUrl !== LOCAL_API || requireQaAppUrl(env.APP_URL) !== LOCAL_APP) throw new Error('QA_LOCAL_TARGET_REQUIRED');
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.GITHUB_REPOSITORY !== QA_REPOSITORY || env.GITHUB_ACTOR_ID !== '320162789') throw new Error('QA_LOCAL_RUNNER_REQUIRED');
  if (!/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '') || !/^[a-f0-9]{40}$/.test(env.FLH_QA_HEAD_SHA || '')) throw new Error('QA_LOCAL_RUN_ID_REQUIRED');
  if (!env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) throw new Error('QA_LOCAL_TEMP_REQUIRED');
  // These are unnecessary for local CLI operation; never inherit a linked/hosted credential.
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'DATABASE_URL']) if (env[key]) throw new Error('QA_LOCAL_REMOTE_CONFIG_FORBIDDEN');
  const projectId = `flh-auth-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const directory = path.join(path.resolve(env.RUNNER_TEMP), projectId);
  if (path.dirname(directory) !== path.resolve(env.RUNNER_TEMP)) throw new Error('QA_LOCAL_TEMP_INVALID');
  return Object.freeze({ ...config, appUrl: LOCAL_APP, projectId, directory, headSha: env.FLH_QA_HEAD_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
}

/** Exact CLI-owned names/labels bind docker exec and teardown to this one runtime. */
export function assertOwnedContainer(config, data, service = 'db') {
  if (!data || data.Name !== `/supabase_${service}_${config.projectId}` || data.Config?.Labels?.['com.supabase.cli.project'] !== config.projectId || data.State?.Running !== true) throw new Error('QA_LOCAL_CONTAINER_NOT_OWNED');
  return true;
}

/** Daemon-reported, full-ID-bound Linux hosts file only; no arbitrary privileged path. */
export function ownedContainerHostsPath(config, dockerRootDir, data, expectedId) {
  if (typeof dockerRootDir !== 'string' || dockerRootDir === '/' || !path.posix.isAbsolute(dockerRootDir)
      || dockerRootDir.endsWith('/') || dockerRootDir.includes('\\') || /[\x00-\x1f\x7f]/.test(dockerRootDir)
      || path.posix.normalize(dockerRootDir) !== dockerRootDir) throw new Error('QA_LOCAL_DOCKER_ROOT_INVALID');
  if (!/^flh-auth-\d+-\d+$/.test(config?.projectId || '') || !/^[a-f0-9]{64}$/.test(expectedId || '')
      || data?.Id !== expectedId || data.State?.Running !== true || data.Config?.Labels?.['com.supabase.cli.project'] !== config.projectId
      || !(new RegExp(`^/supabase_[a-z][a-z0-9_]*_${config.projectId}$`).test(data.Name || '') || data.Name === `/realtime-dev.supabase_realtime_${config.projectId}`)) throw new Error('QA_LOCAL_CONTAINER_NOT_OWNED');
  const expected = path.posix.join(dockerRootDir, 'containers', expectedId, 'hosts');
  if (data.HostsPath !== expected) throw new Error('QA_LOCAL_CONTAINER_HOSTS_PATH_INVALID');
  return expected;
}

export function assertContainerProductionDenied(hosts) {
  const rows = String(hosts).split('\n').map(line => line.split('#')[0].trim().split(/\s+/));
  for (const host of PRODUCTION_HOSTS) {
    const matching = rows.filter(parts => parts.slice(1).includes(host));
    if (!matching.some(parts => parts[0] === '127.0.0.1') || !matching.some(parts => parts[0] === '::1') || matching.some(parts => !['127.0.0.1', '::1'].includes(parts[0]))) throw new Error('QA_LOCAL_CONTAINER_DNS_NOT_DENIED');
  }
  return true;
}

export function requireSuccessfulCoreEvidence(config, evidence) {
  if (evidence?.status !== 'PASS' || evidence.headSha !== config.headSha || String(evidence.requesterRunId) !== config.runId
      || evidence.coreWorkflow !== '.github/workflows/qa-isolated.yml' || evidence.coreRunStatus !== 'completed' || evidence.coreRunConclusion !== 'success'
      || !Number.isSafeInteger(evidence.coreRunId) || evidence.coreRunId < 1 || !Number.isSafeInteger(evidence.coreRunAttempt) || evidence.coreRunAttempt < 1
      || !Array.isArray(evidence.checkedJobs) || evidence.checkedJobs.length !== 2
      || !['Static quality', 'Browser smoke'].every(name => evidence.checkedJobs.filter(job => job.name === name && job.status === 'completed' && job.conclusion === 'success' && job.runAttempt === evidence.coreRunAttempt).length === 1)) throw new Error('QA_LOCAL_CORE_EVIDENCE_REQUIRED');
  return true;
}

/** Only generated local keys from captured CLI status enter this harness. Never print status. */
export function readLocalRuntime(config, status) {
  if (status?.API_URL !== config.backendUrl) throw new Error('QA_LOCAL_STATUS_TARGET_MISMATCH');
  const publishableKey = requireQaPublishableKey(status.ANON_KEY, config);
  let serverClaims;
  try { serverClaims = JSON.parse(Buffer.from(status.SERVICE_ROLE_KEY.split('.')[1], 'base64url').toString()); } catch { throw new Error('QA_LOCAL_SERVER_KEY_INVALID'); }
  if (!serverClaims || typeof serverClaims !== 'object' || Array.isArray(serverClaims) || serverClaims.role !== 'service_role' || serverClaims.ref === 'gkpoylfozvuwuwqeoduc' || status.SERVICE_ROLE_KEY === publishableKey) throw new Error('QA_LOCAL_SERVER_KEY_INVALID');
  return { ...config, publishableKey, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

/** Local-only Auth transport; callers cannot follow redirects or choose another origin. */
export async function fetchRunnerLocalAuth(config, route, options = {}, fetchImpl = fetch) {
  const checked = requireIsolatedQaBackend(config);
  if (checked.mode !== 'runner-local' || checked.backendUrl !== LOCAL_API || !['/auth/v1/admin/users', '/auth/v1/token?grant_type=password', '/auth/v1/logout'].includes(route) && !/^\/auth\/v1\/admin\/users\/[a-f0-9-]{36}$/.test(route)) throw new Error('QA_LOCAL_AUTH_ROUTE_INVALID');
  return fetchImpl(`${checked.backendUrl}${route}`, { ...options, redirect: 'error' });
}

/** Gateway overlay only for endpoints that already authenticate in their own source. */
export function localFunctionConfig(source, projectId) {
  if (!/^flh-auth-\d+-\d+$/.test(projectId) || (source.match(/^project_id\s*=/gm) || []).length !== 1) throw new Error('QA_LOCAL_PROJECT_CONFIG_INVALID');
  let result = source.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  for (const endpoint of ['qa-auth', 'attempt-history-api', 'activity-api', 'question-reference-api', 'parent-program-api']) {
    if (result.includes(`[functions.${endpoint}]`)) throw new Error('QA_LOCAL_FUNCTION_CONFIG_UNEXPECTED');
    result += `\n# Runner-only overlay; endpoint retains its cryptographic/session authorization.\n[functions.${endpoint}]\nverify_jwt = false\n`;
  }
  return result;
}

/** Artifact errors contain stable codes only, never raw backend/child-process messages. */
export function safeQaFailure(error) {
  return /^QA_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'QA_LOCAL_STAGE_FAILED';
}

const commands = new Set(['supabase_start', 'supabase_db_reset', 'supabase_status', 'supabase_stop', 'supabase_version', 'supabase_functions_serve',
  'docker_info', 'docker_inspect', 'docker_list_containers', 'docker_list_volumes', 'docker_exec_hosts', 'docker_exec_psql', 'docker_exec', 'container_hosts_append', 'container_hosts_read',
  'git_head', 'git_tracked_sources', 'node_authenticated_browser', 'python_local_server', 'unknown_command']);
const categories = new Set(['CONFIG_INVALID', 'DOCKER_UNAVAILABLE', 'DISK_FULL', 'IMAGE_PULL_FAILED', 'HEALTH_CHECK_FAILED', 'PORT_IN_USE',
  'PERMISSION_DENIED', 'DATABASE_OR_MIGRATION_FAILED', 'LOCAL_TRANSPORT_FAILED', 'EXECUTABLE_OR_FILE_MISSING', 'PROCESS_TIMEOUT', 'UNKNOWN_FAILURE']);
const authenticatedFailures = new Set(['OIDC_URL_REJECTED', 'OIDC_ENV_MISSING', 'OIDC_REQUEST_FAILED', 'OIDC_TOKEN_MISSING',
  'ATTESTATION_FAILED', 'TESTING_CONFIG_INVALID', 'MODULE_MISSING', 'BROWSER_EXECUTABLE_MISSING', 'AUTH_PREPARE_FAILED', 'AUTH_CLEANUP_FAILED',
  'TRANSPORT_FAILED', 'RESPONSE_JSON_INVALID', 'BROWSER_TIMEOUT', 'BROWSER_ERRORS', 'NETWORK_REJECTED', 'SESSION_INVALID', 'QUIZ_INVALID',
  'RESUME_FAILED', 'ANSWER_KEY_LEAK', 'PARENT_CONFIG_FAILED', 'PARENT_LOGIN_FAILED', 'PARENT_DASHBOARD_FAILED', 'PARENT_EXCLUSION_FAILED',
  'PARENT_LOGOUT_FAILED', 'ATTEMPT_NOT_FOUND', 'DEEP_LINK_INVALID', 'UNCLASSIFIED']);
export const AUTHENTICATED_QA_STAGES = Object.freeze(['CONFIG', 'ATTESTATION', 'PLAYWRIGHT_IMPORT', 'OIDC_REQUEST', 'AUTH_PREPARE', 'SESSION_VALIDATION',
  'BROWSER_LAUNCH', 'BROWSER_NAVIGATION', 'PROGRAM_READY', 'PROGRAM_OPEN', 'BOOK_READY', 'BOOK_OPEN', 'LEARNING_OPEN', 'LEARNING_RESUME',
  'LEARNING_ANSWERS', 'LEARNING_FINISH', 'EXAM_OPEN', 'EXAM_RESUME', 'EXAM_ANSWERS', 'EXAM_SUBMIT', 'ATTEMPT_DISCOVERY',
  'DEEP_LINK', 'SCREENSHOT', 'PARENT_AUTH', 'BROWSER_SAFETY', 'AUTH_CLEANUP']);
const authenticatedResponseErrors = new Set(['QA_AUTH_FAILED', 'QA_BUSY', 'QA_LEARNER_NOT_READY', 'QA_QUIZ_NOT_FOUND', 'QA_VERSION_NOT_FOUND',
  'QA_ATTEMPT_CLEANUP_FAILED', 'QA_LEASE_ACQUIRE_FAILED', 'QA_LEASE_RELEASE_FAILED', 'QA_LEASE_NOT_OWNED', 'INVALID_RUN_ID', 'UNKNOWN_ACTION', 'METHOD_NOT_ALLOWED']);
const safeHttpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599;
const safeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000;

/** Only fixed identities/numeric status escape; the error object stays private. */
export function safeAuthenticatedFailure(error) {
  const codes = {
    QA_OIDC_URL_INVALID:'OIDC_URL_REJECTED', QA_ISOLATION_ATTESTATION_FAILED:'ATTESTATION_FAILED',
    QA_ISOLATION_CONFIG_REQUIRED:'TESTING_CONFIG_INVALID', QA_ISOLATION_URL_INVALID:'TESTING_CONFIG_INVALID',
    QA_ISOLATION_IDENTITY_MISMATCH:'TESTING_CONFIG_INVALID', QA_PRODUCTION_FORBIDDEN:'TESTING_CONFIG_INVALID',
    QA_PUBLISHABLE_KEY_REQUIRED:'TESTING_CONFIG_INVALID', QA_PUBLISHABLE_KEY_INVALID:'TESTING_CONFIG_INVALID',
    QA_APP_URL_INVALID:'TESTING_CONFIG_INVALID', QA_APP_MUST_BE_LOCAL:'TESTING_CONFIG_INVALID',
    QA_AUTH_PREPARE_FAILED:'AUTH_PREPARE_FAILED', QA_AUTH_CLEANUP_FAILED:'AUTH_CLEANUP_FAILED',
    QA_OIDC_REQUEST_FAILED:'OIDC_REQUEST_FAILED', QA_OIDC_TOKEN_MISSING:'OIDC_TOKEN_MISSING',
    QA_AUTH_SESSION_INVALID:'SESSION_INVALID', QA_AUTH_QUIZ_INVALID:'QUIZ_INVALID',
    QA_BROWSER_NETWORK_REJECTED:'NETWORK_REJECTED', QA_BROWSER_ERRORS:'BROWSER_ERRORS',
    QA_LOCAL_RESUME_API_FAILED:'RESUME_FAILED', QA_LOCAL_RESUME_INVALID:'RESUME_FAILED', QA_LOCAL_RESUME_ID_CHANGED:'RESUME_FAILED',
    QA_LOCAL_ANSWER_KEY_LEAK:'ANSWER_KEY_LEAK', QA_LOCAL_PARENT_CONFIG_REQUIRED:'PARENT_CONFIG_FAILED',
    QA_LOCAL_PARENT_LOGIN_FAILED:'PARENT_LOGIN_FAILED', QA_LOCAL_PARENT_DASHBOARD_FAILED:'PARENT_DASHBOARD_FAILED',
    QA_LOCAL_PARENT_TEST_EXCLUSION_FAILED:'PARENT_EXCLUSION_FAILED', QA_LOCAL_PARENT_LOGOUT_FAILED:'PARENT_LOGOUT_FAILED',
    QA_LOCAL_ATTEMPT_NOT_FOUND:'ATTEMPT_NOT_FOUND', QA_LOCAL_DEEP_LINK_QUERY_REMAIN:'DEEP_LINK_INVALID',
  };
  let code = Object.hasOwn(codes, error?.message) ? codes[error.message] : 'UNCLASSIFIED';
  if (error?.message === 'GitHub OIDC environment is unavailable') code = 'OIDC_ENV_MISSING';
  else if (error?.name === 'TimeoutError') code = 'BROWSER_TIMEOUT';
  else if (error?.name === 'SyntaxError') code = 'RESPONSE_JSON_INVALID';
  else if (error?.name === 'TypeError' && error?.message === 'fetch failed') code = 'TRANSPORT_FAILED';
  else if (error?.code === 'ERR_MODULE_NOT_FOUND') code = 'MODULE_MISSING';
  else if (String(error?.message || '').startsWith("browserType.launch: Executable doesn't exist")) code = 'BROWSER_EXECUTABLE_MISSING';
  return { code, ...(safeHttpStatus(error?.qaHttpStatus) ? { http_status: error.qaHttpStatus } : {}),
    ...(authenticatedResponseErrors.has(error?.qaResponseError) ? { response_error: error.qaResponseError } : {}) };
}

function authenticatedProcessDetails(stderr) {
  let failure, terminal, stage, network;
  for (const line of String(stderr).split(/\r?\n/)) {
    let value;
    try {
      if (line.startsWith('QA_AUTH_FAILURE ')) {
        value = JSON.parse(line.slice('QA_AUTH_FAILURE '.length));
        if (!failure && AUTHENTICATED_QA_STAGES.includes(value.stage) && authenticatedFailures.has(value.code)) failure = value;
      } else if (line.startsWith('QA_AUTH_TERMINAL ')) {
        value = JSON.parse(line.slice('QA_AUTH_TERMINAL '.length)); if (authenticatedFailures.has(value.code)) terminal = value;
      } else if (line.startsWith('QA_AUTH_STAGE ')) {
        value = JSON.parse(line.slice('QA_AUTH_STAGE '.length)); if (AUTHENTICATED_QA_STAGES.includes(value.stage) && value.status === 'START') stage = value.stage;
      } else if (line.startsWith('QA_AUTH_NETWORK ')) {
        value = JSON.parse(line.slice('QA_AUTH_NETWORK '.length));
        if (['PASS','FAIL','NOT_STARTED'].includes(value.status) && safeCount(value.unexpected_requests) && safeCount(value.browser_errors)) network = {
          status: value.status, unexpected_requests: value.unexpected_requests, browser_errors: value.browser_errors };
      }
    } catch {}
  }
  const selected = failure || terminal;
  return { authenticated_failure: selected?.code || authenticatedProcessFailure(stderr),
    ...(failure || stage ? { authenticated_stage: failure?.stage || stage } : {}),
    ...(safeHttpStatus(selected?.http_status) ? { authenticated_http_status: selected.http_status } : {}),
    ...(authenticatedResponseErrors.has(selected?.response_error) ? { authenticated_response_error: selected.response_error } : {}),
    ...(network ? { authenticated_network: network } : {}) };
}

/** Match fixed error identities only; captured URLs, tokens and response bodies never escape. */
function authenticatedProcessFailure(stderr) {
  for (const [pattern, code] of [
    [/Error: QA_OIDC_URL_INVALID(?:\r?\n|$)/, 'OIDC_URL_REJECTED'],
    [/Error: GitHub OIDC environment is unavailable(?:\r?\n|$)/, 'OIDC_ENV_MISSING'],
    [/Error: GitHub OIDC request failed: \d{3}(?:\r?\n|$)/, 'OIDC_REQUEST_FAILED'],
    [/Error: GitHub OIDC token missing(?:\r?\n|$)/, 'OIDC_TOKEN_MISSING'],
    [/Error: QA_ISOLATION_ATTESTATION_FAILED(?:\r?\n|$)/, 'ATTESTATION_FAILED'],
    [/Error: QA_(?:ISOLATION_CONFIG_REQUIRED|ISOLATION_URL_INVALID|ISOLATION_IDENTITY_MISMATCH|PUBLISHABLE_KEY_REQUIRED|PUBLISHABLE_KEY_INVALID|APP_URL_INVALID|APP_MUST_BE_LOCAL)(?:\r?\n|$)/, 'TESTING_CONFIG_INVALID'],
    [/Error \[ERR_MODULE_NOT_FOUND\]:/, 'MODULE_MISSING'],
    [/browserType\.launch: Executable doesn't exist/, 'BROWSER_EXECUTABLE_MISSING'],
    [/Error: QA auth prepare failed: \d{3}(?: [A-Z_]+)?(?:\r?\n|$)/, 'AUTH_PREPARE_FAILED'],
    [/Error: QA auth cleanup failed: \d{3}(?: [A-Z_]+)?(?:\r?\n|$)/, 'AUTH_CLEANUP_FAILED'],
  ]) if (pattern.test(String(stderr))) return code;
  return 'UNCLASSIFIED';
}

/** Fixed identities/categories only; never return the command line or captured stderr. */
export function qaProcessDiagnostic(file, args, stderr, exitCode, reason = 'FAILED') {
  const name = String(file).replaceAll('\\', '/').split('/').at(-1).toLowerCase().replace(/\.(exe|cmd)$/, '');
  let command = 'unknown_command';
  if (name === 'supabase') {
    if (args[0] === 'start') command = 'supabase_start';
    else if (args[0] === 'db' && args[1] === 'reset') command = 'supabase_db_reset';
    else if (['status', 'stop'].includes(args[0])) command = `supabase_${args[0]}`;
    else if (args[0] === '--version') command = 'supabase_version';
    else if (args[0] === 'functions' && args[1] === 'serve') command = 'supabase_functions_serve';
  } else if (name === 'docker') {
    if (args[0] === 'info') command = 'docker_info';
    else if (args[0] === 'inspect') command = 'docker_inspect';
    else if (args[0] === 'ps') command = 'docker_list_containers';
    else if (args[0] === 'volume' && args[1] === 'ls') command = 'docker_list_volumes';
    else if (args[0] === 'exec') command = args.includes('psql') ? 'docker_exec_psql' : args.some(arg => arg === '/etc/hosts' || arg === 'cat >> /etc/hosts') ? 'docker_exec_hosts' : 'docker_exec';
  } else if (name === 'sudo' && args[0] === '-n') command = args[1] === 'tee' && args[2] === '-a' ? 'container_hosts_append' : args[1] === 'cat' ? 'container_hosts_read' : command;
  else if (name === 'git') command = args[0] === 'rev-parse' ? 'git_head' : args[0] === 'ls-files' ? 'git_tracked_sources' : command;
  else if (name === 'node' && args[0] === 'tests/authenticated-e2e.mjs') command = 'node_authenticated_browser';
  else if (name === 'python3' && args[0] === '-m' && args[1] === 'http.server') command = 'python_local_server';
  let category = reason === 'TIMEOUT' ? 'PROCESS_TIMEOUT' : reason === 'UNAVAILABLE' ? 'EXECUTABLE_OR_FILE_MISSING' : 'UNKNOWN_FAILURE';
  if (reason === 'FAILED') for (const [pattern, label] of [
    [/failed to parse|error parsing|invalid config|unknown.*config|unsupported.*config|toml.*error/i, 'CONFIG_INVALID'],
    [/cannot connect to.*docker|docker daemon.*not running|docker\.sock/i, 'DOCKER_UNAVAILABLE'],
    [/no space left on device|disk quota exceeded/i, 'DISK_FULL'],
    [/pull access denied|manifest unknown|failed to pull|failed to resolve.*image|toomanyrequests/i, 'IMAGE_PULL_FAILED'],
    [/health.?check|unhealthy|container.*not healthy/i, 'HEALTH_CHECK_FAILED'],
    [/address already in use|port is already allocated|bind.*already in use/i, 'PORT_IN_USE'],
    [/permission denied/i, 'PERMISSION_DENIED'],
    [/sqlstate|syntax error|relation.*does not exist|column.*does not exist|migration.*failed|QA_LOCAL_(?:DATABASE|FIXTURE|PRIVILEGE|TEST_LEARNER|PARENT)_/i, 'DATABASE_OR_MIGRATION_FAILED'],
    [/connection refused|ECONNREFUSED|context deadline exceeded|network.*unreachable|i\/o timeout|timed out|ETIMEDOUT|unexpected EOF/i, 'LOCAL_TRANSPORT_FAILED'],
    [/command not found|executable.*not found|no such file or directory|ENOENT/i, 'EXECUTABLE_OR_FILE_MISSING'],
  ]) if (pattern.test(String(stderr))) { category = label; break; }
  if (reason === 'FAILED' && exitCode === 127) category = 'EXECUTABLE_OR_FILE_MISSING';
  // -1 explicitly means no process exit status (spawn failure/timeout), not a fabricated exit code.
  return Object.freeze({ command, exit_code: Number.isInteger(exitCode) ? exitCode : -1, exit_kind: Number.isInteger(exitCode) ? 'PROCESS_EXIT' : 'NO_PROCESS_EXIT', category,
    ...(command === 'node_authenticated_browser' ? authenticatedProcessDetails(stderr) : {}) });
}

export function safeQaProcessDiagnostic(error) {
  const value = error?.diagnostic;
  if (!commands.has(value?.command) || !categories.has(value?.category) || !Number.isInteger(value?.exit_code) || !['PROCESS_EXIT', 'NO_PROCESS_EXIT'].includes(value?.exit_kind)) return null;
  return { command: value.command, exit_code: value.exit_code, exit_kind: value.exit_kind, category: value.category,
    ...(value.command === 'node_authenticated_browser' && authenticatedFailures.has(value.authenticated_failure) ? { authenticated_failure: value.authenticated_failure } : {}),
    ...(value.command === 'node_authenticated_browser' && AUTHENTICATED_QA_STAGES.includes(value.authenticated_stage) ? { authenticated_stage: value.authenticated_stage } : {}),
    ...(value.command === 'node_authenticated_browser' && safeHttpStatus(value.authenticated_http_status) ? { authenticated_http_status: value.authenticated_http_status } : {}),
    ...(value.command === 'node_authenticated_browser' && authenticatedResponseErrors.has(value.authenticated_response_error) ? { authenticated_response_error: value.authenticated_response_error } : {}),
    ...(value.command === 'node_authenticated_browser' && ['PASS','FAIL','NOT_STARTED'].includes(value.authenticated_network?.status)
      && safeCount(value.authenticated_network?.unexpected_requests) && safeCount(value.authenticated_network?.browser_errors)
      ? { authenticated_network: { status:value.authenticated_network.status, unexpected_requests:value.authenticated_network.unexpected_requests, browser_errors:value.authenticated_network.browser_errors } } : {}) };
}
