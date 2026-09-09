# Paper Exam Workflow

This document is the canonical workflow for **paper-based exams/worksheets that must still become first-class learner attempts in Family Learning Hub**.

It applies to Aya, Mohammad, and future learners. Do not hard-code learner-specific rules into the workflow itself.

## Goal

Allow ChatGPT to create a print-ready paper exam, let the learner solve it away from the tablet, then ingest the solved paper back into the Family Learning Hub backend so the attempt can appear in normal progress/history/reporting **once the required version-bound server ingestion path described below is implemented and deployed**.

The paper is an alternate **delivery surface**, not a separate grading system.

## Source-of-truth rules

1. Use the learner's assigned book/source package as the primary content source.
2. Respect the project's page flags and visual protocol.
3. For mathematics, `MATH_MODE: VISUAL_AUTHORITATIVE` is binding: visually verify every mathematical expression that depends on the source page before reusing or adapting it.
4. Preserve the terminology and notation style of the source curriculum/book.
5. Distinguish explicitly between:
   - a question copied/adapted from the book, and
   - a newly generated question on the same concept/pattern.
6. When the user's request is based on prior learner performance, inspect the latest relevant attempts first and use the actual weak concepts/misconceptions as the emphasis for the paper.

## Canonical paper identity

Every paper model must receive a stable unique `paper_model_code` before final export.

Recommended shape:

`<LEARNER>-<SUBJECT>-<GRADE>-<SCOPE>-PAPER-<YYYYMMDD>-<REV>`

Example:

`MOH-MATH7-U1-INT-PAPER-20260909-G`

The same code must be present in:

- the printed exam,
- the answer key,
- the canonical question data used to generate the exam,
- the backend quiz/version metadata when the paper is approved,
- the learner attempt metadata when solved-paper ingestion is supported and performed.

The code is the bridge between the physical pages and the backend record.

### Unique allocation and immutable quiz-version binding

`paper_model_code` is a unique identifier within a Family Learning Hub workspace, not merely a human-readable label.

Before a paper is approved/published:

1. Check the backend for an existing approved paper with the same `paper_model_code` in the same workspace.
2. If the code already exists, **do not reuse it**. Increment/change the revision component and generate a new code.
3. Publish the exact approved question package to one immutable `quiz_version_id`.
4. Store the binding in `quiz_versions.settings.paper_exam` (or an equivalent canonical version-level JSON object if the schema later changes) with at least:
   - `paper_model_code`
   - `paper_content_hash`
   - `paper_question_count`
   - `paper_question_map`
   - `approved_at`
5. `paper_question_map` must map each printed question number to the exact backend `question_id` / `question_code` and option positions used by that approved quiz version.
6. `paper_content_hash` must be calculated from the approved canonical question package, not from the rendered PDF bytes. It is used to detect accidental content drift.
7. Keep `paper_question_count` version-bound in `quiz_versions.settings.paper_exam`. A future paper-specific start operation must read this count from the exact approved `quiz_version_id` and use it for queue construction. Never fall back to the generic default count for a paper exam.

After approval/printing:

- Never resolve a scanned paper to the **latest** quiz version.
- Resolve `paper_model_code` only within the correct workspace and to **exactly one** approved `quiz_version_id`.
- If the lookup returns zero versions or more than one version, stop; never guess.
- Any future attempt must be started against that exact bound `quiz_version_id`.
- Copy `paper_model_code`, the bound `paper_quiz_version_id`, and `paper_content_hash` into `quiz_attempts.metadata` when ingestion is eventually performed.
- If the canonical package hash no longer matches the approved `paper_content_hash`, block ingestion until the discrepancy is resolved.
- Any content change after approval requires a new quiz version **and a new `paper_model_code` revision**.

This binding rule prevents a photographed paper from being attached to the wrong model or graded against a newer/different quiz version.

## Current production support status

**Paper creation, PDF generation, approval, printing, and later answer transcription are supported as an orchestration workflow. Automatic solved-paper ingestion into Exam V2 is not yet a supported production operation.**

The current generic `flh_exam_start` path resolves by quiz slug and can select the latest published version. It does not provide the required workspace-scoped `paper_model_code` resolution, immutable `quiz_version_id` start contract, or server-side paper queue gate. Therefore:

- do **not** create a real paper attempt through the generic latest-version start path,
- do **not** call `flh_exam_save_answer` for transcribed paper answers until the required server gate exists,
- do **not** claim that a photographed paper has been ingested into learner history merely because its answers were read successfully.

Until the version-bound server path is implemented and deployed, ChatGPT may prepare the exact canonical answer transcription and validation package, but must stop before creating/saving a production attempt.

## Required server-side paper start gate

Before the first production paper ingestion, implement a dedicated server-side operation for paper attempts. It may be an RPC or Edge Function, but it must enforce the following atomically on the server:

1. Accept the current `workspace_id`, learner identity, exact approved `quiz_version_id`, and `paper_model_code` (or resolve the code to that version within the same workspace transactionally).
2. Verify that the version contains approved `settings.paper_exam` metadata and that the stored `paper_model_code`, `paper_content_hash`, `paper_question_count`, and `paper_question_map` are internally valid.
3. Create the attempt against **that exact `quiz_version_id` only**; never select a latest published version.
4. Build the question queue only from that exact approved version.
5. Before the attempt is allowed to accept answers, verify server-side that:
   - queue count equals `paper_question_count`,
   - every queued question matches the expected `paper_question_map`,
   - no unexpected question is present,
   - every mapped printed question is present exactly once.
6. Persist a server-controlled marker such as `paper_queue_validated = true` together with `paper_model_code`, `paper_quiz_version_id`, and `paper_content_hash` in attempt metadata only after the gate passes.
7. On any mismatch, reject the operation and perform transaction rollback or explicit cleanup so no usable partial paper attempt/queue remains.
8. The server save-answer path must reject writes for a paper-tagged attempt unless `paper_queue_validated = true`, and must reject any question id not present in that validated paper mapping.
9. Submission/grading must remain bound to the same immutable quiz version and validated queue.

This gate is a prerequisite for production paper ingestion. A client-side or ChatGPT-side count check alone is not sufficient.

## Fixed-spec rule

Once the user specifies page count and question count, treat both as **hard constraints**.

Do not solve a layout problem by silently:

- adding questions,
- removing questions,
- shrinking type to an uncomfortable size,
- changing the requested page count,
- switching format without permission.

If the layout has excess space, improve readability and balance first: increase breathing room, math size, answer space, or visual clarity while preserving the fixed specification.

For the currently approved common pattern, when the user asks for a standard 20-question paper exam and does not override the layout:

- A4 portrait,
- 2 pages,
- 20 questions total,
- 2 vertical columns per page.

This is a default template, not a universal hard limit; explicit user instructions always win.

## Layout standard

For a compact school-style paper:

- Use two vertical columns when it materially improves space utilization.
- Each question is one visual block: prompt + answer choices/response area + separator.
- Avoid large unused white regions.
- Avoid dense text walls or tiny type.
- Use one section/skill heading per group of related questions; do not repeat the same skill label above every question.
- Keep section headings pedagogically meaningful but visually quiet.
- Prefer selecting/circling A/B/C/D/E/F beside each question when a separate answer sheet would waste substantial space.
- Keep the model code, learner, subject, grade/curriculum, score, and duration in a compact header.

## Mathematics print invariant

The platform's RTL/LTR invariant also applies to paper artifacts.

- Arabic prose remains RTL.
- Every mathematical run is logically LTR and bidi-isolated during authoring.
- Negative signs must remain leading.
- Operand order must never reverse visually.
- Fractions must be proper stacked fractions, not `3/4`, unless the source book itself deliberately uses slash notation.
- Use professional notation for exponents, roots, comparison signs, multiplication/division, coordinates, angles, segments, parallel/perpendicular/congruence marks, and other mathematical symbols.
- Math glyph size must be proportionate to the surrounding schoolbook text; do not make inline fractions visually huge.
- Before finalizing a mathematics paper, compare representative notation against the learner's actual mathematics book pages and follow the book's conventions where possible.

## Canonical question package

Before final PDF layout, keep one structured source package containing at minimum for each question:

- `paper_model_code`
- paper question number
- backend `question_code` (when already created)
- prompt
- options and their positions/labels
- correct answer
- explanation / correct explanation / final incorrect explanation
- concept id or concept code
- source book code
- source PDF page(s)
- origin (`book`, `adapted`, `generated`)
- relevant source metadata / visual verification status

The PDF and the backend quiz must be generated from the **same canonical question package**. Never recreate the questions separately for the backend after the paper has been approved.

## Approval boundary

Creating a draft paper does **not** create a learner attempt.

Recommended sequence with the current production capability:

1. Generate the canonical question package.
2. Produce and visually QA the paper PDF.
3. User reviews/approves the model.
4. Allocate a unique `paper_model_code`, verify it is unused, publish the same exact questions as one versioned backend quiz/exam pool, and store the immutable model-to-version binding, `paper_content_hash`, `paper_question_count`, and `paper_question_map` on that exact quiz version.
5. Print and solve on paper.
6. User uploads/photos the solved pages.
7. Identify the model by `paper_model_code`, resolve it within the correct workspace to exactly one bound `quiz_version_id`, verify the content hash and version-bound question count, and transcribe answers by printed question number using the stored question map.
8. **Current stop point:** save the validated transcription package for review, but do not create/save a real Exam attempt until the required server-side paper start gate is implemented and deployed.
9. After that server capability exists, start the attempt through the dedicated version-bound paper path, confirm its server validation marker, save each mapped response, submit through the existing grading path, and verify history/review output.

## Existing backend pieces and missing bridge

The current backend already has core storage and grading pieces that can be reused later:

- `quiz_versions`
- `quiz_questions`
- `quiz_question_options`
- `quiz_question_answer_keys`
- `quiz_attempts`
- `quiz_attempt_question_queue`
- `quiz_attempt_answers`
- `flh_exam_save_answer`
- `flh_exam_submit`

The current schema also provides JSONB storage suitable for paper provenance/binding:

- `quiz_versions.settings`
- `quiz_attempts.metadata`

However, these pieces **do not by themselves make production paper ingestion safe or supported**. The missing bridge is the dedicated server-side, workspace-scoped, version-bound paper start/queue-validation operation defined above, plus save-answer enforcement for validated paper attempts.

Once that bridge exists, the intended flow is:

- publish the approved paper as a normal immutable quiz version whose Exam pool contains the exact paper questions,
- store the unique paper model code, canonical package hash, question map, approval metadata, and printed question count on that exact version,
- resolve the model within the correct workspace to that exact version,
- start through the dedicated paper server path,
- require the server-side queue gate to pass,
- save the transcribed choices through the existing answer path only for the validated mapping,
- submit normally through server-authoritative grading,
- store the same paper identity/version/hash provenance on the attempt.

Do **not** directly fabricate percentage/mastery/reward rows from the scanned paper.

## Photo / scan ingestion

When solved pages are uploaded:

1. Confirm the printed `paper_model_code` first.
2. Resolve it within the correct workspace to exactly one approved `quiz_version_id`; stop if the result is missing or ambiguous.
3. Verify the canonical question package hash matches the stored approved `paper_content_hash`.
4. Confirm the version-bound `paper_question_count` matches the printed paper.
5. Confirm all expected pages are present.
6. Read only the learner's marks/answers; do not reinterpret the printed question text from OCR if the canonical model is already known.
7. Map each printed question number through the stored `paper_question_map` to its canonical backend question id.
8. If a mark is ambiguous, ask for clarification for that question instead of guessing.
9. Produce the validated answer transcription package.
10. **If the dedicated version-bound server paper path is not deployed, stop here.** Do not create an attempt or call the generic Exam start/save path.
11. If the dedicated path is deployed, start through it, require the server-side queue validation marker, save only mapped answers, submit normally, and return the learner's normal result/review view when available.

## Reporting semantics

After supported ingestion is implemented, a paper Exam attempt should be treated as `delivery_mode = exam` for normal reporting unless the product later adds a first-class paper delivery mode.

Store paper-specific provenance in attempt metadata, for example:

- `paper_model_code`
- `paper_quiz_version_id`
- `paper_content_hash`
- `paper_queue_validated = true`
- `paper_ingested = true`
- `paper_ingested_at`
- `paper_source = uploaded_photos`

Do not misrepresent paper answers as interactive tablet actions such as hints or retries.

## Safety / data integrity

- Never alter Aya or Mohammad's real progress merely to test this workflow.
- Use the dedicated `test` learner for automated/exploratory QA.
- Do not create a real learner attempt until the paper has actually been solved, the user asks for ingestion, **and the dedicated server paper gate is deployed**.
- Preserve question/version immutability once a paper model has been approved and printed; revisions get a new paper model code/version.
- Never reuse a `paper_model_code` for different content or bind one paper code to multiple quiz versions.
- Never ingest a paper when the approved version, version-bound question count, question mapping, or generated queue does not exactly match the printed model.
- Never bypass the required server paper gate by using the generic latest-version Exam start path.
