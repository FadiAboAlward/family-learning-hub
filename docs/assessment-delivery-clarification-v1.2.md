# FLH-FEAT-2026-027 proposed v1.2 delivery clarification

Status: PROPOSED, awaiting explicit approval. Active specification remains v1.1 Google Drive revision 4. Preserve v1.0 revision 2 and v1.1 revision 4 unchanged. This proposal does not authorize merging, Production migration/deployment, real sending, new provider choice or real learner QA.

The user identified Gmail through connected ChatGPT as the approved operational channel in Academic Assessment SOP v1.13, and authorized scoped outbox/receipt infrastructure on 12 October 2026. There is no approved integrated server sender or provider-reconciliation transport in the repository. The implemented infrastructure is deliberately separate from a claim that automated delivery is complete.

Proposed clarification: allow AC-04's operational notification completion to be evidenced by an explicitly authorized human/agent Gmail handoff followed by a reviewed, exact SENT message-ID readback. Keep automated sending and independent backend Gmail reconciliation as separately BLOCKED capabilities. Publication release alone never completes delivery.

The simpler alternative is the existing manual SOP with an unstructured delivery note. It lacks transactional version-scoped claim and unknown-send protection. The scoped outbox on the existing publication receipt adds those protections with no sender service, dependency or provider credential. An integrated automatic Gmail sender would require a separate authenticated transport, credential ownership and reconciliation contract; it is outside this proposal.

Required gates if this clarification is approved:

1. Immutable exact released workspace/quiz/version/learner/program/candidate identity; reviewed recipient and verified Learning/Exam links before preparing the envelope.
2. One frozen envelope and one transactional handoff claim per version; simultaneous and repeated claims must not create another handoff.
3. After an uncertain send, block new claims indefinitely until the exact SENT record is reconciled. No expiry or automatic resend.
4. Operator verifies the actual connected Gmail readback. Store immutable message ID, exact content hash, source, observation time and authenticated reviewer. SENT label, intended recipient, subject, complete body/links/marker must match. Never accept a bare `verified:true`, a draft ID, a snippet or an unverified message ID.
5. Server confirmation represents an operator-reviewed witness. It does not cryptographically prove the provenance of externally supplied JSON. Independent server provider verification must remain explicitly unavailable.
6. QA uses synthetic Testing fixtures; no real sends or student records. Positive/negative identity, content, authorization, uncertain status, concurrency, duplicate-ID and cleanup tests must pass on the final head. Real Gmail interoperability remains a separate authorized operational check.
7. Preserve authentication, RLS, tenant isolation, published history and the v1.1 hold/release contract. No new provider or broad learner access.

Affected files: shared assessment-delivery validator/command helper, existing parent `learning-api` dispatcher, forward delivery-outbox migration, unit and isolated DB/API contracts, architecture and publication runbook. No historical migration is modified. Production requires separate approval and verification.

Approval requested only for treating this operational Gmail witness as complete notification evidence. The current implementation/QA authorization covers infrastructure; it does not approve that completion-rule change.
