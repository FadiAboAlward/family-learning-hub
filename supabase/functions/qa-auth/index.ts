import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.10.0";
import {
  ACTOR_ID,
  AUDIENCE,
  QA_QUIZ_SLUG,
  REPOSITORY,
  REPOSITORY_ID,
  SESSION_SECONDS,
  TEST_LEARNER_SLUG,
  WORKFLOW_PREFIX,
  WORKSPACE_ID,
  executeQaAction,
  normalizeQaAction,
  validateGithubClaims,
} from "./logic.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

/** Return a non-cacheable JSON response. */
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Encode bytes using URL-safe base64 without padding. */
function b64url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Encode UTF-8 text using URL-safe base64. */
function b64urlText(text: string) {
  return b64url(new TextEncoder().encode(text));
}

/** Import the service-role key as the HMAC signing key used by learner sessions. */
async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Sign one encoded learner-session payload. */
async function hmac(data: string) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(data));
  return b64url(new Uint8Array(signature));
}

/** Issue the short-lived learner session consumed by existing Family Learning Hub APIs. */
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

/** Verify GitHub's JWT cryptographically, then enforce the repository/workflow claim boundary. */
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
  validateGithubClaims(payload);
}

/** Load the one canonical isolated Testing learner and reject unsafe metadata drift. */
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

/** Resolve the latest published version of the fixed QA-only quiz. */
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

/** Delete only Testing attempts for the canonical QA quiz version. */
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

/** Acquire or renew the single database-backed Testing lease. */
async function acquireTestingLease(runId: string, ttlSeconds: number) {
  const { data, error } = await admin.rpc("flh_qa_acquire_testing_lease", {
    p_workspace_id: WORKSPACE_ID,
    p_run_id: runId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error("QA_LEASE_ACQUIRE_FAILED");
  return data === true;
}

/** Release the Testing lease only when the caller owns its run id. */
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
    await authenticateGithubRunner(String(body.oidc_token || ""));
    const learner = await getTestingLearner();
    const result = await executeQaAction(
      {
        action: normalizeQaAction(body.action),
        runId: body.run_id,
        learner,
      },
      {
        createRunId: () => crypto.randomUUID(),
        acquireLease: acquireTestingLease,
        releaseLease: releaseTestingLease,
        clearAttempts: clearTestingAttempts,
        issueSession: issueLearnerSession,
      },
    );
    return response(result.body, result.status);
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

// Keep these immutable-boundary constants referenced here so repository security review can see the exact scope.
void REPOSITORY;
void REPOSITORY_ID;
void ACTOR_ID;
void WORKFLOW_PREFIX;
