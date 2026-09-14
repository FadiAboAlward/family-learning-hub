import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260914230608_learning_finish_rpc.sql', 'utf8');
const learningApi = fs.readFileSync('supabase/functions/learning-api/index.ts', 'utf8').replace(/\r\n/g, '\n');
const config = fs.readFileSync('supabase/config.toml', 'utf8');
const rollbackDoc = fs.readFileSync('docs/learning-finish-rpc.md', 'utf8');

assert.match(
  migration,
  /create or replace function public\.flh_learning_finish\(\s*p_workspace_id uuid,\s*p_learner_id uuid,\s*p_attempt_id uuid,\s*p_duration_seconds integer\s*\)/i,
);
assert.match(migration, /security invoker\s+set search_path = ''/i);
assert.match(migration, /revoke all on function public\.flh_learning_finish\(uuid,uuid,uuid,integer\) from public/i);
assert.match(migration, /revoke all on function public\.flh_learning_finish\(uuid,uuid,uuid,integer\) from anon, authenticated/i);
assert.match(migration, /grant execute on function public\.flh_learning_finish\(uuid,uuid,uuid,integer\) to service_role/i);
assert.match(migration, /for update/i, 'finish must serialize on owned rows');
assert.match(migration, /learning_finish_last_result/i, 'finish must persist its retry response');
assert.match(migration, /on conflict \(learner_id, badge_id\) do nothing/i, 'badge writes must be idempotent');

const finishStart = learningApi.indexOf('async function finishQuiz');
const finishEnd = learningApi.indexOf('\n}\n\nDeno.serve', finishStart) + 2;
const finishFunction = learningApi.slice(finishStart, finishEnd);
assert.ok(finishStart >= 0 && finishEnd > finishStart, 'finishQuiz must exist');
assert.match(finishFunction, /admin\.rpc\("flh_learning_finish"/);
assert.match(finishFunction, /"finish\.rpc",\{dbOperations:1\}/);
assert.doesNotMatch(finishFunction, /admin\.from\(/, 'finish Edge adapter must not make extra DB calls');
assert.doesNotMatch(learningApi, /async function awardCompletion/, 'award waterfall must move into the RPC');

const startStart = learningApi.indexOf('async function startQuiz');
const startEnd = learningApi.indexOf('\n}', startStart) + 2;
const startFunction = learningApi.slice(startStart, startEnd);
assert.match(startFunction, /admin\.rpc\("flh_learning_start"/);
assert.match(startFunction, /"start\.rpc",\{dbOperations:1\}/);

const answerStart = learningApi.indexOf('async function answerQuestion');
const answerEnd = learningApi.indexOf('\n}', answerStart) + 2;
const answerFunction = learningApi.slice(answerStart, answerEnd);
assert.match(answerFunction, /admin\.rpc\("flh_learning_answer"/);
assert.match(answerFunction, /"answer\.rpc",\{dbOperations:1\}/);

assert.match(config, /\[functions\.learning-api\]\s*verify_jwt\s*=\s*false/);
assert.match(rollbackDoc, /219e13bbd2cc7a04e3f844492f16d839f9a1d6b7/);
assert.match(rollbackDoc, /18 Edge-to-DB operations/i);
assert.match(rollbackDoc, /one `flh_learning_finish` RPC/i);
assert.match(rollbackDoc, /redeploy the previous `learning-api` source/i);
assert.match(rollbackDoc, /no\s+destructive database rollback is required/i);

console.log('Learning finish RPC structure, one-operation telemetry, start/answer regressions, auth config, and rollback guards passed.');
