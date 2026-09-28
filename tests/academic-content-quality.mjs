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

const mixedOperators = read('valid-package.json');
mixedOperators.questions[0].prompt = 'احسب 2 + 3';
mixedOperators.questions[1].prompt = 'احسب 8 - 9';
const mixedOperatorsResult = validateAcademicPackage(mixedOperators);
assert.ok(!mixedOperatorsResult.errors.some(x => x.code === 'NORMALIZED_PROMPT_DUPLICATE'), 'Different math operators must remain distinct during near-duplicate normalization');

const cosmeticDuplicate = read('valid-package.json');
cosmeticDuplicate.questions[0].prompt = 'احسب 2 + 3';
cosmeticDuplicate.questions[1].prompt = 'احسب 8 + 9';
const cosmeticDuplicateResult = validateAcademicPackage(cosmeticDuplicate);
assert.ok(cosmeticDuplicateResult.errors.some(x => x.code === 'NORMALIZED_PROMPT_DUPLICATE'), 'Same-operation numeric variants must still be caught as near-duplicates');

for (const [answer, hint] of [
  ['نعم', 'فكّر جيدًا ثم اختر نعم.'],
  ['x < 3', 'العلاقة الصحيحة هي x < 3.'],
  ['−4', 'الموضع النهائي هو −4.']
]) {
  const shortLeak = read('valid-package.json');
  shortLeak.questions[0].options[0].content = answer;
  shortLeak.questions[0].hints[0].content = hint;
  const shortLeakResult = validateAcademicPackage(shortLeak);
  assert.ok(shortLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK'), 'Short/symbolic answer leak must be detected for ' + answer);
}

console.log('Academic content quality tests passed: source/evidence grounding, blueprint/difficulty, distractors, four-level hint depth, 3/6-step shape, short/symbolic answer-leak prevention, math-operator-aware near-duplicate checks, canonical Learning/Exam boundaries, and duplicate reasoning guards are enforced.');
