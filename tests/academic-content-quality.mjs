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


const arabicDigitPromptDuplicate = read('valid-package.json');
arabicDigitPromptDuplicate.questions[0].prompt = 'احسب ٢ + ٣';
arabicDigitPromptDuplicate.questions[1].prompt = 'احسب ٨ + ٩';
const arabicDigitPromptDuplicateResult = validateAcademicPackage(arabicDigitPromptDuplicate);
assert.ok(arabicDigitPromptDuplicateResult.errors.some(x => x.code === 'NORMALIZED_PROMPT_DUPLICATE'), 'Arabic-Indic numeric variants must be caught as near-duplicates');

const persianDigitPromptDuplicate = read('valid-package.json');
persianDigitPromptDuplicate.questions[0].prompt = 'احسب ۲ + ۳';
persianDigitPromptDuplicate.questions[1].prompt = 'احسب ۸ + ۹';
const persianDigitPromptDuplicateResult = validateAcademicPackage(persianDigitPromptDuplicate);
assert.ok(persianDigitPromptDuplicateResult.errors.some(x => x.code === 'NORMALIZED_PROMPT_DUPLICATE'), 'Eastern Arabic/Persian numeric variants must be caught as near-duplicates');

for (const digitLeak of ['−٤', '−۴']) {
  const arabicDigitLeak = read('valid-package.json');
  arabicDigitLeak.questions[0].options[0].content = '-4';
  arabicDigitLeak.questions[0].hints[0].content = 'الموضع النهائي هو ' + digitLeak + '.';
  const arabicDigitLeakResult = validateAcademicPackage(arabicDigitLeak);
  assert.ok(arabicDigitLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK'), 'Arabic-script digit answer leak must be detected for ' + digitLeak);
}

const spacedOperatorDuplicate = read('valid-package.json');
spacedOperatorDuplicate.questions[0].options[0].content = '2 - 6';
spacedOperatorDuplicate.questions[0].options[1].content = '2-6';
const spacedOperatorDuplicateResult = validateAcademicPackage(spacedOperatorDuplicate);
assert.ok(spacedOperatorDuplicateResult.errors.some(x => x.code === 'DUPLICATE_OPTION_CONTENT'), 'Equivalent math options that differ only by operator spacing must be rejected');

const malformedExamHints = read('valid-package.json');
malformedExamHints.questions[1].hints = { content: 'الإجابة 3' };
const malformedExamHintsResult = validateAcademicPackage(malformedExamHints);
assert.ok(malformedExamHintsResult.errors.some(x => x.code === 'NON_LEARNING_HINTS_FORBIDDEN'), 'Exam must reject malformed non-array hint payloads');

const singleQuestionPackage = read('valid-package.json');
singleQuestionPackage.blueprint = [singleQuestionPackage.blueprint[0]];
singleQuestionPackage.questions = [singleQuestionPackage.questions[0]];
delete singleQuestionPackage.academic_context.single_difficulty_justification;
const singleQuestionPackageResult = validateAcademicPackage(singleQuestionPackage);
assert.ok(singleQuestionPackageResult.errors.some(x => x.code === 'SINGLE_DIFFICULTY_UNJUSTIFIED'), 'Single-question packages still need a single-difficulty academic justification');

console.log('Academic content quality tests passed: source/evidence grounding, blueprint/difficulty, distractors, four-level hint depth, 3/6-step shape, short/symbolic and Arabic-script digit answer-leak prevention, Unicode-digit and math-operator-aware near-duplicate checks, operator-spacing option uniqueness, single-question difficulty justification, canonical Learning/Exam hint-shape boundaries, and duplicate reasoning guards are enforced.');
