# Interactive Learning Labs — Academic Pilot Handoff

**FEATURE_ID:** `FLH-FEAT-2026-032`  
**SPEC_VERSION:** `1.0`  
**SPEC_URL:** https://docs.google.com/document/d/1MLZG3nSmJ0TpXaE3XYf7QqqiMoEHTp8StPiOIQl96zg/edit  
**DRIVE_REVISION_ID:** `3` (retrieved and content-verified 2026-10-18)  
**ClickUp task:** https://app.clickup.com/t/z8xb3ut9mj  
**Status:** Proposal only — **no runtime, DB, scoring, or Production behavior changes.**

## Proposal

Arabic term: **المختبرات التعليمية التفاعلية**. English: **Interactive Learning Labs (ILL)**.

Offer an optional, exact-skill micro-lab before Learning Mode for future exercise packages. Pilot Grade 5 fractions first; only generalize after academic sign-off and actual QA. The lab teaches by interaction, prediction, observation and explanation, without revealing Exam questions or adding grading requirements. It supplements the current mandatory authoring-time instructional video.

**Student journey:** open pre-Learning lab → manipulate one model and see correctly linked visual/number representations → answer a small transfer prompt → continue to the unchanged Learning/Exam paths (or skip the lab).

## Pedagogical authoring contract (proposal)

For each new lab, an academic owner must approve:

- Student + grade + curriculum + exact book/part/page + targeted skill and misconception.
- One observable learning goal, meaningful control(s), correct state transitions, reversible/resettable interactions.
- A predict–manipulate–observe–explain cycle and one transfer check.
- Concise, age-appropriate explanations and progressive non-revealing support; correct Arabic RTL and Turkish/English terms where required.
- Clear independent proof that the simulation is accurate and accessible; use stacked fraction notation in learner UI per `docs/pedagogy-engine.md` and existing math invariants.

Do not make a new subsystem unless current `interactive` explanation blocks are unsuitable. Student usage is optional and never changes grades, mastery, rewards, Exam integrity, or the existing video gate.

## Evidence and reference limitations

- Clark & Mayer, *e-Learning and the Science of Instruction*, 5th ed., Wiley (2023): https://www.wiley-vch.de/de?isbn=978-1-394-17737-0&option=com_eshop&view=product
- PhET inquiry and research: https://phetsims.colorado.edu/ar_SA/research
- Standalone demo (not a product-ready implementation): https://fadiaboalward.github.io/family-quiz-lab/fraction-lab/

These principles are a synthesis from accessible official descriptions and teaching resources; **not** a claim of full copyrighted-book ingestion.

## Delivery gate

**Codex** to implement from the frozen Drive revision after design review, then run deterministic tests + review + TestSprite / approved browser QA on **Testing** accounts, including 390x844 and desktop. Follow AC-01–AC-08 in the pinned Spec. No merge/deployment until those gates and user approval.
