export const WORKSPACE_ID = '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
export const TEST_LEARNER_SLUG = 'test';
export const QA_QUIZ_SLUG = 'qa-automation-core';
export const REPOSITORY = 'FadiAboAlward/family-learning-hub';
export const REPOSITORY_ID = '1343709875';
export const ACTOR_ID = '320162789';
export const WORKFLOW_PREFIX = `${REPOSITORY}/.github/workflows/qa-smoke.yml@`;
export const AUDIENCE = 'family-learning-hub-qa';
export const SESSION_SECONDS = 10 * 60;
export const LEASE_TTL_SECONDS = 15 * 60;
export const LEGACY_LEASE_TTL_SECONDS = SESSION_SECONDS;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_EVENTS = new Set(['pull_request', 'push', 'workflow_dispatch']);

/** Validate the GitHub OIDC claims that bind QA access to this repository and workflow. */
export function validateGithubClaims(payload) {
  if (String(payload?.repository || '') !== REPOSITORY) throw new Error('REPOSITORY_NOT_ALLOWED');
  if (String(payload?.repository_id || '') !== REPOSITORY_ID) throw new Error('REPOSITORY_NOT_ALLOWED');
  if (String(payload?.actor_id || '') !== ACTOR_ID) throw new Error('ACTOR_NOT_ALLOWED');
  if (!String(payload?.workflow_ref || '').startsWith(WORKFLOW_PREFIX)) throw new Error('WORKFLOW_NOT_ALLOWED');
  if (!ALLOWED_EVENTS.has(String(payload?.event_name || ''))) throw new Error('EVENT_NOT_ALLOWED');
  if (String(payload?.runner_environment || '') !== 'github-hosted') throw new Error('RUNNER_NOT_ALLOWED');
  return true;
}

/** Normalize the temporary legacy request shape and explicit prepare/cleanup actions. */
export function normalizeQaAction(action) {
  return action == null ? 'legacy' : String(action);
}

/**
 * Execute one QA lifecycle action against injected lease/session dependencies.
 * This keeps authorization-independent state transitions testable without HTTP or Supabase.
 */
export async function executeQaAction({ action, runId, learner }, deps) {
  const normalized = normalizeQaAction(action);
  const {
    createRunId,
    acquireLease,
    releaseLease,
    clearAttempts,
    issueSession,
  } = deps;

  if (normalized === 'legacy') {
    const legacyRunId = createRunId();
    if (!(await acquireLease(legacyRunId, LEGACY_LEASE_TTL_SECONDS))) {
      return { status: 409, body: { error: 'QA_BUSY' } };
    }
    try {
      await clearAttempts(learner.id);
      return {
        status: 200,
        body: {
          session: await issueSession(learner.id),
          learner: { display_name: learner.display_name, slug: learner.slug },
          legacy_lock_seconds: LEGACY_LEASE_TTL_SECONDS,
        },
      };
    } catch (error) {
      try { await releaseLease(legacyRunId); } catch {}
      throw error;
    }
  }

  if (normalized === 'prepare') {
    const ownedRunId = createRunId();
    if (!(await acquireLease(ownedRunId, LEASE_TTL_SECONDS))) {
      return { status: 409, body: { error: 'QA_BUSY' } };
    }
    try {
      const deletedAttempts = await clearAttempts(learner.id);
      return {
        status: 200,
        body: {
          session: await issueSession(learner.id),
          learner: { display_name: learner.display_name, slug: learner.slug },
          run_id: ownedRunId,
          quiz_slug: QA_QUIZ_SLUG,
          expires_in: SESSION_SECONDS,
          deleted_attempts: deletedAttempts,
        },
      };
    } catch (error) {
      try { await releaseLease(ownedRunId); } catch {}
      throw error;
    }
  }

  if (normalized === 'cleanup') {
    const requestedRunId = String(runId || '');
    if (!UUID_RE.test(requestedRunId)) return { status: 400, body: { error: 'INVALID_RUN_ID' } };
    if (!(await acquireLease(requestedRunId, LEASE_TTL_SECONDS))) {
      return { status: 409, body: { error: 'QA_LEASE_NOT_OWNED' } };
    }
    try {
      const deletedAttempts = await clearAttempts(learner.id);
      if (!(await releaseLease(requestedRunId))) throw new Error('QA_LEASE_RELEASE_FAILED');
      return { status: 200, body: { ok: true, deleted_attempts: deletedAttempts } };
    } catch (error) {
      try { await releaseLease(requestedRunId); } catch {}
      throw error;
    }
  }

  return { status: 400, body: { error: 'UNKNOWN_ACTION' } };
}
