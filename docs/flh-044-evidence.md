# FLH-FEAT-2026-044 implementation evidence

Status: IN_IMPLEMENTATION; not READY_FOR_QA or approved for release.

- Issue: https://github.com/FadiAboAlward/family-learning-hub/issues/204
- FEATURE_ID: `FLH-FEAT-2026-044`
- SPEC_VERSION: `1.1`
- SPEC_URL: https://docs.google.com/document/d/1oRjd8_IuGfQAEKgUzYQpd-QRrc279KBken1FKEHZ2fo/edit
- DRIVE_REVISION_ID: `4`, fetched through Drive revisions and equal to the current v1.1 text. The former Docs API token in the issue returned 404; the issue pin was corrected before coding.
- Baseline main: `c2d97f91e7e8bc2c342c3e9066f93d2de01b1851`; clean worktree verified before the feature branch.
- Read: AGENTS.md, canonical architecture/QA/feature/math/academic/paper/PDF docs, live Platform SOP v1.9 and Academic SOP v1.24.
- FLH026 isolation contract: v1.0 revision 2 and v1.1 revision 2 as referenced by the existing QA policy; unchanged.

## Boundaries and rollout

No Production migrations/deployments, merge, emails, assignments or student attempts are authorized. Production inspection was limited to schema/function definitions, bucket metadata and policy names. Confirmed existing assets/link tables and no buckets or Storage object policies.

Migration: `20261105134103_visual_foundation_bridge_v1.sql`, created with the pinned Supabase CLI. Reuses existing JSON, tables and transaction; no new tables/columns. Publishing defaults OFF (`workspace_settings.visual_assessments.enabled` absent/false). Rollback disables new publishing, preserves issued content and resolvers. After separately authorized deployment, apply only the reviewed forward migration, verify its ledger and bucket/ACL, deploy affected functions including their static WebP decoder, and verify Testing before considering the publishing flag. Production verification is NOT RUN and is outside this PR authorization.

Limits: PNG/JPEG/WebP; 4 MiB per file, 4096 per dimension, 8,388,608 pixels and 24 MiB distinct bytes per candidate. Private read URL TTL 120 seconds; signed upload allocation uses Storage's two-hour token with upsert disabled. No URLs in canonical graphs/papers. PNG/JPEG/WebP undergo full decoding before create/stage/release. WebP decoder is the unmodified @jsquash/webp 1.5.0 raster decoder binary, with upstream licenses retained; it must be included as a function static asset.

## Execution and containment

Cloud-first feature branch and GitHub-hosted Isolated QA Gate. Before opening the PR, GitHub public Actions listing showed Pages, Live Frontend Performance and PR Public Preview disabled; read-only REST listed zero in-progress and queued runs. The connector does not expose the workflows collection, so the public Actions page supplied disabled-state evidence; no workflow was enabled or dispatched. Pages workflow ID observed in existing run metadata: 340560552. Existing isolated/authenticated workflow IDs: 378653272 / 378962197.

Optional cloud-local DB startup failed extracting the PostgreSQL image (`no space left on device` in Docker's storage). Its owned startup/pull was stopped; no cleanup of unrelated Docker data was attempted. This is not DB/RLS PASS. The existing hosted fresh-DB gate remains mandatory.

## Acceptance matrix

Each row requires evidence on the final exact PR head; pending is never PASS.

| AC | Required evidence | Current disposition |
|---|---|---|
| AC-01 | zero-image render/answer/persistence; legacy regressions | PENDING |
| AC-02 | one verified required figure in active/review/history | PENDING |
| AC-03 | 2+ ordered figures, 390×844/desktop/reload/resume | PENDING |
| AC-04 | composite A/B/C/D, independent math and option mapping | PENDING |
| AC-05 | exact 10/10/20; uniqueness/difficulty/hints/mode security | PENDING |
| AC-06 | correct/wrong/hint/retry/unknown; nonblocking guidance/resume | PENDING |
| AC-07 | optional NEW colored 20-item paper, immutable image hash and rendered pages | PENDING; no automatic PDF or real paper requested |
| AC-08 | identical historical graphs/paper/attempt/deep-link behavior | PENDING |
| AC-09 | invalid/missing/corrupt bytes fail before release; safe retry | PENDING |
| AC-10 | workspace/learner/HELD/expiry/traversal/overwrite/leak/rights negatives | PENDING |
| AC-11 | exact candidate/stage/HELD/release/readback, isolated DB/RLS, CI, authenticated UI, CodeRabbit/TestSprite | PENDING |
| AC-12 | source-checked school-exam cognitive patterns; owned diagrams | PENDING; synthetic fixtures cannot prove the real academic pilot |

Independent source/semantic approval and the genuine academic pilot belong to the academic/product QA owner. Do not substitute the code author's own declaration or synthetic fixture validation for that approval.
