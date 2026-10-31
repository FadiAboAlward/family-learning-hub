# FLH-041 delivery and QA handoff

- FEATURE_ID: FLH-FEAT-2026-041
- SPEC_VERSION: 1.2
- SPEC_URL: https://docs.google.com/document/d/1TN58_YhGEUSKrtcDVcT--Dx2FDV3ZTwy2HP08KRNjVY/edit
- DRIVE_REVISION_ID: AHj4eMRlku7YQo8w3wxgzk_gzhhrJHgwpP-pksfBk6Q7NpSktdyFV9YJW4uaypdp4wu5cTHeXHRsz1H1c_htyeb_dRaZhP8Gs5atXseG9Tc
- Issue: https://github.com/FadiAboAlward/family-learning-hub/issues/194
- Material decision: owner approved eligible-video-only resume; v1.0/revision 2 access criteria remain, R01–R08 approved in v1.1/revision 3.
- Isolation: FLH-FEAT-2026-026 v1.1, revision 2; production traffic and real-learner writes forbidden. No assessment content is authored by this change.

| Criteria | Deterministic evidence |
| --- | --- |
| A01–A03, A05 | `optional-learning-video-browser.mjs`: library new/continuing/completed, live question DOM, typed drafts, hints, feedback, completed Learning and submitted Exam/history; zero extra academic commands |
| A04, A07 | `optional-learning-video-sequence.contract.sql` and `optional-learning-videos.contract.sql`: exact owned version/snapshot, active Exam embargo, synthetic second learner, revoked program, service-only grants |
| A06, A08 | Existing/extended ordered-video/provider-error/outcomes scenarios on 390×844 and 1365×900; RTL/math/focus/touch checks; temporary screenshots |
| R01–R03, R06–R07 | Browser official-API fixture: explicit opt-in, pause/save, reload/login/new context resume, lost response, conflicting device, ended/restart/delete; unavailable eligibility never reads player state/time |
| R04–R05, R08 | Edge unit input/session tests; SQL persistence/eligibility/expiry/clear/ACL checks; two real PostgreSQL clients racing first insert in `optional-learning-video-sequence.concurrency.mjs` |

Run existing CI commands without weakening the required gates. The optional-video SQL and concurrency files and browser suite are already unconditional in Isolated QA Gate. All `tests/*.unit.mjs` are discovered by CI. Browser fixtures intercept and deny backend traffic before navigation; success does not establish actual YouTube playback, ads/navigation, or the actual restricted tablet.

Docker-local QA was subsequently started in an isolated Testing environment. On 2026-10-31, actual YouTube playback and opt-in save/resume/deletion were verified across independent Edge and Chrome browser profiles on Windows at localhost:4173 with local Supabase at 127.0.0.1:54321. The new 29-day eligibility is measured from last provider verification, not the last playback save. No physical Android tablet check was performed. Production settings, user records and schema were not altered during this QA. Local static/unit/math/deep-link and mocked browser evidence are recorded separately from exact-head CI in the PR. TestSprite must consume this pinned spec; unavailable service/configuration or an isolated backend is BLOCKED_EXTERNAL, never PASS. CodeRabbit review, custom checks and Change Stack results must be tied to the final PR head.

## Deployment and production verification (separate release gate)

Do not treat tests as production deployment. Deployment requires owner authorization and a verified sequence for two forward migrations (`20261030233934_lesson_video_access.sql`, `20261031043018_lesson_video_resume.sql`), the `learning-api` Edge Function and static assets. No flags, assignments, published versions, academic records or rewards are migrated. The existing Production optional_learning_videos setting must be inspected because it may already be enabled for real students. Do not enable Pages, the public PR preview or the legacy live-performance workflow for this QA.

After any future authorized deployment, verify served build/migration/function identities, service-only ACLs, the existing daily prune job, eligible and ineligible provider behavior, lossless Learning return and active Exam denial on an explicitly authorized Testing scope. Actual provider and restricted-tablet evidence remain independent release gates. No destructive rollback is proposed; disable the new UI/route in a reviewed forward fix if needed, preserving stored academic history.
