# Math Rendering Invariant — Arabic RTL UI

This is a platform invariant for **every learner**, current or future. It is not tied to Aya, Mohammad, a grade, a curriculum, or a particular quiz.

## Rendering contract

- The application shell and Arabic prose remain RTL.
- Every mathematical expression is rendered in logical mathematical order as LTR with bidirectional isolation.
- This applies to question prompts, answer options, hints, explanations, learner answers, correct answers, completed-attempt review, Exam review, and any other student-facing math surface.
- Negative values must preserve the leading sign, for example `-26` must never appear as `26-`.
- Operand order must never be visually reversed, for example `19 - (-7)` must not appear as `(-7) - 19`.
- Numeric and decimal answer inputs are LTR.
- Stored question/answer data is canonical and must never be reversed, reordered, or rewritten to compensate for RTL display. Direction is a rendering concern only.

## Architecture

`app.js` provides the base `math()` formatting helper. `math-direction-v1.js` loads immediately after it and wraps the shared renderer before Learning, Exam, and review runtimes load. The wrapper reads the original escaped source before the legacy helper expands fractions, so a complete expression has one isolated LTR `bdi` boundary. Its bounded source parser supports signed integers and decimals (including Arabic digits), nested parentheses, comparisons and arithmetic operators, slash/`\\frac{…}{…}` stacked fractions, `^` powers (including braced exponents) and Unicode superscripts such as `2²` or `2⁻³`, and `√`, `sqrt(…)` or `\\sqrt{…}` roots. It typesets source without evaluating or changing answers.

Structured expressions retain the complete authored expression as their accessible `aria-label`. Numerators/denominators, superscripts and radical bars are scoped to the math wrapper and reuse the existing fraction markup. Arabic prose and ordinary Turkish/English remain unchanged; renderer-owned existing markup is idempotent while newly appended math is still enhanced. Unknown or malformed notation falls back to readable escaped text, with bounded nesting/token/source limits and no runtime library or HTML execution. A scoped `#app` DOM fallback uses the same parser only as a safety net for dynamic student UI that bypasses the shared helper accidentally.

The fallback is not a replacement for using the shared math renderer in the main Learning, Exam, and review code paths.

## Required deterministic guard

The GitHub Actions `QA Gate` must run all of the following on every PR targeting `main`:

1. `node tests/static-qa.mjs`
2. `node tests/math-rendering-guard.mjs`
3. `node tests/math-direction.mjs`
4. `node tests/exam-v2-api.mjs`
5. `node tests/smoke.mjs`
6. `node tests/math-direction-browser.mjs`
7. existing performance and Arabic-copy smoke checks

`tests/math-rendering-guard.mjs` protects the architecture itself: load order, shared renderer use on Learning/Exam/history surfaces, LTR isolation, numeric inputs, required regression corpus, and real-mode smoke coverage.

## Required real-browser coverage

The mobile Playwright smoke must exercise the actual runtime flows with mocked backend APIs so no learner data is modified:

- Learning Mode question and math option
- Learning feedback/explanation
- Learning completed review
- Exam Mode question and math option
- Exam submitted result/review
- learner answer, correct answer, and explanation in review

A synthetic DOM probe is useful as a low-level regression but is **not sufficient by itself**.

## Regression corpus

At minimum, deterministic tests must retain:

- `19 - (-7)`
- `(-7) - 19`
- `-7 + 19`
- `19 + (-7)`
- `-21 - (-6)`
- `-26`
- `(1/2 + 3/4) × 2 = 2.5`
- `(-3)^2 + sqrt(16) = 13`
- `2² + 3³ = 35`
- `\\frac{1}{2} + \\sqrt{9} ≥ 3.5`

`tests/math-typesetting.unit.mjs` additionally protects operator families, safe invalid/oversized input, ordinary learner languages, and partial already-rendered content. The low-level browser regression checks actual fraction stacking, raised exponents, radical bars, complete-source labels and no overflow on mobile and desktop; actual Learning/Exam/review smoke remains required.

## Review gate

CodeRabbit must treat this invariant as review-critical. Changes to math rendering, Learning, Exam, review, or the guard/tests must not weaken the invariant or remove real-flow coverage merely to make CI pass.

The repository PR checklist must explicitly ask whether Math/RTL rendering is affected and whether the invariant and real-mode browser regressions were checked.

## Production verification

For a math/RTL rendering change, after merge and GitHub Pages deployment, first verify the deployed build/assets through direct deployment or HTTP checks. The required GitHub Actions browser smoke remains the automated Playwright coverage for the invariant. Use an approved local interactive browser connector selected by required capability on the live site only when a browser-rendered production check is still needed and no structured tool or existing automated evidence can prove it. Connector display-name drift alone is not a blocker when another approved local connector exposes the required capabilities. If used, confirm representative math retains LTR order inside the RTL document, and do not modify a real learner attempt solely to perform this verification.

## GitHub enforcement

Repository ruleset **`Protect main`** is active on the default branch and requires pull requests plus the GitHub Actions checks **`Static quality`** and **`Browser smoke`**. Force/non-fast-forward updates and branch deletion are also blocked. There are no bypass actors for the connected user.

Because `Static quality` now contains `tests/math-rendering-guard.mjs`, breaking or removing the math architecture invariant makes that required status check fail; because `Browser smoke` exercises actual Learning, Exam, and review flows, a visual/runtime bidi regression also blocks the merge. This is server-side enforcement, not only documentation.

CodeRabbit remains a separate exact-head review gate defined by project policy and the PR checklist. The current ruleset does not list CodeRabbit as a required GitHub status check, so its exact-head completion must still be verified before merge under `docs/qa-policy.md`.
