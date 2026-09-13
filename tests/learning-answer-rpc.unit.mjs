import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260913145055_learning_answer_rpc.sql', 'utf8');
const learningApi = fs.readFileSync('supabase/functions/learning-api/index.ts', 'utf8');
const config = fs.readFileSync('supabase/config.toml', 'utf8');
const rollbackDoc = fs.readFileSync('docs/learning-answer-rpc.md', 'utf8');

assert.match(
  migration,
  /create or replace function public\.flh_learning_answer\(\s*p_workspace_id uuid,\s*p_learner_id uuid,\s*p_attempt_id uuid,\s*p_question_id uuid,\s*p_option_position integer\s*\)/i,
);
assert.match(migration, /security invoker\s+set search_path = ''/i);
assert.match(migration, /revoke all on function public\.flh_learning_answer\(uuid,uuid,uuid,uuid,integer\) from public/i);
assert.match(migration, /revoke all on function public\.flh_learning_answer\(uuid,uuid,uuid,uuid,integer\) from anon, authenticated/i);
assert.match(migration, /grant execute on function public\.flh_learning_answer\(uuid,uuid,uuid,uuid,integer\) to service_role/i);

const answerFunction = learningApi.match(/async function answerQuestion[\s\S]*?\n}/)?.[0] ?? '';
assert.match(answerFunction, /trace\.measure\("answer\.rpc",\{dbOperations:1\}/);
assert.match(answerFunction, /admin\.rpc\("flh_learning_answer"/);
assert.doesNotMatch(answerFunction, /admin\.from\(/, 'Learning answer must make exactly one Edge database operation');

const configuredFunctions = [...config.matchAll(/^\[functions\.([^\]]+)\]\s*\r?\nverify_jwt\s*=\s*false\s*$/gm)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(configuredFunctions, ['exam-v2-api', 'family-api', 'learning-api', 'student-library-api']);

assert.match(rollbackDoc, /redeploy the previous `learning-api` source/i);
assert.match(rollbackDoc, /Dropping the RPC is not required for rollback/i);

console.log('Learning answer RPC structure, telemetry, auth config, and rollback guards passed.');
