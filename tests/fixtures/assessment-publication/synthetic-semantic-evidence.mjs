// Synthetic only: structural fixture for FLH-047. Never use as a real semantic review.
export const syntheticSemanticEvidence=candidate=>(candidate.questions||[]).map((q,i)=>({
  question_code:q.question_code,
  status:'PASS',
  outcome:'Synthetic test outcome for '+q.question_code+' - not actual educational approval.',
  answer_reason:'Synthetic answer-key reconstruction only for '+q.question_code+'.',
  distractors:'Synthetic distinct distractor rationale evaluation for '+q.question_code+'.',
  clarity:'Synthetic child-readability review placeholder for '+q.question_code+'.',
  explanation_value:'Synthetic review of feedback explanation for '+q.question_code+'.',
  hint_additions:q.delivery_surface==='learning'?[1,2,3,4].map(n=>'Synthetic evidence of NEW guidance at level '+n+' for '+q.question_code+'.'):[],
  ...(Array.isArray(q.assets)&&q.assets.length?{visual_review:'Synthetic raster/scale/source review for '+q.question_code+'; not real learner-image QA.'}:{})
}));
