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

`app.js` provides the base `math()` formatting helper. `math-direction-v1.js` loads immediately after it and wraps the shared renderer before Learning, Exam, and review runtimes load. Mathematical runs are emitted as isolated LTR `bdi` elements. A scoped `#app` DOM fallback is retained only as a safety net for dynamic student UI that bypasses the shared helper accidentally.

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

## Review gate

CodeRabbit must treat this invariant as review-critical. Changes to math rendering, Learning, Exam, review, or the guard/tests must not weaken the invariant or remove real-flow coverage merely to make CI pass.

The repository PR checklist must explicitly ask whether Math/RTL rendering is affected and whether the invariant and real-mode browser regressions were checked.

## Production verification

For a math/RTL rendering change, after merge and GitHub Pages deployment, verify the live site using Family Learning Hub Playwright. Confirm the new production build is served and that representative math retains LTR order inside the RTL document. Do not modify a real learner attempt solely to perform this verification.

## GitHub enforcement

Repository ruleset **`Protect main`** is active on the default branch and requires pull requests plus the GitHub Actions checks **`Static quality`** and **`Browser smoke`**. Force/non-fast-forward updates and branch deletion are also blocked. There are no bypass actors for the connected user.

Because `Static quality` now contains `tests/math-rendering-guard.mjs`, breaking or removing the math architecture invariant makes that required status check fail; because `Browser smoke` exercises actual Learning, Exam, and review flows, a visual/runtime bidi regression also blocks the merge. This is server-side enforcement, not only documentation.

CodeRabbit remains a separate exact-head review gate defined by project policy and the PR checklist. The current ruleset does not list CodeRabbit as a required GitHub status check, so its exact-head completion must still be verified before merge under `docs/qa-policy.md`.
