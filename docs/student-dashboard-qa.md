# Student dashboard — FLH-034

- FEATURE_ID: FLH-FEAT-2026-034
- SPEC_VERSION: 1.0
- SPEC_URL: https://docs.google.com/document/d/1ytJP3w8LN-spgouSuJhPvAXAN2a3NXl_4BwREjczCX4/edit
- DRIVE_REVISION_ID: 2
- Issue: https://github.com/FadiAboAlward/family-learning-hub/issues/175
- Base: `deaf4ecc87f17084bdaa67947507d4481d1faf75`

## Requirement evidence

| Criteria | Evidence |
| --- | --- |
| AC01 next step; AC03 saved/ready/new/complete distinctions | `student-dashboard.unit.mjs`; actual Home/launch/resume in `learner-journey-browser.mjs` |
| AC02 all catalog paths, no duplicate tasks, no catalog-only homework | Dashboard unit tests; existing 34 learner-journey API/contract regressions; browser book/unit/extra/dedicated fixtures |
| AC04 filters/counts/four-item limit/show more; no starts on reads | Dashboard browser assertions and request counters |
| AC05 preservation of library and independent history | Browser hierarchy, four compact attempts, Learning/Exam filters, scores/errors/review; unchanged history and launcher source files |
| AC06 refresh, return, error/retry, switching/reload | Browser injected failure and delayed previous-session response, forward/reverse synthetic session switches with distinct history and denied cross-session detail; cache unit regressions |
| AC07 design, RTL, mobile/desktop, touch targets | Actual-runtime screenshots at 390×844 and 1280×900; overflow/RTL/44px assertions; shared-renderer math in actual dashboard hero/row titles; approved local interactive browser visual inspection |
| AC08 isolated data, original immutable-version routing | Existing learner-journey unit/API tests; actual-runtime synthetic browser launch/resume/results; Runner-local authenticated workflow when available |

## Deliberate design adaptations

The supplied HTML is a visual/interaction reference. Its sample names, exercises, marks, dates, simulation dialogs and academic illustration are not imported. The existing application shell, progress, rewards, library and independent attempt history remain. The dashboard adopts the purple/pastel card language, next-step card, three counters, filters, compact list and completed disclosure. It uses neutral Arabic, the current font/icons and the existing shell width. Filters can wrap on narrow screens instead of overflowing. Buttons open the real existing Learning, Exam and result flows.

Dashboard titles and context pass escaped text through the existing shared math renderer, with escaped plain text as the availability fallback. A real Home fixture checks `19 - (-7)` remains one logical LTR expression within the RTL hero and row. The original renderer and stored academic data are unchanged.

The catalog already excludes general unlinked program-book quizzes and supplies start availability through program quizzes or eligible version assignments. This is reused without a new assignment model, API field, migration or backend change. A missing/unknown/unavailable journey is not labelled NEW.

## Validation and release boundary

Run static QA, convention-based `tests/*.unit.mjs`, learner-journey API contracts, cache regressions, Exam API tests and math/content direction guards before browser tests. Browser tests use `FLH_QA_ISOLATION_MODE=mock-local`, the repository isolation harness and synthetic Testing identities only. CI runs the same dashboard/library/history browser test and uploads PNGs plus an exact-head SHA/hash manifest as a temporary seven-day artifact. Screenshots are not committed.

Local Docker was unavailable during implementation (`dockerDesktopLinuxEngine` pipe absent), so SQL and unmocked authenticated acceptance must use the existing isolated GitHub runner. Record current Actions, CodeRabbit and TestSprite run IDs/results in the PR; local synthetic coverage is not proof of unmocked backend acceptance. No Production traffic, real learner activity, migration, deployment or merge is authorized by this PR. After later approval, verify the deployed dashboard and existing history/library with the isolated Testing learner.
