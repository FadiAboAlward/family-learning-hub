import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = fs.readdirSync('supabase/migrations')
  .find((file) => file.endsWith('_learning_start_rpc.sql'));
assert.ok(migrationPath, 'Learning start RPC migration must exist');

const migration = fs.readFileSync(`supabase/migrations/${migrationPath}`, 'utf8');
const learningApi = fs.readFileSync('supabase/functions/learning-api/index.ts', 'utf8');
const config = fs.readFileSync('supabase/config.toml', 'utf8');
const rollbackDoc = fs.readFileSync('docs/learning-start-rpc.md', 'utf8');

assert.match(
  migration,
  /create or replace function public\.flh_learning_start\(\s*p_workspace_id uuid,\s*p_learner_id uuid,\s*p_quiz_slug text\s*\)/i,
);
assert.match(migration, /security invoker\s+set search_path = ''/i);
assert.match(migration, /pg_advisory_xact_lock/i, 'simultaneous starts must serialize inside the transaction');
assert.match(migration, /revoke all on function public\.flh_learning_start\(uuid,uuid,text\) from public/i);
assert.match(migration, /revoke all on function public\.flh_learning_start\(uuid,uuid,text\) from anon, authenticated/i);
assert.match(migration, /grant execute on function public\.flh_learning_start\(uuid,uuid,text\) to service_role/i);
assert.doesNotMatch(migration, /quiz_question_answer_keys/, 'start payload must not read answer keys');

const startFunction = learningApi.match(/async function startQuiz[\s\S]*?\n}/)?.[0] ?? '';
assert.match(startFunction, /trace\.measure\("start\.rpc",\{dbOperations:1\}/);
assert.match(startFunction, /admin\.rpc\("flh_learning_start"/);
assert.equal(
  (startFunction.match(/\badmin\.rpc\s*\(/g) ?? []).length,
  1,
  'Learning start must make exactly one RPC call',
);
assert.doesNotMatch(startFunction, /admin\.from\(/, 'Learning start must make exactly one Edge database operation');
assert.match(
  startFunction,
  /console\.error\("Learning start RPC failed",\{code:error\.code,message:error\.message\}\)/,
  'RPC failures must retain only the database error code and message in server logs',
);
assert.match(startFunction, /throw new Error\("START_QUIZ_FAILED"\)/, 'unexpected RPC failures must stay opaque');
assert.match(
  startFunction,
  /if\(\(data as any\)\?\.error\)throw new Error\(String\(\(data as any\)\.error\)\)/,
  'Learning start must preserve server-authoritative domain errors',
);
assert.match(startFunction, /return data;/, 'Learning start must return the RPC response unchanged');
assert.match(
  migration,
  /raise warning 'flh_learning_start create failed at stage % \(SQLSTATE %, message %\)'/i,
  'caught create failures must retain server-side diagnostics',
);
assert.doesNotMatch(
  migration,
  /jsonb_build_object\('error',\s*'ATTEMPT_CREATE_FAILED',/i,
  'database diagnostics must not leak into the attempt error response',
);
assert.doesNotMatch(
  migration,
  /jsonb_build_object\('error',\s*'QUEUE_CREATE_FAILED',/i,
  'database diagnostics must not leak into the queue error response',
);

const answerFunction = learningApi.match(/async function answerQuestion[\s\S]*?\n}/)?.[0] ?? '';
assert.match(answerFunction, /trace\.measure\("answer\.rpc",\{dbOperations:1\}/);
assert.match(answerFunction, /admin\.rpc\("flh_learning_answer"/);
assert.equal((answerFunction.match(/\badmin\.rpc\s*\(/g) ?? []).length, 1);
assert.doesNotMatch(answerFunction, /admin\.from\(/, 'Learning answer must remain one Edge database operation');

for (const untouchedAction of ['saveDraft', 'requestHint', 'finishQuiz']) {
  assert.match(learningApi, new RegExp(`async function ${untouchedAction}\\b`));
}

const configuredFunctions = [...config.matchAll(/^\[functions\.([^\]]+)\]\s*\r?\nverify_jwt\s*=\s*false\s*$/gm)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(configuredFunctions, ['exam-v2-api', 'family-api', 'learning-api', 'student-library-api']);

assert.match(rollbackDoc, /Production baseline remains recorded as roughly 14 Edge-to-DB operations/i);
assert.match(rollbackDoc, /redeploy\s+the previous `learning-api` version/i);
assert.match(rollbackDoc, /Dropping the RPC or running a destructive emergency\s+rollback is not required/i);

console.log('Learning start RPC structure, telemetry, answer regression, auth config, and rollback guards passed.');
