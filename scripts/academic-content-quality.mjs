import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SURFACES = new Set(['learning', 'exam', 'paper']);
const ORIGINS = new Set(['BOOK_DERIVED', 'GENERATED_SIMILAR']);
const PROMPT_LANGUAGES = new Set(['ar', 'tr', 'en']);
const HTML_ENTITY_RE = /&(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/iu;
const RAW_HTML_TAG_RE = /<\/?[a-z][a-z0-9-]*(?:\s+(?:(?:disabled|selected|checked|readonly|required|multiple|autofocus|hidden|open)|[a-z_:][-a-z0-9_:.]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)))*\s*\/?>/iu;
const SOURCE_DEPENDENCY_PATTERNS = [
  /\bkitap(?:ta|taki|tan)\s+(?:verilen|yer\s+alan|bak(?:arak)?|incele(?:yerek)?|yararlan(?:arak)?)\b/iu,
  /\bkitaba\s+(?:g[oö]re|bak(?:arak)?|ba[sş]vur(?:arak)?)\b/iu,
  /\bkitab[ıiuü]\s+(?:a[cç](?:ıp|arak)?|incele(?:yerek)?|kullan(?:arak)?)\b/iu,
  /\bsayfaya\s+(?:bak(?:arak)?|git(?:erek)?|ba[sş]vur(?:arak)?|d[oö]n(?:erek)?)\b/iu,
  /\bsayfa(?:da|daki|dan)\s+(?:verilen|yer\s+alan|bak(?:arak)?|incele(?:yerek)?|yararlan(?:arak)?)\b/iu,
  /\bkayna(?:kta|ktaki)\s+(?:verilen|yer\s+alan|bak(?:arak)?|incele(?:yerek)?|yararlan(?:arak)?)\b/iu,
  /\bkayna[gğ]a\s+g[oö]re\b/iu,
  /\b(?:according\s+to|refer\s+to|consult)\s+(?:the\s+)?(?:book|textbook|page|source|reference)\b/iu,
  /\b(?:open|look\s+at|see|check)\s+(?:the\s+)?(?:book|textbook|page|source|reference)\b/iu,
  /\buse\s+(?:the\s+)?(?:book|textbook|page|source|reference)\b(?!\s+(?:below|above|following)\b)/iu,
  /\buse\s+(?:the\s+)?(?:diagram|figure|table|chart|image)\s+(?:on|from)\s+(?:the\s+)?(?:previous|next|following|preceding)\s+page\b/iu,
  /\bon\s+(?:the\s+)?(?:previous|next|following|preceding)\s+page\b/iu,
  /(?:راجع|افتح)\s+(?:الكتاب|الصفحة|المصدر|المرجع)/u,
  /(?:انظر|ارجع)\s+إلى\s+(?:الكتاب|الصفحة|المصدر|المرجع)/u,
  /بالرجوع\s+إلى\s+(?:الكتاب|الصفحة|المصدر|المرجع)/u,
  /وفق(?:ًا|ا)\s+(?:للكتاب|للمصدر|للمرجع)/u
];
const SOFT_SOURCE_REFERENCE_PATTERNS = [
  /(?:في|من)\s+مفردات(?:\s+(?:درس|نص|الدرس|النص))?/u,
  /في\s+(?:النص|الدرس|القصيدة)(?![\p{L}\p{N}_])(?!(?:\s+(?:الآتي|التالي|أدناه)\s*[:：]?\s*(?:«[^»]{3,}»|"[^"]{3,}"|“[^”]{3,}”)))(?!(?:\s*[:：]\s*(?:«[^»]{3,}»|"[^"]{3,}"|“[^”]{3,}”)))/u,
  /(?:كما\s+)?ورد(?:ت)?\s+في\s+(?:وصف|مفردات|درس|نص|قصيدة|مطالعة|الدرس|النص|القصيدة)/u,
  /كما\s+في\s+(?:درس|نص|قصيدة|مطالعة|الدرس|النص|القصيدة)/u,
  /(?:الفكرة|المعنى|الموضوع|القيمة)[^؟.!]{0,90}\s+ل(?:قصيدة|نص|درس|مطالعة)\s+«[^»]+»/u,
  /في\s+أسئلة\s+الاستيعاب\s+ل(?:نص|درس|قصيدة|مطالعة)\s+«[^»]+»/u,
  /استحضر(?:ي)?\s+[^.؟!]{0,80}\s+في\s+(?:النص|الدرس|القصيدة)/u,
  /(?:بحسب|وفقاً|وفقًا|وفقا)\s+(?:الدرس|النص|القصيدة)/u,
  /\b(?:derste|metinde|şiirde)\s+(?:geçen|kullanılan|yer\s+alan|verilen)\b/iu,
  /\b(?:dersin|metnin|şiirin)\s+(?:sözlüğünde|kelimelerinde|bağlamında)\b/iu,
  /\b(?:derse|metne|şiire)\s+göre\b/iu,
  /\b(?:as\s+(?:used|stated|mentioned|defined)\s+in|from)\s+(?:the\s+)?(?:lesson|text|poem)\b/iu,
  /\baccording\s+to\s+(?:the\s+)?(?:lesson|text|poem)\b/iu,
  /\bin\s+(?:the\s+)?(?:lesson|text|poem)\b(?!\s+(?:below|above|following))/iu
];
const HINT_ROLES = new Map([[1, 'nudge'], [2, 'guide'], [3, 'strong_guide'], [4, 'near_solution']]);
const REQUIRED_CONTEXT = ['student_ref', 'grade', 'curriculum', 'subject', 'book_code', 'confirmed_scope', 'learner_state_ref', 'next_target'];
const CONCEPT_STATES = new Set(['MASTERED', 'DEVELOPING', 'NEEDS_REINFORCEMENT', 'UNKNOWN_BASELINE']);
const DIFFICULTY_ROLES = new Set(['support', 'target', 'transfer']);
const COVERAGE_DECISIONS = new Set(['ADVANCE', 'REMEDIATE', 'BASELINE', 'REVIEW_DUE']);
const DEFAULT_TARGET_DIFFICULTY = new Map([
  ['UNKNOWN_BASELINE', 2],
  ['NEEDS_REINFORCEMENT', 2],
  ['DEVELOPING', 3],
  ['MASTERED', 4]
]);

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
  .replace(/\b\d{1,3}(?:,\d{3})+\b/gu, grouped => grouped.replace(/,/g, ''))
  .replace(/(\d)٬(?=\d)/gu, '$1')
  .replace(/[−–—]/g, '-')
  .replace(/[×✕·]/g, '*')
  .replace(/[÷⁄∕]/g, '/')
  .replace(/≤/g, '<=')
  .replace(/≥/g, '>=')
  .replace(/٫/g, '.')
  .replace(/٪/g, '%');
const normalizeHint = value => caseFold(canonicalMath(value))
  .replace(/(\d)\.(?=\d)/gu, '$1\uE000')
  .replace(/(\d),(?=\d)/gu, '$1\uE001')
  .replace(/\s+/g, '')
  .replace(/["'`“”‘’….,،؛;:!?؟_]+/gu, '')
  .replace(/\uE000/gu, '.')
  .replace(/\uE001/gu, ',');
const abstractOperandNumbers = value => value.replace(/\p{N}+(?:[.,]\p{N}+)?/gu, (number, offset, source) => {
  const before = source.slice(0, offset);
  const suffix = source.slice(offset + number.length);
  const semanticDimension = /^[dD](?!\p{L})/u.test(suffix);
  const exponentContext = /\^\s*[+\-]?\s*$/u.test(before);
  const semanticNumber = exponentContext || semanticDimension;
  return semanticNumber ? number : '#';
});
const normalizeReasoning = value => abstractOperandNumbers(caseFold(canonicalMath(value)))
  .replace(/\s+/g, '')
  .replace(/["'`“”‘’….,،؛;:!?؟_]+/gu, '');

const escapeRegexChar = ch => '\\^$.*+?()[]{}|'.includes(ch) ? '\\' + ch : ch;
const flexibleAnswerPattern = value => {
  const normalized = canonicalMath(value)
    .toLocaleLowerCase('en-US')
    .replace(/\s*([+\-*/^=<>%])\s*/g, '$1')
    .replace(/\s+/g, ' ');
  const chars = [...normalized];
  let pattern = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/u.test(ch)) {
      if (!pattern.endsWith('\\s+')) pattern += '\\s+';
      continue;
    }
    if (/[+\-*/^=<>%]/u.test(ch)) {
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
const normalizeOption = value => caseFold(canonicalMath(value)).replace(/\s*([+\-*/^=<>%])\s*/g, '$1').replace(/\s+/g, ' ');
const normalizePrompt = value => abstractOperandNumbers(caseFold(canonicalMath(value))).replace(/[\s"'`“”‘’….,،؛;:!?؟]+/gu, '');

const normalizeRationale = value => caseFold(text(value)).replace(/\s+/gu, ' ').replace(/["'“”‘’….,،؛;:!?؟]+/gu, '').trim();

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
    const rightArithmeticContinuation = unsignedNumber && /[+\-*/^%]/u.test(rightNonSpace);
    const prefix = h.slice(0, start);
    const leftOperatorMatch = prefix.match(/([+*/^])\s*$/u);
    const beforeLeftOperator = leftOperatorMatch ? prefix.slice(0, leftOperatorMatch.index) : '';
    const hasLeftOperandBeforeOperator = /(?:^|[\s(])(?:\p{L}|\d+(?:[.,]\d+)?|[)\]}])\s*$/u.test(beforeLeftOperator);
    const leftArithmeticContinuation = unsignedNumber && !!leftOperatorMatch && hasLeftOperandBeforeOperator;
    const signedNumber = /^[+\-]\d+(?:[.,]\d+)?$/u.test(a);
    const leftArithmeticOperand = /(?:^|[\s(])(?:\p{L}|\d+(?:[.,]\d+)?|[)\]}])\s*$/u.test(prefix);
    const signedAfterBinaryOperator = /(?:^|[\s(])(?:\p{L}|\d+(?:[.,]\d+)?|[)\]}])\s*[+\-*/^]\s*$/u.test(prefix);
    const signedInsideOperatorParen = /(?:^|[\s(])(?:\p{L}|\d+(?:[.,]\d+)?|[)\]}])\s*[+\-*/^]\s*\(\s*$/u.test(prefix);
    const signedBinaryContinuation = signedNumber && (leftArithmeticOperand || signedAfterBinaryOperator || signedInsideOperatorParen);

    if (!leftWordAdjacent && !rightWordAdjacent && !leftDecimalContinuation && !rightDecimalContinuation &&
        !leftNegativeContinuation && !leftArithmeticContinuation && !rightArithmeticContinuation &&
        !signedBinaryContinuation) return true;
  }
  return false;
}
function issue(list, code, path, message) {
  list.push({ code, path, message });
}

function learnerVisibleFields(q, basePath) {
  const fields = [];
  for (const key of ['prompt', 'explanation', 'correct_explanation', 'final_incorrect_explanation', 'feedback']) {
    if (typeof q?.[key] === 'string') fields.push({ path: basePath + '.' + key, value: q[key] });
  }
  for (const [i, option] of (Array.isArray(q?.options) ? q.options : []).entries()) {
    if (typeof option?.content === 'string') fields.push({ path: basePath + '.options[' + i + '].content', value: option.content });
  }
  for (const [i, hint] of (Array.isArray(q?.hints) ? q.hints : []).entries()) {
    if (typeof hint?.content === 'string') fields.push({ path: basePath + '.hints[' + i + '].content', value: hint.content });
    for (const key of ['steps', 'expanded_steps']) {
      for (const [j, value] of (Array.isArray(hint?.[key]) ? hint[key] : []).entries()) {
        if (typeof value === 'string') fields.push({ path: basePath + '.hints[' + i + '].' + key + '[' + j + ']', value });
      }
    }
  }
  return fields;
}

function sourceDependency(value) {
  const normalized = caseFold(text(value));
  return normalized && SOURCE_DEPENDENCY_PATTERNS.some(re => re.test(normalized));
}

function softSourceReference(value) {
  const normalized = caseFold(text(value));
  return normalized && SOFT_SOURCE_REFERENCE_PATTERNS.some(re => re.test(normalized));
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

  const conceptTargetsByCode = new Map();
  let coveragePrimaryTargets = [];
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

    const conceptTargets = Array.isArray(ctx.concept_targets) ? ctx.concept_targets : [];
    if (!conceptTargets.length) {
      issue(errors, 'CONCEPT_TARGETS_REQUIRED', 'academic_context.concept_targets', 'New targeted packages require at least one concept target grounded in learner evidence.');
    }
    for (const [i, target] of conceptTargets.entries()) {
      const p = 'academic_context.concept_targets[' + i + ']';
      const conceptCode = text(target && target.concept_code);
      const state = text(target && target.state);
      if (!conceptCode) issue(errors, 'CONCEPT_TARGET_CODE_REQUIRED', p + '.concept_code', 'concept_code is required.');
      else if (conceptTargetsByCode.has(conceptCode)) issue(errors, 'DUPLICATE_CONCEPT_TARGET', p + '.concept_code', 'Duplicate concept target ' + conceptCode + '.');
      else conceptTargetsByCode.set(conceptCode, target);
      if (!CONCEPT_STATES.has(state)) issue(errors, 'INVALID_CONCEPT_STATE', p + '.state', 'state must be MASTERED, DEVELOPING, NEEDS_REINFORCEMENT, or UNKNOWN_BASELINE.');
      if (!Number.isInteger(target && target.target_difficulty) || target.target_difficulty < 1 || target.target_difficulty > 5) {
        issue(errors, 'TARGET_DIFFICULTY_OUT_OF_RANGE', p + '.target_difficulty', 'target_difficulty must be an integer from 1 to 5.');
      }
      if (!Array.isArray(target && target.evidence_refs) || target.evidence_refs.length === 0 || target.evidence_refs.some(x => !text(x))) {
        issue(errors, 'CONCEPT_TARGET_EVIDENCE_REQUIRED', p + '.evidence_refs', 'Each concept target requires authoritative evidence references or an explicit baseline/no-live-evidence marker.');
      }
      const defaultDifficulty = DEFAULT_TARGET_DIFFICULTY.get(state);
      if (defaultDifficulty && Number.isInteger(target && target.target_difficulty) && target.target_difficulty !== defaultDifficulty && !text(target && target.target_difficulty_justification)) {
        issue(errors, 'TARGET_DIFFICULTY_OVERRIDE_UNJUSTIFIED', p + '.target_difficulty_justification', 'A target difficulty that differs from the default concept-state centre requires an evidence-based justification.');
      }
    }
  }

  if (ctx && typeof ctx === 'object') {
    const coverage = ctx.coverage_plan;
    const cp = 'academic_context.coverage_plan';
    if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
      issue(errors, 'COVERAGE_PLAN_REQUIRED', cp, 'New targeted packages require an explicit sequential curriculum coverage plan.');
    } else {
      for (const key of ['ordered_scope_ref', 'coverage_cursor', 'next_sequential_target']) {
        if (!text(coverage[key])) issue(errors, 'COVERAGE_PLAN_FIELD_REQUIRED', cp + '.' + key, key + ' is required.');
      }
      for (const key of ['cursor_order', 'next_target_order']) {
        if (!Number.isInteger(coverage[key]) || coverage[key] < 0) {
          issue(errors, 'COVERAGE_ORDER_INVALID', cp + '.' + key, key + ' must be a non-negative integer.');
        }
      }
      const decision = text(coverage.decision);
      if (!COVERAGE_DECISIONS.has(decision)) {
        issue(errors, 'COVERAGE_DECISION_INVALID', cp + '.decision', 'decision must be ADVANCE, REMEDIATE, BASELINE, or REVIEW_DUE.');
      }
      const primaryTargets = Array.isArray(coverage.primary_target_concepts) ? coverage.primary_target_concepts.map(text).filter(Boolean) : [];
      coveragePrimaryTargets = primaryTargets;
      if (!primaryTargets.length) {
        issue(errors, 'COVERAGE_PRIMARY_TARGETS_REQUIRED', cp + '.primary_target_concepts', 'At least one primary target concept is required.');
      }
      if (!Array.isArray(coverage.evidence_refs) || coverage.evidence_refs.length === 0 || coverage.evidence_refs.some(x => !text(x))) {
        issue(errors, 'COVERAGE_EVIDENCE_REFS_REQUIRED', cp + '.evidence_refs', 'Coverage decisions require authoritative evidence references or an explicit baseline/no-live-evidence marker.');
      }

      const resolvedPrimaryTargets = [];
      for (const [i, conceptCode] of primaryTargets.entries()) {
        const target = conceptTargetsByCode.get(conceptCode);
        if (!target) {
          issue(errors, 'COVERAGE_PRIMARY_TARGET_UNKNOWN', cp + '.primary_target_concepts[' + i + ']', 'Primary target concept ' + conceptCode + ' is not declared in academic_context.concept_targets.');
          continue;
        }
        resolvedPrimaryTargets.push(target);
        if (text(target.state) === 'MASTERED' && decision !== 'REVIEW_DUE' && !text(coverage.mastered_primary_target_justification)) {
          issue(errors, 'MASTERED_PRIMARY_TARGET_UNJUSTIFIED', cp + '.primary_target_concepts[' + i + ']', 'A MASTERED concept cannot remain a primary target unless the decision is REVIEW_DUE or an explicit justification is provided.');
        }
      }

      if (decision === 'ADVANCE' && Number.isInteger(coverage.cursor_order) && Number.isInteger(coverage.next_target_order) && coverage.next_target_order !== coverage.cursor_order + 1) {
        issue(errors, 'COVERAGE_ADVANCE_NOT_SEQUENTIAL', cp + '.next_target_order', 'ADVANCE must move to the immediately next assessable skill/subskill: next_target_order must equal cursor_order + 1.');
      }
      if (decision === 'REMEDIATE') {
        if (Number.isInteger(coverage.cursor_order) && Number.isInteger(coverage.next_target_order) && coverage.next_target_order !== coverage.cursor_order) {
          issue(errors, 'COVERAGE_REMEDIATE_CURSOR_MISMATCH', cp + '.next_target_order', 'REMEDIATE must remain on the current coverage cursor.');
        }
        if (resolvedPrimaryTargets.length && !resolvedPrimaryTargets.some(target => ['DEVELOPING', 'NEEDS_REINFORCEMENT'].includes(text(target.state)))) {
          issue(errors, 'COVERAGE_REMEDIATE_TARGET_INVALID', cp + '.primary_target_concepts', 'REMEDIATE requires at least one DEVELOPING or NEEDS_REINFORCEMENT primary target concept.');
        }
      }
      if (decision === 'BASELINE' && resolvedPrimaryTargets.length && !resolvedPrimaryTargets.some(target => text(target.state) === 'UNKNOWN_BASELINE')) {
        issue(errors, 'COVERAGE_BASELINE_TARGET_INVALID', cp + '.primary_target_concepts', 'BASELINE requires at least one UNKNOWN_BASELINE primary target concept.');
      }
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
    const conceptCode = text(b && b.concept_code);
    if (!conceptCode) issue(errors, 'CONCEPT_REQUIRED', p + '.concept_code', 'concept_code is required.');
    if (!Number.isInteger(b && b.difficulty_level) || b.difficulty_level < 1 || b.difficulty_level > 5) issue(errors, 'DIFFICULTY_OUT_OF_RANGE', p + '.difficulty_level', 'difficulty_level must be an integer from 1 to 5.');
    const difficultyRole = text(b && b.difficulty_role);
    if (!DIFFICULTY_ROLES.has(difficultyRole)) issue(errors, 'INVALID_DIFFICULTY_ROLE', p + '.difficulty_role', 'difficulty_role must be support, target, or transfer.');
    const conceptTarget = conceptTargetsByCode.get(conceptCode);
    if (conceptCode && !conceptTarget) {
      issue(errors, 'BLUEPRINT_CONCEPT_TARGET_REQUIRED', p + '.concept_code', 'Blueprint concept ' + conceptCode + ' has no matching academic_context.concept_targets entry.');
    } else if (conceptTarget && DIFFICULTY_ROLES.has(difficultyRole) && Number.isInteger(b && b.difficulty_level)) {
      const centre = conceptTarget.target_difficulty;
      const expectedDifficulty = difficultyRole === 'support' ? Math.max(1, centre - 1) : difficultyRole === 'transfer' ? Math.min(5, centre + 1) : centre;
      if (b.difficulty_level !== expectedDifficulty && !text(b && b.difficulty_override_reason)) {
        issue(errors, 'DIFFICULTY_ROLE_MISMATCH', p + '.difficulty_level', 'difficulty_level does not match the concept target and difficulty_role; add a learner-evidence-based difficulty_override_reason for an intentional exception.');
      }
    }
    if (!ORIGINS.has(b && b.origin)) issue(errors, 'INVALID_ORIGIN', p + '.origin', 'origin must be BOOK_DERIVED or GENERATED_SIMILAR.');
    if (!text(b && b.source_ref)) issue(errors, 'SOURCE_REF_REQUIRED', p + '.source_ref', 'source_ref is required.');

    const sig = normalizeReasoning(b && b.reasoning_signature);
    if (!sig) issue(errors, 'REASONING_SIGNATURE_REQUIRED', p + '.reasoning_signature', 'reasoning_signature is required for duplicate/near-duplicate protection.');
    else if (reasoning.has(sig)) issue(errors, 'DUPLICATE_REASONING_SIGNATURE', p + '.reasoning_signature', 'Reasoning form duplicates ' + reasoning.get(sig) + '.');
    else reasoning.set(sig, code || p);
  }

  const assessedConcepts = new Set(blueprint.map(row => text(row && row.concept_code)).filter(Boolean));
  for (const [i, conceptCode] of coveragePrimaryTargets.entries()) {
    if (conceptTargetsByCode.has(conceptCode) && !assessedConcepts.has(conceptCode)) {
      issue(errors, 'COVERAGE_PRIMARY_TARGET_UNASSESSED', 'academic_context.coverage_plan.primary_target_concepts[' + i + ']', 'Primary target concept ' + conceptCode + ' must be assessed by at least one blueprint item.');
    }
  }

  const difficulties = new Set(blueprint.map(x => x && x.difficulty_level).filter(Number.isInteger));
  if (blueprint.length > 0 && difficulties.size === 1 && !text(ctx && ctx.single_difficulty_justification)) {
    issue(errors, 'SINGLE_DIFFICULTY_UNJUSTIFIED', 'academic_context.single_difficulty_justification', 'A one-level package needs an explicit academic justification.');
  }

  for (const surface of SURFACES) {
    const rows = blueprint.filter(x => x && x.delivery_surface === surface);
    if (rows.length !== 20 || text(ctx && ctx.difficulty_distribution_justification)) continue;
    const roleCounts = { support: 0, target: 0, transfer: 0 };
    for (const row of rows) if (DIFFICULTY_ROLES.has(row.difficulty_role)) roleCounts[row.difficulty_role]++;
    if (roleCounts.support !== 4 || roleCounts.target !== 12 || roleCounts.transfer !== 4) {
      issue(errors, 'DIFFICULTY_DISTRIBUTION_MISMATCH', 'blueprint', 'A standard 20-question ' + surface + ' surface requires 4 support, 12 target, and 4 transfer items unless academic_context.difficulty_distribution_justification is provided.');
    }
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

    const promptLanguage = text(q && q.prompt_language).toLocaleLowerCase('en-US');
    if (!promptLanguage) issue(errors, 'PROMPT_LANGUAGE_REQUIRED', p + '.prompt_language', 'prompt_language is required for newly authored questions.');
    else if (!PROMPT_LANGUAGES.has(promptLanguage)) issue(errors, 'PROMPT_LANGUAGE_UNSUPPORTED', p + '.prompt_language', 'prompt_language must currently be ar, tr, or en.');

    for (const field of learnerVisibleFields(q, p)) {
      if (HTML_ENTITY_RE.test(field.value) || RAW_HTML_TAG_RE.test(field.value)) {
        issue(errors, 'LEARNER_TEXT_MARKUP_FORBIDDEN', field.path, 'Learner-visible authored text must be plain text; store apostrophes and symbols directly, not HTML/entity markup.');
      }
      if (sourceDependency(field.value)) {
        issue(errors, 'EXTERNAL_SOURCE_DEPENDENCY', field.path, 'Learner-visible authored text must be self-contained and must not send the learner back to a book, page, source, or reference.');
      }
      if (softSourceReference(field.value)) {
        issue(errors, 'SOFT_SOURCE_REFERENCE', field.path, 'Learner-visible authored text must embed the needed context instead of locating it only in an unseen lesson, text, poem, or vocabulary list.');
      }
    }

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
    const optionPositions = new Map();
    const distractorRationales = new Map();
    let correctCount = 0;
    let correctContent = '';

    for (const [j, o] of opts.entries()) {
      const op = p + '.options[' + j + ']';
      const content = text(o && o.content);
      const n = normalizeOption(content);

      if (!content) issue(errors, 'OPTION_CONTENT_REQUIRED', op + '.content', 'Option content is required.');
      else if (normalizedOptions.has(n)) issue(errors, 'DUPLICATE_OPTION_CONTENT', op + '.content', 'Duplicate option content with ' + normalizedOptions.get(n) + '.');
      else normalizedOptions.set(n, op);

      const position = o && o.position;
      if (!Number.isInteger(position) || position < 1) {
        issue(errors, 'OPTION_POSITION_INVALID', op + '.position', 'Option position must be a positive integer.');
      } else if (optionPositions.has(position)) {
        issue(errors, 'DUPLICATE_OPTION_POSITION', op + '.position', 'Option position duplicates ' + optionPositions.get(position) + '.');
      } else {
        optionPositions.set(position, op);
      }

      if (o && o.is_correct === true) {
        correctCount++;
        correctContent = content;
        if (text(o.misconception_code)) issue(errors, 'CORRECT_OPTION_MISCONCEPTION', op + '.misconception_code', 'Correct option cannot carry a misconception_code.');
      } else {
        const rationale = text(o && o.distractor_rationale);
        if (!rationale) {
          issue(errors, 'DISTRACTOR_RATIONALE_REQUIRED', op + '.distractor_rationale', 'Every wrong option needs a concise rationale explaining why it is a plausible distractor.');
        } else {
          const rationaleKey = normalizeRationale(rationale);
          if (distractorRationales.has(rationaleKey)) issue(errors, 'DUPLICATE_DISTRACTOR_RATIONALE', op + '.distractor_rationale', 'Distractor rationale duplicates ' + distractorRationales.get(rationaleKey) + ' instead of describing a distinct plausible error.');
          else distractorRationales.set(rationaleKey, op + '.distractor_rationale');
        }
      }
    }

    if (correctCount !== 1) issue(errors, 'SINGLE_CORRECT_OPTION_REQUIRED', p + '.options', 'Expected exactly one correct option; found ' + correctCount + '.');

    const misconceptionTarget = text(b && b.misconception_target);
    if (misconceptionTarget && !opts.some(o => o && o.is_correct !== true && text(o.misconception_code) === misconceptionTarget)) {
      issue(errors, 'MISCONCEPTION_TARGET_UNMAPPED', p + '.options', 'Blueprint misconception_target ' + misconceptionTarget + ' is not mapped to any wrong option.');
    }

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

      const hintContentTexts = [];
      const hintPayloadTexts = [];
      let previousHintPayloadSize = 0;
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
        const hintPayloadSize = text(combined).replace(/\s+/gu, ' ').length;
        if (j > 0 && previousHintPayloadSize > 0 && hintPayloadSize < previousHintPayloadSize * 0.75) {
          issue(warnings, 'HINT_DEPTH_REGRESSION', hp, 'Later hint payload is materially smaller than the previous level; review that support depth and informational payload really increased.');
        }
        previousHintPayloadSize = hintPayloadSize;

        if (correctCount === 1 && answerLeak(combined, correctContent)) issue(errors, 'HINT_ANSWER_LEAK', hp, 'Hint exposes the correct option/final answer before finalization.');

        const contentKey = normalizeHint(h && h.content);
        const payloadKey = normalizeHint(combined);
        const duplicateVisibleContent = contentKey && hintContentTexts.includes(contentKey);
        if (duplicateVisibleContent) {
          issue(errors, 'DUPLICATE_HINT_CONTENT', hp + '.content', 'Later learner-visible hint content duplicates an earlier hint instead of adding support.');
        } else if (payloadKey && hintPayloadTexts.includes(payloadKey)) {
          issue(errors, 'DUPLICATE_HINT_CONTENT', hp, 'Later hint payload duplicates an earlier hint instead of adding support.');
        }
        hintContentTexts.push(contentKey);
        hintPayloadTexts.push(payloadKey);

        if (h && Object.prototype.hasOwnProperty.call(h, 'decomposable') && typeof h.decomposable !== 'boolean') {
          issue(errors, 'HINT_DECOMPOSABLE_INVALID', hp + '.decomposable', 'Hint decomposable flag, when present, must be boolean.');
        } else if (h && typeof h.decomposable === 'boolean' && typeof q.decomposable === 'boolean' && h.decomposable !== q.decomposable) {
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

const modulePath = fs.realpathSync(path.resolve(fileURLToPath(import.meta.url)));
let entryPath = '';
if (process.argv[1]) {
  const resolvedEntry = path.resolve(process.argv[1]);
  try {
    entryPath = fs.realpathSync(resolvedEntry);
  } catch {
    entryPath = resolvedEntry;
  }
}
const sameEntrypoint = process.platform === 'win32'
  ? entryPath.toLocaleLowerCase('en-US') === modulePath.toLocaleLowerCase('en-US')
  : entryPath === modulePath;
if (entryPath && sameEntrypoint) main();
