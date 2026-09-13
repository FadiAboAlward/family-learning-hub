import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const containerName = 'supabase_db_family-learning-hub';
const attemptId = '50000000-0000-4000-8000-000000000001';
const workspaceId = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const questionId = '40000000-0000-4000-8000-000000000004';

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
  return { child, done, readStdout: () => stdout };
}

const setup = fs.readFileSync('tests/learning-answer-rpc.concurrency-setup.sql', 'utf8');
const verify = fs.readFileSync('tests/learning-answer-rpc.concurrency-verify.sql', 'utf8');
await psql(setup);

// Hold the attempt row long enough for both calls to queue behind the same lock.
// The advisory lock is only a deterministic test signal that the row lock has
// already been acquired; production serialization uses the RPC's row locks.
const blocker = spawnPsql(`begin; select pg_advisory_xact_lock(91300101); select id from public.quiz_attempts where id='${attemptId}'::uuid for update; select pg_sleep(8); commit;`);
const lockDeadline = Date.now() + 3000;
let blockerReady = false;
while (!blockerReady && Date.now() < lockDeadline) {
  blockerReady = await psql("select count(*)::text from pg_locks where locktype='advisory' and objid=91300101 and granted") === '1';
  if (blockerReady) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}
assert.equal(blockerReady, true, 'the concurrency blocker must acquire the attempt row first');

const learnerId = await psql(`select id::text from public.learners where workspace_id='${workspaceId}'::uuid and slug='test'`);
const answerSql = `select public.flh_learning_answer('${workspaceId}'::uuid,'${learnerId}'::uuid,'${attemptId}'::uuid,'${questionId}'::uuid,2)::text`;
const first = spawnPsql(answerSql);
const second = spawnPsql(answerSql);
const [blockerOutput, firstOutput, secondOutput] = await Promise.all([blocker.done, first.done, second.done]);

assert.match(blockerOutput, new RegExp(attemptId));
assert.equal(JSON.parse(firstOutput).attempt_no, 1);
assert.equal(JSON.parse(secondOutput).attempt_no, 1);
assert.deepEqual(JSON.parse(firstOutput), JSON.parse(secondOutput));
await psql(verify);

console.log('Learning answer concurrent double-submit and idempotent retry tests passed.');
