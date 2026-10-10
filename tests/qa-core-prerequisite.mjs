import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const CORE_WORKFLOW_PATH = '.github/workflows/qa-isolated.yml';
export const AUTHENTICATED_WORKFLOW_PATH = '.github/workflows/qa-authenticated-local.yml';
const REPOSITORY = 'FadiAboAlward/family-learning-hub';
const API_ORIGIN = 'https://api.github.com';
const MAX_WAIT_MS = 30 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const REQUIRED_JOBS = ['Static quality', 'Browser smoke'];
const PENDING_STATUSES = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure']);
const ERROR_CODES = new Set([
  'QA_CORE_CONFIG_REQUIRED', 'QA_CORE_REPOSITORY_NOT_ALLOWED', 'QA_CORE_SHA_INVALID',
  'QA_CORE_RUN_ID_INVALID', 'QA_CORE_WAIT_CONFIG_INVALID', 'QA_CORE_API_ROUTE_FORBIDDEN',
  'QA_CORE_API_FETCH_FAILED', 'QA_CORE_API_REDIRECT_FORBIDDEN', 'QA_CORE_API_HTTP_FAILED',
  'QA_CORE_API_RESPONSE_INVALID', 'QA_CORE_PAGINATION_LIMIT', 'QA_CORE_RUN_MISMATCH',
  'QA_CORE_REQUESTER_MISMATCH', 'QA_CORE_FAILED', 'QA_CORE_JOB_MISMATCH',
  'QA_CORE_REQUIRED_JOBS_MISSING', 'QA_CORE_TIMEOUT', 'QA_CORE_ARTIFACT_FAILED',
]);

class QaCorePrerequisiteError extends Error {
  constructor(code, evidence = null) {
    super(code);
    this.code = code;
    this.evidence = evidence;
  }
}

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const shaIsValid = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

function configuration(env) {
  if (!env.FLH_QA_HEAD_SHA || !env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) {
    throw new QaCorePrerequisiteError('QA_CORE_CONFIG_REQUIRED');
  }
  if (env.GITHUB_REPOSITORY !== REPOSITORY) throw new QaCorePrerequisiteError('QA_CORE_REPOSITORY_NOT_ALLOWED');
  if (!shaIsValid(env.FLH_QA_HEAD_SHA)) throw new QaCorePrerequisiteError('QA_CORE_SHA_INVALID');
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID) || !positiveId(Number(env.GITHUB_RUN_ID))) {
    throw new QaCorePrerequisiteError('QA_CORE_RUN_ID_INVALID');
  }
  if (typeof env.GITHUB_TOKEN !== 'string' || /\s/.test(env.GITHUB_TOKEN)) throw new QaCorePrerequisiteError('QA_CORE_CONFIG_REQUIRED');
  return { headSha: env.FLH_QA_HEAD_SHA, requesterRunId: Number(env.GITHUB_RUN_ID), token: env.GITHUB_TOKEN };
}

/** Only read-only, fixed-repository workflow-run and attempt-job routes are permitted. */
export function requireQaCoreApiRoute(value) {
  let url;
  try { url = new URL(value); } catch { throw new QaCorePrerequisiteError('QA_CORE_API_ROUTE_FORBIDDEN'); }
  const prefix = `/repos/${REPOSITORY}/actions/`;
  const runRoute = new RegExp(`^${prefix}runs/[1-9][0-9]*$`);
  const jobsRoute = new RegExp(`^${prefix}runs/[1-9][0-9]*/attempts/[1-9][0-9]*/jobs$`);
  const runsRoute = `${prefix}workflows/qa-isolated.yml/runs`;
  const keys = [...url.searchParams.keys()];
  const isRuns = url.pathname === runsRoute;
  const isJobs = jobsRoute.test(url.pathname);
  const validQuery = (isRuns || isJobs)
    && keys.length === (isRuns ? 4 : 2)
    && new Set(keys).size === keys.length
    && keys.every(key => (isRuns ? ['head_sha', 'event', 'per_page', 'page'] : ['per_page', 'page']).includes(key))
    && url.searchParams.get('per_page') === String(PAGE_SIZE)
    && /^[1-3]$/.test(url.searchParams.get('page'))
    && (!isRuns || (shaIsValid(url.searchParams.get('head_sha')) && ['pull_request', 'push'].includes(url.searchParams.get('event'))));
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash
      || !((runRoute.test(url.pathname) && keys.length === 0) || validQuery)) {
    throw new QaCorePrerequisiteError('QA_CORE_API_ROUTE_FORBIDDEN');
  }
  return url.href;
}

function validateRun(run, { headSha, requesterRunId }, workflowPath, fail) {
  if (!run || typeof run !== 'object' || !positiveId(run.id) || !positiveId(run.run_attempt)
      || !positiveId(run.run_number) || !positiveId(run.workflow_id) || run.head_sha !== headSha
      || run.path !== workflowPath || run.repository?.full_name !== REPOSITORY
      || run.head_repository?.full_name !== REPOSITORY || !['pull_request', 'push'].includes(run.event)
      || typeof run.head_branch !== 'string' || !run.head_branch || /[\r\n]/.test(run.head_branch)) {
    fail(workflowPath === CORE_WORKFLOW_PATH ? 'QA_CORE_RUN_MISMATCH' : 'QA_CORE_REQUESTER_MISMATCH');
  }
  if (workflowPath === AUTHENTICATED_WORKFLOW_PATH && run.id !== requesterRunId) fail('QA_CORE_REQUESTER_MISMATCH');
  if (run.event === 'push' && run.head_branch !== 'main') fail('QA_CORE_RUN_MISMATCH');
  if (run.event === 'pull_request') {
    if (!Array.isArray(run.pull_requests) || !run.pull_requests.length
        || run.pull_requests.some(pr => !positiveId(pr.number) || pr.base?.ref !== 'main'
          || pr.head?.sha !== headSha || pr.head?.ref !== run.head_branch)) {
      fail(workflowPath === CORE_WORKFLOW_PATH ? 'QA_CORE_RUN_MISMATCH' : 'QA_CORE_REQUESTER_MISMATCH');
    }
  }
  return run;
}

function sameTrigger(run, requester) {
  if (run.event !== requester.event || run.head_branch !== requester.head_branch) return false;
  if (run.event === 'push') return true;
  return run.pull_requests.some(pr => requester.pull_requests.some(expected => expected.number === pr.number));
}

/** No backend/browser/bootstrap work is authorized by this helper; it only proves the exact-head core gate. */
export async function waitForQaCorePrerequisite({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = delay,
  timeoutMs = MAX_WAIT_MS,
  pollIntervalMs = 15_000,
  requestTimeoutMs = 15_000,
} = {}) {
  const config = configuration(env); // Validate all identity configuration before even the first fetch.
  if (![timeoutMs, pollIntervalMs, requestTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0)
      || timeoutMs > MAX_WAIT_MS || pollIntervalMs > timeoutMs || requestTimeoutMs > MAX_WAIT_MS
      || typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof sleep !== 'function') {
    throw new QaCorePrerequisiteError('QA_CORE_WAIT_CONFIG_INVALID');
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw new QaCorePrerequisiteError('QA_CORE_WAIT_CONFIG_INVALID');
  let polls = 0;
  let selected = null;
  let checkedJobs = [];
  const elapsed = () => Math.max(0, Math.floor(now() - startedAt));
  const evidence = (status, reason = null) => ({
    schemaVersion: 1,
    status,
    ...(reason ? { reason } : {}),
    repository: REPOSITORY,
    headSha: config.headSha,
    requesterRunId: config.requesterRunId,
    coreWorkflow: CORE_WORKFLOW_PATH,
    coreRunId: selected?.id ?? null,
    coreRunAttempt: selected?.run_attempt ?? null,
    coreRunStatus: selected?.status === 'completed' || PENDING_STATUSES.has(selected?.status) ? selected.status : null,
    coreRunConclusion: CONCLUSIONS.has(selected?.conclusion) ? selected.conclusion : null,
    checkedJobs,
    polls,
    elapsedMs: elapsed(),
  });
  const fail = code => { throw new QaCorePrerequisiteError(code, evidence('FAIL', code)); };
  const remaining = () => {
    const value = timeoutMs - elapsed();
    if (value <= 0) fail('QA_CORE_TIMEOUT');
    return value;
  };
  const get = async route => {
    const url = requireQaCoreApiRoute(`${API_ORIGIN}${route}`);
    const signal = AbortSignal.timeout(Math.min(requestTimeoutMs, remaining()));
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        redirect: 'error',
        signal,
      });
    } catch { fail(elapsed() >= timeoutMs ? 'QA_CORE_TIMEOUT' : 'QA_CORE_API_FETCH_FAILED'); }
    remaining();
    if (response?.redirected || (response?.url && response.url !== url) || (response?.status >= 300 && response?.status < 400)) fail('QA_CORE_API_REDIRECT_FORBIDDEN');
    if (!response?.ok) fail('QA_CORE_API_HTTP_FAILED');
    let result;
    try { result = await response.json(); } catch { fail('QA_CORE_API_RESPONSE_INVALID'); }
    remaining();
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail('QA_CORE_API_RESPONSE_INVALID');
    return result;
  };
  const prefix = `/repos/${REPOSITORY}/actions`;
  const pages = async (route, field, extraQuery = '') => {
    const items = [];
    let total = null;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await get(`${route}?${extraQuery}per_page=${PAGE_SIZE}&page=${page}`);
      if (!Number.isSafeInteger(result.total_count) || result.total_count < 0 || !Array.isArray(result[field])
          || result[field].length > PAGE_SIZE || (total !== null && result.total_count !== total)) fail('QA_CORE_API_RESPONSE_INVALID');
      total = result.total_count;
      if (total > PAGE_SIZE * MAX_PAGES) fail('QA_CORE_PAGINATION_LIMIT');
      items.push(...result[field]);
      if (items.length === total) return items;
      if (items.length > total || result[field].length !== PAGE_SIZE) fail('QA_CORE_API_RESPONSE_INVALID');
    }
    fail('QA_CORE_PAGINATION_LIMIT');
  };
  const requester = validateRun(await get(`${prefix}/runs/${config.requesterRunId}`), config, AUTHENTICATED_WORKFLOW_PATH, fail);
  if ((env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== requester.event)
      || (env.GITHUB_HEAD_REF && env.GITHUB_HEAD_REF !== requester.head_branch)
      || (env.GITHUB_REF && env.GITHUB_REF !== (requester.event === 'push' ? 'refs/heads/main' : `refs/pull/${requester.pull_requests[0].number}/merge`))) {
    fail('QA_CORE_REQUESTER_MISMATCH');
  }
  const latestRun = async () => {
    const runs = await pages(`${prefix}/workflows/qa-isolated.yml/runs`, 'workflow_runs', `head_sha=${config.headSha}&event=${requester.event}&`);
    const ids = new Set();
    for (const run of runs) {
      validateRun(run, config, CORE_WORKFLOW_PATH, fail);
      if (ids.has(run.id)) fail('QA_CORE_API_RESPONSE_INVALID');
      ids.add(run.id);
    }
    return runs.filter(run => sameTrigger(run, requester))
      .sort((a, b) => b.run_number - a.run_number || b.id - a.id || b.run_attempt - a.run_attempt)[0] ?? null;
  };
  const detail = async run => {
    const current = validateRun(await get(`${prefix}/runs/${run.id}`), config, CORE_WORKFLOW_PATH, fail);
    if (current.id !== run.id || current.run_number !== run.run_number || current.workflow_id !== run.workflow_id
        || !sameTrigger(current, requester) || current.run_attempt < run.run_attempt) fail('QA_CORE_RUN_MISMATCH');
    return current;
  };
  const runSucceeded = run => {
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') fail('QA_CORE_FAILED');
      return true;
    }
    if (!PENDING_STATUSES.has(run.status) || run.conclusion != null) fail('QA_CORE_RUN_MISMATCH');
    return false;
  };
  while (remaining() > 0) {
    polls += 1;
    checkedJobs = [];
    selected = await latestRun();
    if (selected) {
      selected = await detail(selected);
      if (runSucceeded(selected)) {
        const jobs = await pages(`${prefix}/runs/${selected.id}/attempts/${selected.run_attempt}/jobs`, 'jobs');
        const jobIds = new Set();
        for (const job of jobs) {
          if (!job || !positiveId(job.id) || jobIds.has(job.id) || job.run_id !== selected.id
              || job.run_attempt !== selected.run_attempt || job.head_sha !== config.headSha
              || job.status !== 'completed' || job.conclusion !== 'success') fail('QA_CORE_JOB_MISMATCH');
          jobIds.add(job.id);
        }
        for (const name of REQUIRED_JOBS) {
          const matches = jobs.filter(job => job.name === name);
          if (matches.length !== 1) fail('QA_CORE_REQUIRED_JOBS_MISSING');
          checkedJobs.push({ name, jobId: matches[0].id, runAttempt: selected.run_attempt, status: 'completed', conclusion: 'success' });
        }
        // A rerun/new run appearing during pagination must not let an older attempt authorize bootstrap.
        const latest = await latestRun();
        if (latest?.id === selected.id) {
          const current = await detail(latest);
          if (current.run_attempt === selected.run_attempt && runSucceeded(current)) {
            selected = current;
            return evidence('PASS');
          }
          selected = current;
        }
      }
    }
    await sleep(Math.min(pollIntervalMs, remaining()));
  }
  fail('QA_CORE_TIMEOUT');
}

/** Artifacts use a fixed allowlist produced above; raw API responses and credentials never reach disk. */
async function writeSummary(summary) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = path.join(root, 'qa-authenticated-evidence');
  const target = path.join(directory, 'core-prerequisite.json');
  try {
    await fs.mkdir(directory, { recursive: true });
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error();
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(target, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch { throw new QaCorePrerequisiteError('QA_CORE_ARTIFACT_FAILED'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let summary;
  try {
    summary = await waitForQaCorePrerequisite();
  } catch (error) {
    const reason = ERROR_CODES.has(error?.code) ? error.code : 'QA_CORE_API_RESPONSE_INVALID';
    summary = error instanceof QaCorePrerequisiteError && error.evidence
      ? error.evidence : { schemaVersion: 1, status: 'FAIL', reason, coreWorkflow: CORE_WORKFLOW_PATH };
    process.exitCode = 1;
  }
  try { await writeSummary(summary); } catch {
    summary = { ...summary, status: 'FAIL', reason: 'QA_CORE_ARTIFACT_FAILED' };
    process.exitCode = 1;
  }
  console.log(summary.status === 'PASS'
    ? `Core prerequisite PASS: head ${summary.headSha}, run ${summary.coreRunId}, attempt ${summary.coreRunAttempt}.`
    : `Core prerequisite FAIL: ${summary.reason}.`);
}
