# Family Learning Hub — Canonical Testing QA

## Purpose

`Testing` (stable learner slug `test`) is the dedicated learner for authenticated QA. It is test infrastructure, not a real child profile. Automated QA must never run as Aya or Mohammad because their attempts, scores, mastery, rewards, streaks, and parent-visible history are real learner data.

The Testing learner must remain active with:

- `metadata.is_test = true`
- `metadata.qa_automation = true`
- `metadata.exclude_from_parent_metrics = true`
- `metadata.show_on_login = false`

The profile stays hidden from the ordinary child chooser. It can still be used by authorized local Playwright through direct learner authentication.

## Authentication paths

### Local Family Learning Hub Playwright

Local/manual browser QA uses the Testing learner's protected manual PIN and stable slug `test`. The PIN is kept only in secure project context; it is not committed to GitHub, printed in logs, written to screenshots, exposed in DOM reports, or stored in GitHub Actions.

The local Playwright flow may authenticate Testing directly through the normal learner-login API, store the returned learner session in the dedicated browser context, and then exercise Production. It does not need Testing to be visible in the child profile chooser.

### GitHub Actions

The blocking `Browser smoke` job uses GitHub OIDC and never uses the learner PIN. `tests/authenticated-e2e.mjs` requests an OIDC token with audience `family-learning-hub-qa` and exchanges it through the Production `qa-auth` Edge Function.

`qa-auth` verifies the GitHub token signature and requires the approved repository identity, repository ID, owner actor ID, `qa-smoke.yml` workflow reference, approved event type, and GitHub-hosted runner before it can issue a short-lived Testing learner session.

The Production `qa-auth` function is intentionally deployed with Supabase JWT verification disabled because GitHub OIDC is its authentication boundary; the function performs the OIDC verification itself.

## Canonical automated content

The authenticated GitHub regression uses QA-only content rather than a real child's lesson:

- quiz slug: `qa-automation-core`
- program title: `QA Automation — Testing`
- book title: `QA Automation Book`

The flow exercises the real Production backend through both Learning Mode and Exam Mode.

## Serialized run ownership

Testing is a shared learner, so authenticated CI runs must never overlap on it.

Two independent controls enforce this:

1. The GitHub `Browser smoke` job uses one global Testing-learner concurrency group with `cancel-in-progress: false`, so GitHub queues overlapping browser runs instead of cancelling or overlapping them.
2. `qa-auth` acquires a database lease before issuing a session. `prepare` returns a server-generated `run_id`; `cleanup` must present the same `run_id` before Testing attempts can be deleted and the lease released.

If the Testing lease is already owned, `prepare` returns `409 QA_BUSY` without clearing attempts. A different run cannot clean up the active run. The lease has a bounded expiry so a crashed runner cannot block Testing permanently.

## Cleanup boundary

Automated cleanup is intentionally narrow. It may delete attempts only when all of these are true:

- workspace is the Family Learning Hub workspace;
- learner is the stable `test` learner;
- quiz version belongs to the canonical `qa-automation-core` quiz;
- caller owns the active Testing lease via the matching server-issued `run_id`.

No request may supply an arbitrary learner ID or quiz ID for cleanup. Aya and Mohammad must never be touched by this path.

The browser test calls cleanup in a `finally` path so Testing attempts are removed even when the browser flow itself fails. Cleanup obtains a fresh GitHub OIDC token rather than reusing a potentially expired token.

## Required regression coverage

The canonical Testing authenticated browser run verifies the real Production backend and includes:

1. obtaining a GitHub OIDC token;
2. acquiring Testing run ownership and a short-lived learner session;
3. opening the QA-only program/book;
4. completing the QA Learning Mode flow;
5. completing the QA Exam Mode flow and reaching review;
6. failing on browser/page console errors;
7. closing the browser;
8. cleaning only the owning Testing run in `finally`.

`tests/qa-auth-lease.unit.mjs` protects the OIDC, isolation, lease, cleanup, workflow serialization, and migration invariants from being silently weakened.

## Delivery and verification

Changes to this system follow the normal Family Learning Hub release policy:

`PR → exact-SHA Static quality + Browser smoke → exact-SHA CodeRabbit → fix findings → rerun after any head change → merge → apply migration/deploy Edge Function → Production verification`

Repository success and Production success remain separate states. A change is not complete until the migration and/or Edge Function version required by that PR is deployed and verified in Production.
