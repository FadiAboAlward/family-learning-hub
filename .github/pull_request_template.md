## Summary

Describe what changed and why.

## User impact

- Student flow affected: yes / no
- Parent flow affected: yes / no
- Data/access rules affected: yes / no
- Learning or exam behavior affected: yes / no
- Production deployment required: yes / no
- Database migration required: yes / no
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
- Validated PR-head SHA for every required pre-merge gate: `<sha>`
- [ ] QA Gate / Static quality passed for the exact PR-head SHA recorded above.
- [ ] QA Gate / Browser smoke passed for the exact same PR-head SHA recorded above.
- [ ] CodeRabbit review completed for the exact same PR-head SHA; all actionable findings are fixed or explicitly resolved with a verified architectural reason.
- [ ] If the PR-head SHA changed after any required result, Static quality, Browser smoke, and CodeRabbit review were all rerun/re-reviewed for the new SHA and the recorded SHA above was updated.
- [ ] Production deployment steps are documented below, or explicitly marked N/A.
- [ ] Database migration steps and reconciliation requirements are documented below, or explicitly marked N/A.
- [ ] Production verification plan is documented below, or explicitly marked N/A.

## Production deployment

- Required: yes / no
- Deployment target / identifier:
- Steps or N/A reason:

## Database migration

- Required: yes / no
- Migration identity / filename, or N/A reason:
- Existing-production vs fresh-database state checked: yes / no / N/A
- `supabase_migrations.schema_migrations` reconciled when applicable: yes / no / N/A
- If production drift exists, new forward reconciliation migration used: yes / no / N/A
- Apply/rollback notes:

## Production verification

- Required: yes / no
- Exact production checks to perform after merge, or N/A reason:

### Post-merge completion record

Do not describe delivery as complete until this record is filled when production verification is required.

- Status: pending / completed / N/A
- Result:
- Timestamp (UTC):
- Verifier:
- Deployment / migration identifier:
- Evidence link or exact evidence reference:

## Notes for reviewer

Call out migrations, API changes, security/authorization boundaries, risky assumptions, production-state drift, or anything that deserves extra attention.
