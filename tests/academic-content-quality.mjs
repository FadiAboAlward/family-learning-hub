import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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


const fractionOperatorSpacingLeak = read('valid-package.json');
fractionOperatorSpacingLeak.questions[0].options[0].content = '1/2';
fractionOperatorSpacingLeak.questions[0].hints[0].content = 'فكّر في الكسر ١ ÷ ٢ قبل أن تختار.';
const fractionOperatorSpacingLeakResult = validateAcademicPackage(fractionOperatorSpacingLeak);
assert.ok(fractionOperatorSpacingLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK'), 'Equivalent fraction answer with spaced Unicode operator must be detected as a leak');

const decimalAnalogy = read('valid-package.json');
decimalAnalogy.questions[0].options[0].content = '3';
decimalAnalogy.questions[0].hints[0].content = 'مثال مشابه: العدد 3.5 يحتاج قاعدة مشابهة، لكن طبّق قاعدة السؤال نفسه.';
const decimalAnalogyResult = validateAcademicPackage(decimalAnalogy);
assert.ok(!decimalAnalogyResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Integer answer must not match the integer part of an analogous decimal');

const bidiDuplicate = read('valid-package.json');
bidiDuplicate.questions[0].options[0].content = '-4';
bidiDuplicate.questions[0].options[1].content = '\u200e-4';
const bidiDuplicateResult = validateAcademicPackage(bidiDuplicate);
assert.ok(bidiDuplicateResult.errors.some(x => x.code === 'DUPLICATE_OPTION_CONTENT'), 'Invisible bidi controls must not make visually identical options distinct');

const symbolicOperatorSpacingLeak = read('valid-package.json');
symbolicOperatorSpacingLeak.questions[0].options[0].content = 'x + 3';
symbolicOperatorSpacingLeak.questions[0].hints[0].content = 'العلاقة النهائية هي x+3.';
const symbolicOperatorSpacingLeakResult = validateAcademicPackage(symbolicOperatorSpacingLeak);
assert.ok(symbolicOperatorSpacingLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK'), 'Symbolic binary plus/minus spacing must not bypass answer-leak detection');

const reasoningOperators = read('valid-package.json');
reasoningOperators.blueprint[0].reasoning_signature = 'x + y';
reasoningOperators.blueprint[1].reasoning_signature = 'x - y';
const reasoningOperatorsResult = validateAcademicPackage(reasoningOperators);
assert.ok(!reasoningOperatorsResult.errors.some(x => x.code === 'DUPLICATE_REASONING_SIGNATURE'), 'Reasoning signatures must preserve semantically meaningful math operators');

const reasoningNumericVariants = read('valid-package.json');
reasoningNumericVariants.blueprint[0].reasoning_signature = 'اجمع 2 + 3';
reasoningNumericVariants.blueprint[1].reasoning_signature = 'اجمع 8 + 9';
const reasoningNumericVariantsResult = validateAcademicPackage(reasoningNumericVariants);
assert.ok(reasoningNumericVariantsResult.errors.some(x => x.code === 'DUPLICATE_REASONING_SIGNATURE'), 'Reasoning signatures that differ only by numeric operands must be treated as duplicates');

const arabicDecimalAnalogy = read('valid-package.json');
arabicDecimalAnalogy.questions[0].options[0].content = '3';
arabicDecimalAnalogy.questions[0].hints[0].content = 'مثال مشابه يستخدم العدد ٣٫٥ دون أن يعطي جواب هذا السؤال.';
const arabicDecimalAnalogyResult = validateAcademicPackage(arabicDecimalAnalogy);
assert.ok(!arabicDecimalAnalogyResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Arabic decimal separator must keep 3 from matching inside ٣٫٥');

const multiWordAnswerLeak = read('valid-package.json');
multiWordAnswerLeak.questions[0].options[0].content = 'لا يمكن تحديدها';
multiWordAnswerLeak.questions[0].hints[0].content = 'بعد التحليل ستجد أن الإجابة لا يمكن تحديدها.';
const multiWordAnswerLeakResult = validateAcademicPackage(multiWordAnswerLeak);
assert.ok(multiWordAnswerLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK'), 'Multi-word correct answers must be detected when leaked with normal whitespace');

for (const negativeExample of ['-4', '- 4']) {
  const unsignedInsideNegative = read('valid-package.json');
  unsignedInsideNegative.questions[0].options[0].content = '4';
  unsignedInsideNegative.questions[0].hints[0].content = 'مثال مختلف يمكن أن تكون نتيجته ' + negativeExample + '، ثم طبّق القاعدة على السؤال.';
  const unsignedInsideNegativeResult = validateAcademicPackage(unsignedInsideNegative);
  assert.ok(!unsignedInsideNegativeResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Unsigned answer must not match inside negative value ' + negativeExample);
}

const distinctMathHints = read('valid-package.json');
distinctMathHints.questions[0].hints[0] = { level: 1, role: 'nudge', content: 'قارن x + y', decomposable: false };
distinctMathHints.questions[0].hints[1] = { level: 2, role: 'guide', content: 'قارن x - y', decomposable: false };
const distinctMathHintsResult = validateAcademicPackage(distinctMathHints);
assert.ok(!distinctMathHintsResult.errors.some(x => x.code === 'DUPLICATE_HINT_CONTENT' && x.path === 'questions[0].hints[1]'), 'Hint duplicate normalization must preserve meaningful math operators');

const decimalHintDistinction = read('valid-package.json');
decimalHintDistinction.questions[0].options[0].content = '99';
decimalHintDistinction.questions[0].hints[0] = { level: 1, role: 'nudge', content: 'قارن ٣٫٥', decomposable: false };
decimalHintDistinction.questions[0].hints[1] = { level: 2, role: 'guide', content: 'قارن ٣٥', decomposable: false };
const decimalHintDistinctionResult = validateAcademicPackage(decimalHintDistinction);
assert.ok(!decimalHintDistinctionResult.errors.some(x => x.code === 'DUPLICATE_HINT_CONTENT' && x.path === 'questions[0].hints[1]'), 'Hint normalization must preserve decimal points between digits');

const semanticReasoningNumbers = read('valid-package.json');
semanticReasoningNumbers.blueprint[0].reasoning_signature = 'simplify x^2';
semanticReasoningNumbers.blueprint[1].reasoning_signature = 'simplify x^3';
const semanticReasoningNumbersResult = validateAcademicPackage(semanticReasoningNumbers);
assert.ok(!semanticReasoningNumbersResult.errors.some(x => x.code === 'DUPLICATE_REASONING_SIGNATURE'), 'Semantic exponent numbers in reasoning signatures must remain distinct');

const dimensionReasoningNumbers = read('valid-package.json');
dimensionReasoningNumbers.blueprint[0].reasoning_signature = 'identify 2D shapes';
dimensionReasoningNumbers.blueprint[1].reasoning_signature = 'identify 3D shapes';
const dimensionReasoningNumbersResult = validateAcademicPackage(dimensionReasoningNumbers);
assert.ok(!dimensionReasoningNumbersResult.errors.some(x => x.code === 'DUPLICATE_REASONING_SIGNATURE'), 'Dimension numbers in reasoning signatures must remain distinct');

for (const subtractionHint of ['مثال مشابه: 5 - 4', 'مثال مشابه: x - 4']) {
  const negativeInsideSubtraction = read('valid-package.json');
  negativeInsideSubtraction.questions[0].options[0].content = '-4';
  negativeInsideSubtraction.questions[0].hints[0].content = subtractionHint;
  const negativeInsideSubtractionResult = validateAcademicPackage(negativeInsideSubtraction);
  assert.ok(!negativeInsideSubtractionResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Negative answer must not match a binary subtraction fragment: ' + subtractionHint);
}

const spacedUnitReasoning = read('valid-package.json');
spacedUnitReasoning.blueprint[0].reasoning_signature = 'اجمع 2 تفاحات';
spacedUnitReasoning.blueprint[1].reasoning_signature = 'اجمع 8 تفاحات';
const spacedUnitReasoningResult = validateAcademicPackage(spacedUnitReasoning);
assert.ok(spacedUnitReasoningResult.errors.some(x => x.code === 'DUPLICATE_REASONING_SIGNATURE'), 'Concrete operands before spaced unit names must still normalize as the same reasoning form');

const signedProseLeak = read('valid-package.json');
signedProseLeak.questions[0].options[0].content = '-4';
signedProseLeak.questions[0].hints[0].content = 'Choose -4';
const signedProseLeakResult = validateAcademicPackage(signedProseLeak);
assert.ok(signedProseLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Signed answers revealed after ordinary prose words must be detected');

const missingDecompositionClassification = read('valid-package.json');
delete missingDecompositionClassification.questions[0].decomposable;
for (const hint of missingDecompositionClassification.questions[0].hints) {
  delete hint.decomposable;
  delete hint.steps;
  delete hint.expanded_steps;
}
const missingDecompositionClassificationResult = validateAcademicPackage(missingDecompositionClassification);
assert.ok(missingDecompositionClassificationResult.errors.some(x => x.code === 'DECOMPOSABLE_CLASSIFICATION_REQUIRED'), 'Learning questions must explicitly classify decomposition before step checks can be skipped');

const nonDecomposableLearning = read('valid-package.json');
nonDecomposableLearning.questions[0].decomposable = false;
for (const hint of nonDecomposableLearning.questions[0].hints) {
  hint.decomposable = false;
  delete hint.steps;
  delete hint.expanded_steps;
}
const nonDecomposableLearningResult = validateAcademicPackage(nonDecomposableLearning);
assert.ok(!nonDecomposableLearningResult.errors.some(x => ['DECOMPOSABLE_CLASSIFICATION_REQUIRED','HINT_DECOMPOSABLE_MISMATCH','HINT_THREE_STEP_SHAPE','HINT_SIX_STEP_SHAPE'].includes(x.code)), 'Explicitly non-decomposable Learning questions may omit 3/6-step arrays');

const commaDecimalHintDistinction = read('valid-package.json');
commaDecimalHintDistinction.questions[0].options[0].content = '99';
commaDecimalHintDistinction.questions[0].hints[0] = { level: 1, role: 'nudge', content: 'قارن 3,5', decomposable: false };
commaDecimalHintDistinction.questions[0].hints[1] = { level: 2, role: 'guide', content: 'قارن 35', decomposable: false };
const commaDecimalHintDistinctionResult = validateAcademicPackage(commaDecimalHintDistinction);
assert.ok(!commaDecimalHintDistinctionResult.errors.some(x => x.code === 'DUPLICATE_HINT_CONTENT' && x.path === 'questions[0].hints[1]'), 'Hint normalization must preserve comma decimal separators between digits');

const additionFragmentHint = read('valid-package.json');
additionFragmentHint.questions[0].options[0].content = '4';
additionFragmentHint.questions[0].hints[0].content = 'مثال مشابه: 5 + 4';
const additionFragmentHintResult = validateAcademicPackage(additionFragmentHint);
assert.ok(!additionFragmentHintResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Unsigned answer must not match the right operand of an analogous addition example');

for (const [answer, hint] of [
  ['x ≤ 3', 'العلاقة النهائية هي x <= 3.'],
  ['x ≥ 3', 'العلاقة النهائية هي x >= 3.']
]) {
  const inequalityLeak = read('valid-package.json');
  inequalityLeak.questions[0].options[0].content = answer;
  inequalityLeak.questions[0].hints[0].content = hint;
  const inequalityLeakResult = validateAcademicPackage(inequalityLeak);
  assert.ok(inequalityLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Equivalent Unicode/ASCII inequality answer leak must be detected for ' + answer);
}

const invisibleRequiredText = read('valid-package.json');
invisibleRequiredText.academic_context.next_target = '\u200e';
invisibleRequiredText.questions[0].prompt = '\u200e';
invisibleRequiredText.questions[0].options[0].content = '\u200e';
invisibleRequiredText.questions[0].hints[0].content = '\u200e';
invisibleRequiredText.questions[0].hints[0].steps[0] = '\u200e';
invisibleRequiredText.questions[0].hints[0].expanded_steps[0] = '\u200e';
const invisibleRequiredTextResult = validateAcademicPackage(invisibleRequiredText);
const invisibleCodes = new Set(invisibleRequiredTextResult.errors.map(x => x.code));
for (const code of ['ACADEMIC_CONTEXT_FIELD_REQUIRED', 'PROMPT_REQUIRED', 'OPTION_CONTENT_REQUIRED', 'HINT_CONTENT_REQUIRED', 'HINT_THREE_STEP_SHAPE', 'HINT_SIX_STEP_SHAPE']) {
  assert.ok(invisibleCodes.has(code), 'Invisible format-only required text must be rejected with ' + code);
}

const turkishCaseLeak = read('valid-package.json');
turkishCaseLeak.questions[0].options[0].content = 'İstanbul';
turkishCaseLeak.questions[0].hints[0].content = 'Cevap istanbul.';
const turkishCaseLeakResult = validateAcademicPackage(turkishCaseLeak);
assert.ok(turkishCaseLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Turkish dotted-I case variants must not bypass answer-leak detection');

const unaryPlusLeak = read('valid-package.json');
unaryPlusLeak.questions[0].options[0].content = '4';
unaryPlusLeak.questions[0].hints[0].content = 'الإجابة +4';
const unaryPlusLeakResult = validateAcademicPackage(unaryPlusLeak);
assert.ok(unaryPlusLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Unary plus must not disguise an unsigned answer leak');

const unicodeExponentReasoning = read('valid-package.json');
unicodeExponentReasoning.blueprint[0].reasoning_signature = 'simplify x²';
unicodeExponentReasoning.blueprint[1].reasoning_signature = 'simplify x³';
const unicodeExponentReasoningResult = validateAcademicPackage(unicodeExponentReasoning);
assert.ok(!unicodeExponentReasoningResult.errors.some(x => x.code === 'DUPLICATE_REASONING_SIGNATURE'), 'Unicode superscript exponents must remain semantically distinct');

const unicodeExponentLeak = read('valid-package.json');
unicodeExponentLeak.questions[0].options[0].content = 'x²';
unicodeExponentLeak.questions[0].hints[0].content = 'الناتج النهائي هو x^2.';
const unicodeExponentLeakResult = validateAcademicPackage(unicodeExponentLeak);
assert.ok(unicodeExponentLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Unicode superscript and caret exponent forms must compare equivalently for leak detection');

const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flh academic qa '));
try {
  const cliScript = path.join(cliDir, 'academic content quality.mjs');
  const invalidPackage = path.join(cliDir, 'invalid package.json');
  fs.copyFileSync(new URL('../scripts/academic-content-quality.mjs', import.meta.url), cliScript);
  fs.writeFileSync(invalidPackage, '{}\n', 'utf8');
  const cliRun = spawnSync(process.execPath, [cliScript, invalidPackage], { encoding: 'utf8' });
  assert.equal(cliRun.status, 1, 'CLI must execute validation and fail invalid packages even when its path contains spaces');
  assert.match(cliRun.stdout, /PACKAGE_OBJECT_REQUIRED|ACADEMIC_CONTEXT_REQUIRED|BLUEPRINT_REQUIRED/u, 'CLI must emit validation output from a spaced path');
} finally {
  fs.rmSync(cliDir, { recursive: true, force: true });
}

const unicodeFractionLeak = read('valid-package.json');
unicodeFractionLeak.questions[0].options[0].content = '1/2';
unicodeFractionLeak.questions[0].hints[0].content = 'الناتج النهائي هو ½.';
const unicodeFractionLeakResult = validateAcademicPackage(unicodeFractionLeak);
assert.ok(unicodeFractionLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Unicode vulgar fractions must canonicalize to slash fractions for leak detection');

const unicodeFractionDuplicate = read('valid-package.json');
unicodeFractionDuplicate.questions[0].options[0].content = '1/2';
unicodeFractionDuplicate.questions[0].options[1].content = '½';
const unicodeFractionDuplicateResult = validateAcademicPackage(unicodeFractionDuplicate);
assert.ok(unicodeFractionDuplicateResult.errors.some(x => x.code === 'DUPLICATE_OPTION_CONTENT'), 'Unicode vulgar fractions and slash fractions must be duplicate options');

for (const [answer, hint] of [['4', 'مثال مشابه: 3^4'], ['3', 'مثال مشابه: 3 ^ 4']]) {
  const exponentFragment = read('valid-package.json');
  exponentFragment.questions[0].options[0].content = answer;
  exponentFragment.questions[0].hints[0].content = hint;
  const exponentFragmentResult = validateAcademicPackage(exponentFragment);
  assert.ok(!exponentFragmentResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Answer must not match an operand inside an analogous exponent expression: ' + hint);
}

const exponentSpacingLeak = read('valid-package.json');
exponentSpacingLeak.questions[0].options[0].content = 'x^2';
exponentSpacingLeak.questions[0].hints[0].content = 'الناتج النهائي هو x ^ 2.';
const exponentSpacingLeakResult = validateAcademicPackage(exponentSpacingLeak);
assert.ok(exponentSpacingLeakResult.errors.some(x => x.code === 'HINT_ANSWER_LEAK' && x.path === 'questions[0].hints[0]'), 'Exponent operator spacing must not bypass answer-leak detection');

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

console.log('Academic content quality tests passed: source/evidence grounding, blueprint/difficulty, distractors, four-level hint depth, 3/6-step shape, short/symbolic and Arabic-script digit answer-leak prevention, Unicode-digit and math-operator-aware near-duplicate checks, operator-spacing option uniqueness, bidi-control option normalization, fraction including Unicode slash forms, symbolic, equivalent inequality, Turkish case-fold, and Unicode-exponent leak detection, decimal-boundary-safe leak detection including Arabic decimals, operator-preserving reasoning signatures and hint comparisons, semantic-number-safe reasoning normalization including spaced-unit operands, multi-word answer leak detection, signed-number-safe numeric boundaries including binary-subtraction/prose distinction, unary-plus handling, and analogous addition/exponent fragments, period/comma-decimal-preserving hint comparison, invisible-text rejection, single-question difficulty justification, explicit Learning decomposition classification with canonical 3/6 hint-shape boundaries, robust CLI entrypoint execution from spaced paths, and duplicate reasoning guards are enforced.');
