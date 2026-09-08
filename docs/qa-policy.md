# Family Learning Hub — QA, Review, Merge, and Production Verification Policy

## Canonical delivery workflow

For any non-trivial change that can affect learner behavior, content delivery, authentication, security, data, database schema, quizzes, exams, parent reporting, or production runtime, the default workflow is:

1. Create a dedicated branch and Pull Request. Do not make the change directly on `main` unless it is a true emergency recovery action.
2. Select the appropriate test layer(s) for the behavior being changed and add/update those tests in the PR.
3. Run the deterministic GitHub Actions `QA Gate` on the PR.
4. Require both deterministic jobs to pass:
   - `Static quality`
   - `Browser smoke`
5. Run CodeRabbit review on the current PR-head commit.
6. Inspect every actionable CodeRabbit comment. Do not treat a green QA Gate as proof that the change is ready if CodeRabbit has unresolved actionable findings.
7. Fix valid findings. If a finding does not apply to the actual architecture, document the reason clearly in the review thread and resolve it only after verifying the architecture.
8. Record the exact PR-head commit SHA covered by `Static quality`, `Browser smoke`, and CodeRabbit. If the PR-head SHA changes for any reason, rerun all three required pre-merge gates against the new SHA and replace the recorded SHA.
9. Merge only when:
   - `Static quality`, `Browser smoke`, and CodeRabbit review all cover the exact same current PR-head SHA;
   - all actionable CodeRabbit findings are fixed or explicitly resolved with a verified architectural reason;
   - the PR description/checklist accurately reflects user impact, selected testing layers, QA status, migrations, security boundaries, deployment risks, and the production verification plan.
10. Perform any required production deployment and any required database migration as separate operations. A merged PR alone is not proof that production is updated.
11. Verify production directly after deployment/migration. Check the actual production state, not only the repository state.
12. Record production verification completion and evidence, including the result and, as applicable, timestamp, verifier, deployment/migration identifier, and evidence link or exact evidence reference.
13. Only then describe the work as complete.

In short:

`PR → select/update tests → exact-SHA QA Gate → exact-SHA CodeRabbit → fix findings → rerun all gates on any new head SHA → merge → deploy/migrate → production verification + evidence`

Partial completion must be described accurately. For example, say "merged but not yet verified in production" instead of "done".

## Testing strategy and test selection

Testing is part of implementation, not a final afterthought. The project does **not** require a unit test for every function. Each behavior change should use the smallest deterministic test layer that proves the important risk, with additional layers when the boundary itself matters.

### Unit tests

Add or update unit tests for non-trivial pure or isolatable logic when practical, especially:

- parsing and validation;
- authentication/authorization decisions that can be isolated;
- scoring, grading, mastery, reward, or state-transition logic;
- action dispatch and input-shape handling;
- error mapping and failure behavior;
- configuration-driven business rules.

Do not create low-value tests for trivial getters, pass-through wrappers, constants, or implementation details with no meaningful behavior.

### Integration / contract tests

Add or update integration/contract coverage when correctness depends on a boundary that a unit test cannot prove, especially:

- Supabase table/query behavior;
- Row Level Security and learner/workspace isolation;
- persistence and resume/autosave behavior;
- Edge Function/API contracts;
- database migrations, grants, constraints, or production-sensitive schema behavior;
- interactions across modules where mocking would hide the real failure mode.

Where useful, combine integration coverage with unit tests for extracted logic so failures remain easy to diagnose.

### Browser / E2E tests

Use Playwright browser coverage for important user-visible behavior, including:

- student and parent navigation;
- mobile interaction and touch behavior;
- learner-content isolation visible through the UI;
- Learning Mode behavior, hints, confirmation, save/resume;
- Exam Mode autosave, review/flagging, submission, and no correctness disclosure before submission;
- rendered Arabic/RTL behavior and mathematical directionality when the browser layout is part of the risk.

Keep browser tests focused on high-value flows. Do not move logic assertions into E2E tests when a faster lower-level test can prove them more reliably.

### Regression rule for bugs

For an important defect, add a deterministic regression test that reproduces the failure before/with the fix whenever practical. Put the regression at the **lowest reliable layer** that would have caught the bug:

- pure logic bug → unit regression;
- data/RLS/API boundary bug → integration/contract regression;
- rendered interaction/navigation bug → Playwright/browser regression.

A bug fix without a new test is acceptable only when reproduction is not practical or the existing suite already catches the defect; the PR must explain the reason.

### Dedicated high-risk regressions

Changes affecting these areas must preserve targeted coverage:

- learner-content isolation;
- authentication and authorization boundaries;
- server-authoritative grading/results;
- Learning vs Exam behavior;
- autosave/resume and duplicate-action protection;
- Arabic/RTL copy and math directionality;
- mobile touch behavior;
- migration and production-state reconciliation where applicable.

### No-test changes

Documentation-only, copy-only, or genuinely trivial pass-through changes may require no new test. The PR must mark the test choice as N/A and explain why rather than adding meaningless coverage.

## Required deterministic QA

Every pull request targeting `main` must run the GitHub Actions workflow `QA Gate`.

The merge-blocking checks should be:

- `Static quality`
- `Browser smoke`

`Static quality` checks JavaScript syntax, runtime references, Arabic/RTL shell requirements, known copy regressions, legacy runtime guards, school-year formatting, merge markers, repository-defined static safety invariants, and server-side unit tests currently wired into the gate.

`Browser smoke` runs the mobile Playwright flow and rendered Arabic copy QA. It protects the student hierarchy, learning/exam behavior, learner content isolation, direct standalone-book assignment, parent progressive disclosure, activity filters, mobile interactions, and question references.

Both deterministic checks must be tied to the same exact PR-head commit SHA used for the CodeRabbit review. A passing result from an older head is stale and cannot be reused after any push changes the PR-head SHA.

## Merge rule

Do not merge to `main` while either required deterministic check is failing or pending, while CodeRabbit has unresolved actionable findings, or while the required pre-merge results do not all cover the exact current PR-head SHA.

GitHub repository Rulesets/Branch Protection should enforce the two deterministic checks above. The repository workflow alone runs QA; the GitHub rule is what actually blocks a red merge. The exact-SHA CodeRabbit requirement remains a documented review gate unless GitHub can enforce it directly with a stable status check.

Recommended ruleset settings:

- Target: default branch (`main`)
- Enforcement: Active
- Require a pull request before merging: On
- Require status checks to pass before merging: On
- Required checks: `Static quality`, `Browser smoke`
- Block force pushes: On
- Require branches to be up to date before merging: Off initially, to avoid unnecessary duplicate QA runs for this small repository. Revisit if concurrent development increases.

## CodeRabbit review layer

CodeRabbit is an additional review gate for non-trivial changes, but it is not a replacement for deterministic QA.

The repository `.coderabbit.yaml` should review against the canonical repository rules in `AGENTS.md`, `docs/architecture.md`, and this policy. It should specifically review for:

- child-facing mobile/RTL regressions;
- learner content isolation;
- data-driven access instead of hard-coded users/content;
- server-authoritative grading and saved state;
- Learning vs Exam behavior;
- security, RLS, and database integrity risks;
- QA-test weakening or GitHub Actions bypasses;
- architecture/documentation drift;
- **test-selection quality**: whether the PR added the appropriate unit, integration/contract, browser, or regression coverage for the risk it changed;
- important bug fixes that should gain deterministic regression coverage but do not;
- over-testing that adds brittle low-value assertions rather than protecting behavior.

CodeRabbit should not mechanically demand unit tests for every function. It should judge the behavior/risk using the testing strategy above.

Rules for CodeRabbit findings:

- Never claim CodeRabbit review completed until its current review actually completed.
- Never claim "0 issues" while a review is still processing.
- Record the exact PR-head SHA covered by the CodeRabbit result.
- Require `Static quality`, `Browser smoke`, and CodeRabbit to cover one identical PR-head SHA before merge.
- If the PR-head SHA changes after any of those results, all three required pre-merge gates must run again for the new SHA; do not use subjective exceptions such as "meaningful change" or "latest relevant head."
- Treat actionable findings as blockers until fixed or explicitly shown to be inapplicable to the real architecture.
- Do not blindly apply suggested patches; verify each suggestion against the repository and production architecture.
- If CodeRabbit is temporarily unavailable, say so explicitly. Do not relabel a manual review as a CodeRabbit review.

The `family-learning-hub` repository is public. The project must not depend on paid/Advanced-only CodeRabbit features for its core safety process. Baseline public-repository review may be used, while deterministic GitHub Actions remain the durable required checks.

## TestSprite / AI exploratory QA layer

TestSprite, once connected to the Family Learning Hub workflow, is an **additional exploratory/AI QA layer**. It does not replace unit tests, integration/contract tests, Playwright, GitHub Actions, CodeRabbit, or direct production verification.

Operating rules:

- Use the dedicated `test` learner for automated learner activity; do not pollute Aya or Mohammad's real progress, rewards, mastery, or reporting.
- Use TestSprite especially for major feature changes, high-risk flows, and periodic broader regression/exploration where AI-generated coverage can discover cases not explicitly encoded in deterministic tests.
- Do not make TestSprite a required merge blocker until the integration is connected, stable, repeatable enough for CI use, and its cost/credit behavior is understood.
- A reproducible defect discovered by TestSprite should be treated as a normal product bug and should gain deterministic regression coverage at the appropriate layer whenever practical.
- If TestSprite reports a non-reproducible or flaky issue, investigate it, but do not weaken deterministic tests to accommodate it.

## Production deployment and database migration

Production deployment and database migration are separate requirements and must not be represented by one combined yes/no field.

For a production deployment, record:

- whether deployment is required;
- the target/service and deployment identifier when available;
- the exact deployment steps or the reason deployment is N/A.

For a database migration, record:

- whether a migration is required;
- the exact migration identity/filename;
- whether existing production state differs from a fresh database;
- reconciliation with `supabase_migrations.schema_migrations` when applicable;
- the forward migration used to correct production drift rather than rewriting previously applied migration history;
- any apply/rollback notes needed for safe execution.

## Production verification

Repository success and production success are separate states.

After merge, verify whichever production systems the change touches. Examples:

- GitHub Pages: confirm the merged asset/script is actually served and the relevant UI flow works.
- Supabase migrations: confirm the exact migration identity is recorded/applied and inspect the resulting schema/function/data state.
- Edge Functions: confirm the deployed function matches the reviewed source behavior and record the deployment identifier when available.
- Authentication changes: verify the intended credential/login path succeeds and old supported paths still behave as intended.
- Quiz/Exam changes: confirm Learning and Exam pools, question counts, isolation, saved state, grading, flagging, and retry/concurrency behavior in production.
- Security changes: verify actual grants/roles/permissions in production rather than assuming the migration applied them.

When repository migration history and production state differ because production previously applied an older migration version, do not rewrite applied history. Prefer a new forward reconciliation migration, review it through the same PR/QA/CodeRabbit process, apply it, and then verify production.

A production verification plan written before merge is not completion evidence. Before describing delivery as complete, record the post-merge verification result and supporting evidence, including as applicable:

- completion status;
- verification result;
- timestamp;
- verifier;
- deployment or migration identifier;
- evidence link or an exact evidence reference when no link exists.

## UX research layer

After major navigation or interaction changes, run an AI/usability test (for example Uxia) as an additional product-quality review. This is intentionally not required on every PR because usability-agent runs are slower and less deterministic than Playwright.

Examples of changes that deserve UX-agent review:

- new student navigation hierarchy;
- major Learning/Exam interaction changes;
- new parent dashboard information architecture;
- onboarding/login redesign;
- substantial mobile layout changes.

## Pull request discipline

Every PR should explain its user impact, explicitly declare the test layer(s) selected for the change, and complete the repository PR checklist. When behavior changes, update or add deterministic tests in the same PR rather than weakening existing assertions.

For schema/data/runtime changes, the PR should also state:

- whether a production deployment is required and how it will be performed;
- whether a database migration is required, its exact identity, and how production migration history will be reconciled;
- whether existing production state may differ from a fresh database;
- security/authorization boundaries touched by the change;
- the exact production verification that will be performed after merge;
- after merge, the production verification result and evidence before delivery is described as complete.
