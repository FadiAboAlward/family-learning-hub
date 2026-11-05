# FLH-FEAT-2026-044 implementation evidence

Status: DRAFT. Platform QA is being finalized; mandatory academic/paper acceptance is not approved for release. The PR description and temporary CI manifests record the final exact head and actual run results.

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

Unlinked upload storage is capped at 48 MiB/version and 192 MiB/workspace, checked before signed allocation and atomically on Storage insertion/size increases. This is a byte budget, not a question image-count limit. Parent-only `prune_assessment_uploads` removes at most 100 unlinked objects older than seven days (both creation and update); preparation invokes it too. Linked objects and recent uploads survive; staging locks/checks the object before binding it. Publishing OFF does not prevent maintenance.

Limits: PNG/JPEG/WebP; 4 MiB per file, 4096 per dimension, 8,388,608 pixels and 24 MiB distinct bytes per candidate. Private read URL TTL 120 seconds; signed upload allocation uses Storage's two-hour token with upsert disabled. Temporary media URLs never enter canonical graphs/papers. PNG/JPEG/WebP undergo full decoding before create/stage/release. Required stored media is checked for availability/hash before persisting a Learning/Exam answer; a media outage cannot be graded as an academic error. WebP decoder is the unmodified @jsquash/webp 1.5.0 raster decoder binary, with upstream licenses retained and locked-package byte comparison; it must be included as a function static asset.

## Execution and containment

Cloud-first feature branch and GitHub-hosted Isolated QA Gate. Before opening the PR, GitHub public Actions listing showed Pages, Live Frontend Performance and PR Public Preview disabled; read-only REST listed zero in-progress and queued runs. The connector does not expose the workflows collection, so the public Actions page supplied disabled-state evidence; no workflow was enabled or dispatched. Pages workflow ID observed in existing run metadata: 340560552. Existing isolated/authenticated workflow IDs: 378653272 / 378962197.

Optional cloud-local DB startup failed extracting the PostgreSQL image (`no space left on device` in Docker's storage). Its owned startup/pull was stopped; no cleanup of unrelated Docker data was attempted. This is not DB/RLS PASS. The existing hosted fresh-DB gate remains mandatory.

## Acceptance matrix

Each row requires evidence on the final exact PR head; pending is never PASS.

| AC | Deterministic evidence / exact-candidate mapping | Acceptance limitation |
|---|---|---|
| AC-01 | `assessment-visual.unit.mjs`, `.contract.mjs`, `assessment-visual-browser.mjs`: no-image questions, native saves, ordinary finalization; old suites retained | Final CI head/result is in PR |
| AC-02 | Real three-codec decode; one required rectangle in Learning active/feedback, Exam composite in active/review, own history; parent HELD preview | Real Edge/Storage evidence is in authenticated job; academic pilot separate |
| AC-03 | Two ordered rectangle/triangle assets, labels/dimensions, same order after reload; mobile 390×844 and desktop 1365×900, keyboard zoom/focus; temporary screenshots | Exact screenshot SHA/run/hash manifest required |
| AC-04 | `geometry-source.json`, deterministic `render.py`, independent JS vector dot products and keyed A/B/C/D mapping; source raster visually inspected | Synthetic mathematical evidence is not independent academic approval of the real pilot |
| AC-05 | Official gate runs on exact synthetic 40-item candidate; explicit stage and matching blueprint, 10/10/20, existing difficulty/answer balance/hints/uniqueness; native core/exam pools | Real 40-item pilot requires source and semantic owner approval |
| AC-06 | Unit correct/wrong/hint/retry/unknown cases; real DB answer/resume at 9/10/11/20; independent Exam with unfinished Learning; finish still rejects incompleteness; browser optional summaries/continue | Guidance has no score/mastery write or new stage attempt |
| AC-07 | The separate Paper asset contract accepts 20 items; interactive authoring remains 40. New-profile paper projection adds immutable image manifest; old projection delegates unchanged; no automatic PDF path added | NOT RUN / BLOCKED: no independently authored NEW colored 20-item paper or page-render inspection. Do not claim PASS or substitute the earlier 40 |
| AC-08 | New vs preserved function outputs compared as exact JSON text for every reconstructed legacy graph/paper; old DB/RLS/concurrency/attempt/deep-link/browser suites retained | No historical content or migrations edited; Production not migrated or verified |
| AC-09 | CRC/compressed corruption, true MIME/dimensions/hash/missing bytes; zero grading on required-media outage; visible retry/back with answer controls disabled; optional-image readiness | API/Storage and UI evidence remain distinct |
| AC-10 | Scoped UUID/hash paths, rejection of cross-version links/historical opt-in and transient URLs in canonical data; private bucket/no public policies, wrong learner, parent role/session negatives, HELD parent preview, overwrite, genuine Storage expiry, source rights; provenance stays outside learner source metadata | Authenticated outcomes must be read from the final job, not inferred from mocked PASS |
| AC-11 | Exact generated candidate→stage→HELD→release/readback in disposable DB; migration reapplication; real Edge/Auth/Storage test; final exact-head CI, screenshot manifest and actual review | BLOCKED until final CI/review; TestSprite missing integration credentials. The full visual40 authenticated Learning/Exam browser now runs on the disposable Runner at 390×844 and desktop; its exact-head result and temporary manifest are in the PR (synthetic provider evidence is explicit, not academic/provider approval) |
| AC-12 | Original generated geometry with exact coordinates/units; perimeter, composite-area and perpendicular classification; source/option mapping checked without copying a publisher item | BLOCKED: photographed 3D school-exam comparison and independent real-pilot semantic/source review not evidenced |

Independent source/semantic approval and the genuine academic pilot belong to the academic/product QA owner. Do not substitute the code author's own declaration or synthetic fixture validation for that approval.

## Repeatable checks and review status

- `node tests/assessment-visual.unit.mjs`: official exact candidate; actual PNG/JPEG/WebP; corruption, rights, scope, dimensions, missing media, optional/required readiness, key-order invariance, deterministic geometry, no-write refresh and guidance.
- `node tests/assessment-visual.contract.mjs`: disposable DB only; reapply forward migration, stage/import rollback, hashes, immutable links/assets, HELD, provider gate, actual native saves/finish/review and no duplicate attempts.
- `node tests/assessment-visual-browser.mjs`: actual application runtimes with isolated synthetic APIs, 390×844/desktop, stages and feedback/review/history, reload/resume, required failure, keyboard zoom and RTL. No Production requests; no real learner data.
- `verifyAssessmentVisualApi` inside the existing owned authenticated Runner: normal parent Auth, real signed uploads/reads and all codecs, session/role/path/MIME/hash/overwrite/expiry negatives, stage/HELD/preview/provider gate, verified owned cleanup. No real provider video or released student assignment.
- Existing convention-based units, academic gate, static checks and native regression contracts remain unconditional. Local optional DB failure does not waive hosted DB/RLS.
- CodeRabbit CLI was absent; installation from `cli.coderabbit.ai` returned HTTP 403 under the environment network policy. PR-based CodeRabbit review is requested separately; do not label a manual review as CodeRabbit.
- TestSprite: no connected MCP/CLI and no `API_KEY` / `TESTSPRITE_API_KEY` bindings. The documented official MCP package requires `API_KEY`. Outcome is `BLOCKED_EXTERNAL` for missing service authentication; no exploratory run or PASS claimed.
- Temporary visual evidence: `playwright-screenshots/flh-044-*` with seven-day CI artifact retention. Not committed. The manifest records FEATURE_ID/version/revision, actual checkout head, candidate hash, run and screenshot hashes.
- Dedupe: existing Continuous Improvement Log OBS-2026-11-05-077 already records viewport/footer interception and retaining its regression. This change adds the visual-question-specific static-footer assertion after screenshot inspection reproduced confirmation covering a diagram; no duplicate observation or new SOP rule was created.


## CodeRabbit repair round — six verified issues

The review of `8779989` submitted CHANGES_REQUESTED with six actionable inline comments. All six were checked against the source; the runbook comment points to the export instructions in `docs/assessment-publication-runbook.md`, while the script already compared both visual fields.

| Comment | Verified defect and smallest correction | Regression evidence |
|---|---|---|
| 4486003908 | Missing asset helper failed open; required Learning/Exam answers now remain blocked and show an actionable error. Text/optional-image readiness remains available | Actual-runtime mobile/desktop missing-helper browser cases |
| 4486003942 | RTL concept summary bypassed math isolation; use the existing escaped `renderMath` path | Negative expressions and escaped image markup in actual summary browser |
| 4486003952 | Runbook export omitted canonical assets/stage; add those fields | Visual snapshot positive and missing/reordered-field preflight negatives |
| 4486003962 | Unlinked uploads could accumulate; byte budgets and seven-day, parent-only bounded cleanup reuse existing Storage/association data | DB quota/allocation/Storage guard and old-unlinked vs linked/recent selection; real Edge maintenance |
| 4486003967 | Hydration failure could misreport an already committed answer/finish/submit; return native payload plus `media_unavailable` for committed actions only | Execute real TS handlers with a failing media dependency and verify exactly one persistence call and HTTP 200 |
| 4486003979 | Inner metadata join dropped linked required prompts; preserve the link, default invalid/missing metadata to required and mark unavailable | DB removal of metadata retains the required link; actual Learning/Exam handler rejects it before persistence |

Additional review items: batch signed reads instead of serial per-asset signing; independently assert perimeter/area answer keys; actual second-learner and outside-question refresh checks on Learning/Exam/history (HTTP 403); correct history forbidden mapping. The authenticated browser uses real app/API/image bytes and translates only local Kong's container Storage origin to the inspected host origin. A clearly synthetic provider record is seeded only after proving release rejects absent provider evidence; this does not assert real video/academic approval. Owned fixture attempts/assignments/video records are removed before the existing native authenticated suite.

Policy warning dispositions: the approved v1.1 contract explicitly requires scoped, short-lived signed upload/read URLs. Replacing them with a new stream/proxy API would be a material design change, so that warning is disputed with the pinned contract; no service keys, user bearer headers, source rights or real learner data enter DOM, logs, screenshots or evidence. Resource URLs remain transient in memory/DOM as required by the approved design. The PR description follows the full repository template, with blocked deployment/acceptance fields explicit. Docstring coverage is advisory and is not represented as PASS; changed media operations have behavioral documentation without mechanical comments on every fixture callback. No review/check configuration was weakened. Exact-head review/check and Change Stack dispositions remain recorded in the PR.
