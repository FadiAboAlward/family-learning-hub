import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateAcademicPackage } from '../scripts/academic-content-quality.mjs';

const file='tests/fixtures/assessment-publication/valid-package.json';
const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
const result=validateAcademicPackage(pkg);
if (result.errors.length) console.error('Candidate-specific academic errors:',JSON.stringify(result.errors,null,2));
if (result.warnings.length) console.warn('Candidate-specific review warnings:',JSON.stringify(result.warnings,null,2));
assert.equal(result.ok,true,'The exact academic candidate must pass the deterministic authoring validator before it can proceed.');
assert.equal(pkg.questions.length,40);
assert.equal(pkg.questions.filter(q=>q.delivery_surface==='learning').length,20);
assert.equal(pkg.questions.filter(q=>q.delivery_surface==='exam').length,20);
assert.equal(pkg.academic_context.student_ref,'testing-learner');
assert.equal(pkg.academic_context.learner_state_ref,'synthetic:flh-027-testing-baseline');
assert.ok(!/private-student-state|private-GDrive|mohammad|77\.5/i.test(JSON.stringify(pkg)),
  'Committed publication regression input must contain only synthetic learner-state metadata');

for (const question of pkg.questions) {
  const wrong = question.options.filter(option=>option.is_correct===false);
  assert.equal(wrong.length,3,`Expected three wrong choices for ${question.question_code}`);
  // Prevent a distractor rationale from being considered unique merely because it
  // echoes each distinct wrong answer after a copy-pasted explanatory template.
  const reviewedRationales=wrong.map(option=>{
    const raw=option.distractor_rationale;
    assert.equal(typeof raw,'string');
    assert.ok(raw.trim().length>35,`Missing substantive rationale: ${question.question_code}`);
    return raw.replaceAll(`«${option.content}»`,'').trim().toLocaleLowerCase('tr');
  });
  assert.equal(new Set(reviewedRationales).size,wrong.length,
    `Distinct plausible error explanations required for ${question.question_code}`);
}
console.log('FLH-027 synthetic Grade 7 rational fixture validator passed');
