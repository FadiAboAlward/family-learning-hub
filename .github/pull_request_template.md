## Summary

Describe what changed and why.

## User impact

- Student flow affected: yes / no
- Parent flow affected: yes / no
- Data/access rules affected: yes / no
- Learning or exam behavior affected: yes / no

## QA checklist

- [ ] The change is data-driven; no learner, grade, book, or quiz access was hard-coded unnecessarily.
- [ ] Learner content isolation still works: one learner cannot see another learner's assigned content.
- [ ] Student hierarchy remains clear: program or standalone book → book → unit → Learning/Exam.
- [ ] Learning Mode still saves/resumes correctly and does not count an unconfirmed first tap as an answer.
- [ ] Exam Mode still autosaves, allows review/flagging, and does not reveal correctness before submission.
- [ ] Arabic/RTL copy was checked; no unintended English UI labels or reversed school-year text were introduced.
- [ ] Mobile interaction and touch targets were considered.
- [ ] Tests were added or updated for behavior changed by this PR.
- [ ] QA Gate / Static quality passes.
- [ ] QA Gate / Browser smoke passes.

## Notes for reviewer

Call out migrations, API changes, risky assumptions, or anything that deserves extra attention.
