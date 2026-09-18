# Family Learning Hub — Feature Spec → Codex → TestSprite Handoff

This document is the repository-side handoff protocol. The detailed process policy lives in Google Drive under:

`My Drive / Family Learning Hub / System & SOP / Family Learning Hub — Platform Development & QA SOP`

The canonical product requirement itself lives under:

`My Drive / Family Learning Hub / System & SOP / Feature Specs`

GitHub remains the source of truth for code and reproducible infrastructure.

## 1. When a Feature Spec is required

Create or update a versioned Feature Spec before implementation for any non-trivial:

- product feature or workflow change;
- student/parent behavior change;
- Learning or Exam behavior change;
- data/security/authorization change;
- externally observable API behavior change;
- meaningful bug fix whose intended behavior needs to be explicit.

Trivial copy, metadata, or mechanical changes may use N/A with a reason.

## 2. Required identity and version pin

Each Feature Spec has:

- `FEATURE_ID` — stable across revisions;
- `SPEC_VERSION` — semantic product-contract version, e.g. `1.0`, `1.1`;
- `SPEC_URL` — canonical Drive document URL;
- `SPEC_REVISION_ID` — exact Drive revision captured when implementation starts.

The GitHub Issue/PR must pin all four values and summarize the acceptance criteria.

The pin is the contract for that branch/PR. A later edit to the Drive document does not silently retarget work already in progress.

If behavior requirements materially change, publish a new `SPEC_VERSION`, update the PR pin, and re-evaluate affected implementation and QA.

Do not create one global “current feature” file or setting. Parallel branches carry independent pins.

## 3. Codex implementation sequence

Codex is the primary implementer for platform code.

Before changing code:

1. verify the branch/worktree and current SHA;
2. read the exact pinned Feature Spec through the available Google Drive connector/MCP;
3. compare the requested acceptance criteria with the current architecture;
4. implement the smallest scoped change that satisfies the spec;
5. choose deterministic unit / contract / Playwright regression coverage according to the risk.

If the pinned spec conflicts with the repository architecture or production state, stop and surface the conflict instead of silently redefining the requirement.

## 4. TestSprite verification sequence

TestSprite is an additive requirement-aware verifier driven from the Codex workflow.

One-time environment setup uses TestSprite's supported Codex integration:

`testsprite setup --agent codex`

A non-interactive environment may use:

`TESTSPRITE_API_KEY=... testsprite setup --from-env --yes --agent codex`

Do not commit API keys or other TestSprite credentials.

For a feature run:

1. use the same pinned Feature Spec and acceptance criteria that Codex implemented;
2. provide that spec as TestSprite's PRD / plan source rather than inferring intent only from code;
3. run the relevant frontend/API flows against an isolated test/preview environment using the dedicated Testing learner when authentication is required;
4. classify failures as product defects, test fragility, or environment/setup failures;
5. Codex verifies and fixes valid product defects;
6. rerun the failed TestSprite cases;
7. when practical, convert each reproducible product defect into a deterministic regression test at the lowest reliable repository layer.

TestSprite may self-heal fragile test artifacts, but it is not the authority to silently change production code.

## 5. Persistent TestSprite plans

The Drive Feature Spec remains the canonical product requirement.

If a TestSprite plan is valuable enough to retain across sessions, version the plan with the code and label it with the `FEATURE_ID` and `SPEC_VERSION` from which it was derived. Review plan changes like code changes.

Exploratory one-off TestSprite runs do not need to create permanent repository artifacts.

## 6. Merge relationship

TestSprite is currently additive and requirement-aware, not a replacement for deterministic QA.

The durable merge-safety layers remain:

- deterministic unit/integration/contract tests;
- GitHub Actions `Static quality`;
- GitHub Actions Playwright `Browser smoke`;
- exact-SHA CodeRabbit review.

When TestSprite discovers a new bug, deterministic regression coverage is the durable memory that prevents the same defect from returning.
