import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  AUTHENTICATED_WORKFLOW_PATH,
  CORE_WORKFLOW_PATH,
  requireQaCoreApiRoute,
  waitForQaCorePrerequisite,
} from './qa-core-prerequisite.mjs';

const repository = 'FadiAboAlward/family-learning-hub';
const headSha = 'a'.repeat(40);
const token = 'synthetic-secret-never-record-in-evidence';
const env = { FLH_QA_HEAD_SHA: headSha, GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: '900' };
const prefix = `/repos/${repository}/actions`;
const pr = { number: 144, head: { ref: 'feat/isolation', sha: headSha }, base: { ref: 'main' } };
const run = (extra = {}) => ({
  id: 1000, run_number: 20, run_attempt: 1, workflow_id: 501,
  path: CORE_WORKFLOW_PATH, head_sha: headSha, head_branch: 'feat/isolation', event: 'pull_request',
  repository: { full_name: repository }, head_repository: { full_name: repository }, pull_requests: [pr],
  status: 'completed', conclusion: 'success', ...extra,
});
const requester = run({ id: 900, workflow_id: 502, path: AUTHENTICATED_WORKFLOW_PATH, status: 'in_progress', conclusion: null });
const jobs = (current = run()) => ['Static quality', 'Browser smoke'].map((name, index) => ({
  id: 2000 + index, name, run_id: current.id, run_attempt: current.run_attempt, head_sha: headSha,
  status: 'completed', conclusion: 'success',
}));

function scenario({ requesterRun = requester, runs = [run()], runDetail, jobList, response, scenarioEnv = env } = {}) {
  let clock = 0;
  let listCalls = 0;
  let detailCalls = 0;
  let jobCalls = 0;
  let currentRuns = [];
  const requests = [];
  const sleeps = [];
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    requests.push({ pathname: url.pathname, search: url.search });
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.ok(options.signal instanceof AbortSignal);
    requireQaCoreApiRoute(url.href);
    let body;
    if (url.pathname === `${prefix}/runs/900`) {
      body = requesterRun;
    } else if (url.pathname === `${prefix}/workflows/qa-isolated.yml/runs`) {
      listCalls += 1;
      assert.equal(url.searchParams.get('head_sha'), headSha);
      assert.equal(url.searchParams.get('event'), requesterRun.event);
      currentRuns = typeof runs === 'function' ? runs(listCalls) : runs;
      const start = (Number(url.searchParams.get('page')) - 1) * 100;
      body = { total_count: currentRuns.length, workflow_runs: currentRuns.slice(start, start + 100) };
    } else if (/\/attempts\/[1-9][0-9]*\/jobs$/.test(url.pathname)) {
      jobCalls += 1;
      const runId = Number(url.pathname.match(/\/runs\/(\d+)/)[1]);
      const attempt = Number(url.pathname.match(/\/attempts\/(\d+)/)[1]);
      const values = typeof jobList === 'function' ? jobList({ runId, attempt, jobCalls }) : jobList ?? jobs(run({ id: runId, run_attempt: attempt }));
      const start = (Number(url.searchParams.get('page')) - 1) * 100;
      body = { total_count: values.length, jobs: values.slice(start, start + 100) };
    } else {
      const id = Number(url.pathname.match(/\/runs\/(\d+)$/)?.[1]);
      assert.ok(id);
      detailCalls += 1;
      body = typeof runDetail === 'function' ? runDetail({ id, detailCalls }) : runDetail ?? currentRuns.find(item => item.id === id);
    }
    return response ? response({ url, body, requests }) : new Response(JSON.stringify(body), { status: 200 });
  };
  return {
    requests, sleeps,
    execute: extra => waitForQaCorePrerequisite({ env: scenarioEnv, fetchImpl, now: () => clock,
      sleep: async ms => { sleeps.push(ms); clock += ms; }, timeoutMs: 100, pollIntervalMs: 10, requestTimeoutMs: 10, ...extra }),
  };
}

// Invalid identity configuration must fail before credentials can reach any transport.
for (const badEnv of [
  {}, ...Object.keys(env).map(key => ({ ...env, [key]: '' })),
  { ...env, GITHUB_REPOSITORY: 'Saas-Alex/family-learning-hub' },
  { ...env, FLH_QA_HEAD_SHA: 'main' }, { ...env, FLH_QA_HEAD_SHA: 'A'.repeat(40) },
  { ...env, GITHUB_RUN_ID: '900/attempts/1' }, { ...env, GITHUB_RUN_ID: '9007199254740992' },
  { ...env, GITHUB_TOKEN: 'credential with newline\n' },
]) {
  let fetches = 0;
  await assert.rejects(waitForQaCorePrerequisite({ env: badEnv, fetchImpl: async () => { fetches += 1; throw new Error(token); } }), /QA_CORE_/);
  assert.equal(fetches, 0);
}
for (const options of [{ timeoutMs: 720001 }, { pollIntervalMs: 101 }, { requestTimeoutMs: 0 }]) {
  const test = scenario();
  await assert.rejects(test.execute(options), /QA_CORE_WAIT_CONFIG_INVALID/);
  assert.equal(test.requests.length, 0);
}

const allowed = `https://api.github.com${prefix}/workflows/qa-isolated.yml/runs?head_sha=${headSha}&event=pull_request&per_page=100&page=1`;
assert.equal(requireQaCoreApiRoute(allowed), allowed);
assert.equal(requireQaCoreApiRoute(`https://api.github.com${prefix}/runs/1000/attempts/1/jobs?per_page=100&page=3`), `https://api.github.com${prefix}/runs/1000/attempts/1/jobs?per_page=100&page=3`);
for (const url of [
  allowed.replace('https:', 'http:'), allowed.replace('api.github.com', 'api.github.com.evil.invalid'),
  allowed.replace('api.github.com', 'credential@api.github.com'), `${allowed}#fragment`,
  allowed.replace(repository, 'other/repository'), allowed.replace('qa-isolated.yml', 'qa-smoke.yml'),
  allowed.replace('page=1', 'page=4'), `${allowed}&page=1`, `${allowed}&redirect=https://evil.invalid`,
  `https://api.github.com${prefix}/runs/1000/cancel`, `https://api.github.com${prefix}/runs/1000?extra=1`,
]) assert.throws(() => requireQaCoreApiRoute(url), /QA_CORE_API_ROUTE_FORBIDDEN/);

const passed = scenario();
const proof = await passed.execute();
assert.equal(proof.status, 'PASS');
assert.equal(proof.headSha, headSha);
assert.equal(proof.coreRunId, 1000);
assert.equal(proof.coreRunAttempt, 1);
assert.deepEqual(proof.checkedJobs.map(job => job.name), ['Static quality', 'Browser smoke']);
assert.equal(passed.sleeps.length, 0);
assert.equal(passed.requests.length, 6); // Requester, list, detail, attempt jobs, latest list, final detail.
assert.ok(!JSON.stringify(proof).includes(token));
assert.ok(!Object.hasOwn(proof, 'token'));

for (const changed of [
  { head_sha: 'b'.repeat(40) }, { path: CORE_WORKFLOW_PATH }, { id: 899 },
  { head_repository: { full_name: 'other/repository' } },
  { pull_requests: [{ ...pr, base: { ref: 'other' } }] },
]) {
  const test = scenario({ requesterRun: { ...requester, ...changed } });
  await assert.rejects(test.execute(), /QA_CORE_REQUESTER_MISMATCH/);
  assert.equal(test.requests.length, 1);
}
for (const changedEnv of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_HEAD_REF: 'other' }, { GITHUB_REF: 'refs/pull/145/merge' }]) {
  const test = scenario({ scenarioEnv: { ...env, ...changedEnv } });
  await assert.rejects(test.execute(), /QA_CORE_REQUESTER_MISMATCH/);
  assert.equal(test.requests.length, 1);
}

for (const changed of [
  { head_sha: 'b'.repeat(40) }, { path: '.github/workflows/qa-smoke.yml' }, { event: 'workflow_dispatch' },
  { head_repository: { full_name: 'other/repository' } }, { run_attempt: 0 },
  { pull_requests: [{ ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } }] },
]) {
  await assert.rejects(scenario({ runs: [run(changed)] }).execute(), /QA_CORE_RUN_MISMATCH/);
}
// A newer failed run takes precedence over an older successful run for the same head.
await assert.rejects(scenario({ runs: [run({ id: 999, run_number: 19 }), run({ conclusion: 'failure' })] }).execute(), /QA_CORE_FAILED/);
for (const conclusion of ['cancelled', 'timed_out', 'neutral', 'skipped', null]) {
  await assert.rejects(scenario({ runs: [run({ conclusion })] }).execute(), /QA_CORE_FAILED/);
}

for (const jobList of [
  [jobs()[0]], [jobs()[0], { ...jobs()[1], name: 'Other job' }],
  [...jobs(), { ...jobs()[0], id: 2010 }],
  jobs().map((job, index) => index ? { ...job, run_attempt: 2 } : job),
  jobs().map((job, index) => index ? { ...job, run_id: 999 } : job),
  jobs().map((job, index) => index ? { ...job, head_sha: 'b'.repeat(40) } : job),
  jobs().map((job, index) => index ? { ...job, conclusion: 'skipped' } : job),
  jobs().map((job, index) => index ? { ...job, status: 'in_progress', conclusion: null } : job),
  [...jobs(), { ...jobs()[0], id: 2010, name: 'Additional', conclusion: 'failure' }],
]) await assert.rejects(scenario({ jobList }).execute(), /QA_CORE_(JOB_MISMATCH|REQUIRED_JOBS_MISSING)/);

const pending = scenario({ runs: count => [run(count === 1 ? { status: 'in_progress', conclusion: null } : {})] });
const pendingProof = await pending.execute();
assert.equal(pendingProof.status, 'PASS');
assert.equal(pendingProof.polls, 2);
assert.deepEqual(pending.sleeps, [10]);

// Rerunning after job inspection cannot authorize bootstrap from the previous attempt.
let rerun = false;
const newerAttempt = scenario({
  runs: () => [run({ run_attempt: rerun ? 2 : 1 })],
  runDetail: ({ detailCalls }) => {
    if (detailCalls === 2) rerun = true;
    return run({ run_attempt: rerun ? 2 : 1 });
  },
});
const newerProof = await newerAttempt.execute();
assert.equal(newerProof.coreRunAttempt, 2);
assert.equal(newerProof.polls, 2);
assert.ok(newerProof.checkedJobs.every(job => job.runAttempt === 2));
assert.equal(newerAttempt.requests.filter(item => item.pathname.endsWith('/attempts/2/jobs')).length, 1);

for (const runs of [[], [run({ status: 'queued', conclusion: null })],
  [run({ head_branch: 'other', pull_requests: [{ ...pr, number: 145, head: { ...pr.head, ref: 'other' } }] })]]) {
  const timedOut = scenario({ runs });
  await assert.rejects(timedOut.execute(), error => {
    assert.equal(error.code, 'QA_CORE_TIMEOUT');
    assert.equal(error.evidence.status, 'FAIL');
    assert.equal(error.evidence.elapsedMs, 100);
    return true;
  });
  assert.equal(timedOut.sleeps.length, 10);
}

const manyRuns = Array.from({ length: 101 }, (_, index) => run({ id: 1000 + index, run_number: 20 + index }));
const paged = scenario({ runs: manyRuns });
assert.equal((await paged.execute()).coreRunId, 1100);
assert.equal(paged.requests.filter(item => item.search.includes('page=2')).length, 2);
await assert.rejects(scenario({ runs: Array.from({ length: 301 }, (_, index) => run({ id: 1000 + index, run_number: 20 + index })) }).execute(), /QA_CORE_PAGINATION_LIMIT/);

for (const response of [
  () => new Response('{}', { status: 302, headers: { Location: 'https://evil.invalid' } }),
  () => ({ ok: true, status: 200, redirected: true, url: 'https://evil.invalid', json: async () => requester }),
  () => new Response(token, { status: 403 }),
  () => new Response(token, { status: 200 }),
  () => { throw new Error(`Transport exposed ${token}`); },
]) {
  const test = scenario({ response });
  await assert.rejects(test.execute(), error => {
    assert.match(error.code, /^QA_CORE_API_/);
    assert.ok(!JSON.stringify(error.evidence).includes(token));
    assert.ok(!error.message.includes(token));
    return true;
  });
  assert.equal(test.requests.length, 1);
}

// Exercise the real CLI and fixed artifact writer with a transport tripwire in an owned temporary copy.
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flh-core-prerequisite-'));
try {
  fs.mkdirSync(path.join(temporaryRoot, 'tests'));
  const entrypoint = path.join(temporaryRoot, 'tests', 'qa-core-prerequisite.mjs');
  fs.copyFileSync(new URL('./qa-core-prerequisite.mjs', import.meta.url), entrypoint);
  const marker = path.join(temporaryRoot, 'fetch-attempted');
  const tripwire = path.join(temporaryRoot, 'tripwire.mjs');
  fs.writeFileSync(tripwire, `import fs from 'node:fs'; globalThis.fetch = async () => { fs.writeFileSync(${JSON.stringify(marker)}, 'attempted'); throw new Error('transport forbidden'); };\n`);
  const rejected = spawnSync(process.execPath, ['--import', pathToFileURL(tripwire).href, entrypoint], {
    cwd: temporaryRoot, encoding: 'utf8', env: { ...process.env, ...env, FLH_QA_HEAD_SHA: '' },
  });
  assert.equal(rejected.status, 1);
  assert.equal(fs.existsSync(marker), false);
  assert.match(rejected.stdout, /Core prerequisite FAIL: QA_CORE_CONFIG_REQUIRED/);
  assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes(token));
  const summary = JSON.parse(fs.readFileSync(path.join(temporaryRoot, 'qa-authenticated-evidence', 'core-prerequisite.json'), 'utf8'));
  assert.deepEqual(summary, { schemaVersion: 1, status: 'FAIL', reason: 'QA_CORE_CONFIG_REQUIRED', coreWorkflow: CORE_WORKFLOW_PATH });
  assert.ok(!JSON.stringify(summary).includes(token));
} finally {
  const resolvedRoot = path.resolve(temporaryRoot);
  assert.ok(resolvedRoot.startsWith(`${path.resolve(os.tmpdir())}${path.sep}flh-core-prerequisite-`));
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

// The push-to-main path has no PR-number dependency and still requires the same exact SHA.
const pushed = run({ event: 'push', head_branch: 'main', pull_requests: [] });
const pushProof = await scenario({ requesterRun: { ...requester, ...pushed, id: 900, path: AUTHENTICATED_WORKFLOW_PATH }, runs: [pushed],
  scenarioEnv: { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } }).execute();
assert.equal(pushProof.status, 'PASS');
await assert.rejects(scenario({ requesterRun: { ...requester, event: 'push', head_branch: 'other', pull_requests: [] } }).execute(), /QA_CORE_RUN_MISMATCH/);

const source = fs.readFileSync(new URL('./qa-core-prerequisite.mjs', import.meta.url), 'utf8');
assert.match(source, /qa-authenticated-evidence/);
assert.match(source, /core-prerequisite\.json/);
assert.doesNotMatch(source, /JSON\.stringify\((?:result|response|run|config)\b/);
assert.doesNotMatch(source, /console\.(?:log|error)\((?:error|config|response|result)\b/);
console.log('Core prerequisite: exact-head workflow/attempt/jobs, bounded waits, zero-fetch config failures, redirect and secret-safe evidence tests passed.');
