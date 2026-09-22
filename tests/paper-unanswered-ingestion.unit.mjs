import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260922134500_paper_unanswered_answers.sql','utf8');

for(const fragment of [
  'FLH-FEAT-2026-003',
  `if new.response = '{"unanswered":true}'::jsonb then`,
  `raise exception 'PAPER_UNANSWERED_INTERACTION_INVALID'`,
  `if new.response ? 'unanswered' then`,
  `v_is_paper := nullif(v_attempt.metadata->>'paper_model_code','') is not null`,
  `insert into public.quiz_attempt_answers`,
  `'{"unanswered":true}'::jsonb`,
  `if v_queue_count = 0 or v_answer_count <> v_queue_count then`,
  `return jsonb_build_object('error','EXAM_NOT_COMPLETE')`,
  `when aa.response = '{"unanswered":true}'::jsonb then false`,
  `when aa.response = '{"unanswered":true}'::jsonb then 0`,
  `when aa.response = '{"unanswered":true}'::jsonb then 'not_mastered'`
]){
  assert.ok(migration.includes(fragment),`paper unanswered migration missing invariant: ${fragment}`);
}

const autoMaterialization=migration.match(/if v_is_paper then[\s\S]*?end if;/);
assert.ok(autoMaterialization,'paper-only unanswered materialization block not found');
assert.ok(
  autoMaterialization[0].includes(`and not exists (`),
  'paper unanswered rows must only materialize for missing queue answers'
);

assert.ok(
  migration.indexOf(`if v_queue_count = 0 or v_answer_count <> v_queue_count then`) >
  migration.indexOf(`if v_is_paper then`),
  'interactive incomplete-exam guard must remain outside and after the paper-only block'
);

assert.ok(
  migration.includes(`if new.response ? 'unanswered' then`) &&
  migration.includes(`raise exception 'PAPER_ANSWER_INVALID'`),
  'contradictory unanswered payloads must fail closed'
);

console.log('Paper unanswered ingestion regression tests passed');
