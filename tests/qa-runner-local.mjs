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
