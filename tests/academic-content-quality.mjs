import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateAcademicPackage } from '../scripts/academic-content-quality.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL('./fixtures/academic-content-quality/' + name, import.meta.url), 'utf8'));

const valid = validateAcademicPackage(read('valid-package.json'));
assert.equal(valid.ok, true, JSON.stringify(valid, null, 2));
assert.deepEqual(valid.errors, []);

const invalid = validateAcademicPackage(read('invalid-package.json'));
assert.equal(invalid.ok, false);
const codes = new Set(invalid.errors.map(x => x.code));
for (const code of [
  'EVIDENCE_REFS_REQUIRED',
  'EXTERNAL_RUNTIME_DEPENDENCY_FORBIDDEN',
  'INVALID_DELIVERY_SURFACE',
  'DUPLICATE_REASONING_SIGNATURE',
  'SINGLE_DIFFICULTY_UNJUSTIFIED',
  'DUPLICATE_OPTION_CONTENT',
  'DISTRACTOR_RATIONALE_REQUIRED',
  'FOUR_HINT_LEVELS_REQUIRED',
  'HINT_ANSWER_LEAK',
  'HINT_THREE_STEP_SHAPE',
  'HINT_SIX_STEP_SHAPE',
  'NON_LEARNING_HINTS_FORBIDDEN'
]) {
  assert.ok(codes.has(code), 'missing expected validation error ' + code);
}

const leak = read('valid-package.json');
leak.questions[0].hints[3].content = 'اختر -4.';
const leakResult = validateAcademicPackage(leak);
assert.ok(leakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK'), 'near-solution hint must not reveal final answer');

const examLeak = read('valid-package.json');
examLeak.questions[1].hints = [{ level: 1, role: 'nudge', content: 'hint' }];
const examResult = validateAcademicPackage(examLeak);
assert.ok(examResult.errors.some(x => x.code === 'NON_LEARNING_HINTS_FORBIDDEN'), 'Exam must not carry in-progress hints');

console.log('Academic content quality tests passed: source/evidence grounding, blueprint/difficulty, distractors, four-level hint depth, 3/6-step shape, answer-leak prevention, canonical Learning/Exam boundaries, and duplicate reasoning guards are enforced.');
