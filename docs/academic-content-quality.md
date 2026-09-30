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

## Concept targets and adaptive difficulty

Every newly authored targeted package declares `academic_context.concept_targets`. Each relevant concept records `concept_code`, a state (`MASTERED`, `DEVELOPING`, `NEEDS_REINFORCEMENT`, or `UNKNOWN_BASELINE`), `target_difficulty` on the 1–5 scale, and one or more evidence references. Unknown/baseline work still records an explicit baseline/no-live-evidence reference instead of pretending personalization evidence exists.

Default target centres are: UNKNOWN_BASELINE = 2, NEEDS_REINFORCEMENT = 2, DEVELOPING = 3, and MASTERED = 4. A different centre is allowed only with an evidence-based `target_difficulty_justification`.

Each blueprint row declares `difficulty_role` as `support`, `target`, or `transfer`. Those roles normally map to one level below the concept target, the concept target itself, or one level above it, bounded to 1–5. An intentional exception requires `difficulty_override_reason`.

For a standard 20-question delivery surface the default role mix is 4 support / 12 target / 4 transfer. A diagnostic, remediation, or challenge package may use a different mix only when `academic_context.difficulty_distribution_justification` explains why. Learning authoring should feel progressively harder; Exam may interleave the same calibrated mix so the order is not predictable.

The SOP also guides concept allocation: verified weak concepts receive the greatest share, current/developing scope the next share, and mastered/prerequisite concepts are used for retrieval/transfer rather than score inflation. The validator checks the machine-verifiable difficulty contract; academic review remains responsible for whether the concept allocation fits the learner evidence.

## Assessment blueprint

Every new package must include a machine-readable blueprint before the questions are published. Each blueprint row identifies:

- question_code;
- delivery_surface: learning, exam, or paper;
- concept_code;
- difficulty_level from 1 to 5;
- difficulty_role: support, target, or transfer;
- origin: BOOK_DERIVED or GENERATED_SIMILAR;
- source_ref;
- reasoning_signature describing the reasoning form being tested;
- optional misconception_target when the item intentionally probes a known misconception.

Difficulty comes from learner evidence and prerequisite status, not grade or total score alone. A multi-question package should normally span more than one difficulty level; a one-level package needs an explicit academic justification.

The reasoning_signature is deliberately explicit. It prevents Learning, Exam, and Paper from being filled with cosmetic variants that change only names or numbers while testing the same reasoning path.

## Question and option quality

A single-choice question must have one unambiguous correct option. Options must be unique after Unicode/whitespace normalization.

Wrong options must carry a short distractor_rationale explaining why a learner could plausibly choose them. Rationales inside one question must be distinct rather than duplicated filler. Where a known misconception is confidently represented, a wrong option may also carry misconception_code. When a blueprint row declares misconception_target, at least one wrong option must carry the same misconception_code. Never attach a misconception to the correct option and never invent a misconception merely to satisfy metadata.

The deterministic gate cannot prove every semantic property of a distractor. It therefore combines machine checks with author responsibility: plausibility, age-appropriate language, source fidelity, and lack of grammatical/visual answer giveaways still require content review. The validator emits a warning when the correct option is unusually long compared with distractors.

## Progressive hint contract

The existing four-level hint contract remains authoritative:

1. nudge: direct attention without giving the method or result;
2. guide: remind the relevant rule or strategy without completing the problem;
3. strong_guide: give a worked sub-step, decomposition, or analogous example without the final answer;
4. near_solution: give the clearest allowed path while leaving the learner to produce or identify the final answer.

Every Learning question must explicitly declare `decomposable: true` or `decomposable: false` at question level. This question-level classification is authoritative for the whole four-hint sequence; a hint-level `decomposable` flag, when present, must agree with it.

For a decomposable Learning question, every hint uses exactly three short steps and the expanded form uses exactly six short steps. Expansion changes granularity, not disclosure level. An explicitly non-decomposable Learning question may omit the 3/6-step arrays.

The validator rejects direct answer leakage when the correct option appears in a pre-finalization hint. Later hints must not be exact duplicates of earlier hints and must add new instructional value. The intended progression also grows in explicitness/informational payload: nudge is the shortest cue, guide adds the relevant strategy, strong_guide adds a worked sub-step/decomposition/analogy, and near_solution is the fullest allowed support without the final answer. The validator emits a review warning when a later combined hint payload is materially smaller than the previous level; semantic depth still requires content review rather than a crude word-count pass/fail rule.

After a wrong attempt, the same previously served hint must not be replayed as the next support. Resume must preserve monotonic hint state. A verified recurring misconception may receive misconception-specific guidance without exceeding the current disclosure ceiling. An isolated slip on a mastered concept should not trigger unnecessary over-scaffolding.

This content contract protects the rules already documented in docs/adaptive-learning.md and docs/pedagogy-engine.md; it does not create a competing hint system.

## External tools

runtime_external_dependencies must be declared and is expected to be an empty array for normal packages.

Brisk Teaching is optional teacher-side advisory review. Its output may be used as an independent comparison for wording, grade level, DOK variety, or quiz construction, but it is not a curriculum source of truth and is never auto-published.

Snorkl is optional diagnostic escalation when repeated Family Learning Hub evidence does not explain a misconception and a spoken/whiteboard/worked-reasoning response would materially improve diagnosis. Prefer an internal Family Learning Hub remediation question first when it can answer the diagnostic question. It is not part of the standard Learning or Exam path, and any useful diagnosis must be summarized back into the authoritative learner evidence path before future targeting.

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

Package-specific validation is a mandatory authoring boundary, not merely fixture-backed CI coverage.

Before an agent creates or updates any migration, seed/import payload, backend registration, printable artifact, or other publication artifact for a newly authored assessment package, it must:

1. materialize the exact candidate package as JSON in a local or otherwise non-published working location;
2. run `node scripts/academic-content-quality.mjs path/to/academic-package.json` against that exact candidate;
3. stop on any validator error;
4. review and disposition warnings before continuing;
5. record the package-specific validation result in the PR/Issue handoff or equivalent durable delivery evidence.

Do not place real learner attempts into repository regression fixtures merely to satisfy this boundary. The exact package may be validated from a temporary working file; synthetic Testing-learner fixtures remain the committed regression evidence.

If a future centralized authoring/import/publishing command is added to the repository, that command must invoke `validateAcademicPackage` before any persistence or publication write. Until such a centralized writer exists, the agent authoring boundary above is mandatory for every content-publication path.

A package is not academically ready when the validator reports errors. Warnings require human review/disposition but do not automatically fail validation.

This gate is necessary but not sufficient: source correctness, visual-authoritative math verification, learner-state reconciliation, and the existing QA/security rules still apply.

Published quiz versions remain immutable. Fixes to published content use the existing versioned/forward-only content workflow.
