# Family Learning Hub — QA and Merge Policy

## Required deterministic QA

Every pull request targeting `main` must run the GitHub Actions workflow `QA Gate`.

The merge-blocking checks should be:

- `Static quality`
- `Browser smoke`

`Static quality` checks JavaScript syntax, runtime references, Arabic/RTL shell requirements, known copy regressions, legacy runtime guards, school-year formatting, and merge markers.

`Browser smoke` runs the mobile Playwright flow and rendered Arabic copy QA. It protects the student hierarchy, learning/exam behavior, learner content isolation, direct standalone-book assignment, parent progressive disclosure, activity filters, mobile interactions, and question references.

## Merge rule

Do not merge to `main` while either required deterministic check is failing or pending.

GitHub repository Rulesets/Branch Protection should enforce the two checks above. The repository workflow alone runs QA; the GitHub rule is what actually blocks a red merge.

Recommended ruleset settings:

- Target: default branch (`main`)
- Enforcement: Active
- Require a pull request before merging: On
- Require status checks to pass before merging: On
- Required checks: `Static quality`, `Browser smoke`
- Block force pushes: On
- Require branches to be up to date before merging: Off initially, to avoid unnecessary duplicate QA runs for this small repository. Revisit if concurrent development increases.

## AI review layer

CodeRabbit is advisory, not the deterministic merge gate.

The repository `.coderabbit.yaml` asks CodeRabbit to review for:

- child-facing mobile/RTL regressions
- learner content isolation
- data-driven access instead of hard-coded users/content
- server-authoritative grading and saved state
- Learning vs Exam behavior
- QA-test weakening
- GitHub Actions bypasses
- architecture/documentation drift

The AI reviewer may find issues deterministic tests miss, but an AI approval is not a replacement for the required GitHub Actions checks.

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
