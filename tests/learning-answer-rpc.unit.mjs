import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260930185500_learning_misconception_evidence.sql', 'utf8');
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
assert.match(migration, /question_option_misconceptions/i);
assert.match(migration, /detected_misconception_id/i);
assert.match(migration, /'misconception_detected'/i);
assert.match(migration, /'mapped_distractor'/i);
assert.match(migration, /v_misconception_concept_id = v_queue\.concept_id/i);
assert.match(migration, /qom\.workspace_id = p_workspace_id/i);
assert.match(migration, /v_misconception_mapping_count = 1/i);
assert.match(migration, /public\.explanation_sets/i);
assert.match(migration, /es\.misconception_id = v_misconception_id/i);
assert.match(migration, /explanation_set_id/i);
assert.match(migration, /public\.explanation_blocks/i);
assert.match(migration, /v_misconception_feedback_text/i);
assert.match(migration, /feedback_text/i);
assert.match(migration, /error_classification/i);
assert.match(migration, /pedagogy\.misconception_policy/i);
assert.match(migration, /detect_from_multiple_choice_distractors/i);
assert.match(migration, /prefer_misconception_specific_explanation/i);
assert.match(migration, /misconception_explanation/i);
assert.match(migration, /count\(\*\) over\(\)::integer as mapping_count/i);
assert.match(migration, /v_misconception_concept_id = v_queue\.concept_id/i);
assert.match(migration, /public\.quiz_assignments/i);
assert.match(migration, /public\.learner_program_enrollments/i);
assert.match(migration, /public\.learning_programs/i);
assert.match(migration, /v_effective_grade/i);
assert.match(migration, /jsonb_set\(\s*v_hint,\s*'\{content\}'/i);

const answerFunction = learningApi.match(/async function answerQuestion[\s\S]*?\n}/)?.[0] ?? '';
assert.match(answerFunction, /trace\.measure\("answer\.rpc",\{dbOperations:1\}/);
assert.match(answerFunction, /admin\.rpc\("flh_learning_answer"/);
assert.equal(
  (answerFunction.match(/\badmin\.rpc\s*\(/g) ?? []).length,
  1,
  'Learning answer must make exactly one RPC call',
);
assert.doesNotMatch(answerFunction, /admin\.from\(/, 'Learning answer must make exactly one Edge database operation');
assert.match(
  answerFunction,
  /console\.error\("Learning answer RPC failed",\{code:error\.code,message:error\.message\}\)/,
  'RPC failures must retain only the database error code and message in server logs',
);
assert.match(answerFunction, /throw new Error\("ANSWER_SAVE_FAILED"\)/, 'RPC failures must stay opaque to callers');

const configuredFunctions = [...config.matchAll(/^\[functions\.([^\]]+)\]\s*\r?\nverify_jwt\s*=\s*false\s*$/gm)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(configuredFunctions, ['exam-v2-api', 'family-api', 'learning-api', 'student-library-api']);

assert.match(rollbackDoc, /new corrective migration that restores the previous/i);
assert.match(rollbackDoc, /do not rewrite or delete either historical\s+migration/i);

console.log('Learning answer RPC structure, telemetry, auth config, and rollback guards passed.');
