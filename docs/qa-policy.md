# Family Learning Hub — QA, Review, Merge, and Production Verification Policy

## Canonical delivery workflow

For any non-trivial change that can affect learner behavior, content delivery, authentication, security, data, database schema, quizzes, exams, parent reporting, or production runtime, the default workflow is:

1. Create a dedicated branch and Pull Request. Do not make the change directly on `main` unless it is a true emergency recovery action.
2. Run the deterministic GitHub Actions `QA Gate` on the PR.
3. Require both deterministic jobs to pass:
   - `Static quality`
   - `Browser smoke`
4. Run CodeRabbit review on the current PR-head commit.
5. Inspect every actionable CodeRabbit comment. Do not treat a green QA Gate as proof that the change is ready if CodeRabbit has unresolved actionable findings.
6. Fix valid findings. If a finding does not apply to the actual architecture, document the reason clearly in the review thread and resolve it only after verifying the architecture.
7. Record the exact PR-head commit SHA covered by `Static quality`, `Browser smoke`, and CodeRabbit. If the PR-head SHA changes for any reason, rerun all three required pre-merge gates against the new SHA and replace the recorded SHA.
8. Merge only when:
   - `Static quality`, `Browser smoke`, and CodeRabbit review all cover the exact same current PR-head SHA;
   - all actionable CodeRabbit findings are fixed or explicitly resolved with a verified architectural reason;
   - the PR description/checklist accurately reflects user impact, QA status, migrations, security boundaries, deployment risks, and the production verification plan.
9. Perform any required production deployment and any required database migration as separate operations. A merged PR alone is not proof that production is updated.
10. Verify production directly after deployment/migration. Check the actual production state, not only the repository state.
11. Record production verification completion and evidence, including the result and, as applicable, timestamp, verifier, deployment/migration identifier, and evidence link or exact evidence reference.
12. Only then describe the work as complete.

In short:

`PR → exact-SHA QA Gate → exact-SHA CodeRabbit → fix findings → rerun all gates on any new head SHA → merge → deploy/migrate → production verification + evidence`

Partial completion must be described accurately. For example, say "merged but not yet verified in production" instead of "done".

## Required deterministic QA

Every pull request targeting `main` must run the GitHub Actions workflow `QA Gate`.

The merge-blocking checks should be:

- `Static quality`
- `Browser smoke`

`Static quality` checks JavaScript syntax, runtime references, Arabic/RTL shell requirements, known copy regressions, legacy runtime guards, school-year formatting, merge markers, and repository-defined static safety invariants.

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

The repository `.coderabbit.yaml` asks CodeRabbit to review for:

- child-facing mobile/RTL regressions
- learner content isolation
- data-driven access instead of hard-coded users/content
- server-authoritative grading and saved state
- Learning vs Exam behavior
- QA-test weakening
- GitHub Actions bypasses
- architecture/documentation drift
- security and database integrity risks

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

- new student navigation hierarchy
- major Learning/Exam interaction changes
- new parent dashboard information architecture
- onboarding/login redesign
- substantial mobile layout changes

## Pull request discipline

Every PR should explain its user impact and complete the repository PR checklist. When behavior changes, update or add deterministic tests in the same PR rather than weakening existing assertions.

For schema/data/runtime changes, the PR should also state:

- whether a production deployment is required and how it will be performed;
- whether a database migration is required, its exact identity, and how production migration history will be reconciled;
- whether existing production state may differ from a fresh database;
- security/authorization boundaries touched by the change;
- the exact production verification that will be performed after merge;
- after merge, the production verification result and evidence before delivery is described as complete.
