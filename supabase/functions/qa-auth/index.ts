import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.10.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WORKSPACE_ID = "55f9224c-8ba7-4cbc-9f88-713e6a6b41df";
const TEST_LEARNER_SLUG = "test";
const QA_QUIZ_SLUG = "qa-automation-core";
const REPOSITORY = "FadiAboAlward/family-learning-hub";
const REPOSITORY_ID = "1343709875";
const ACTOR_ID = "320162789";
const WORKFLOW_PREFIX = `${REPOSITORY}/.github/workflows/qa-smoke.yml@`;
const AUDIENCE = "family-learning-hub-qa";
const SESSION_SECONDS = 10 * 60;
const LEASE_TTL_SECONDS = 15 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function b64url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlText(text: string) {
  return b64url(new TextEncoder().encode(text));
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmac(data: string) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(data));
  return b64url(new Uint8Array(signature));
}

async function issueLearnerSession(learnerId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    typ: "learner",
    learner_id: learnerId,
    workspace_id: WORKSPACE_ID,
    iat: now,
    exp: now + SESSION_SECONDS,
    nonce: crypto.randomUUID(),
    qa: true,
  };
  const body = b64urlText(JSON.stringify(payload));
  return `${body}.${await hmac(body)}`;
}

async function authenticateGithubRunner(oidc: string) {
  if (!oidc) throw new Error("OIDC_REQUIRED");

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(oidc, JWKS, {
      issuer: "https://token.actions.githubusercontent.com",
      audience: AUDIENCE,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_GITHUB_OIDC");
  }

  if (String(payload.repository || "") !== REPOSITORY) throw new Error("REPOSITORY_NOT_ALLOWED");
  if (String(payload.repository_id || "") !== REPOSITORY_ID) throw new Error("REPOSITORY_NOT_ALLOWED");
  if (String(payload.actor_id || "") !== ACTOR_ID) throw new Error("ACTOR_NOT_ALLOWED");
  if (!String(payload.workflow_ref || "").startsWith(WORKFLOW_PREFIX)) throw new Error("WORKFLOW_NOT_ALLOWED");
  if (!["pull_request", "push", "workflow_dispatch"].includes(String(payload.event_name || ""))) {
    throw new Error("EVENT_NOT_ALLOWED");
  }
  if (String(payload.runner_environment || "") !== "github-hosted") throw new Error("RUNNER_NOT_ALLOWED");
}

async function getTestingLearner() {
  const { data: learner, error } = await admin
    .from("learners")
    .select("id,display_name,slug,metadata,is_active")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("slug", TEST_LEARNER_SLUG)
    .eq("is_active", true)
    .maybeSingle();

  const metadata = (learner?.metadata || {}) as Record<string, unknown>;
  if (
    error ||
    !learner ||
    metadata.is_test !== true ||
    metadata.qa_automation !== true ||
    metadata.exclude_from_parent_metrics !== true
  ) {
    throw new Error("QA_LEARNER_NOT_READY");
  }
  return learner;
}

async function latestQaQuizVersionId() {
  const { data: quiz, error: quizError } = await admin
    .from("quizzes")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("slug", QA_QUIZ_SLUG)
    .eq("status", "active")
    .maybeSingle();
  if (quizError || !quiz) throw new Error("QA_QUIZ_NOT_FOUND");

  const { data: version, error: versionError } = await admin
    .from("quiz_versions")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("quiz_id", quiz.id)
    .eq("state", "published")
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError || !version) throw new Error("QA_VERSION_NOT_FOUND");
  return version.id as string;
}

async function clearTestingAttempts(learnerId: string) {
  const versionId = await latestQaQuizVersionId();
  const { count, error } = await admin
    .from("quiz_attempts")
    .delete({ count: "exact" })
    .eq("workspace_id", WORKSPACE_ID)
    .eq("learner_id", learnerId)
    .eq("quiz_version_id", versionId);
  if (error) throw new Error("QA_ATTEMPT_CLEANUP_FAILED");
  return count || 0;
}

async function acquireTestingLease(runId: string) {
  const { data, error } = await admin.rpc("flh_qa_acquire_testing_lease", {
    p_workspace_id: WORKSPACE_ID,
    p_run_id: runId,
    p_ttl_seconds: LEASE_TTL_SECONDS,
  });
  if (error) throw new Error("QA_LEASE_ACQUIRE_FAILED");
  return data === true;
}

async function releaseTestingLease(runId: string) {
  const { data, error } = await admin.rpc("flh_qa_release_testing_lease", {
    p_workspace_id: WORKSPACE_ID,
    p_run_id: runId,
  });
  if (error) throw new Error("QA_LEASE_RELEASE_FAILED");
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "prepare");
    await authenticateGithubRunner(String(body.oidc_token || ""));
    const learner = await getTestingLearner();

    if (action === "prepare") {
      const runId = crypto.randomUUID();
      if (!(await acquireTestingLease(runId))) return response({ error: "QA_BUSY" }, 409);

      try {
        const deletedAttempts = await clearTestingAttempts(learner.id);
        return response({
          session: await issueLearnerSession(learner.id),
          learner: { display_name: learner.display_name, slug: learner.slug },
          run_id: runId,
          quiz_slug: QA_QUIZ_SLUG,
          expires_in: SESSION_SECONDS,
          deleted_attempts: deletedAttempts,
        });
      } catch (error) {
        try {
          await releaseTestingLease(runId);
        } catch {
          // The bounded lease expires automatically; preserve the primary failure.
        }
        throw error;
      }
    }

    if (action === "cleanup") {
      const runId = String(body.run_id || "");
      if (!UUID_RE.test(runId)) return response({ error: "INVALID_RUN_ID" }, 400);
      if (!(await acquireTestingLease(runId))) return response({ error: "QA_LEASE_NOT_OWNED" }, 409);

      try {
        const deletedAttempts = await clearTestingAttempts(learner.id);
        if (!(await releaseTestingLease(runId))) throw new Error("QA_LEASE_RELEASE_FAILED");
        return response({ ok: true, deleted_attempts: deletedAttempts });
      } catch (error) {
        try {
          await releaseTestingLease(runId);
        } catch {
          // The bounded lease expires automatically; preserve the primary failure.
        }
        throw error;
      }
    }

    return response({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "QA_AUTH_FAILED";
    const authErrors = new Set([
      "OIDC_REQUIRED",
      "INVALID_GITHUB_OIDC",
      "REPOSITORY_NOT_ALLOWED",
      "ACTOR_NOT_ALLOWED",
      "WORKFLOW_NOT_ALLOWED",
      "EVENT_NOT_ALLOWED",
      "RUNNER_NOT_ALLOWED",
    ]);
    console.log(JSON.stringify({ event: "qa_auth_denied", error: reason }));
    return response({ error: authErrors.has(reason) ? "QA_AUTH_FAILED" : reason }, authErrors.has(reason) ? 401 : 500);
  }
});
