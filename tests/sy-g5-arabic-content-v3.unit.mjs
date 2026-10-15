import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = 'content/sy-g5-arabic-brochure-baseline-20261015-v3.json';
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
assert.equal(examBlueprint.get('Q-202610150290022')?.context_type,'direct',
  'E02 is a direct missing-title function question, not a contextual case');
assert.equal(new Set(pkg.questions.map(q => q.question_code)).size, 40);
assert.equal(new Set(pkg.questions.map(q => q.prompt)).size, 40);
assert.equal(learning.flatMap(q => q.hints ?? []).length, 80);
const concepts = new Map();
// The protected parent stage RPC rejects nonnumeric question codes.
for (const q of pkg.questions) assert.match(q.question_code, /^Q-20261015029[0-9]{4}$/, 'The globally unique FLH-029 code namespace prevents collisions with other same-day packages');
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

// Scoped academic fidelity regression for the single material v3 change.
const e10=exam.find(q=>q.question_code==='Q-202610150290030');
assert.ok(e10 && e10.prompt.includes('المجلات') && e10.prompt.includes('الصفحات'),
 'E10 must apply eligibility constraints, not repeat L03 choice of gathering information');
assert.equal(e10.options.filter(o=>o.is_correct).length,1);
assert.ok(e10.options.some(o=>o.content.includes('مبلل')),
 'E10 wrong option must violate a substantive acceptance criterion');
const e16=exam.find(q=>q.question_code==='Q-202610150290036');
assert.ok(e16 && e16.options.some(o=>o.content.includes('التي خلفَ المدرسةِ')),
 'E16 grammar scope and sentence completeness');
const e18=exam.find(q=>q.question_code==='Q-202610150290038');
assert.ok(e18 && e18.options.some(o=>o.content.includes('ينظّفُ الطلابُ')),
 'E18 verbal report vs invitation');
// FLH-027 uses the existing official assessment stage and release contracts.
// Do not publish through content SQL migrations or bypass learner binding.
assert.equal(pkg.academic_semantic_review?.spec_version,'1.1');
assert.equal(pkg.assessment_independence_audit?.spec_version,'1.1');
assert.equal(pkg.publication_gates.academic_semantic_review,'PASS');
assert.equal(pkg.questions.length,40);
console.log('Syrian G5 Arabic v3 authored content QA PASS: 40 unique items, 80 hints, answer keys and source fidelity; managed stage/release required');
