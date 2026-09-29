import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SURFACES = new Set(['learning', 'exam', 'paper']);
const ORIGINS = new Set(['BOOK_DERIVED', 'GENERATED_SIMILAR']);
const HINT_ROLES = new Map([[1, 'nudge'], [2, 'guide'], [3, 'strong_guide'], [4, 'near_solution']]);
const REQUIRED_CONTEXT = ['student_ref', 'grade', 'curriculum', 'subject', 'book_code', 'confirmed_scope', 'learner_state_ref', 'next_target'];

const text = value => typeof value === 'string' ? value.replace(/\p{Cf}/gu, '').trim() : '';
const caseFold = value => value
  .toLocaleLowerCase('und')
  .normalize('NFD')
  .replace(/\u0307/gu, '')
  .normalize('NFC');
const SUPERSCRIPT_DIGITS = new Map([
  ['⁰', '0'], ['¹', '1'], ['²', '2'], ['³', '3'], ['⁴', '4'],
  ['⁵', '5'], ['⁶', '6'], ['⁷', '7'], ['⁸', '8'], ['⁹', '9']
]);
const preserveSuperscripts = value => value.replace(/[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu, seq => {
  const chars = [...seq];
  let sign = '';
  if (chars[0] === '⁺' || chars[0] === '⁻') sign = chars.shift() === '⁻' ? '-' : '+';
  return '^' + sign + chars.map(ch => SUPERSCRIPT_DIGITS.get(ch) || ch).join('');
});
const canonicalMath = value => preserveSuperscripts(text(value)).normalize('NFKC')
  .replace(/\p{Cf}/gu, '')
  .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x6f0))
  .replace(/[−–—]/g, '-')
  .replace(/[×✕·]/g, '*')
  .replace(/÷/g, '/')
  .replace(/≤/g, '<=')
  .replace(/≥/g, '>=')
  .replace(/٫/g, '.');
const normalizeHint = value => caseFold(canonicalMath(value))
  .replace(/(\d)\.(?=\d)/gu, '$1\uE000')
  .replace(/(\d),(?=\d)/gu, '$1\uE001')
  .replace(/\s+/g, '')
  .replace(/["'`“”‘’….,،؛;:!?؟_]+/gu, '')
  .replace(/\uE000/gu, '.')
  .replace(/\uE001/gu, ',');
const normalizeReasoning = value => caseFold(canonicalMath(value))
  .replace(/\p{N}+(?:[.,]\p{N}+)?/gu, (number, offset, source) => {
    const before = source.slice(0, offset);
    const prevNonSpace = before.match(/(\S)\s*$/u)?.[1] || '';
    const nextChar = source[offset + number.length] || '';
    const semanticNumber = prevNonSpace === '^' || /\p{L}/u.test(nextChar);
    return semanticNumber ? number : '#';
  })
  .replace(/\s+/g, '')
  .replace(/["'`“”‘’….,،؛;:!?؟_]+/gu, '');

const escapeRegexChar = ch => '\\^$.*+?()[]{}|'.includes(ch) ? '\\' + ch : ch;
const flexibleAnswerPattern = value => {
  const normalized = canonicalMath(value)
    .toLocaleLowerCase('en-US')
    .replace(/\s*([+\-*/=<>])\s*/g, '$1')
    .replace(/\s+/g, ' ');
  const chars = [...normalized];
  let pattern = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/u.test(ch)) {
      if (!pattern.endsWith('\\s+')) pattern += '\\s+';
      continue;
    }
    if (/[+\-*/=<>]/u.test(ch)) {
      const operator = escapeRegexChar(ch);
      if (i === 0) pattern += operator + '\\s*';
      else if (i === chars.length - 1) pattern += '\\s*' + operator;
      else pattern += '\\s*' + operator + '\\s*';
    } else {
      pattern += escapeRegexChar(ch);
    }
  }
  return pattern;
};
const normalizeOption = value => caseFold(canonicalMath(value)).replace(/\s*([+\-*/=<>])\s*/g, '$1').replace(/\s+/g, ' ');
const normalizePrompt = value => caseFold(canonicalMath(value)).replace(/\p{N}+(?:[.,]\p{N}+)?/gu, '#').replace(/[\s"'`“”‘’….,،؛;:!?؟]+/gu, '');

function answerLeak(hintText, answer) {
  const h = caseFold(canonicalMath(hintText));
  const a = caseFold(canonicalMath(answer));
  if (!h || !a) return false;

  const phrase = flexibleAnswerPattern(a);
  if (!phrase) return false;
  const re = new RegExp(phrase, 'giu');

  for (const match of h.matchAll(re)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = start > 0 ? h[start - 1] : '';
    const after = end < h.length ? h[end] : '';
    const prev = start > 1 ? h[start - 2] : '';
    const next = end + 1 < h.length ? h[end + 1] : '';

    const leftWordAdjacent = /[\p{L}\p{N}]/u.test(before);
    const rightWordAdjacent = /[\p{L}\p{N}]/u.test(after);
    const startsWithDigit = /^\d/u.test(a);
    const endsWithDigit = /\d$/u.test(a);
    const leftDecimalContinuation = startsWithDigit && /[.,]/u.test(before) && /\d/u.test(prev);
    const rightDecimalContinuation = endsWithDigit && /[.,]/u.test(after) && /\d/u.test(next);
    const unsignedNumber = /^\d+(?:[.,]\d+)?$/u.test(a);
    const leftNonSpaceMatch = h.slice(0, start).match(/(\S)\s*$/u);
    const leftNonSpace = leftNonSpaceMatch ? leftNonSpaceMatch[1] : '';
    const leftNegativeContinuation = unsignedNumber && leftNonSpace === '-';
    const rightNonSpaceMatch = h.slice(end).match(/^\s*(\S)/u);
    const rightNonSpace = rightNonSpaceMatch ? rightNonSpaceMatch[1] : '';
    const rightArithmeticContinuation = unsignedNumber && /[+\-*/]/u.test(rightNonSpace);
    const prefix = h.slice(0, start);
    const leftOperatorMatch = prefix.match(/([+*/])\s*$/u);
    const beforeLeftOperator = leftOperatorMatch ? prefix.slice(0, leftOperatorMatch.index) : '';
    const hasLeftOperandBeforeOperator = /(?:^|[\s(])(?:\p{L}|\d+(?:[.,]\d+)?|[)\]}])\s*$/u.test(beforeLeftOperator);
    const leftArithmeticContinuation = unsignedNumber && !!leftOperatorMatch && hasLeftOperandBeforeOperator;
    const signedNumber = /^[+\-]\d+(?:[.,]\d+)?$/u.test(a);
    const leftArithmeticOperand = /(?:^|[\s(])(?:\p{L}|\d+(?:[.,]\d+)?|[)\]}])\s*$/u.test(prefix);
    const signedBinaryContinuation = signedNumber && leftArithmeticOperand;

    if (!leftWordAdjacent && !rightWordAdjacent && !leftDecimalContinuation && !rightDecimalContinuation &&
        !leftNegativeContinuation && !leftArithmeticContinuation && !rightArithmeticContinuation &&
        !signedBinaryContinuation) return true;
  }
  return false;
}
function issue(list, code, path, message) {
  list.push({ code, path, message });
}

export function validateAcademicPackage(pkg) {
  const errors = [];
  const warnings = [];

  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return {
      ok: false,
      errors: [{ code: 'PACKAGE_OBJECT_REQUIRED', path: '$', message: 'Package must be a JSON object.' }],
      warnings
    };
  }

  const ctx = pkg.academic_context;
  if (!ctx || typeof ctx !== 'object') {
    issue(errors, 'ACADEMIC_CONTEXT_REQUIRED', 'academic_context', 'academic_context is required.');
  } else {
    for (const key of REQUIRED_CONTEXT) {
      if (!text(ctx[key])) issue(errors, 'ACADEMIC_CONTEXT_FIELD_REQUIRED', 'academic_context.' + key, key + ' is required.');
    }
    if (!Array.isArray(ctx.evidence_refs) || ctx.evidence_refs.length === 0 || ctx.evidence_refs.some(x => !text(x))) {
      issue(errors, 'EVIDENCE_REFS_REQUIRED', 'academic_context.evidence_refs', 'At least one evidence reference is required; baseline packages should record an explicit baseline/no-live-evidence reference.');
    }
  }

  if (!Array.isArray(pkg.runtime_external_dependencies)) {
    issue(errors, 'RUNTIME_EXTERNAL_DEPENDENCIES_REQUIRED', 'runtime_external_dependencies', 'Declare runtime_external_dependencies explicitly; normal packages should use an empty array.');
  } else if (pkg.runtime_external_dependencies.length) {
    issue(errors, 'EXTERNAL_RUNTIME_DEPENDENCY_FORBIDDEN', 'runtime_external_dependencies', 'Standard learner delivery must not depend on Brisk, Snorkl, or another external runtime.');
  }

  const blueprint = Array.isArray(pkg.blueprint) ? pkg.blueprint : [];
  const questions = Array.isArray(pkg.questions) ? pkg.questions : [];
  if (!blueprint.length) issue(errors, 'BLUEPRINT_REQUIRED', 'blueprint', 'At least one blueprint item is required.');
  if (!questions.length) issue(errors, 'QUESTIONS_REQUIRED', 'questions', 'At least one question is required.');

  const blueByCode = new Map();
  const reasoning = new Map();

  for (const [i, b] of blueprint.entries()) {
    const p = 'blueprint[' + i + ']';
    const code = text(b && b.question_code);

    if (!code) issue(errors, 'QUESTION_CODE_REQUIRED', p + '.question_code', 'question_code is required.');
    else if (blueByCode.has(code)) issue(errors, 'DUPLICATE_BLUEPRINT_CODE', p + '.question_code', 'Duplicate blueprint question_code ' + code + '.');
    else blueByCode.set(code, b);

    if (!SURFACES.has(b && b.delivery_surface)) issue(errors, 'INVALID_DELIVERY_SURFACE', p + '.delivery_surface', 'delivery_surface must be learning, exam, or paper; practice is not a canonical mode.');
    if (!text(b && b.concept_code)) issue(errors, 'CONCEPT_REQUIRED', p + '.concept_code', 'concept_code is required.');
    if (!Number.isInteger(b && b.difficulty_level) || b.difficulty_level < 1 || b.difficulty_level > 5) issue(errors, 'DIFFICULTY_OUT_OF_RANGE', p + '.difficulty_level', 'difficulty_level must be an integer from 1 to 5.');
    if (!ORIGINS.has(b && b.origin)) issue(errors, 'INVALID_ORIGIN', p + '.origin', 'origin must be BOOK_DERIVED or GENERATED_SIMILAR.');
    if (!text(b && b.source_ref)) issue(errors, 'SOURCE_REF_REQUIRED', p + '.source_ref', 'source_ref is required.');

    const sig = normalizeReasoning(b && b.reasoning_signature);
    if (!sig) issue(errors, 'REASONING_SIGNATURE_REQUIRED', p + '.reasoning_signature', 'reasoning_signature is required for duplicate/near-duplicate protection.');
    else if (reasoning.has(sig)) issue(errors, 'DUPLICATE_REASONING_SIGNATURE', p + '.reasoning_signature', 'Reasoning form duplicates ' + reasoning.get(sig) + '.');
    else reasoning.set(sig, code || p);
  }

  const difficulties = new Set(blueprint.map(x => x && x.difficulty_level).filter(Number.isInteger));
  if (blueprint.length > 0 && difficulties.size === 1 && !text(ctx && ctx.single_difficulty_justification)) {
    issue(errors, 'SINGLE_DIFFICULTY_UNJUSTIFIED', 'academic_context.single_difficulty_justification', 'A one-level package needs an explicit academic justification.');
  }

  const seenQuestionCodes = new Set();
  const promptForms = new Map();

  for (const [i, q] of questions.entries()) {
    const p = 'questions[' + i + ']';
    const code = text(q && q.question_code);

    if (!code) issue(errors, 'QUESTION_CODE_REQUIRED', p + '.question_code', 'question_code is required.');
    else if (seenQuestionCodes.has(code)) issue(errors, 'DUPLICATE_QUESTION_CODE', p + '.question_code', 'Duplicate question_code ' + code + '.');
    else seenQuestionCodes.add(code);

    const b = blueByCode.get(code);
    if (!b) issue(errors, 'BLUEPRINT_MATCH_REQUIRED', p + '.question_code', 'No blueprint row exists for ' + (code || p) + '.');
    if (!SURFACES.has(q && q.delivery_surface)) issue(errors, 'INVALID_DELIVERY_SURFACE', p + '.delivery_surface', 'delivery_surface must be learning, exam, or paper.');
    if (!text(q && q.prompt)) issue(errors, 'PROMPT_REQUIRED', p + '.prompt', 'prompt is required.');
    if (!text(q && q.concept_code)) issue(errors, 'CONCEPT_REQUIRED', p + '.concept_code', 'concept_code is required.');
    if (!Number.isInteger(q && q.difficulty_level) || q.difficulty_level < 1 || q.difficulty_level > 5) issue(errors, 'DIFFICULTY_OUT_OF_RANGE', p + '.difficulty_level', 'difficulty_level must be an integer from 1 to 5.');
    if (!ORIGINS.has(q && q.origin)) issue(errors, 'INVALID_ORIGIN', p + '.origin', 'origin must be BOOK_DERIVED or GENERATED_SIMILAR.');
    if (!text(q && q.source_ref)) issue(errors, 'SOURCE_REF_REQUIRED', p + '.source_ref', 'source_ref is required.');

    if (b) {
      for (const key of ['delivery_surface', 'concept_code', 'difficulty_level', 'origin', 'source_ref']) {
        if (q[key] !== b[key]) issue(errors, 'BLUEPRINT_QUESTION_MISMATCH', p + '.' + key, key + ' does not match blueprint for ' + code + '.');
      }
    }

    const promptForm = normalizePrompt(q && q.prompt);
    if (promptForm) {
      if (promptForms.has(promptForm)) issue(errors, 'NORMALIZED_PROMPT_DUPLICATE', p + '.prompt', 'Prompt is a normalized near-duplicate of ' + promptForms.get(promptForm) + '.');
      else promptForms.set(promptForm, code || p);
    }

    if (!q || q.question_type !== 'single_choice') issue(errors, 'UNSUPPORTED_QUESTION_TYPE', p + '.question_type', 'This first academic QA gate currently validates single_choice packages only.');

    const opts = Array.isArray(q && q.options) ? q.options : [];
    if (opts.length < 4 || opts.length > 6) issue(errors, 'OPTION_COUNT_OUT_OF_RANGE', p + '.options', 'single_choice questions require 4 to 6 options.');

    const normalizedOptions = new Map();
    let correctCount = 0;
    let correctContent = '';

    for (const [j, o] of opts.entries()) {
      const op = p + '.options[' + j + ']';
      const content = text(o && o.content);
      const n = normalizeOption(content);

      if (!content) issue(errors, 'OPTION_CONTENT_REQUIRED', op + '.content', 'Option content is required.');
      else if (normalizedOptions.has(n)) issue(errors, 'DUPLICATE_OPTION_CONTENT', op + '.content', 'Duplicate option content with ' + normalizedOptions.get(n) + '.');
      else normalizedOptions.set(n, op);

      if (o && o.is_correct === true) {
        correctCount++;
        correctContent = content;
        if (text(o.misconception_code)) issue(errors, 'CORRECT_OPTION_MISCONCEPTION', op + '.misconception_code', 'Correct option cannot carry a misconception_code.');
      } else if (!text(o && o.distractor_rationale)) {
        issue(errors, 'DISTRACTOR_RATIONALE_REQUIRED', op + '.distractor_rationale', 'Every wrong option needs a concise rationale explaining why it is a plausible distractor.');
      }
    }

    if (correctCount !== 1) issue(errors, 'SINGLE_CORRECT_OPTION_REQUIRED', p + '.options', 'Expected exactly one correct option; found ' + correctCount + '.');

    if (correctCount === 1 && opts.length >= 4) {
      const correctLen = text(correctContent).length;
      const wrongLens = opts.filter(o => !o || o.is_correct !== true).map(o => text(o && o.content).length).filter(Boolean).sort((a, b) => a - b);
      const median = wrongLens.length ? wrongLens[Math.floor(wrongLens.length / 2)] : 0;
      if (median && correctLen > median * 2.5) issue(warnings, 'ANSWER_LENGTH_GIVEAWAY', p + '.options', 'Correct option is much longer than the typical distractor; review for answer-key leakage.');
    }

    const hints = Array.isArray(q && q.hints) ? q.hints : [];

    if (q && q.delivery_surface === 'learning') {
      if (typeof q.decomposable !== 'boolean') {
        issue(errors, 'DECOMPOSABLE_CLASSIFICATION_REQUIRED', p + '.decomposable', 'Learning questions must explicitly declare decomposable as true or false.');
      }
      if (hints.length !== 4) issue(errors, 'FOUR_HINT_LEVELS_REQUIRED', p + '.hints', 'Learning questions require exactly four progressive hint levels.');

      const hintTexts = [];
      for (const [j, h] of hints.entries()) {
        const hp = p + '.hints[' + j + ']';
        const expected = j + 1;

        if (!h || h.level !== expected) issue(errors, 'HINT_LEVEL_SEQUENCE', hp + '.level', 'Expected hint level ' + expected + '.');
        if (!h || h.role !== HINT_ROLES.get(expected)) issue(errors, 'HINT_ROLE_SEQUENCE', hp + '.role', 'Expected role ' + HINT_ROLES.get(expected) + ' at level ' + expected + '.');
        if (!text(h && h.content)) issue(errors, 'HINT_CONTENT_REQUIRED', hp + '.content', 'Hint content is required.');

        const combined = [
          h && h.content,
          ...(Array.isArray(h && h.steps) ? h.steps : []),
          ...(Array.isArray(h && h.expanded_steps) ? h.expanded_steps : [])
        ].map(text).filter(Boolean).join(' ');

        if (correctCount === 1 && answerLeak(combined, correctContent)) issue(errors, 'HINT_ANSWER_LEAK', hp, 'Hint exposes the correct option/final answer before finalization.');

        const hn = normalizeHint(combined);
        if (hn && hintTexts.includes(hn)) issue(errors, 'DUPLICATE_HINT_CONTENT', hp, 'Later hint duplicates an earlier hint instead of adding support.');
        hintTexts.push(hn);

        if (h && typeof h.decomposable === 'boolean' && typeof q.decomposable === 'boolean' && h.decomposable !== q.decomposable) {
          issue(errors, 'HINT_DECOMPOSABLE_MISMATCH', hp + '.decomposable', 'Hint decomposable flag must match the Learning question classification.');
        }
        if (q && q.decomposable === true) {
          if (!Array.isArray(h && h.steps) || h.steps.length !== 3 || h.steps.some(x => !text(x))) issue(errors, 'HINT_THREE_STEP_SHAPE', hp + '.steps', 'Decomposable Learning questions require exactly 3 non-empty steps in every hint.');
          if (!Array.isArray(h && h.expanded_steps) || h.expanded_steps.length !== 6 || h.expanded_steps.some(x => !text(x))) issue(errors, 'HINT_SIX_STEP_SHAPE', hp + '.expanded_steps', 'Decomposable Learning questions require exactly 6 non-empty expanded steps in every hint.');
        }
      }
    } else if (q && q.hints !== undefined && (!Array.isArray(q.hints) || hints.length)) {
      issue(errors, 'NON_LEARNING_HINTS_FORBIDDEN', p + '.hints', 'Exam and paper questions must not carry in-progress hint payloads, including malformed non-array hint data.');
    }
  }

  for (const code of blueByCode.keys()) {
    if (!seenQuestionCodes.has(code)) issue(errors, 'BLUEPRINT_ORPHAN', 'blueprint.' + code, 'Blueprint item ' + code + ' has no question.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/academic-content-quality.mjs <academic-package.json>');
    process.exit(2);
  }
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = validateAcademicPackage(pkg);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const sameEntrypoint = process.platform === 'win32'
  ? entryPath.toLocaleLowerCase('en-US') === modulePath.toLocaleLowerCase('en-US')
  : entryPath === modulePath;
if (entryPath && sameEntrypoint) main();
