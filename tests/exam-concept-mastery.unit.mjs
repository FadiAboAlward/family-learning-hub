import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260910080000_record_exam_concept_mastery.sql','utf8');

for(const required of [
  'uq_quiz_question_one_primary_concept',
  'on public.quiz_question_concepts(workspace_id,question_id)',
  'where is_primary=true',
  'flh_record_exam_concept_mastery',
  'flh_record_exam_mastery_on_submit',
  'flh_backfill_paper_exam_concept_mastery',
  'trg_record_exam_mastery_on_submit',
  "new.delivery_mode='exam'",
  "new.status='submitted'",
  'old.status is distinct from new.status',
  'qc.is_primary=true',
  'EXAM_MASTERY_EVALUATION_INCOMPLETE',
  'count(*) filter (where aa.is_correct is true)::integer as correct_count',
  'count(*) filter (where aa.first_try_correct is true)::integer as first_try_count',
  'first_try_correct_count=coalesce(v_old.first_try_correct_count,0)+r.first_try_count',
  'concept_mastery_recorded',
  'concept_mastery_evidence_count',
  'concept_mastery_concept_count',
  'primary-concept-running-evidence-v1',
  "coalesce((a.metadata->>'paper_ingested')::boolean,false) is true",
  "coalesce((a.metadata->>'paper_queue_validated')::boolean,false) is true",
  'PAPER_EXAM_MASTERY_BACKFILL_SKIPPED',
  'PAPER_EXAM_MASTERY_BACKFILL_SUMMARY',
  "'eligible',v_eligible",
  "'recorded',v_recorded",
  "'skipped',v_skipped",
  'grant execute on function public.flh_record_exam_concept_mastery(uuid,uuid) to service_role',
  'grant execute on function public.flh_backfill_paper_exam_concept_mastery() to service_role'
]){
  assert.ok(migration.includes(required),`exam mastery migration missing invariant: ${required}`);
}

for(const signature of [
  'public.flh_record_exam_concept_mastery(uuid,uuid)',
  'public.flh_record_exam_mastery_on_submit()',
  'public.flh_backfill_paper_exam_concept_mastery()'
]){
  assert.ok(
    migration.includes(`revoke all on function ${signature} from anon, authenticated`),
    `${signature} must not be directly executable by learner roles`
  );
}

assert.ok(
  migration.includes('count(*) filter (where aa.is_correct is not null)'),
  'submission must fail closed if any queued answer has not been server-evaluated'
);
assert.ok(
  !migration.includes('qc.is_primary=false'),
  'secondary concept links must not double-count one exam question as mastery evidence'
);
assert.ok(
  !migration.includes("raise exception 'PAPER_EXAM_MASTERY_BACKFILL_FAILED"),
  'one malformed historical paper attempt must not abort the schema migration'
);

function mergedScore(oldScore,oldEvidence,correct,newEvidence){
  return Math.round((((oldScore*oldEvidence)+(correct*100))/(oldEvidence+newEvidence))*100)/100;
}
assert.equal(mergedScore(60.72,21,11,13),69.86,'Mohammad add/sub paper evidence regression');
assert.equal(mergedScore(94.44,9,7,7),96.87,'Mohammad multiply/divide paper evidence regression');

console.log('Exam concept mastery structural regression tests passed');
