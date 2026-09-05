## Summary

Describe what changed and why.

## User impact

- Student flow affected: yes / no
- Parent flow affected: yes / no
- Data/access rules affected: yes / no
- Learning or exam behavior affected: yes / no
- Production deploy/migration required: yes / no
- Security/authorization boundary affected: yes / no

## QA checklist

- [ ] The change is data-driven; no learner, grade, book, or quiz access was hard-coded unnecessarily. (Mark N/A with a note if documentation-only.)
- [ ] Learner content isolation still works: one learner cannot see another learner's assigned content. (Or N/A with reason.)
- [ ] Student hierarchy remains clear: program or standalone book → book → unit → Learning/Exam. (Or N/A with reason.)
- [ ] Learning Mode still saves/resumes correctly and does not count an unconfirmed first tap as an answer. (Or N/A with reason.)
- [ ] Exam Mode still autosaves, allows review/flagging, and does not reveal correctness before submission. (Or N/A with reason.)
- [ ] Arabic/RTL copy was checked; no unintended English UI labels or reversed school-year text were introduced. (Or N/A with reason.)
- [ ] Mobile interaction and touch targets were considered. (Or N/A with reason.)
- [ ] Tests were added or updated for behavior changed by this PR, or the PR explains why no test change is needed.
- [ ] QA Gate / Static quality passes on the latest relevant head.
- [ ] QA Gate / Browser smoke passes on the latest relevant head.
- [ ] CodeRabbit review completed on the current reviewed head; all actionable findings are fixed or explicitly resolved with a verified architectural reason.
- [ ] If meaningful fixes were made after review, QA and CodeRabbit were rerun/re-reviewed as appropriate.
- [ ] Deployment/migration steps are documented below, or explicitly marked N/A.
- [ ] Production verification steps are documented below, or explicitly marked N/A.

## Deployment / migration

- Required: yes / no
- Steps or N/A reason:

## Production verification

- Required: yes / no
- Exact production checks to perform after merge, or N/A reason:

## Notes for reviewer

Call out migrations, API changes, security/authorization boundaries, risky assumptions, production-state drift, or anything that deserves extra attention.
