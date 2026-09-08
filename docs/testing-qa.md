# Family Learning Hub — Testing QA account

## Purpose

`Testing` is the canonical dedicated learner account for authenticated QA. Its stable learner slug is `test`. It is platform test infrastructure, not a real child profile.

The account exists specifically so Learning Mode, Exam Mode, learner library, assignments, gamification, and production-backend integrations can be exercised without contaminating Aya or Mohammad statistics.

## Isolation requirements

The Testing learner must remain:

- `metadata.is_test = true`
- `metadata.exclude_from_parent_metrics = true`
- active and available for QA

Automated authenticated QA must never run as Aya or Mohammad. Their attempts, scores, XP, streaks, mastery, rewards, and parent-visible history are real learner data.

Testing mirrors active real-learner program enrollments, quiz assignments, and direct content assignments through the project database mirroring rules. Newly assigned content should therefore be testable through Testing without copying it manually.

## Authentication paths

There are exactly two supported authenticated QA paths.

### 1. Local / Family Learning Hub Playwright

Use the normal learner login flow with:

- learner slug: `test`
- display name: `Testing`
- the current manual Testing PIN from secure project context

The manual Testing PIN is a fallback credential for human/local browser QA. It must not be committed to GitHub, printed in console output, embedded in DOM, included in screenshots/reports, or copied into GitHub Actions configuration.

The database stores only the PIN hash. The plaintext PIN must be treated as a secret and supplied only to an authorized local Playwright/browser session when needed.

### 2. GitHub Actions / required CI QA

GitHub Actions must never use the Testing PIN.

The `qa-smoke.yml` workflow obtains a GitHub OIDC token with audience `family-learning-hub-qa`. The `qa-session-api` validates the exact approved repository/workflow/runner boundary and exchanges that OIDC token for a short-lived learner session for `Testing`.

The short-lived session is then used by the real-backend Playwright smoke test against Production APIs.

## Canonical real-backend regression

The canonical full backend regression quiz is:

`sy-g7-integers-add-subtract-v1`

The authenticated Testing regression should cover, where supported by the current reviewed runtime:

1. open the Testing learner session;
2. verify Testing identity and test-mode banner;
3. open Learning Mode against the real Production backend;
4. start a Learning attempt;
5. request a hint;
6. choose an answer and save a draft;
7. confirm an answer;
8. open Exam Mode against the real Production backend;
9. start an Exam attempt;
10. save answers for all exam questions;
11. exercise flag/unflag state;
12. confirm no correctness feedback appears before submit;
13. submit the exam;
14. verify the review/result state loads;
15. record backend/browser failures without exposing credentials;
16. clean up only Testing attempts for the canonical QA quiz.

## Cleanup boundary

Automated cleanup may delete attempts only when all of these are true:

- workspace is the Family Learning Hub workspace;
- learner is the dedicated `test` learner;
- quiz is the canonical QA quiz configured by the QA service.

No automated cleanup path may accept an arbitrary learner id supplied by a caller. It must never delete Aya or Mohammad attempts.

## QA layers

The project uses complementary layers:

1. **Static quality** — syntax, runtime guards, architecture invariants, security regressions.
2. **Mocked/local browser smoke** — deterministic frontend and interaction behavior.
3. **Authenticated Testing real-backend smoke** — the reviewed PR frontend against the real Production backend using the isolated Testing learner.
4. **Post-deploy Production verification** — required after any deployment/migration/backend change; verifies that the deployed artifact matches the reviewed behavior.
5. **Manual Family Learning Hub Playwright** — used for targeted live browser QA when local/persistent browser behavior or production UX must be checked directly.

A pre-merge test against Production backend does not prove that a new Edge Function or migration from the same PR is already deployed. Backend deployments/migrations are verified separately after merge/deploy.

## Credential policy

- Never store the Testing plaintext PIN in the repository.
- Never include it in issue/PR bodies, workflow YAML, source code, logs, screenshots, DOM, or QA reports.
- Supabase stores only the hashed learner credential.
- Local Playwright may use the plaintext PIN only for the `test` learner login flow.
- GitHub Actions uses OIDC and must not depend on the PIN.
- If the plaintext manual PIN is lost, rotate the Testing PIN rather than attempting to recover it from the stored hash.

## Delivery policy

Any change to this Testing QA model follows the canonical project workflow:

`PR → exact-SHA Static quality + Browser smoke → exact-SHA CodeRabbit → merge → required migration/deployment → Production verification + evidence`

If the PR head SHA changes, all required pre-merge gates must run again on the new SHA.
