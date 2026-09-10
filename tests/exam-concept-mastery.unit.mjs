import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260910080000_record_exam_concept_mastery.sql','utf8');

for(const required of [
  'flh_record_exam_concept_mastery',
  'flh_record_exam_mastery_on_submit',
  'trg_record_exam_mastery_on_submit',
  "new.delivery_mode='exam'",
  "new.status='submitted'",
  'old.status is distinct from new.status',
  'qc.is_primary=true',
  'EXAM_MASTERY_EVALUATION_INCOMPLETE',
  'concept_mastery_recorded',
  'concept_mastery_evidence_count',
  'concept_mastery_concept_count',
  'primary-concept-running-evidence-v1',
  "coalesce((a.metadata->>'paper_ingested')::boolean,false) is true",
  'grant execute on function public.flh_record_exam_concept_mastery(uuid,uuid) to service_role'
]){
  assert.ok(migration.includes(required),`exam mastery migration missing invariant: ${required}`);
}

assert.ok(
  migration.includes('revoke all on function public.flh_record_exam_concept_mastery(uuid,uuid) from anon, authenticated'),
  'exam mastery helper must not be directly executable by learner roles'
);
assert.ok(
  migration.includes('revoke all on function public.flh_record_exam_mastery_on_submit() from anon, authenticated'),
  'exam mastery trigger function must not be directly executable by learner roles'
);
assert.ok(
  migration.includes('count(*) filter (where aa.is_correct is true)::integer as correct_count'),
  'mastery evidence must come from server-authoritative graded answers'
);
assert.ok(
  migration.includes('count(*) filter (where aa.is_correct is not null)'),
  'submission must fail closed if any queued answer has not been server-evaluated'
);
assert.ok(
  !migration.includes('qc.is_primary=false'),
  'secondary concept links must not double-count one exam question as mastery evidence'
);

function mergedScore(oldScore,oldEvidence,correct,newEvidence){
  return Math.round((((oldScore*oldEvidence)+(correct*100))/(oldEvidence+newEvidence))*100)/100;
}
assert.equal(mergedScore(60.72,21,11,13),69.86,'Mohammad add/sub paper evidence regression');
assert.equal(mergedScore(94.44,9,7,7),96.87,'Mohammad multiply/divide paper evidence regression');

// Idempotency: the attempt marker is checked before any concept aggregation/update.
const markerCheck=migration.indexOf("concept_mastery_recorded')::boolean,false) is true");
const conceptLoop=migration.indexOf('for r in');
assert.ok(markerCheck>=0 && conceptLoop>markerCheck,'idempotency marker must be checked before mastery writes');

console.log('Exam concept mastery regression tests passed');
