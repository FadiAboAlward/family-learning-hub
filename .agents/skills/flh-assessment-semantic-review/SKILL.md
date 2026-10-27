---
name: flh-assessment-semantic-review
description: Evidence-based academic QA and triage of Family Learning Hub multiple-choice questions, answer keys, misconception-based distractors and progressive hints before publishing; distinguishes actual item defects from AI-grader errors and prepares only genuine ambiguities for human adjudication.
---

# Family Learning Hub — Semantic Item Review (optional repository skill)

This is an **optional authoring-review aid**, not a generator, automatic sign-off, or release authority. Keep it short. Use the user's current Academic Assessment SOP and the assigned AI-READY book as authoritative; never silently change their requirements. When reviewing content, do not mutate production, student records, book sources, or the frozen official candidate. Repository maintenance follows the regular Feature Spec/PR QA process. `SKILL.md` does not override any gate. Running a review is **not an independent second review** and is **not release approval**.

## Inputs

- Student / grade / curriculum / subject and assigned BOOK_CODE; exact `PDF_PAGE` and excerpt (inspect VISUAL_REQUIRED original where meaning depends on a diagram).
- Exact item code, delivery surface `learning` or `exam`, question and all 4 options with *explicit* selected key, the learning outcome, its source origin (`BOOK_DERIVED` or `GENERATED_SIMILAR`).
- If Learning: H1–H4 and post-response explanations. If Exam: **zero hints**, by design.
- For a whole-candidate review, the unchanged official `candidate_sha256`, version, and all 40 items; do not extrapolate a single-item result to whole-candidate PASS.

## Minimal sequence, per item

1. **Source/authenticity.** Read actual book text, distinguish source fact from self-contained hypothetical context. Synthetic times/names can be legitimate `GENERATED_SIMILAR`. If the student needs unseen information or source is unresolved: `EVIDENCE_MISSING`, not fabricated FAIL.
2. **Key validity first.** Ignore `is_correct` initially. Solve the stem from its data; compare each option. If 0 or >1 options defensible, or selected key is not uniquely supported: `ITEM_FAIL`. Cite one exact sentence and the right option(s). This is a blocking risk to student grades.
3. **Distractors.** For each wrong option, identify a plausible, *different* student reasoning route. Bad distractor = implausible/also correct or a copy of another, not merely easy. Note what student response would reveal and the next small teaching step. Keep the question's cognitive target (not accidental keyword matching).
4. **Learning hints.** Check four distinct stages: H1 orientation, H2 conceptual/linguistic support, H3 analogical transfer, H4 near-solution method. Each exactly 3 bullets and >=30 lexical words **per hint total**, not per bullet. `H4` may narrow possibilities; it must not literally mark the correct option or short-circuit the intended reasoning. For H2/H3, test the counterfactual: could a student choose correctly by copying a supplied word-for-word translation/answer? If yes, `ITEM_FAIL`; quote exact leak. Check all hints refer to **this** stem, not a previous draft.
5. **Post-response explanation.** State why the correct answer is correct AND why *each wrong answer* is wrong; verify no fabricated book facts. Explain the concept in Arabic at the student's level with needed English/Turkish terms.
6. **Reviewer sanity check.** Never take external reviewer `PASS/FAIL` as ground truth. Separate `ITEM_DEFECT`, `GRADER_OR_RUBRIC_DEFECT`, `SOURCE_GAP`, or `INCOMPLETE_REVIEW`; invalidate an unsupported quote, reversed numeric minimum, claim that Exam needs hints, or `PASS` alongside acknowledged leakage.
7. **Small record, not essay.** Return item ID, `ACCEPT_PROVISIONAL | ITEM_FAIL | SOURCE_GAP | HUMAN_REVIEW_REQUIRED`, exact quote, objective defect code, one-sentence rationale, low-cost next action, reviewer/origin and confidence. An unfinished model report is `INCOMPLETE_REVIEW`, not a PASS or a demonstrated FAIL.
8. **Escalate only true unresolved disputes.** If two defensible interpretations remain after checking exact book text and specified SOP, place a **single binary decision** with both interpretations and evidence into `human_queue.json`. A human chooses; until then `HUMAN_REVIEW_REQUIRED`. Do not label self-review as human approval. Escalate no routine numeric or key-comparison checks.

## Progression and release discipline

- Start with a **small gold set**, containing valid and deliberately faulty examples; require agreement on root-cause defect, not only verdict. Check evidence quote exists verbatim in the item's exact text.
- Batch 5–10 question cores; accept questions before drafting hints; keep accepted items immutable and track their exact identifiers. Avoid blind whole-candidate regeneration, cascading local repairs, gratuitous graders, or another app dependency.
- Run the **existing official** deterministic `validate_assessment_candidate` on the *full final 40-question candidate*, then independently review all actual items/hints and both surfaces on **that same hash**. If reviewer unavailable/blocked/incomplete, do **not** route around safety blocks or declare academic PASS. Authorized release/video/links/SENT only after SOP gates pass.
- If previous two permitted repair rounds for an exact candidate are used up, freeze it and create a genuinely distinct plan only after a justified redesign, not a renamed patch.

## Compact record

`{item_code, candidate_sha256, assessment_surface, finding, root_bucket, severity, evidence_quote, rationale, next_action, reviewer_kind, human_decision: null}`

Keep teacher-facing evidence separate from student-facing questions/feedback. Consult `references/sources.md` for external inspirations and boundaries; consult `references/adjudication-examples.md` for verified local examples.

## Lightweight consistency check (advisory)

Use `python3 scripts/check_review.py path/to/review_input.json` on a **local, private** input record when an external reviewer returns structured findings. It checks modes, word/bullet minimums, contradiction between PASS and admitted errors, and literal evidence quotes. It does **not** identify semantic errors the reviewer failed to report and cannot provide an independent academic PASS. No required API, account, or network call. Use only anonymized synthetic fixtures in the public repository.