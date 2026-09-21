import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath='supabase/migrations/20260921160000_register_tr_g7_tam_sayilar_shared_paper_quiz.sql';
const sql=fs.readFileSync(migrationPath,'utf8');

const match=sql.match(/v_package jsonb := \$json\$\s*([\s\S]*?)\s*\$json\$::jsonb;/);
assert.ok(match,'canonical 20-question package not found');
const questions=JSON.parse(match[1]);

assert.equal(questions.length,20,'shared package must contain exactly 20 questions');
assert.deepEqual(questions.map(q=>q.n),Array.from({length:20},(_,i)=>i+1),'question numbers must be 1..20');
for(const q of questions){
  assert.equal(q.options.length,4,`question ${q.n} must have exactly 4 options`);
  assert.ok(Number.isInteger(q.correct)&&q.correct>=1&&q.correct<=4,`question ${q.n} has invalid answer position`);
}
assert.deepEqual(
  questions.map(q=>q.correct),
  [2,2,2,2,3,3,3,1,3,3,2,3,2,3,1,1,2,3,3,3],
  'answer positions must stay identical to the approved PDF package'
);

for(const fragment of [
  "v_model_code text := 'MOH-TRMATH7-K1-TAM-PAPER-20260921-B'",
  "v_quiz_slug text := 'tr-g7-tam-sayilar-20260921-b'",
  "'TR-G7-2026-2027'",
  "'TR-MATH-G7-2026-2027-K1'",
  "'tema-1-sayilar-ve-nicelikler-1'",
  "'paper_question_count',20",
  "'shared_delivery_invariant','learning_exam_paper_same_question_set'",
  "false,'core','tr'",
  "v_workspace,v_mohammad,v_program,'active',false",
  'flh_paper_exam_runtime_package',
  'paper_canonical_package',
  'paper_runtime_content_hash',
  'extensions.digest'
]) assert.ok(sql.includes(fragment),`missing shared-paper invariant: ${fragment}`);

assert.ok(!sql.includes("'exam_pool'"),'this quiz must not define a separate Exam-only question pool');
assert.equal((sql.match(/'question_count',20/g)||[]).length,2,'Learning and Exam must both explicitly use 20 questions');

assert.equal(questions[0].prompt,'Bir ölçekte 0 sayısı “başlangıç/referans noktası” olarak kullanılıyor. Aşağıdakilerden hangisi buna en uygun örnektir?');
assert.equal(questions[0].options[1],'Bir yarışın başlangıç çizgisi');
assert.equal(questions[0].correct,2);
assert.equal(questions[19].prompt,'Zemin kat 0. Sığınak -1. katta, Asya sığınağın 3 kat üstünde, Demir Asya’nın 2 kat üstünde oturuyor. Demir hangi kattadır?');
assert.equal(questions[19].options[2],'+4');
assert.equal(questions[19].correct,3);

console.log('TR G7 Tam Sayılar shared Learning/Exam/Paper invariants passed');
