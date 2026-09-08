# Family Learning Hub — Agent Instructions

These instructions apply to the whole repository.

## Canonical references

Before making a non-trivial product, data, security, quiz, exam, learner, parent, or runtime change, read and follow:

- `docs/architecture.md` — product and data architecture source of truth.
- `docs/qa-policy.md` — testing, review, merge, deployment, and production-verification policy.

If implementation and documentation disagree, do not silently choose one. Verify the live architecture and update the stale side in the same change when appropriate.

## Test selection is part of implementation

For every behavior change, explicitly choose the smallest useful test layer(s). Do not write a unit test for every function mechanically.

- **Unit test:** required for non-trivial pure or isolatable business logic, validation, parsing, authorization decisions, scoring/grading logic, state transitions, and error handling when practical. New standalone Node unit-test files should use `tests/*.unit.mjs`; the QA Gate auto-runs that convention.
- **Integration/contract test:** required for meaningful database, Supabase, RLS, API-boundary, persistence, migration, or cross-module behavior when a unit test alone cannot prove the boundary.
- **Browser/E2E test (Playwright):** required for important user-visible student/parent flows, mobile interaction, navigation, Learning Mode, Exam Mode, and UI behavior that depends on rendered state.
- **Regression test:** for an important bug, add a test that reproduces the failure before/with the fix whenever practical. Put it at the lowest layer that reliably catches the bug.
- **Targeted regressions:** RTL, mathematical directionality, learner-content isolation, server-authoritative grading, autosave/resume, and mobile touch behavior must keep dedicated regression coverage when changed.
- **No-test changes:** documentation-only, copy-only, or trivial pass-through changes may legitimately need no new test, but the PR must state why.

Prefer a few high-value deterministic tests over broad brittle tests. Never weaken an assertion merely to make CI pass.

## Test data

Use the dedicated `test` learner for automated or exploratory learner activity. Do not contaminate Aya or Mohammad's real progress, rewards, mastery, or reporting.

## Delivery workflow

Default non-trivial workflow:

`branch/PR → choose/update tests → QA Gate → CodeRabbit on exact PR-head SHA → fix/re-run on new SHA → merge → deploy/migrate if required → production verification + evidence`

Do not describe work as complete before required production verification is actually completed.

## Additional AI QA

TestSprite, when connected, is an additive AI/exploratory QA layer. It does not replace deterministic unit, integration, Playwright, GitHub Actions, or CodeRabbit checks. Use the dedicated test learner and treat reproducible TestSprite defects as normal bugs that should gain deterministic regression coverage where practical.
