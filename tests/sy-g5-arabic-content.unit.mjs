import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = 'content/sy-g5-arabic-brochure-baseline-20261012-v1.json';
const pkg = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
assert.notEqual(pkg.status, 'QUALITY_BLOCKED', 'Academic package is QUALITY_BLOCKED: unresolved Learning/Exam reasoning mirrors; rebuild and review the entire Exam bank before publication');
const validator = spawnSync(process.execPath, [path.join(root, 'scripts/academic-content-quality.mjs'), path.join(root, rel)], {
  cwd: root, encoding: 'utf8', timeout: 60_000
});
assert.equal(validator.status, 0, 'Exact academic candidate validator failed:\n' + validator.stdout + '\n' + validator.stderr);
assert.equal(pkg.academic_context.student_ref, 'Syrian G5 learner — anonymized curriculum baseline');
assert.equal(pkg.academic_context.book_code, 'AR-LUGATI-G5-T1');
assert.equal(pkg.academic_context.coverage_plan.decision, 'BASELINE');
const learning = pkg.questions.filter(q => q.delivery_surface === 'learning');
const exam = pkg.questions.filter(q => q.delivery_surface === 'exam');
assert.equal(learning.length, 20);
assert.equal(exam.length, 20);
assert.equal(new Set(pkg.questions.map(q => q.question_code)).size, 40);
assert.equal(new Set(pkg.questions.map(q => q.prompt)).size, 40);
assert.equal(learning.flatMap(q => q.hints ?? []).length, 80);
const concepts = new Map();
for (const q of pkg.questions) {
  concepts.set(q.concept_code, (concepts.get(q.concept_code) ?? 0) + 1);
  assert.equal(q.options.filter(o => o.is_correct === true).length, 1, q.question_code);
  if (q.delivery_surface === 'exam') assert.equal(q.hints?.length ?? 0, 0, q.question_code);
  else for (const h of q.hints) {
    assert.equal(h.content.split('\n').filter(Boolean).length, 3, q.question_code);
    assert.ok(h.content.split(/\s+/u).filter(Boolean).length >= 30, q.question_code);
  }
}
assert.equal(concepts.get('arabic-g5-u1-brochure'), 30);
assert.equal(concepts.get('arabic-g5-u1-sentence-types'), 6);
assert.equal(concepts.get('arabic-g5-u1-initial-hamza'), 4);

// Ensure the public repository package has no copied personal academic scores or identities.
const serialized = JSON.stringify(pkg);
assert.doesNotMatch(serialized, /Aya|آية|AYA-|88\.46|93\.75|20\/20|19\/20/u);
assert.doesNotMatch(readFileSync(path.join(root, 'supabase/migrations/20261012093000_register_sy_g5_arabic_brochure_baseline.sql'), 'utf8'), /Aya|آية|AYA-|\$aya_|\baya_/iu, 'Public publication artifact must be learner-neutral');
assert.equal(pkg.questions.length, 40);
// Answer key placement preflight: prevent a learner from inferring later correct
// options from a cycle such as 1-2-3-4-1-2-3-4, without changing item semantics.
for (const [surface, items] of [['Learning', learning], ['Exam', exam]]) {
  const keys = items.map(q => q.options.find(o => o.is_correct)?.position);
  assert.equal(keys.length, 20, surface + ' answer count');
  assert.deepEqual([1,2,3,4].map(k => keys.filter(v => v === k).length),
    [5,5,5,5], surface + ' key locations should be balanced');
  for (let period = 1; period <= 4; period++) {
    for (let start = 0; start <= keys.length - 12; start++) {
      assert.equal(keys.slice(start, start + 12).every((v, i) =>
        v === keys[start + (i % period)]), false,
        surface + ' answer key must not contain a predictable 12-item cycle');
    }
  }
}
for (const q of pkg.questions) {
  const incorrect = q.options.filter(o => !o.is_correct);
  assert.equal(incorrect.length, 3);
  assert.equal(new Set(incorrect.map(o => o.distractor_rationale)).size, 3);
  for (const o of incorrect) assert.ok(o.distractor_rationale.length > 15, q.question_code);
}

// Regression: all Exam E16 alternatives must begin with a verb so first-word
// classification alone cannot solve the meaning-preserving transformation.
const e16 = exam.find(q => q.question_code.endsWith('-E16'));
assert.ok(e16 && e16.options.every(o => /^(?:يحافظُ|يُهملُ)/u.test(o.content)));
assert.equal(e16.options.filter(o => o.is_correct).length, 1);

// Publication integrity: the embedded forward-only SQL package must be the exact
// validator-approved question/option/answer/hint content, not an independently
// edited answer key that could silently misgrade students.
const migration = readFileSync(path.join(root, 'supabase/migrations/20261012093000_register_sy_g5_arabic_brochure_baseline.sql'), 'utf8');
const embedded = migration.match(/v_items jsonb := \$assessment_pkg\$([\s\S]*?)\$assessment_pkg\$::jsonb;/u);
assert.ok(embedded, 'Migration must embed a complete auditable JSON question payload');
const rows = JSON.parse(embedded[1]);
assert.equal(rows.length, 40);
for (const [i, q] of pkg.questions.entries()) {
  const row = rows[i];
  assert.equal(row.authored_code, q.question_code, 'authoring code mismatch at ' + i);
  assert.equal(row.pos, i + 1);
  assert.equal(row.role, i < 20 ? 'core' : 'exam_pool');
  assert.equal(row.concept, q.concept_code);
  assert.equal(row.prompt, q.prompt);
  assert.equal(row.explain, q.explanation);
  assert.equal(row.source_ref, q.source_ref);
  assert.deepEqual(row.opts, q.options.map(o => o.content));
  assert.equal(row.correct, q.options.find(o => o.is_correct).position);
  assert.deepEqual(row.hints, q.hints ?? []);
  assert.deepEqual(row.distractor_rationales, q.options.map(o => o.distractor_rationale ?? null));
}
// Explicit authoring-phase cognitive independence audit (FLH-FEAT-2026-029).
// This tests completeness/correspondence, NOT truth of semantic distinctness:
// reviewers must compare the actual prompts/options/hints on each pair.
const audit = pkg.assessment_independence_audit;
assert.equal(audit?.spec_id, 'FLH-FEAT-2026-029');
assert.equal(audit.spec_version, '1.0');
assert.equal(audit.cross_mode_pairs_reviewed, learning.length * exam.length);
assert.equal(audit.within_exam_pairs_reviewed, exam.length * (exam.length - 1) / 2);
assert.equal(audit.rows?.length, exam.length);
const byExam = new Map(audit.rows.map(row => [row.exam_code, row]));
assert.equal(byExam.size, exam.length);
const learningCodes = new Set(learning.map(q => q.question_code));
for (const q of exam) {
  const row = byExam.get(q.question_code);
  assert.ok(row, 'Missing cognitive review: ' + q.question_code);
  assert.ok(learningCodes.has(row.closest_learning_code), 'Bad comparison reference: ' + q.question_code);
  for (const field of ['input_evidence','cognitive_action','deciding_criterion','independence_rationale']) {
    assert.ok(typeof row[field] === 'string' && row[field].trim().length >= 15,
      'Incomplete reasoning independence evidence ' + q.question_code + ':' + field);
  }
}
assert.equal(new Set(audit.rows.map(r => r.cognitive_action)).size, exam.length,
  'Duplicate Exam cognitive-action labels: inspect actual semantic overlap');
assert.equal(new Set(audit.rows.map(r => r.deciding_criterion)).size, exam.length,
  'Duplicate Exam deciding-criterion labels: inspect actual semantic overlap');
// Regression of the three previously repeated paths must remain source-grounded.
for (const suffix of ['E06','E17','E18']) {
  const q = exam.find(q => q.question_code.endsWith(suffix));
  const bp = pkg.blueprint.find(b => b.question_code === q?.question_code);
  assert.ok(q && bp && bp.reasoning_signature.length >= 30, suffix);
  assert.ok(bp.reasoning_signature !== audit.rows.find(r => r.exam_code === q.question_code)?.independence_rationale, suffix);
}

// Run all mechanical, answer-pattern and exact SQL checks before the release gate.
// PENDING_REVIEW must still fail this branch, but should not hide earlier QA evidence.
console.log('Academic authoring mechanical QA, answer positions and exact migration fidelity: PASS');
assert.equal(pkg.publication_gates.academic_semantic_review, 'PASS',
  'Independent semantic review is required before merge and publication');
console.log('Syrian G5 Arabic public-private separation, canonical CLI, 40/80 content and embedded publication integrity: PASS');
