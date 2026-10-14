/**
 * FLH-FEAT-2026-027 v1.1 revision 4 — read-only exact-candidate publication preflight.
 *
 * No backend writes. This guard deliberately rejects missing evidence rather
 * than marking a partly staged assessment as publishable. The existing
 * scripts/academic-content-quality.mjs remains the academic source of truth.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAcademicPackage } from './academic-content-quality.mjs';

const fail = (errors, code, message) => errors.push({ code, message });
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
const text = value => typeof value === 'string' ? value.trim() : '';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const array = value => Array.isArray(value) ? value : [];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Canonicalize key order while preserving every field and authored array order. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
export const assessmentCandidateHash = candidate => sha(canonical(candidate));

/** Project the reviewed candidate into the independently exported database shape. */
function projectedCandidateQuestion(q) {
  const correct = array(q.options).find(o => o?.is_correct === true);
  return {
    code: q.question_code,
    type: q.question_type,
    language: q.prompt_language,
    difficulty: q.difficulty_level,
    concept_code: q.concept_code,
    prompt: q.prompt,
    role: q.delivery_surface === 'learning' ? 'core' : 'exam_pool',
    options: array(q.options).map(o => ({ position: o?.position, content: o?.content, label: o?.label ?? String.fromCharCode(64 + o?.position) })).sort((a,b)=>a.position-b.position),
    correct_position: correct?.position ?? null,
    explanation: q.explanation ?? null,
    correct_explanation: q.correct_explanation ?? null,
    final_incorrect_explanation: q.final_incorrect_explanation ?? null,
    hints: array(q.hints).map(h => ({ level: h?.level, role: h?.role, content: h?.content, steps: h?.steps ?? null, expanded_steps: h?.expanded_steps ?? null })).sort((a,b)=>a.level-b.level)
  };
}

/** Compare source text, option labels, answer position, hint metadata and exact concept. */
function projectedSnapshotQuestion(q) {
  return {
    code: q.question_code,
    type: q.question_type,
    language: q.prompt_language,
    difficulty: q.difficulty_level,
    concept_code: array(q.primary_concept_codes).length === 1 ? q.primary_concept_codes[0] : null,
    prompt: q.prompt,
    role: q.delivery_role,
    options: array(q.options).map(o => ({ position: o?.position, content: o?.content, label: o?.label ?? null })).sort((a,b)=>a.position-b.position),
    correct_position: q.correct_position,
    explanation: q.key?.explanation ?? null,
    correct_explanation: q.key?.correct ?? null,
    final_incorrect_explanation: q.key?.incorrect ?? null,
    hints: array(q.hints).map(h => ({ level: h?.hint_level, role: h?.pedagogical_role, content: h?.content, steps: h?.metadata?.steps ?? null, expanded_steps: h?.metadata?.expanded_steps ?? null })).sort((a,b)=>a.level-b.level)
  };
}

/** Read-only evidence check; does not authenticate a reviewer or authorize publication. */
export function inspectAssessmentPublication(candidate, snapshot, expectedTarget) {
  const errors = [];
  const candidateHash = assessmentCandidateHash(candidate);
  const scopeKeys = ['workspace_id','quiz_id','quiz_version_id'];
  const targetValid = object(expectedTarget) && scopeKeys.every(key => uuid(expectedTarget[key]));
  if (!targetValid) fail(errors,'TARGET_REQUIRED','An independently selected workspace/quiz/version target with valid UUIDs is required.');
  let academic;
  try { academic = validateAcademicPackage(candidate); }
  catch { academic = { ok:false, errors:[{code:'INVALID_PACKAGE',message:'Malformed academic package.'}], warnings:[] }; }
  if (!academic.ok) fail(errors, 'ACADEMIC_VALIDATION_FAILED', 'Exact-candidate academic validator rejected this package.');
  if (!object(snapshot)) {
    fail(errors, 'SNAPSHOT_REQUIRED', 'An independently read backend draft snapshot is required.');
    return { ok:false, candidate_sha256:candidateHash, errors, academic };
  }

  for (const k of scopeKeys) {
    if (!uuid(snapshot[k])) fail(errors, 'SCOPE_REQUIRED', 'Missing or invalid immutable target scope: '+k);
    else if (targetValid && snapshot[k].toLowerCase() !== expectedTarget[k].toLowerCase()) {
      fail(errors,'TARGET_SCOPE_MISMATCH','Draft snapshot does not belong to the independently selected target: '+k);
    }
  }
  if (snapshot.quiz_status !== 'draft' || snapshot.version_state !== 'draft') {
    fail(errors,'UNSAFE_VERSION_STATE','Both quiz and exact version must remain unpublished drafts.');
  }

  const questions = Array.isArray(candidate?.questions) ? candidate.questions : [];
  const learning = questions.filter(q=>q?.delivery_surface==='learning');
  const exam = questions.filter(q=>q?.delivery_surface==='exam');
  if (questions.some(q => !/^Q-[0-9]{6,}$/.test(q?.question_code ?? ''))) {
    fail(errors,'QUESTION_CODE_INVALID','Question codes must satisfy the existing backend Q- plus six-or-more digits contract.');
  }
  if (questions.length!==40 || learning.length!==20 || exam.length!==20) {
    fail(errors,'QUESTION_SPLIT_INVALID','Requires exactly 20 Learning and 20 independent Exam questions.');
  }
  if (!Array.isArray(snapshot.questions) || snapshot.questions.length!==40) {
    fail(errors,'STAGING_INCOMPLETE','Backend snapshot must contain exactly 40 questions.');
  } else if (snapshot.questions.some(row => !object(row))) {
    fail(errors,'STAGING_INCOMPLETE','Every staged question must be a complete object.');
  } else if (snapshot.questions.some(row => !Number.isInteger(row.position))) {
    fail(errors,'ROW_IDENTITY_INVALID','Every staged question position must be an integer before comparison.');
  } else if (questions.length === 40 && learning.length === 20 && exam.length === 20) {
    const seen = new Set();
    const actual = snapshot.questions.slice().sort((a,b)=>a.position-b.position);
    const expected = [...learning,...exam];
    for (let i=0;i<40;i++) {
      const row = actual[i];
      if (row.position!==i+1 || seen.has(row.question_code)) fail(errors,'ROW_IDENTITY_INVALID','Invalid or repeated question position/code at position '+(i+1));
      seen.add(row.question_code);
      if (sha(projectedSnapshotQuestion(row))!==sha(projectedCandidateQuestion(expected[i]))) {
        fail(errors,'CANDIDATE_STAGING_DRIFT','Published payload differs from reviewed candidate at position '+(i+1));
      }
      if (row.primary_concept_count!==1 || array(row.primary_concept_codes).length!==1 || row.primary_concept_codes[0]!==expected[i].concept_code) {
        fail(errors,'CONCEPT_MAPPING_REQUIRED','The exact reviewed primary concept is required at '+(i+1));
      }
    }
  }

  const review = snapshot.semantic_review;
  const reviewScopeMatches = scopeKeys.every(key => review?.[key] === snapshot[key]);
  if (review?.candidate_sha256!==candidateHash || review?.result!=='PASS' || !reviewScopeMatches
      || !text(review?.reviewer_ref) || !text(review?.authority_ref) || !text(review?.source_review_ref)
      || !text(review?.learner_scope_review_ref) || !Number.isFinite(Date.parse(review?.reviewed_at))) {
    fail(errors,'SEMANTIC_REVIEW_MISSING','The exact candidate must have a separately recorded human/academic semantic PASS review.');
  }
  const dispositions = array(review?.warning_dispositions);
  const unresolvedWarnings = academic.warnings.filter(warning => !dispositions.some(disposition =>
    object(disposition) && disposition.code===warning.code && disposition.path===warning.path
    && disposition.result==='ACCEPTED' && text(disposition.reason)));
  if (unresolvedWarnings.length) fail(errors,'WARNING_REVIEW_MISSING','Each exact-candidate validator warning needs an explicit code/path disposition and reason.');
  if (snapshot.video_candidate_reviewed !== true) {
    fail(errors,'VIDEO_CANDIDATE_REQUIRED','An exact-lesson video must be reviewed before publishing; authenticated attachment follows publish.');
  }

  return {
    ok:errors.length===0,
    candidate_sha256:candidateHash,
    errors,
    academic,
    warning_disposition_required:unresolvedWarnings.length>0
  };
}

/** CLI exit status stays failed until content, evidence and warning dispositions pass. */
async function main() {
  if (process.argv.length!==5) {
    console.error('Usage: node scripts/assessment-publication-preflight.mjs <academic-package.json> <read-only-draft-snapshot.json> <expected-target.json>');
    process.exit(2);
  }
  const read = filename => JSON.parse(fs.readFileSync(filename,'utf8'));
  const result = inspectAssessmentPublication(read(process.argv[2]),read(process.argv[3]),read(process.argv[4]));
  console.log(JSON.stringify(result,null,2));
  if (!result.ok || result.warning_disposition_required) process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) await main();
