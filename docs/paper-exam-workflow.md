# Paper Exam Workflow

This document is the canonical workflow for **paper-based exams/worksheets that must still become first-class learner attempts in Family Learning Hub**.

It applies to Aya, Mohammad, and future learners. Do not hard-code learner-specific rules into the workflow itself.

## Goal

Allow ChatGPT to create a print-ready paper exam, let the learner solve it away from the tablet, then ingest the solved paper back into the existing Family Learning Hub backend so the attempt appears in normal progress/history/reporting.

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
- the learner attempt metadata when the solved paper is ingested.

The code is the bridge between the physical pages and the backend record.

### Unique allocation and immutable quiz-version binding

`paper_model_code` is a unique identifier within a Family Learning Hub workspace, not merely a human-readable label.

Before a paper is approved/published:

1. Check the backend for an existing approved paper with the same `paper_model_code`.
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
7. Keep `paper_question_count` version-bound in `quiz_versions.settings.paper_exam`. The paper-specific start operation must read this count from the exact approved `quiz_version_id` and use it for queue construction. Do not rely on `quizzes.delivery_config.exam.question_count` for paper ingestion unless every paper version under that quiz is guaranteed to have one immutable count. Never fall back to the generic default (currently 10) for a paper exam.

After approval/printing:

- Never resolve a scanned paper to the **latest** quiz version.
- Resolve `paper_model_code` to **exactly one** approved `quiz_version_id`.
- If the lookup returns zero versions or more than one version, stop ingestion and resolve the data-integrity problem; never guess.
- Start the learner attempt against that exact bound `quiz_version_id`.
- Copy `paper_model_code`, the bound `paper_quiz_version_id`, and `paper_content_hash` into `quiz_attempts.metadata` for provenance.
- If the canonical package hash no longer matches the approved `paper_content_hash`, block ingestion until the discrepancy is resolved.
- Any content change after approval requires a new quiz version **and a new `paper_model_code` revision**.

This binding rule prevents a photographed paper from being attached to the wrong model or graded against a newer/different quiz version.

### Current Exam V2 compatibility requirement

The generic `flh_exam_start` path historically resolves by quiz slug and may select the latest published version. That generic latest-version behavior is **not sufficient for paper ingestion**.

Before the first production paper ingestion, the server-side start operation used by ChatGPT must be version-bound: it must accept or otherwise transactionally resolve the approved immutable `quiz_version_id`, build the queue only from that version, read `paper_question_count` from that exact version's paper metadata, and persist the matching paper provenance on the attempt. If a version-bound start path is not available, do not ingest the paper through the generic latest-version path.

The created queue must exactly match both the approved `paper_question_count` and `paper_question_map` from the bound version. Any mismatch blocks ingestion.

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

Recommended sequence:

1. Generate the canonical question package.
2. Produce and visually QA the paper PDF.
3. User reviews/approves the model.
4. Allocate a unique `paper_model_code`, verify it is unused, publish the same exact questions as one versioned backend quiz/exam pool, and store the immutable model-to-version binding, `paper_content_hash`, `paper_question_count`, and `paper_question_map` on that exact quiz version.
5. Print and solve on paper.
6. User uploads/photos the solved pages.
7. Identify the model by `paper_model_code`, resolve it to exactly one bound `quiz_version_id`, verify the content hash and version-bound question count, and transcribe answers by printed question number using the stored question map.
8. Create a normal server-authoritative Exam attempt against that exact approved quiz version using a version-bound start path; do not fall back to a generic latest-version lookup.
9. Verify the created queue contains exactly the approved printed question count and mapped questions, then save each response using the mapped backend question id/option position.
10. Submit through the existing server-authoritative exam grading path.
11. Verify the attempt appears in learner history/reporting and review displays the same questions/explanations.

## Existing backend bridge

The current backend already has the core storage and grading pieces required for manual paper ingestion without adding a separate paper-exam product mode:

- `quiz_versions`
- `quiz_questions`
- `quiz_question_options`
- `quiz_question_answer_keys`
- `quiz_attempts`
- `quiz_attempt_question_queue`
- `quiz_attempt_answers`
- `flh_exam_start`
- `flh_exam_save_answer`
- `flh_exam_submit`

The current schema also provides JSONB storage suitable for the paper provenance/binding without a new table:

- `quiz_versions.settings`
- `quiz_attempts.metadata`

The robust bridge is therefore:

- publish the approved paper as a normal versioned quiz whose Exam pool contains the exact paper questions,
- store the unique paper model code, canonical package hash, question map, approval metadata, and printed question count on that exact quiz version,
- after the paper is solved, resolve the code to that exact version and use a version-bound server start operation for that learner,
- have that version-bound start operation read `paper_question_count` from the bound version and construct the queue only from that version,
- verify the queue contains exactly the mapped printed questions before saving answers,
- save the transcribed paper choices into that attempt, then submit it normally,
- store the same paper identity/version/hash provenance on the attempt.

The existing save/submit grading path remains reusable, but the generic latest-version start behavior must not be used for paper ingestion unless it has been made version-bound.

This preserves server-authoritative grading and lets existing attempt history/reporting continue to work.

Do **not** directly fabricate percentage/mastery/reward rows from the scanned paper when the normal server grading path can produce them.

## Photo / scan ingestion

When solved pages are uploaded:

1. Confirm the printed `paper_model_code` first.
2. Resolve it to exactly one approved `quiz_version_id`; stop if the result is missing or ambiguous.
3. Verify the canonical question package hash matches the stored approved `paper_content_hash`.
4. Confirm the version-bound `paper_question_count` and expected queue size both match the printed paper.
5. Confirm all expected pages are present.
6. Read only the learner's marks/answers; do not reinterpret the printed question text from OCR if the canonical model is already known.
7. Map each printed question number through the stored `paper_question_map` to its canonical backend question id.
8. If a mark is ambiguous, ask for clarification for that question instead of guessing.
9. Start/submit the mapped answers through the server-authoritative grading path against the bound version; stop if the created queue is not an exact match for the approved paper mapping/count.
10. Return the learner's normal review/result link or attempt view when available.

## Reporting semantics

A paper Exam attempt should be treated as `delivery_mode = exam` for normal reporting unless the product later adds a first-class paper delivery mode.

Store paper-specific provenance in attempt metadata, for example:

- `paper_model_code`
- `paper_quiz_version_id`
- `paper_content_hash`
- `paper_ingested = true`
- `paper_ingested_at`
- `paper_source = uploaded_photos`

Do not misrepresent paper answers as interactive tablet actions such as hints or retries.

## Safety / data integrity

- Never alter Aya or Mohammad's real progress merely to test this workflow.
- Use the dedicated `test` learner for automated/exploratory QA.
- Do not create a real learner attempt until the paper has actually been solved and the user asks for ingestion.
- Preserve question/version immutability once a paper model has been approved and printed; revisions get a new paper model code/version.
- Never reuse a `paper_model_code` for different content or bind one paper code to multiple quiz versions.
- Never ingest a paper when the approved version, version-bound question count, question mapping, or generated queue does not exactly match the printed model.
