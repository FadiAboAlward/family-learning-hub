# Optional Learning videos

Contract: canonical `FLH-FEAT-2026-018`, `SPEC_VERSION: 1.3`, [Drive Feature Spec](https://docs.google.com/document/d/1zzG0z6GCVV8jaVlV_H-91AvQ5Z5I5QcK5dWrmUsFDic/edit), [Issue #125](https://github.com/FadiAboAlward/family-learning-hub/issues/125). The historical implementation alias `FLH-FEAT-2026-012` remains in older migration/branch names only. Version 1.3 preserves the ordered vetted sequence and adds an authenticated read-only deep link that can reopen the current sequence for a progressed Learning attempt without mutating academic progress.

## Learner behavior

One or more vetted videos may accompany a learner's exact assessment version before the first Learning question. Multi-video assignments have explicit positive positions and are shown in order; existing single-video assignments remain position 1. The learner can immediately start the exercise, watch some or all of the video, or leave. An absent, unverified, mismatched, expired or failing video never prevents Learning. An already progressed Learning session resumes its question directly on the normal Learning route. A learner-only deep link with `videos=1` opens a read-only preview of the current verified ordered assignments for that quiz/version, even when the attempt has progressed. Opening or leaving that preview does not create, reset, finish, cancel, snapshot, or otherwise mutate the academic attempt; choosing Continue Learning then follows the normal resume route. Exam has no video dependency or instructional card.

The optional selector records only a learner's own statement:

| Value | Meaning |
| --- | --- |
| `not_reported` | No viewing statement supplied; default |
| `not_watched` | Learner says they did not watch |
| `watched_part` | Learner says they watched part |
| `watched_full` | Learner says they watched all |

The card explicitly labels this as optional **Family Learning Hub self-report**, separate from YouTube content. Only pressing Save writes a report. Starting without a report creates no viewing event. A save or refresh failure leaves Start available. Reports cannot change scoring, mastery, XP, Reward Points or Exam access.

The existing exercise-duration timer starts when the learner enters the first question. Time spent on the optional card is excluded from academic duration reporting; no video-duration value is calculated or stored.

There is no playback-time, percentage, seek, pause/play, player-ended or inferred-completion evidence. The player integration listens only for technical readiness and errors; it never reads the playback clock or state. A learner may change their own statement; it remains a statement, never a verified viewing result.

## Association and authoring

Candidate selection remains part of assessment authoring. No autonomous discovery, ranking, download or re-hosting service is added. Validate newly authored academic packages through `node scripts/academic-content-quality.mjs <package.json>` before their normal publication path; optional video attachment does not replace that gate.

The author supplies the exact learner, published quiz version, serving program, curriculum, grade, subject and primary concept/target, plus a YouTube video ID, authored title/language and recommendation rationale/source. Program enrollment supplies curriculum and grade; `learners.grade_level` alone and an unrelated primary program cannot prove equivalence. An available quiz in an active enrolled serving program and a matching quiz concept must exist. A similar topic name never authorizes reuse across curricula.

Use the existing authenticated authoring API with a `video` object containing `learner_id`, `quiz_version_id`, `program_id`, `curriculum_id`, `grade_level`, `subject_id`, `concept_id`, `video_ref`, `title`, `language`, `rationale` and `position`. `position` must be a positive integer and is unique per learner plus immutable assessment version; ordered assignments render by ascending position. Omitting `position` is supported only for backward-compatible single-video authoring, where the server defaults it to position 1. The author must resolve those IDs from the published assessment and learner's serving context and review the actual video's curriculum/skill relevance; copied text labels do not prove association. The server checks database relationships and official provider status before attachment. This operation does not publish an assessment.

Attachment and status refresh are authenticated parent owner/admin operations through `learning-api`. They validate the candidate with the supported [YouTube videos.list endpoint](https://developers.google.com/youtube/v3/docs/videos/list), requesting only identity and required status fields. `status.embeddable` must be true and `status.madeForKids` must be an explicit boolean. Deleted/private/non-embeddable responses, missing/invalid status, absent API credentials, timeout, malformed JSON and provider rejection fail closed. Do not substitute `selfDeclaredMadeForKids`, scrape the player, or mark an unknown status as safe.

`YOUTUBE_API_KEY` is a server secret. Configure it through the authorized server's secret mechanism; never place it in frontend code, a committed fixture, logs or chat. The server does not return the key or raw provider payload. No learner/session information is sent in the provider request.

Existing attempts pin the selected reference separately from future attachments. Changing the assignment never switches a resumed attempt to a different video or reuses another learner's report. Report updates use an expected revision and request UUID; duplicate retries cannot duplicate evidence or overwrite a later statement. Cross-learner/workspace and Exam-attempt writes are rejected. Exposed tables have RLS; browser roles cannot directly write assignment, status or report data.

## Provider status lifetime

Validation is usable for seven days. Status refresh rechecks the same reference through the official API; unavailable or expired status produces the non-blocking fallback. A separate provider-status revision rejects stale results after reattachment, another refresh or pruning without changing video identity or self-report revisions. Status updates are scoped to that assignment's pinned video snapshots. The Learning start path remains one database RPC and does not await a live provider request. This preserves exercise availability during a YouTube outage.

Provider metadata must be refreshed or removed within 30 days under [YouTube's data policy](https://developers.google.com/youtube/terms/developer-policies). Before any Production provider-status collection, including attachment while the UI remains disabled, configure the authenticated maintenance operation to prune expired provider-status data, run it at least daily, and verify it affects assignments and attempt snapshots. Disabling rendering and seven-day render expiry do not satisfy stored-data retention. Educational association and first-party self-report remain distinct from provider status.

The parent owner/admin API actions are `attach_optional_video` with `video`, `refresh_optional_video` with `assignment_id`, and `prune_optional_video_status`. Pruning clears provider booleans and validation timestamps after 29 days, leaving a one-day margin for daily maintenance. `learning_video_assignments` stores each reviewed ordered association; `learning_video_attempts` pins the attempt's full sequence on first entry and explicitly named `self_report`; `learning_video_report_requests` provides retry receipts. These service-only tables do not add a gamification event or viewing metric.

## Embed configuration and failure

The official iframe uses `youtube-nocookie.com`, `autoplay=0`, native controls, `rel=0`, inline playback, the page's exact `origin` and `strict-origin-when-cross-origin` referrer policy. At 390 pixels the player still meets the provider's 200×200 minimum. Branding, advertisements, titles, channel links and controls are preserved.

Readiness is not proof of successful playback. Error, network/API initialization timeout and the learner's “video does not work” action remove the failed player and display a short message while preserving Start. No technical errors or provider payloads appear in learner copy. Leaving the card destroys the player and its pending work.

MadeForKids metadata never grants permission to track. Player watch tracking is off for every video. Google child-directed site designation is a separate operational step using [Google's supported tools](https://support.google.com/policies/answer/9664901?hl=en); an iframe query parameter or privacy-enhanced hostname is not designation evidence.

Privacy-enhanced mode may still show non-personalized ads. `rel=0` may still show same-channel recommendations. Native player links can lead outside the application. See [embedding help](https://support.google.com/youtube/answer/171780?hl=en), [player parameters](https://developers.google.com/youtube/player_parameters), and [IFrame API](https://developers.google.com/youtube/iframe_api_reference). Never overlay or alter the player to hide those behaviors.

## QA and activation boundary

The workspace setting is disabled by default. Enable only in isolated Testing fixtures for development. Production enablement, migration, Edge deployment and real-learner use require separate explicit authorization.

Static quality precedes browser testing. Deterministic coverage checks reference/status and report validation, SQL authorization/association/snapshot/retry boundaries, optional rendering, immediate Start, missing/error cases, Exam independence, resume and the absence of player-derived viewing metrics. Existing Learning/Exam/math/rewards tests remain required. Mock provider responses prove contracts, not actual YouTube behavior.

Live QA must record the selected API-validated video, environment and actual observations on desktop and 390×844:

1. Playback, pre-roll and mid-roll ads: record presence, absence within the observation window, or inability to assess. No observed ad does not guarantee an ad-free future session.
2. Title, channel/avatar, YouTube branding, recommendations and end-screen: click available surfaces and record outbound navigation or in-player video switching. Missing/unobservable surfaces remain untested.
3. RTL/LTR, labels/keyboard/touch, horizontal overflow, console/page errors and relevant network outcome metadata. Do not capture sensitive request/response bodies.
4. The **actual child tablet**, with its real restricted profile, browser/app policy and network: confirm the approved embed plays when permitted; title/channel/logo/suggested/end-screen links and direct YouTube app/browser openings remain constrained as intended. Desktop emulation cannot prove this.

Ads/navigation unacceptable for the child experience or unverified actual-device behavior blocks release. Keep the feature disabled and unmerged while mandatory gates remain unresolved. A different delivery provider or player-derived analytics requires a separately versioned spec.

Rollback disables the workspace setting or removes the optional client path; preserve academic attempt history and self-reported evidence. Do not reverse historical migrations or rewrite published assessment versions.
