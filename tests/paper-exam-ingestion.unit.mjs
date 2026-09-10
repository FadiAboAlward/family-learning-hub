import assert from 'node:assert/strict';
import fs from 'node:fs';

const gate=fs.readFileSync('supabase/migrations/20260910023500_paper_exam_ingestion_gate.sql','utf8');
const moh=fs.readFileSync('supabase/migrations/20260910023600_register_mohammad_integer_paper_exam.sql','utf8');

for(const required of [
  'flh_paper_exam_start',
  'p_quiz_version_id uuid',
  'paper_model_code',
  'paper_content_hash',
  'paper_runtime_content_hash',
  'paper_question_count',
  'paper_question_map',
  'paper_queue_validated',
  'paper_exact_mapping',
  'PAPER_MODEL_NOT_UNIQUE',
  'PAPER_ALREADY_INGESTED',
  'PAPER_QUEUE_VALIDATION_FAILED',
  'trg_guard_paper_attempt_answer',
  'trg_guard_paper_attempt_submit',
  'grant execute on function public.flh_paper_exam_start(uuid,uuid,uuid,text,text) to service_role'
]) assert.ok(gate.includes(required),`paper gate missing invariant: ${required}`);

assert.ok(!/flh_paper_exam_start\([\s\S]*p_quiz_slug/.test(gate),'paper start must never resolve by quiz slug/latest version');
assert.ok(gate.includes("v.question_id::text = new.question_id::text")===false,'guard should not contain an invalid alias');

const match=moh.match(/v_package jsonb := \$json\$\s*([\s\S]*?)\s*\$json\$::jsonb;/);
assert.ok(match,'Mohammad canonical seed package not found');
const questions=JSON.parse(match[1]);
assert.equal(questions.length,20,'Mohammad paper must contain exactly 20 questions');
assert.deepEqual(questions.map(q=>q.n),Array.from({length:20},(_,i)=>i+1),'printed numbering must be 1..20');
for(const q of questions){
  assert.equal(q.options.length,4,`question ${q.n} must have four printed options`);
  assert.ok(Number.isInteger(q.correct)&&q.correct>=1&&q.correct<=4,`question ${q.n} has invalid answer position`);
}

assert.equal(questions[4].prompt,'احسب: 6 - (-13)');
assert.equal(questions[4].options[2],'19');
assert.equal(questions[4].correct,3);
assert.equal(questions[10].prompt,'احسب: 13 + (-18)');
assert.equal(questions[10].options[2],'-5');
assert.equal(questions[10].correct,3);
assert.equal(questions[15].prompt,'احسب: 54 ÷ (-6)');
assert.equal(questions[15].options[1],'-9');
assert.equal(questions[16].prompt,'احسب: (-72) ÷ (-8)');
assert.equal(questions[16].options[1],'9');
assert.equal(questions[17].prompt,'احسب: 0 ÷ (-5)');
assert.equal(questions[17].options[0],'0');

for(const s of ['18 - (-7)','(-16) - 9','(-23) - (-8)','6 - (-13)','13 + (-18)','54 ÷ (-6)','(-72) ÷ (-8)','(-4) × 5 + 12']){
  assert.ok(moh.includes(s),`logical LTR math regression missing: ${s}`);
}
assert.ok(moh.includes("'Q-' || (20260910020 + v_n)::text"),'question codes must follow Aya codes without collision');
assert.ok(moh.includes('paper_canonical_package'),'approved canonical package must be stored on the immutable version');
assert.ok(moh.includes('extensions.digest'),'content hash must be SHA-256 over the canonical package');

console.log('Paper exam ingestion regression tests passed');
