import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = 'content/sy-g5-arabic-brochure-baseline-20261015-v2.json';
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
const examBlueprint=new Map(pkg.blueprint.map(b=>[b.question_code,b]));
assert.equal(exam.filter(q=>examBlueprint.get(q.question_code)?.context_type==='contextual').length,15,
  'This package requires exactly 15 meaningful contextual Exam items');
assert.equal(examBlueprint.get('SYAR-G5-20261015-E02')?.context_type,'direct',
  'E02 is a direct missing-title function question, not a contextual case');
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

// Ensure the public repository package contains no learner-specific data.
// Use generic privacy patterns, never put actual student identities or scores
// into public tests, even as forbidden-value regression examples.
const serialized = JSON.stringify(pkg);
assert.doesNotMatch(serialized, /"learner_id"\s*:|"recipient"\s*:|"email"\s*:/iu);
assert.doesNotMatch(serialized, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u);
assert.doesNotMatch(serialized, /https:\/\/docs\.google\.com\/document\/d\//u);
const migrationText = readFileSync(path.join(root, 'supabase/migrations/20261015133000_register_sy_g5_arabic_brochure_baseline_v2.sql'), 'utf8');
assert.doesNotMatch(migrationText, /\$[a-z_]*(?:learner|student|child)[a-z_]*\$/iu,
  'The committed publication package must use learner-neutral SQL delimiters');
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

// Source-grounded, item-specific regression without treating labels as semantics.
const e10=exam.find(q=>q.question_code.endsWith('-E10'));
assert.ok(e10 && e10.prompt.includes('جمع معلومات') && !e10.prompt.includes('تسرّباً'),
  'E10 must test p7 brochure authorship');
const e16=exam.find(q=>q.question_code.endsWith('-E16'));
assert.ok(e16 && e16.options.some(o=>o.content.includes('التي خلفَ المدرسةِ')),
  'E16 must include incomplete nominal-predicate evidence');
const e18=exam.find(q=>q.question_code.endsWith('-E18'));
assert.ok(e18 && e18.options.some(o=>o.content.includes('ينظّفُ الطلابُ')),
  'E18 must discriminate a grammatical verbal report from an invitation');
const l19=learning.find(q=>q.question_code.endsWith('-L19'));
assert.ok(l19 && l19.hints.length===4 && !l19.hints[0].content.includes('الهمزة الأولية هي'),
  'L19 first hint must not disclose the full solution rule');
// Publication integrity: the embedded forward-only SQL package must be the exact
// validator-approved question/option/answer/hint content, not an independently
// edited answer key that could silently misgrade students.
const migration = readFileSync(path.join(root, 'supabase/migrations/20261015133000_register_sy_g5_arabic_brochure_baseline_v2.sql'), 'utf8');
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
  assert.equal(row.difficulty, q.difficulty_level, 'Difficulty parity ' + q.question_code);
  assert.equal(row.origin, q.origin, 'Origin parity ' + q.question_code);
  assert.equal(row.learning_set, i < 20 ? (i < 10 ? 1 : 2) : null, 'Learning set parity ' + q.question_code);
  assert.equal(row.decomposable, q.decomposable ?? false, 'Decomposable parity ' + q.question_code);
  assert.equal(q.question_type, 'single_choice', 'Question type parity ' + q.question_code);
  assert.equal(row.db_code, 'Q-20261015' + String(i + 1).padStart(4, '0'), 'DB code parity ' + q.question_code);
  const sourcePage = /\bPDF_PAGE=(\d+)\b/u.exec(q.source_ref);
  assert.ok(sourcePage, 'Source reference missing PDF_PAGE at ' + q.question_code);
  assert.equal(row.page, Number(sourcePage[1]),
    'Published SQL source page does not match the exact candidate at ' + q.question_code);
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
// Distinct labels cannot prove cognitive independence. The audited comparison
// matrix and an independent semantic review control this release gate.
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
assert.equal(pkg.academic_semantic_review?.independent_semantic_review, 'PASS',
 'Exact independent review must pass before publication');
assert.equal(pkg.publication_gates.academic_semantic_review, 'PASS',
  'Independent semantic review is required before merge and publication');
console.log('Syrian G5 Arabic public-private separation, canonical CLI, 40/80 content and embedded publication integrity: PASS');
