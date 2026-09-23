import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260922134500_paper_unanswered_answers.sql','utf8');

for(const fragment of [
  'FLH-FEAT-2026-003',
  `raise exception 'UNANSWERED_REQUIRES_PAPER_ATTEMPT'`,
  `raise exception 'PAPER_UNANSWERED_REQUIRES_DECLARED_SUBMIT'`,
  `raise exception 'PAPER_UNANSWERED_INTERACTION_INVALID'`,
  `if new.response ? 'unanswered' then`,
  `create or replace function public.flh_paper_exam_submit(`,
  `p_unanswered_sequence_nos integer[]`,
  `'PAPER_UNANSWERED_SET_MISMATCH'`,
  `set_config('flh.paper_unanswered_attempt_id',p_attempt_id::text,true)`,
  `'{"unanswered":true}'::jsonb`,
  `if v_queue_count = 0 or v_answer_count <> v_queue_count then`,
  `return jsonb_build_object('error','EXAM_NOT_COMPLETE')`,
  `when aa.response = '{"unanswered":true}'::jsonb then false`,
  `when aa.response = '{"unanswered":true}'::jsonb then 0`,
  `when aa.response = '{"unanswered":true}'::jsonb then 'not_mastered'`,
  `for update;`,
  `and status = 'in_progress';`,
  `revoke all on function public.flh_exam_submit(uuid,uuid,uuid) from public;`,
  `grant execute on function public.flh_exam_submit(uuid,uuid,uuid) to service_role;`
]){
  assert.ok(migration.includes(fragment),`paper unanswered migration missing invariant: ${fragment}`);
}

const genericSubmitStart=migration.indexOf('create or replace function public.flh_exam_submit(');
const paperSubmitStart=migration.indexOf('create or replace function public.flh_paper_exam_submit(');
assert.ok(genericSubmitStart >= 0 && paperSubmitStart > genericSubmitStart,'paper submit wrapper must exist after generic submit');

const genericSubmit=migration.slice(genericSubmitStart,paperSubmitStart);
assert.ok(
  !genericSubmit.includes(`insert into public.quiz_attempt_answers (`),
  'generic exam submit must not infer or materialize unanswered paper rows'
);

const paperSubmit=migration.slice(paperSubmitStart);
assert.ok(
  paperSubmit.includes('v_declared is distinct from v_missing') &&
  paperSubmit.includes(`qq.sequence_no=any(v_declared)`),
  'paper submit must require an exact declared-blank/missing-set match before materialization'
);

assert.ok(
  migration.includes(`if new.response ? 'unanswered' then`) &&
  migration.includes(`raise exception 'PAPER_ANSWER_INVALID'`),
  'contradictory unanswered payloads must fail closed'
);

console.log('Paper unanswered ingestion regression tests passed');
