## Summary

Describe what changed and why.

## Feature specification

For every non-trivial feature/behavior/data/security change, pin the exact Drive Feature Spec used by implementation and QA. Use N/A only for truly trivial changes.

- Feature Spec ID: `<FLH-FEAT-YYYY-NNN or N/A>`
- Spec version: `<vX.Y or N/A>`
- Canonical Drive URL:
- Spec status at implementation start: READY_FOR_IMPLEMENTATION / N/A
- Requirement changed after implementation started: yes / no / N/A
- If yes, new pinned spec version:
- Codex implemented against this pinned spec: yes / no / N/A
- TestSprite received the same pinned spec / acceptance criteria: yes / no / N/A

A Drive edit does not silently change this PR's contract. If observable requirements change after implementation starts, publish/pin a new spec version and rerun affected implementation/QA against it.

## User impact

- Student flow affected: yes / no
- Parent flow affected: yes / no
- Data/access rules affected: yes / no
- Learning or exam behavior affected: yes / no
- Math/RTL rendering affected: yes / no
- Production deployment required: yes / no
- Database migration required: yes / no
- Security/authorization boundary affected: yes / no

## Testing strategy

Classify the risk changed by this PR and declare the test layer(s) selected. Use N/A with a short reason instead of adding meaningless tests.

- Change type(s): pure/business logic / API-contract / database-RLS / UI-browser / bug-regression / docs-copy / other
- Unit tests: added / updated / existing coverage sufficient / N/A — reason:
- Integration/contract tests: added / updated / existing coverage sufficient / N/A — reason:
- Playwright/browser tests: added / updated / existing coverage sufficient / N/A — reason:
- Regression test for a bug: added / existing test reproduced it / N/A — reason:
- TestSprite exploratory run against the pinned Feature Spec: required / optional / N/A — spec version + reason:

For an important bug, prefer a deterministic regression at the lowest reliable layer that reproduces the failure.

## QA checklist

- [ ] The change follows `AGENTS.md`, `docs/architecture.md`, `docs/qa-policy.md`, and `docs/math-rendering-invariant.md` where applicable.
- [ ] For non-trivial work, Codex and TestSprite used the same pinned Feature Spec ID/version; any material requirement change created a new spec version rather than silently moving the target. (Or N/A with reason.)
- [ ] Any reproducible product defect found by TestSprite gained deterministic regression coverage at the lowest reliable layer when practical, or the N/A reason is explicit.
- [ ] The change is data-driven; no learner, grade, book, or quiz access was hard-coded unnecessarily. (Mark N/A with a note if documentation-only.)
- [ ] Learner content isolation still works: one learner cannot see another learner's assigned content. (Or N/A with reason.)
- [ ] Student hierarchy remains clear: program or standalone book → book → unit → Learning/Exam. (Or N/A with reason.)
- [ ] Learning Mode still saves/resumes correctly and does not count an unconfirmed first tap as an answer. (Or N/A with reason.)
- [ ] Exam Mode still autosaves, allows review/flagging, and does not reveal correctness before submission. (Or N/A with reason.)
- [ ] Arabic/RTL copy was checked; no unintended English UI labels or reversed school-year text were introduced. (Or N/A with reason.)
- [ ] Math rendering invariant checked: Arabic UI remains RTL while mathematical expressions, negative values, math options, learner/correct answers, explanations, and numeric/decimal inputs preserve LTR mathematical order via the shared renderer/bidi-isolation layer. Stored data was not reversed to solve direction. (Or N/A with reason.)
- [ ] If Math/RTL rendering changed, actual Learning Mode, Exam Mode, and completed/review flows are covered by deterministic browser regression; synthetic DOM-only coverage is not sufficient. (Or N/A with reason.)
- [ ] Mobile interaction and touch targets were considered. (Or N/A with reason.)
- [ ] The selected test layer(s) match the risk changed by this PR; tests were added/updated where appropriate, or the N/A reason is explicit.
- [ ] Existing assertions were not weakened merely to make QA pass.
- [ ] Playwright screenshot evidence was captured for each meaningful user-facing UI change, or marked N/A with reason. Evidence is stored as a temporary GitHub Actions artifact under `playwright-screenshots/`, not committed to repository history, with seven-day retention.
- Validated PR-head SHA for every required pre-merge gate: `<sha>`
- [ ] QA Gate / Static quality passed for the exact PR-head SHA recorded above.
- [ ] QA Gate / Browser smoke passed for the exact same PR-head SHA recorded above.
- [ ] CodeRabbit review completed for the exact same PR-head SHA; all actionable findings are fixed or explicitly resolved with a verified architectural reason.
- [ ] If the PR-head SHA changed after any required result, Static quality, Browser smoke, and CodeRabbit review were all rerun/re-reviewed for the new SHA and the recorded SHA above was updated.
- [ ] Production deployment steps are documented below, or explicitly marked N/A.
- [ ] Database migration steps and reconciliation requirements are documented below, or explicitly marked N/A.
- [ ] Production verification plan is documented below, or explicitly marked N/A.

## Production deployment

- Required: yes / no
- Deployment target / identifier:
- Steps or N/A reason:

## Database migration

- Required: yes / no
- Migration identity / filename, or N/A reason:
- Existing-production vs fresh-database state checked: yes / no / N/A
- `supabase_migrations.schema_migrations` reconciled when applicable: yes / no / N/A
- If production drift exists, new forward reconciliation migration used: yes / no / N/A
- Apply/rollback notes:

## Production verification

- Required: yes / no
- Exact production checks to perform after merge, or N/A reason:
- Playwright screenshot evidence link / artifact name, or N/A reason:

### Post-merge completion record

Do not describe delivery as complete until this record is filled when production verification is required.

- Status: pending / completed / N/A
- Result:
- Timestamp (UTC):
- Verifier:
- Deployment / migration identifier:
- Evidence link or exact evidence reference:
- Screenshot artifact / evidence link, or N/A reason:

## Notes for reviewer

Call out migrations, API changes, security/authorization boundaries, risky assumptions, testing tradeoffs, production-state drift, math/RTL rendering surfaces, missing screenshot evidence, or anything that deserves extra attention.
