import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const attemptId = '94000000-0000-4000-8000-000000000004';

/** Execute one SQL command against the disposable local Supabase database. */
async function psql(sql) {
  const { stdout } = await execFileAsync('docker', [
    'exec', containerName, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql,
  ], { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/** Start one concurrent SQL command and expose its completion promise. */
function spawnPsql(sql) {
  const child = spawn('docker', [
    'exec', containerName, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`psql exited ${code}: ${stderr}`)));
  });
  return { done };
}

await psql(fs.readFileSync('tests/learning-finish-rpc.concurrency-setup.sql', 'utf8'));
const learnerId = await psql(`select id::text from public.learners where workspace_id='${workspaceId}'::uuid and slug='test'`);

// Hold the same attempt row first, then start two RPC calls that must overlap
// behind the production serialization lock.
const blocker = spawnPsql(`begin; select id from public.quiz_attempts where id='${attemptId}'::uuid for update; select pg_advisory_xact_lock(91500501); select pg_sleep(12); commit;`);
const lockDeadline = Date.now() + 3000;
let blockerReady = false;
while (!blockerReady && Date.now() < lockDeadline) {
  blockerReady = await psql("select count(*)::text from pg_locks where locktype='advisory' and objid=91500501 and granted") === '1';
  if (!blockerReady) await new Promise((resolve) => setTimeout(resolve, 25));
}
assert.equal(blockerReady, true, 'the concurrency blocker must acquire the finish attempt first');

const finishSql = `set role service_role; select public.flh_learning_finish('${workspaceId}'::uuid,'${learnerId}'::uuid,'${attemptId}'::uuid,11)::text; reset role;`;
const first = spawnPsql(finishSql);
const second = spawnPsql(finishSql);
const waiterDeadline = Date.now() + 5000;
let waiters = 0;
while (waiters < 2 && Date.now() < waiterDeadline) {
  waiters = Number(await psql(`select count(*)::text from pg_stat_activity where wait_event_type='Lock' and query like '%flh_learning_finish%' and query like '%${attemptId}%'`));
  if (waiters < 2) await new Promise((resolve) => setTimeout(resolve, 25));
}
assert.equal(waiters, 2, 'both finish calls must overlap behind the attempt lock');

const [, firstOutput, secondOutput] = await Promise.all([blocker.done, first.done, second.done]);
const firstResult = JSON.parse(firstOutput);
const secondResult = JSON.parse(secondOutput);
assert.deepEqual(secondResult, firstResult);
assert.equal(firstResult.attempt_id, attemptId);
assert.deepEqual(firstResult.award, {
  already_awarded: false,
  badges: ['concept-master'],
  reward_points: 10,
  xp: 45,
});

const retryResult = JSON.parse(await psql(finishSql.replace(',11)', ',999)')));
assert.deepEqual(retryResult, firstResult, 'retry after commit must return the exact cached result');
await psql(fs.readFileSync('tests/learning-finish-rpc.concurrency-verify.sql', 'utf8'));

console.log('Learning finish concurrent double-submit, exact retry, and duplicate-side-effect tests passed.');
