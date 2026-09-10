# Paper Exam Workflow

This document is the canonical workflow for **paper-based exams/worksheets that become first-class learner attempts in Family Learning Hub**.

It applies to Aya, Mohammad, and future learners. Do not hard-code learner-specific rules into the workflow itself.

## Goal

A paper is an alternate **delivery surface**, not a separate grading system. ChatGPT may create a print-ready paper exam, the learner solves it away from the tablet, and the solved paper is then ingested into the same server-authoritative Exam/history/reporting model used by the platform.

Production ingestion is allowed only when the dedicated version-bound paper migration is deployed. The generic latest-version Exam start path is never a substitute.

## Source-of-truth rules

1. Use the learner's assigned book/source package as the primary content source.
2. Respect the project's page flags and visual protocol.
3. For mathematics, `MATH_MODE: VISUAL_AUTHORITATIVE` is binding: visually verify every mathematical expression that depends on the source page before reusing or adapting it.
4. Preserve the terminology and notation style of the source curriculum/book.
5. Distinguish explicitly between a question copied/adapted from the book and a newly generated question on the same concept/pattern.
6. When the request is based on prior learner performance, inspect the latest relevant attempts first and emphasize the actual weak concepts/misconceptions.

## Canonical paper identity

Every paper model receives a stable unique `paper_model_code` before final export.

Recommended shape:

`<LEARNER>-<SUBJECT>-<GRADE>-<SCOPE>-PAPER-<YYYYMMDD>-<REV>`

Example:

`MOH-MATH7-U1-INT-PAPER-20260909-G`

The same code must be present in the printed exam, answer key, canonical question package, backend quiz-version metadata, and the ingested learner-attempt metadata. It is the bridge between the physical pages and the backend record.

### Unique allocation and immutable quiz-version binding

`paper_model_code` is unique within a Family Learning Hub workspace.

Before approval/publishing:

1. Check the workspace for an existing approved version with the same code. Never reuse a code for different content.
2. Publish the exact approved question package to one immutable `quiz_version_id`.
3. Store the binding in `quiz_versions.settings.paper_exam`, including at minimum:
   - `paper_model_code`
   - `paper_content_hash`
   - `paper_question_count`
   - `paper_question_map`
   - `approved_at`
4. `paper_question_map` maps every printed question number to the exact backend `question_id`, `question_code`, and printed option positions.
5. `paper_content_hash` is calculated from the canonical question package, not from rendered PDF bytes.
6. Keep the printed question count version-bound. Never fall back to a generic Exam question-count default.

After approval/printing:

- Never resolve a photographed paper to the latest quiz version.
- Resolve the code within the correct workspace to exactly one approved `quiz_version_id`; zero or multiple matches are a hard stop.
- Any content change after approval requires a new quiz version **and a new paper-model revision**.
- If the stored canonical/runtime package has drifted, block ingestion.

## Production implementation

The dedicated server path is defined by `supabase/migrations/20260910023500_paper_exam_ingestion_gate.sql`.

The supported start operation is:

`public.flh_paper_exam_start(workspace_id, learner_id, exact_quiz_version_id, paper_model_code, source)`

It is service-role only and must be called with the **exact approved quiz version**. It does not resolve a latest version by quiz slug.

The gate verifies atomically:

1. learner/workspace validity;
2. one-and-only-one published version for the paper code;
3. paper model code, approved hash, runtime hash/snapshot, count, and mapping;
4. exact printed sequence to backend question id/code;
5. exact option-position mapping;
6. a queue containing every mapped paper question exactly once and no unexpected question;
7. a server-controlled `paper_queue_validated = true` marker before responses can be stored.

Database guards then enforce the binding for answer writes and again at submission. A paper-tagged answer cannot be written outside the validated mapping, and a paper attempt cannot be submitted if its queue/binding has drifted.

The normal server-authoritative Exam grading functions remain responsible for grading and score persistence. **Never fabricate percentage, mastery, reward, or answer rows directly from a photographed result.**

### Generic Exam path remains forbidden for paper start

`flh_exam_start` resolves normal interactive Exam sessions and may select the currently published version by slug. It must **not** be used to start a paper attempt. Paper ingestion always starts through `flh_paper_exam_start` against the immutable bound `quiz_version_id`.

## Fixed-spec rule

Once the user specifies page count and question count, treat both as hard constraints. Do not solve a layout problem by silently adding/removing questions, shrinking text to an uncomfortable size, changing page count, or switching format.

For the common 20-question paper pattern, unless explicitly overridden:

- A4 portrait;
- 2 pages;
- 20 questions total;
- 2 vertical columns per page.

If space remains, improve readability, math size, answer space, or visual balance rather than changing the specification.

## Layout standard

For a compact school-style paper:

- each question is one visual block: prompt + choices/response area + separator;
- use two columns when it materially improves space use;
- avoid large unused regions and avoid tiny type;
- use one quiet skill/section heading per related group rather than repeating labels per question;
- prefer A/B/C/D/E/F choices next to each question when a separate answer sheet would waste space;
- keep model code, learner, subject, grade/curriculum, score, and duration in a compact header.

## Mathematics print and storage invariant

The platform RTL/LTR invariant applies to paper artifacts and their backend representation:

- Arabic prose remains RTL.
- Mathematical expressions are **stored in logical LTR order** and rendered LTR with bidi isolation.
- Negative signs remain leading and operand order must never reverse visually or in storage.
- Fractions use proper stacked notation unless the source deliberately uses slash notation.
- Use professional notation for powers, roots, comparisons, multiplication/division, coordinates, angles, segments, parallel/perpendicular/congruence symbols, and similar math.
- Before finalizing a mathematics paper, compare representative notation against the learner's actual book pages.

## Canonical question package

Before final PDF layout, maintain one structured source package containing, for each question where applicable:

- paper model code and printed question number;
- backend `question_code` once allocated;
- prompt;
- options and positions/labels;
- correct answer;
- explanation / correct explanation / final incorrect explanation;
- concept id/code;
- source book code and source PDF page(s);
- origin (`book_exact`, `book_adapted`, or `generated`);
- source/visual-verification metadata.

The PDF and backend quiz version must come from the same canonical package. Never recreate the approved questions independently for backend registration.

For historical paper models approved before canonical-package persistence existed, an explicit one-time `paper_legacy_registration` may preserve the historical `paper_content_hash` while storing an immutable runtime package snapshot/hash. This is a migration/backfill exception, not the rule for new papers.

## Approval and ingestion sequence

1. Generate the canonical question package from the approved source scope.
2. Produce and visually QA the paper PDF.
3. User reviews/approves the exact model.
4. Allocate a unique paper code; publish the exact questions as one immutable quiz version; persist code/hash/count/map/package.
5. Print and solve on paper.
6. User uploads/photos all solved pages.
7. Confirm the printed paper code first and resolve it within the workspace to exactly one approved version.
8. Verify the stored package/hash/count/map and confirm all expected pages are present.
9. Read only the learner's marks/answers. Do not reinterpret canonical printed question text from OCR if the model is already known. Ambiguous marks require clarification rather than guessing.
10. Start through `flh_paper_exam_start` using the exact version and require server queue validation.
11. Save only mapped response positions through the normal server answer path.
12. Submit through the normal server-authoritative grading path.
13. Verify persisted score, wrong-answer review, paper provenance, assignment completion, learner history, and parent/reporting surfaces.

## Reporting semantics

A paper Exam attempt is stored as `delivery_mode = exam` so it participates in normal Exam reporting. Paper-specific provenance belongs in `quiz_attempts.metadata`, including:

- `paper_model_code`
- `paper_quiz_version_id`
- `paper_content_hash`
- `paper_runtime_content_hash`
- `paper_queue_validated = true`
- `paper_ingested = true`
- `paper_ingested_at`
- `paper_source = uploaded_photos` (or the actual source)

Do not misrepresent paper activity as interactive tablet behavior such as hints or retries.

## QA and data integrity

- Never use Aya or Mohammad's real accounts merely to test the ingestion feature.
- Use the dedicated `test` learner for automated/exploratory QA first.
- A real learner paper may be ingested only after the paper was actually solved, the user requested ingestion, and the dedicated migration is deployed and verified.
- Preserve question/version immutability after printing; revisions receive a new paper code/version.
- Never reuse one paper code for different content or bind one code to multiple versions.
- Never ingest when the approved version, hash, printed count, mapping, option positions, or generated queue do not exactly match.
- Never bypass the dedicated server gate by using the generic Exam start path.
- Test rollback/cleanup must leave no synthetic attempt attached to a real learner.

## Completion criterion

A solved paper is complete only when all of the following are true: the exact approved model is resolved, the guarded paper attempt exists, all transcribed answers are server-graded, the submitted score/review matches the physical paper, provenance is stamped, and the attempt is visible through normal learner history/reporting. Reading a photograph and computing a score by itself is not ingestion.