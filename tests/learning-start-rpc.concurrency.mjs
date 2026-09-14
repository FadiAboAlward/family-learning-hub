import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const versionId = '92000000-0000-4000-8000-000000000003';
const slug = 'qa-learning-start-concurrency';

async function psql(sql) {
  const { stdout } = await execFileAsync('docker', [
    'exec', containerName, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql,
  ], { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

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

await psql(fs.readFileSync('tests/learning-start-rpc.concurrency-setup.sql', 'utf8'));
const learnerId = await psql(`select id::text from public.learners where workspace_id='${workspaceId}'::uuid and slug='test'`);
const lockExpression = `hashtextextended('${workspaceId}:${learnerId}:${versionId}:learning',0)`;

// Acquire the production serialization lock first, then expose a second lock as
// a deterministic signal that both RPC calls can be started behind it.
const blocker = spawnPsql(`begin; select pg_advisory_xact_lock(${lockExpression}); select pg_advisory_xact_lock(91300401); select pg_sleep(8); commit;`);
const lockDeadline = Date.now() + 3000;
let blockerReady = false;
while (!blockerReady && Date.now() < lockDeadline) {
  blockerReady = await psql("select count(*)::text from pg_locks where locktype='advisory' and objid=91300401 and granted") === '1';
  if (blockerReady) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}
assert.equal(blockerReady, true, 'the concurrency blocker must acquire the Learning start lock first');

const startSql = `set role service_role; select public.flh_learning_start('${workspaceId}'::uuid,'${learnerId}'::uuid,'${slug}')::text; reset role;`;
const first = spawnPsql(startSql);
const second = spawnPsql(startSql);
const [, firstOutput, secondOutput] = await Promise.all([blocker.done, first.done, second.done]);

const firstResult = JSON.parse(firstOutput);
const secondResult = JSON.parse(secondOutput);
assert.equal(firstResult.attempt_id, secondResult.attempt_id);
assert.deepEqual([firstResult.resumed, secondResult.resumed].sort(), [false, true]);
assert.equal(firstResult.queue.length, 2);
assert.equal(secondResult.queue.length, 2);

// A lost HTTP response followed by a retry returns the committed attempt and
// queue rather than repeating side effects.
const retryResult = JSON.parse(await psql(startSql));
assert.equal(retryResult.resumed, true);
assert.equal(retryResult.attempt_id, firstResult.attempt_id);
assert.deepEqual(retryResult.queue, firstResult.queue);

await psql(fs.readFileSync('tests/learning-start-rpc.concurrency-verify.sql', 'utf8'));
console.log('Learning start simultaneous-call, retry, attempt, and queue idempotency tests passed.');
