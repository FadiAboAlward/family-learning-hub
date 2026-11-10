// FLH-FEAT-2026-047 v1.0 — structural evidence for independent semantic QA.
// This never decides whether the educational judgment is true; it prevents
// silent, per-package PASS assertions with no traceable per-question record.
export const SEMANTIC_EVIDENCE_CUTOVER='2026-11-10T23:06:00Z';
const text=value=>typeof value==='string'?value.trim():'';
const enough=value=>text(value).length>=18;
const array=value=>Array.isArray(value)?value:[];

// Existing frozen, pre-policy authoring reviews remain historical/idempotent.
// This is a prospective workflow cutover, NOT an authentication/authorization rule.
export const semanticEvidenceRequired=review=>{
  const reviewed=Date.parse(review?.reviewed_at||'');
  return Number.isFinite(reviewed)&&reviewed>=Date.parse(SEMANTIC_EVIDENCE_CUTOVER);
};

export function validateSemanticItemEvidence(candidate,review) {
  if(!semanticEvidenceRequired(review))return {ok:true,legacy:true,reason:'PRE_POLICY_REVIEW'};
  const questions=array(candidate?.questions),items=array(review?.item_evidence);
  if(!questions.length||items.length!==questions.length)return {ok:false,code:'SEMANTIC_ITEM_EVIDENCE_COUNT'};
  const byCode=new Map();
  for(const item of items) {
    if(!item||typeof item!=='object'||Array.isArray(item)||!text(item.question_code)||byCode.has(item.question_code))
      return {ok:false,code:'SEMANTIC_ITEM_EVIDENCE_DUPLICATE'};
    byCode.set(item.question_code,item);
  }
  const signatures=new Set();
  for(const question of questions) {
    const item=byCode.get(question?.question_code);
    if(!item||item.status!=='PASS'||!['outcome','answer_reason','distractors','clarity','explanation_value'].every(field=>enough(item[field])))
      return {ok:false,code:'SEMANTIC_ITEM_EVIDENCE_INCOMPLETE',question_code:question?.question_code};
    const additions=array(item.hint_additions);
    if(question.delivery_surface==='learning') {
      if(additions.length!==4||additions.some(x=>!enough(x))||new Set(additions.map(x=>text(x).toLowerCase())).size!==4)
        return {ok:false,code:'SEMANTIC_HINT_PROGRESS_EVIDENCE',question_code:question.question_code};
    } else if(additions.length) return {ok:false,code:'SEMANTIC_EXAM_HINT_EVIDENCE',question_code:question.question_code};
    if(array(question.assets).length&&!enough(item.visual_review))
      return {ok:false,code:'SEMANTIC_VISUAL_READABILITY_EVIDENCE',question_code:question.question_code};
    const signature=['outcome','answer_reason','distractors','clarity','explanation_value'].map(k=>text(item[k]).toLowerCase()).join('|');
    if(signatures.has(signature))
      return {ok:false,code:'SEMANTIC_ITEM_EVIDENCE_REPEATED',question_code:question.question_code};
    signatures.add(signature);
  }
  return {ok:true,reviewed_count:items.length};
}
