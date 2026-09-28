# Academic Content Quality Gate

## Purpose

This document is the repository contract for academically validating a newly authored Family Learning Hub assessment package before it is published. It implements FLH-FEAT-2026-007 and complements, rather than replaces, docs/adaptive-learning.md, docs/pedagogy-engine.md, docs/architecture.md, and the Drive Adaptive Assessment SOP.

The gate is an authoring/QA control. It does not add a live AI dependency to a learner attempt.

## Authoritative input order

Before authoring a targeted package, use this order:

1. current Student Academic State;
2. assigned Project Source / book and confirmed scope;
3. newer relevant live attempt/mastery evidence;
4. the Adaptive Assessment SOP and this repository contract;
5. generation and deterministic QA.

If newer live evidence conflicts with Student Academic State, reconcile the state first. If current mastery or school position is unknown, mark the package as baseline/readiness work instead of pretending it is personalized.

## Canonical learner modes

The canonical modes are Learning and Exam. The term practice is legacy terminology and is rejected by the academic package validator as a delivery surface.

Learning may use retries, progressive hints, explanations, misconception-aware feedback, and remediation.

Exam must not expose hints, retry, answer keys, or correctness feedback before submission. Post-submit review is separate from in-progress assistance.

Paper is a delivery surface for printable assessment content, not a third interactive runtime mode.

## Assessment blueprint

Every new package must include a machine-readable blueprint before the questions are published. Each blueprint row identifies:

- question_code;
- delivery_surface: learning, exam, or paper;
- concept_code;
- difficulty_level from 1 to 5;
- origin: BOOK_DERIVED or GENERATED_SIMILAR;
- source_ref;
- reasoning_signature describing the reasoning form being tested.

Difficulty comes from learner evidence and prerequisite status, not grade or total score alone. A multi-question package should normally span more than one difficulty level; a one-level package needs an explicit academic justification.

The reasoning_signature is deliberately explicit. It prevents Learning, Exam, and Paper from being filled with cosmetic variants that change only names or numbers while testing the same reasoning path.

## Question and option quality

A single-choice question must have one unambiguous correct option. Options must be unique after Unicode/whitespace normalization.

Wrong options must carry a short distractor_rationale explaining why a learner could plausibly choose them. Where a known misconception is confidently represented, a wrong option may also carry misconception_code. Never attach a misconception to the correct option and never invent a misconception merely to satisfy metadata.

The deterministic gate cannot prove every semantic property of a distractor. It therefore combines machine checks with author responsibility: plausibility, age-appropriate language, source fidelity, and lack of grammatical/visual answer giveaways still require content review. The validator emits a warning when the correct option is unusually long compared with distractors.

## Progressive hint contract

The existing four-level hint contract remains authoritative:

1. nudge: direct attention without giving the method or result;
2. guide: remind the relevant rule or strategy without completing the problem;
3. strong_guide: give a worked sub-step, decomposition, or analogous example without the final answer;
4. near_solution: give the clearest allowed path while leaving the learner to produce or identify the final answer.

For a decomposable concept, the normal hint uses exactly three short steps and the expanded form uses exactly six short steps. Expansion changes granularity, not disclosure level.

The validator rejects direct answer leakage when the correct option appears in a pre-finalization hint. Later hints must not be exact duplicates of earlier hints.

This content contract protects the rules already documented in docs/adaptive-learning.md and docs/pedagogy-engine.md; it does not create a competing hint system.

## External tools

runtime_external_dependencies must be declared and is expected to be an empty array for normal packages.

Brisk Teaching is optional teacher-side advisory review. Its output may be used as an independent comparison for wording, grade level, DOK variety, or quiz construction, but it is not a curriculum source of truth and is never auto-published.

Snorkl is optional diagnostic escalation when repeated Family Learning Hub evidence does not explain a misconception and a spoken/whiteboard/worked-reasoning response would materially improve diagnosis. It is not part of the standard Learning or Exam path.

The learner stays inside Family Learning Hub in the normal flow.

## Manifest shape

Use tests/fixtures/academic-content-quality/valid-package.json as the executable example. The package contains academic_context, runtime_external_dependencies, blueprint, and questions with options, distractor rationale, and Learning hints.

The fixture uses only the Testing learner and synthetic evidence references. Do not put real learner attempts into automated fixtures.

## Commands

Validate an authored package directly with:

node scripts/academic-content-quality.mjs path/to/academic-package.json

Run the deterministic regression suite with:

node tests/academic-content-quality.mjs

GitHub Actions runs the regression suite as a direct unconditional step in Static quality. Browser smoke remains downstream of Static quality.

## Publication rule

A package is not academically ready when the validator reports errors. Warnings require human review/disposition but do not automatically fail validation.

This gate is necessary but not sufficient: source correctness, visual-authoritative math verification, learner-state reconciliation, and the existing QA/security rules still apply.

Published quiz versions remain immutable. Fixes to published content use the existing versioned/forward-only content workflow.
