import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.10.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const WORKSPACE_ID = "55f9224c-8ba7-4cbc-9f88-713e6a6b41df";
const REPOSITORY = "FadiAboAlward/family-learning-hub";
const AUDIENCE = "family-learning-hub-qa";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

function b64url(bytes: Uint8Array) {
  let value = "";
  for (const b of bytes) value += String.fromCharCode(b);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function b64urlText(text: string) { return b64url(new TextEncoder().encode(text)); }
async function hmacKey() {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_ROLE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function hmac(data: string) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function issueLearnerSession(learnerId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { typ: "learner", learner_id: learnerId, workspace_id: WORKSPACE_ID, iat: now, exp: now + 3600, nonce: crypto.randomUUID(), qa: true };
  const body = b64urlText(JSON.stringify(payload));
  return `${body}.${await hmac(body)}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const oidc = String(body.oidc_token || "");
    if (!oidc) throw new Error("OIDC_REQUIRED");
    const { payload } = await jwtVerify(oidc, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: AUDIENCE });
    if (payload.repository !== REPOSITORY) throw new Error("REPOSITORY_NOT_ALLOWED");
    const workflowRef = String(payload.workflow_ref || "");
    if (!workflowRef.startsWith(`${REPOSITORY}/.github/workflows/qa-smoke.yml@`)) throw new Error("WORKFLOW_NOT_ALLOWED");
    if (!["pull_request", "push", "workflow_dispatch"].includes(String(payload.event_name || ""))) throw new Error("EVENT_NOT_ALLOWED");

    const { data: learner, error } = await admin.from("learners")
      .select("id,display_name,slug,metadata,is_active")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("slug", "test")
      .eq("is_active", true)
      .maybeSingle();
    if (error || !learner || !(learner.metadata || {}).is_test || !(learner.metadata || {}).qa_automation) throw new Error("QA_LEARNER_NOT_READY");

    return new Response(JSON.stringify({ session: await issueLearnerSession(learner.id), learner: { display_name: learner.display_name, slug: learner.slug } }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "QA_AUTH_FAILED";
    console.log(JSON.stringify({ event: "qa_auth_denied", error: reason }));
    return new Response(JSON.stringify({ error: "QA_AUTH_FAILED" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
});
