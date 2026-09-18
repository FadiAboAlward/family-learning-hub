# Family Learning Hub — Agent Instructions

These instructions apply to the whole repository.

## Canonical references

Before making a non-trivial product, data, security, quiz, exam, learner, parent, runtime, or QA change, read and follow:

- `docs/architecture.md` — product and data architecture source of truth.
- `docs/qa-policy.md` — testing, review, merge, deployment, and production-verification policy.
- `docs/feature-spec-workflow.md` — Drive Feature Spec pinning and Codex/TestSprite handoff protocol.
- `docs/math-rendering-invariant.md` — mandatory RTL/LTR math-rendering invariant for learner-facing math surfaces.
- `docs/paper-exam-workflow.md` — canonical workflow for generating, approving, printing, scanning, and ingesting paper exams into learner history.
- `docs/pdf-generation-standard.md` — canonical fixed-layout PDF authoring and render-QA standard for exams, worksheets, and other printable artifacts.

If implementation and documentation disagree, do not silently choose one. Verify the live architecture and update the stale side in the same change when appropriate.

## Tool routing and Playwright scope

Use the fastest reliable structured tool for the job. Prefer repository/GitHub operations, APIs, CLIs, MCPs/plugins/connectors, database/backend tools, and GitHub Actions over interactive browser automation when they can prove or perform the same action more directly.

The dedicated **Family Learning Hub Playwright** MCP is a browser QA/fallback tool, not the default operational tool for the project. Use it when the behavior being verified is genuinely browser-rendered or interaction-dependent, or when no suitable structured API/MCP/plugin/CLI exists. Do not use it for repository edits, settings changes, deployment checks, data inspection, or CI operations when a direct structured tool is available.

This rule does **not** reduce automated Playwright coverage in GitHub Actions. The repository's deterministic Playwright browser smoke remains part of the required QA Gate. If live browser interaction is truly required for Family Learning Hub, use the dedicated Family Learning Hub Playwright rather than Browserbase or a generic browser service.

## Feature specification and Codex/TestSprite handoff

For every non-trivial feature, behavior/workflow change, data/security change, or meaningful bug fix, use a versioned Feature Spec before implementation. Truly trivial copy/metadata changes may be marked N/A.

- The canonical product/behavior requirement lives in Google Drive: `My Drive / Family Learning Hub / System & SOP / Feature Specs`.
- Each spec has a stable `FEATURE_ID` and semantic `SPEC_VERSION`.
- Before coding, pin `FEATURE_ID`, `SPEC_VERSION`, `SPEC_URL`, and the Drive `SPEC_REVISION_ID` in the GitHub Issue/PR. The PR implements that exact pinned contract even if the Drive document later changes.
- Codex is the primary implementer. It must read the pinned spec before changing code and must not infer requirements only from the current implementation when a spec exists.
- Material requirement changes after implementation starts require a new spec version and a new pin; affected implementation and QA must be re-evaluated against the new version.
- TestSprite is the requirement-aware exploratory verifier used from the Codex workflow when the change benefits from browser/API E2E validation. Feed TestSprite the same pinned spec/acceptance criteria as its PRD or plan source; do not let it infer intent from code alone when a spec exists.
- A reproducible TestSprite defect should become a deterministic regression test at the lowest reliable layer when practical.
- Do not maintain one global “current feature” pointer. Each branch/PR carries its own pin so parallel features cannot cross-contaminate requirements.

See `docs/feature-spec-workflow.md` for the handoff sequence and TestSprite usage.

## Test selection is part of implementation

For every behavior change, explicitly choose the smallest useful test layer(s). Do not write a unit test for every function mechanically.

- **Unit test:** use for non-trivial pure or isolatable business logic, validation, parsing, authorization decisions, scoring/grading logic, state transitions, and error handling when practical.
- **Integration/contract test:** use for meaningful database, Supabase, RLS, API-boundary, persistence, migration, or cross-module behavior when a unit test alone cannot prove the boundary.
- **Browser/E2E test (Playwright):** use for important user-visible student/parent flows, mobile interaction, navigation, Learning Mode, Exam Mode, review/completion behavior, and rendered-state behavior.
- **Regression test:** for an important bug, add a deterministic test that reproduces the failure with the fix whenever practical. Put it at the lowest layer that reliably catches the bug.
- **Targeted regressions:** RTL/math directionality, learner-content isolation, server-authoritative grading, autosave/resume, and mobile touch behavior must keep dedicated regression coverage when changed.
- **No-test changes:** documentation-only, copy-only, or trivial pass-through changes may legitimately need no new test, but the PR must state why.

Prefer a few high-value deterministic tests over broad brittle tests. Never weaken an assertion merely to make CI pass.

Convention-based unit tests belong under `tests/*.unit.mjs`; GitHub Actions discovers and runs them automatically.

## Test data and evidence

Use the dedicated `test` learner for automated or exploratory learner activity. Do not contaminate Aya or Mohammad's real progress, rewards, mastery, or reporting.

For meaningful user-facing UI changes, preserve the repository's temporary Playwright screenshot-evidence policy. Never expose credentials, cookies, tokens, learner access codes, or other sensitive data in screenshots, logs, DOM output, or reports.

## Delivery workflow

Default non-trivial workflow:

`pinned Feature Spec → branch/PR → implement with Codex → choose/update deterministic tests → TestSprite when relevant → QA Gate → CodeRabbit on exact PR-head SHA → fix/re-run on new SHA → merge → deploy/migrate if required → production verification + evidence`

If CodeRabbit automatic review is unavailable, trigger the review manually. Service rate limits do not waive the exact-SHA review requirement.

Do not describe work as complete before required production verification is actually completed.

## Additional AI QA

TestSprite, when connected, is an additive AI/exploratory QA layer. It does not replace deterministic unit, integration, Playwright, GitHub Actions, or CodeRabbit checks. Use the dedicated test learner and treat reproducible TestSprite defects as normal bugs that should gain deterministic regression coverage where practical.
