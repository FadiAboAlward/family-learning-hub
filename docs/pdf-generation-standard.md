# PDF Generation Standard

This document is the canonical PDF creation standard for Family Learning Hub artifacts, especially print-ready exams, worksheets, parent reports, and other fixed-layout documents.

## Core principle

A PDF is a **fixed visual deliverable**. Treat generation as a layout-and-verification workflow, not as simple text export.

The mandatory loop is:

`specify -> author -> render -> inspect -> revise -> re-render -> deliver`

Never deliver a newly generated PDF solely because the file was created successfully.

## Format selection

Choose the authoring method based on the artifact, while the final deliverable may still be PDF.

- Fixed, compact, programmatic worksheets/exams: use a deterministic layout engine suitable for precise A4 composition.
- Long text-heavy business documents: author in DOCX when that produces more reliable typography, then convert to PDF.
- Slide-like visual documents: author in PPTX/Slides and export to PDF.
- If one format repeatedly fights the required layout, change the authoring pipeline rather than degrading the design.

For Family Learning Hub paper exams, the PDF itself is the canonical print deliverable; editable DOCX/Google Docs is optional and should not replace a better PDF merely for editability.

## User specification is a hard contract

Before layout, identify and freeze explicit constraints such as:

- page size and orientation,
- exact page count,
- exact question/item count,
- margins,
- columns,
- answer method,
- required headings/metadata,
- whether a separate answer key is needed.

Do not silently change these to make layout easier.

When a paper exam is specified as **2 A4 pages / 20 questions**, the final PDF must remain exactly 2 pages and 20 questions unless the user approves a change.

## Space utilization

Good space utilization does **not** mean filling every square millimeter with tiny content.

Target:

- no large accidental blank regions,
- no obvious imbalance between columns/pages,
- comfortable reading size,
- consistent question rhythm,
- enough separation to scan quickly,
- useful answer/working space when appropriate.

If large blank space remains, fix layout in this order:

1. rebalance items across columns/pages,
2. adjust block spacing and section placement,
3. enlarge math/typography modestly,
4. add useful working/answer space,
5. only then revisit the structure with the user if a genuine constraint conflict remains.

Do not respond to blank space by automatically adding more questions or shrinking the font.

## Column layout

For two-column A4 worksheets/exams:

- Make both columns visually balanced.
- Keep one question block together when possible.
- Avoid a section heading stranded at the bottom of a column.
- Avoid splitting prompt from options across columns/pages.
- Use the center gutter as a clear visual divider without wasting excessive width.
- Group related questions under one skill heading instead of repeating the heading for every question.

## Typography

- Use a readable Arabic font with strong glyph coverage.
- Keep font size appropriate for school print, not screen microcopy.
- Use clear hierarchy: title, compact metadata, section heading, question prompt, options.
- Avoid excessive decorative styles.
- Avoid large headers that consume teaching space without adding value.

## Mathematics

All PDF math must comply with `docs/math-rendering-invariant.md` and the source-book conventions.

Required:

- Arabic prose RTL.
- Mathematical expressions logically LTR and directionally isolated during authoring.
- Leading negative signs preserved.
- Operand order preserved.
- Proper stacked fractions when the source style uses them.
- Correct superscripts/exponents.
- Correct roots, comparison signs, multiplication/division signs, coordinates, geometry marks, and other symbols.
- Inline math size visually matched to surrounding text; no oversized fractions.

For curriculum artifacts, inspect representative source-book pages before finalizing notation and follow the book's symbol/notation conventions whenever practical.

## Render-first QA

Every final PDF must be rendered to page images and inspected visually.

Minimum checks per page:

- exact page count,
- exact requested item/question count,
- no clipped text,
- no overlaps,
- no broken/missing glyphs,
- no black squares,
- no reversed math,
- no malformed fractions/superscripts,
- no large accidental blank region,
- no tiny unreadable text,
- no question split awkwardly from its choices,
- consistent margins and gutter,
- correct model/version code and learner/course metadata when applicable.

For tricky math or renderer-sensitive documents, verify in a second renderer if needed.

## Visual QA is iterative

If the rendered page is not good enough, revise and re-render. Do not explain away visible defects.

A file is not considered final until the rendered pages pass visual inspection.

## Deliverable hygiene

- Keep only final user-facing files in the delivery location.
- Give final files clear names.
- For exams, provide the answer key separately unless the user asks otherwise.
- Use a stable model/version code for artifacts that must later map to backend data.
- Do not expose internal temporary files or intermediate renders as final deliverables.

## Family Learning Hub paper-exam default

When the user asks for a standard print exam and does not override the design, prefer the approved compact pattern from `docs/paper-exam-workflow.md`:

- A4 portrait,
- two pages for a 20-question standard paper,
- two columns per page,
- one visual block per question,
- skill headings once per group,
- professional schoolbook-like mathematics,
- direct answer marking beside the question when a separate answer sheet would waste space,
- unique paper model code,
- final render QA before delivery.
