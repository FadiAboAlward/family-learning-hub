# Family Learning Hub — QA, Review, Merge, and Production Verification Policy

## Canonical delivery workflow

For any non-trivial change that can affect learner behavior, content delivery, authentication, security, data, database schema, quizzes, exams, parent reporting, or production runtime, the default workflow is:

1. Create a dedicated branch and Pull Request. Do not make the change directly on `main` unless it is a true emergency recovery action.
2. Select the test layer(s) that match the risk changed by the PR and add/update deterministic coverage where appropriate.
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
   - the PR description/checklist accurately reflects user impact, selected test layers, QA status, migrations, security boundaries, deployment risks, and the production verification plan.
10. Perform any required production deployment and any required database migration as separate operations. A merged PR alone is not proof that production is updated.
11. Verify production directly after deployment/migration. Check the actual production state, not only the repository state.
12. Record production verification completion and evidence, including the result and, as applicable, timestamp, verifier, deployment/migration identifier, and evidence link or exact evidence reference.
13. Only then describe the work as complete.

In short:

`PR → choose/update tests → exact-SHA QA Gate → exact-SHA CodeRabbit → fix findings → rerun all gates on any new head SHA → merge → deploy/migrate → production verification + evidence`

Partial completion must be described accurately. For example, say "merged but not yet verified in production" instead of "done".

## Required deterministic QA

Every pull request targeting `main` must run the GitHub Actions workflow `QA Gate`.

The merge-blocking checks should be:

- `Static quality`
- `Browser smoke`

`Static quality` checks JavaScript syntax, runtime references, Arabic/RTL shell requirements, known copy regressions, legacy runtime guards, school-year formatting, merge markers, repository-defined static safety invariants, the math-rendering architecture guard, the existing Exam API unit suite, and any convention-based `tests/*.unit.mjs` tests.

`Browser smoke` runs the mobile Playwright flow and rendered Arabic copy QA. It protects the student hierarchy, learning/exam behavior, learner content isolation, direct standalone-book assignment, parent progressive disclosure, activity filters, mobile interactions, question references, real browser math-direction behavior, authenticated Testing-learner coverage, and temporary visual evidence capture for meaningful UI changes.

Both deterministic checks must be tied to the same exact PR-head commit SHA used for the CodeRabbit review. A passing result from an older head is stale and cannot be reused after any push changes the PR-head SHA.

## Testing strategy and test-layer selection

Test selection is part of implementation. The goal is not to write a unit test for every function; the goal is to use the smallest reliable deterministic layer that proves the behavior at risk.

### Unit tests

Use focused unit tests for non-trivial pure or isolatable logic when practical, especially:

- business rules and scoring/grading logic;
- parsing and validation;
- authorization decisions that can be isolated from transport/database code;
- state transitions and retry/error handling;
- helpers whose incorrect output would materially affect learner progress, access, or reporting.

Do not mechanically test trivial getters, pass-through wrappers, framework glue, or implementation details that provide no meaningful regression protection.

New convention-based unit tests should use `tests/*.unit.mjs`. GitHub Actions discovers and executes these automatically. Existing named suites may remain in place when they are already part of the QA Gate.

### Integration and contract tests

Use integration/contract coverage when correctness depends on a real boundary that mocks cannot prove, especially:

- Supabase and database behavior;
- Row Level Security and grants;
- authenticated API contracts;
- persistence and cross-module data flow;
- migrations and production-state reconciliation;
- interactions where a mocked unit test could pass while the real database/API contract is broken.

Unit tests and mocks may complement these tests but must not be treated as proof of a real RLS/database boundary.

### Browser and E2E tests

Use Playwright/browser tests for important user-visible flows and rendered-state behavior, including:

- student and parent navigation;
- Learning Mode and Exam Mode behavior;
- autosave/resume/review flows;
- mobile interactions and accidental double-action risks;
- RTL/math rendering and directionality;
- flows that require the browser, DOM, or actual interaction sequence to expose the defect.

Automated authenticated learner activity must use the dedicated `test` learner rather than Aya or Mohammad so real progress, mastery, rewards, and parent reporting remain clean.

### Regression rule for bugs

For an important bug, add a deterministic regression test that reproduces the failure with the fix whenever practical. Put it at the lowest reliable layer that catches the actual defect:

- logic bug → usually unit test;
- API/RLS/persistence bug → usually integration/contract test;
- interaction/rendering bug → usually Playwright/browser regression.

If existing deterministic coverage already reproduces the bug, strengthen or retain that coverage rather than duplicating tests. If a regression test is impractical, the PR must state why.

### No-test changes

Documentation-only, copy-only, metadata-only, or truly trivial pass-through changes may need no new test. The PR must state the N/A reason explicitly rather than adding meaningless assertions.

### Additional AI/exploratory testing

TestSprite, when connected, is an additive AI/exploratory QA layer. It does not replace deterministic unit, integration/contract, Playwright, GitHub Actions, or CodeRabbit checks and is not a merge blocker until the integration is proven stable enough to be promoted deliberately.

Use the dedicated `test` learner for TestSprite activity. A reproducible defect discovered by TestSprite should be treated as a normal product bug and should gain deterministic regression coverage at the lowest reliable layer when practical.

## Playwright screenshot evidence

For user-facing UI changes, the QA process should produce human-viewable Playwright screenshots in addition to machine assertions whenever the visual result is meaningful to the user.

- CI screenshot files are written only to the runtime folder `playwright-screenshots/`.
- The folder is uploaded as a GitHub Actions artifact named `playwright-screenshots-<run-id>`.
- The workflow must use `retention-days: 7` so screenshots expire automatically after seven days.
- Do not commit transient QA screenshots or the `playwright-screenshots/` folder to repository history. Git history is permanent and is the wrong storage mechanism for temporary evidence.
- Screenshot capture must never expose passwords, learner access codes, tokens, cookies, authorization headers, or other credentials.
- PR/browser smoke screenshots should normally use mocked test data so evidence is reproducible and does not modify real learner data.
- For a production verification that uses Family Learning Hub Playwright, capture only the minimum non-sensitive after-state needed to demonstrate the change. When an ephemeral GitHub artifact is available, link that artifact/run in the PR and user-facing completion report.
- If a change is backend-only or has no meaningful visual surface, screenshot evidence may be marked N/A with a short reason.

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

The repository `.coderabbit.yaml` asks CodeRabbit to review for:

- child-facing mobile/RTL regressions;
- learner content isolation;
- data-driven access instead of hard-coded users/content;
- server-authoritative grading and saved state;
- Learning vs Exam behavior;
- correct selection of unit, integration/contract, browser, and regression coverage;
- missing regression protection for important bug fixes;
- QA-test weakening or GitHub Actions bypasses;
- math-rendering invariant violations;
- architecture/documentation drift;
- security and database integrity risks.

`AGENTS.md` is the concise repository-wide development contract. `docs/architecture.md`, `docs/qa-policy.md`, and `docs/math-rendering-invariant.md` are supplied to CodeRabbit as code-guideline knowledge so review comments can be evaluated against the same architecture developers are expected to follow.

Rules for CodeRabbit findings:

- Never claim CodeRabbit review completed until its current review actually completed.
- Never claim "0 issues" while a review is still processing.
- Record the exact PR-head SHA covered by the CodeRabbit result.
- Require `Static quality`, `Browser smoke`, and CodeRabbit to cover one identical PR-head SHA before merge.
- If the PR-head SHA changes after any of those results, all three required pre-merge gates must run again for the new SHA; do not use subjective exceptions such as "meaningful change" or "latest relevant head."
- Treat actionable findings as blockers until fixed or explicitly shown to be inapplicable to the real architecture.
- Do not blindly apply suggested patches; verify each suggestion against the repository and production architecture.
- If CodeRabbit automatic review is unavailable, manually trigger `@coderabbitai review` on the PR.
- A CodeRabbit service/rate limit does not waive the review gate. Record the external blocker accurately rather than relabeling a manual review as CodeRabbit.

The `family-learning-hub` repository is public. The project must not depend on paid/Advanced-only CodeRabbit features for its core safety process. Deterministic GitHub Actions remain the durable required checks even when CodeRabbit availability is temporarily constrained.

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
- evidence link or an exact evidence reference when no link exists;
- screenshot artifact/run link for meaningful UI changes, or an explicit N/A reason.

## UX research layer

After major navigation or interaction changes, run an AI/usability test (for example Uxia) as an additional product-quality review. This is intentionally not required on every PR because usability-agent runs are slower and less deterministic than Playwright.

Examples of changes that deserve UX-agent review:

- new student navigation hierarchy;
- major Learning/Exam interaction changes;
- new parent dashboard information architecture;
- onboarding/login redesign;
- substantial mobile layout changes.

## Pull request discipline

Every PR should explain its user impact, declare the selected testing strategy, and complete the repository PR checklist. When behavior changes, update or add deterministic tests in the same PR rather than weakening existing assertions.

For schema/data/runtime changes, the PR should also state:

- whether a production deployment is required and how it will be performed;
- whether a database migration is required, its exact identity, and how production migration history will be reconciled;
- whether existing production state may differ from a fresh database;
- security/authorization boundaries touched by the change;
- the exact production verification that will be performed after merge;
- after merge, the production verification result and evidence before delivery is described as complete.
