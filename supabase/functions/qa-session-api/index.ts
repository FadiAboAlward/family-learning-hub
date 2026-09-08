import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WORKSPACE_ID = "55f9224c-8ba7-4cbc-9f88-713e6a6b41df";
const TEST_LEARNER_SLUG = "test";
const QA_QUIZ_SLUG = "sy-g7-integers-add-subtract-v1";
const QA_AUDIENCE = "family-learning-hub-qa";
const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_REPOSITORY = "FadiAboAlward/family-learning-hub";
const GITHUB_REPOSITORY_ID = "1343709875";
const GITHUB_ACTOR_ID = "320162789";
const GITHUB_WORKFLOW_PREFIX = `${GITHUB_REPOSITORY}/.github/workflows/qa-smoke.yml@`;
const SESSION_SECONDS = 10 * 60;
const githubKeys = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function b64url(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlText(text: string) {
  return b64url(new TextEncoder().encode(text));
}

async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
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

async function authenticateGithubRunner(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const token = authorization.slice(7).trim();
  if (!token) throw new Error("AUTH_REQUIRED");

  const { payload } = await jwtVerify(token, githubKeys, {
    issuer: GITHUB_ISSUER,
    audience: QA_AUDIENCE,
  });

  const repository = String(payload.repository || "");
  const repositoryId = String(payload.repository_id || "");
  const actorId = String(payload.actor_id || "");
  const workflowRef = String(payload.workflow_ref || "");
  const eventName = String(payload.event_name || "");
  const runnerEnvironment = String(payload.runner_environment || "");

  if (repository !== GITHUB_REPOSITORY || repositoryId !== GITHUB_REPOSITORY_ID) {
    throw new Error("REPOSITORY_NOT_ALLOWED");
  }
  if (actorId !== GITHUB_ACTOR_ID) throw new Error("ACTOR_NOT_ALLOWED");
  if (!workflowRef.startsWith(GITHUB_WORKFLOW_PREFIX)) throw new Error("WORKFLOW_NOT_ALLOWED");
  if (!["pull_request", "push", "workflow_dispatch"].includes(eventName)) throw new Error("EVENT_NOT_ALLOWED");
  if (runnerEnvironment !== "github-hosted") throw new Error("RUNNER_NOT_ALLOWED");

  return { eventName };
}

async function getTestingLearner() {
  const { data, error } = await admin
    .from("learners")
    .select("id,display_name,slug,metadata,is_active")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("slug", TEST_LEARNER_SLUG)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) throw new Error("TEST_LEARNER_NOT_FOUND");
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  if (metadata.is_test !== true || metadata.exclude_from_parent_metrics !== true) {
    throw new Error("TEST_LEARNER_NOT_ISOLATED");
  }
  return data;
}

async function latestQaQuizVersionId() {
  const { data: quiz, error: quizError } = await admin
    .from("quizzes")
    .select("id,slug,status")
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
  const { error, count } = await admin
    .from("quiz_attempts")
    .delete({ count: "exact" })
    .eq("workspace_id", WORKSPACE_ID)
    .eq("learner_id", learnerId)
    .eq("quiz_version_id", versionId);
  if (error) throw new Error("QA_ATTEMPT_CLEANUP_FAILED");
  return count || 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    await authenticateGithubRunner(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const learner = await getTestingLearner();

    if (action === "prepare") {
      const deletedAttempts = await clearTestingAttempts(learner.id);
      const session = await issueLearnerSession(learner.id);
      return json({
        ok: true,
        learner: {
          display_name: learner.display_name,
          slug: learner.slug,
          is_test: true,
        },
        quiz_slug: QA_QUIZ_SLUG,
        session,
        expires_in: SESSION_SECONDS,
        deleted_attempts: deletedAttempts,
      });
    }

    if (action === "cleanup") {
      const deletedAttempts = await clearTestingAttempts(learner.id);
      return json({ ok: true, deleted_attempts: deletedAttempts });
    }

    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SERVER_ERROR";
    const authErrors = new Set([
      "AUTH_REQUIRED",
      "JWTClaimValidationFailed",
      "JWSSignatureVerificationFailed",
      "REPOSITORY_NOT_ALLOWED",
      "ACTOR_NOT_ALLOWED",
      "WORKFLOW_NOT_ALLOWED",
      "EVENT_NOT_ALLOWED",
      "RUNNER_NOT_ALLOWED",
    ]);
    return json({ error: message }, authErrors.has(message) ? 401 : 500);
  }
});
