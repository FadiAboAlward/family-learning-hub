import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const WORKSPACE_ID = "55f9224c-8ba7-4cbc-9f88-713e6a6b41df";
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function cors(origin: string | null) {
  const allowed = new Set([
    "https://fadiaboalward.github.io",
    "http://localhost:5173",
    "http://localhost:4173",
  ]);
  return {
    "Access-Control-Allow-Origin": origin && allowed.has(origin) ? origin : "https://fadiaboalward.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}
function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}
function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function b64urlText(text: string) { return b64url(new TextEncoder().encode(text)); }
function fromB64url(s: string) {
  const norm = s.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((s.length + 3) % 4);
  const raw = atob(norm);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}
async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacKey() {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_ROLE), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function hmac(data: string) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function verifyHmac(data: string, signature: string) {
  try { return crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(signature), new TextEncoder().encode(data)); }
  catch { return false; }
}
async function issueLearnerSession(learnerId: string, workspaceId: string) {
  const payload = {
    typ: "learner",
    learner_id: learnerId,
    workspace_id: workspaceId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
    nonce: crypto.randomUUID(),
  };
  const body = b64urlText(JSON.stringify(payload));
  return `${body}.${await hmac(body)}`;
}
async function verifyLearnerSession(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const token = auth.slice(7).trim();
  const [body, sig] = token.split(".");
  if (!body || !sig || !(await verifyHmac(body, sig))) throw new Error("INVALID_SESSION");
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  if (payload.typ !== "learner" || payload.workspace_id !== WORKSPACE_ID || !payload.learner_id) throw new Error("INVALID_SESSION");
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("SESSION_EXPIRED");
  return payload as { learner_id: string; workspace_id: string };
}

async function loginGuard(req: Request, slug: string) {
  const forwarded = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
  const ua = req.headers.get("user-agent") || "unknown";
  const loginKeyHash = await sha256(slug.toLowerCase());
  const clientHash = await sha256(`${forwarded}|${ua}`);
  const { data: row } = await admin.from("learner_login_rate_limits")
    .select("id,failed_attempts,window_started_at,locked_until")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("login_key_hash", loginKeyHash)
    .eq("client_hash", clientHash)
    .maybeSingle();
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) throw new Error("TOO_MANY_LOGIN_ATTEMPTS");
  return { loginKeyHash, clientHash, row };
}
async function recordLoginFailure(guard: any) {
  const now = Date.now();
  const inWindow = guard.row?.window_started_at && now - new Date(guard.row.window_started_at).getTime() <= LOGIN_WINDOW_MS;
  const failures = inWindow ? Number(guard.row?.failed_attempts || 0) + 1 : 1;
  const windowStarted = inWindow ? guard.row.window_started_at : new Date(now).toISOString();
  const lockedUntil = failures >= LOGIN_MAX_FAILURES ? new Date(now + LOGIN_LOCK_MS).toISOString() : null;
  await admin.from("learner_login_rate_limits").upsert({
    workspace_id: WORKSPACE_ID,
    login_key_hash: guard.loginKeyHash,
    client_hash: guard.clientHash,
    failed_attempts: failures,
    window_started_at: windowStarted,
    locked_until: lockedUntil,
  }, { onConflict: "workspace_id,login_key_hash,client_hash" });
}
async function clearLoginFailures(guard: any) {
  await admin.from("learner_login_rate_limits").delete()
    .eq("workspace_id", WORKSPACE_ID)
    .eq("login_key_hash", guard.loginKeyHash)
    .eq("client_hash", guard.clientHash);
}

async function learnerChoices() {
  const { data } = await admin.from("learners")
    .select("display_name,slug,metadata")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("is_active", true)
    .order("created_at");
  return {
    learners: (data || [])
      .filter((l: any) => (l.metadata || {}).show_on_login !== false)
      .map((l: any) => ({
        display_name: l.display_name,
        slug: l.slug,
        avatar_emoji: (l.metadata || {}).avatar_emoji || "🧑‍🎓",
        is_test: Boolean((l.metadata || {}).is_test),
      })),
  };
}

async function learnerProfile(learnerId: string) {
  const { data: learner, error: learnerErr } = await admin.from("learners")
    .select("id,display_name,slug,grade_level,metadata")
    .eq("id", learnerId)
    .eq("workspace_id", WORKSPACE_ID)
    .single();
  if (learnerErr || !learner) throw new Error("LEARNER_NOT_FOUND");

  const [{ data: state }, { data: levels }, { data: ownedBadges }, { data: rewards }] = await Promise.all([
    admin.from("learner_gamification_state").select("xp,reward_points,current_level,current_streak,longest_streak,last_learning_date").eq("workspace_id", WORKSPACE_ID).eq("learner_id", learnerId).maybeSingle(),
    admin.from("gamification_levels").select("level_no,name,min_xp,icon").eq("workspace_id", WORKSPACE_ID).order("level_no"),
    admin.from("learner_badges").select("awarded_at,award_reason,badge:gamification_badges(code,title,description,icon)").eq("workspace_id", WORKSPACE_ID).eq("learner_id", learnerId).order("awarded_at", { ascending: false }),
    admin.from("gamification_rewards").select("id,title,description,reward_type,required_level,required_reward_points,parent_approval_required").eq("workspace_id", WORKSPACE_ID).eq("is_active", true).order("required_reward_points", { ascending: true, nullsFirst: false }),
  ]);

  const s: any = state || { xp: 0, reward_points: 0, current_level: 1, current_streak: 0, longest_streak: 0, last_learning_date: null };
  const current = (levels || []).filter((l: any) => Number(l.min_xp) <= Number(s.xp)).at(-1) || (levels || [])[0] || null;
  const next = (levels || []).find((l: any) => Number(l.min_xp) > Number(s.xp)) || null;
  return {
    learner: {
      id: learner.id,
      display_name: learner.display_name,
      slug: learner.slug,
      grade_level: learner.grade_level,
      avatar_emoji: (learner.metadata || {}).avatar_emoji || "🧑‍🎓",
      is_test: Boolean((learner.metadata || {}).is_test),
    },
    gamification: {
      ...s,
      current_level_info: current,
      next_level_info: next,
      xp_to_next: next ? Math.max(0, Number(next.min_xp) - Number(s.xp)) : 0,
      badges: ownedBadges || [],
      rewards: rewards || [],
    },
  };
}

async function parentUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const jwt = auth.slice(7).trim();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new Error("INVALID_PARENT_SESSION");
  const { data: member } = await admin.from("workspace_members")
    .select("workspace_id,role")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!member) throw new Error("NOT_A_PARENT_MEMBER");
  return { user: data.user, member };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "learner_choices") return json(await learnerChoices(), 200, origin);

    if (action === "student_login") {
      const slug = String(body.slug || "").trim().toLowerCase();
      const pin = String(body.pin || "").trim();
      if (!slug || !/^\d{8}$/.test(pin)) return json({ error: "INVALID_LOGIN" }, 400, origin);
      const guard = await loginGuard(req, slug);
      const { data: learner } = await admin.from("learners")
        .select("id,workspace_id,display_name,slug,is_active")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();
      if (!learner) {
        await recordLoginFailure(guard);
        return json({ error: "INVALID_LOGIN" }, 401, origin);
      }
      const { data: tokenId, error: pinError } = await admin.rpc("verify_and_upgrade_learner_pin", {
        p_workspace_id: WORKSPACE_ID,
        p_learner_id: learner.id,
        p_pin: pin,
      });
      if (pinError || !tokenId) {
        await recordLoginFailure(guard);
        return json({ error: "INVALID_LOGIN" }, 401, origin);
      }
      await clearLoginFailures(guard);
      return json({ session: await issueLearnerSession(learner.id, WORKSPACE_ID), profile: await learnerProfile(learner.id) }, 200, origin);
    }

    if (action === "student_profile") {
      const s = await verifyLearnerSession(req);
      return json(await learnerProfile(s.learner_id), 200, origin);
    }

    if (action === "complete_quiz") {
      await verifyLearnerSession(req);
      return json({ error: "LEGACY_QUIZ_COMPLETION_RETIRED", replacement: "learning-api" }, 410, origin);
    }

    if (action === "parent_register") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const inviteCode = String(body.invite_code || "").trim().toUpperCase();
      const relation = String(body.relation || "parent").slice(0, 30);
      if (!email.includes("@") || password.length < 8 || inviteCode.length < 8) return json({ error: "INVALID_REGISTRATION" }, 400, origin);
      const codeHash = await sha256(inviteCode);
      const { data: settings } = await admin.from("workspace_settings").select("id,value").eq("workspace_id", WORKSPACE_ID).eq("key", "auth.parent_invites").single();
      const cfg: any = settings?.value || {};
      const codes: any[] = Array.isArray(cfg.codes) ? cfg.codes : [];
      const idx = codes.findIndex((c: any) => c.hash === codeHash && !c.used);
      if (idx < 0) return json({ error: "INVALID_OR_USED_INVITE" }, 403, origin);
      const { count } = await admin.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", WORKSPACE_ID);
      if ((count || 0) >= Number(cfg.max_parent_accounts || 2)) return json({ error: "PARENT_ACCOUNT_LIMIT" }, 409, origin);
      const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { relation } });
      if (createErr || !created.user) return json({ error: "CREATE_PARENT_FAILED", detail: createErr?.message }, 400, origin);
      const role = (count || 0) === 0 ? "owner" : "admin";
      const { error: memberErr } = await admin.from("workspace_members").insert({ workspace_id: WORKSPACE_ID, user_id: created.user.id, role });
      if (memberErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: "CREATE_PARENT_FAILED" }, 500, origin);
      }
      codes[idx] = { ...codes[idx], used: true, used_by: created.user.id, used_at: new Date().toISOString() };
      await admin.from("workspace_settings").update({ value: { ...cfg, codes } }).eq("id", settings.id);
      return json({ ok: true, role, email }, 200, origin);
    }

    if (action === "parent_dashboard") {
      const { user, member } = await parentUser(req);
      const { data: learners0 } = await admin.from("learners")
        .select("id,display_name,slug,grade_level,metadata")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("is_active", true)
        .order("display_name");
      const learners = (learners0 || []).filter((l: any) => !(l.metadata || {}).is_test && !(l.metadata || {}).exclude_from_parent_metrics);
      const ids = learners.map((l: any) => l.id);
      let states: any[] = [], attempts: any[] = [], claims: any[] = [];
      if (ids.length) {
        const result = await Promise.all([
          admin.from("learner_gamification_state").select("learner_id,xp,reward_points,current_level,current_streak,longest_streak,last_learning_date").eq("workspace_id", WORKSPACE_ID).in("learner_id", ids),
          admin.from("quiz_attempts").select("id,learner_id,percentage,submitted_at,metadata,delivery_mode").eq("workspace_id", WORKSPACE_ID).eq("status", "submitted").in("learner_id", ids).order("submitted_at", { ascending: false }).limit(60),
          admin.from("reward_claims").select("id,learner_id,reward_id,status,requested_at,points_spent,note").eq("workspace_id", WORKSPACE_ID).in("learner_id", ids).order("requested_at", { ascending: false }).limit(60),
        ]);
        states = result[0].data || [];
        attempts = result[1].data || [];
        claims = result[2].data || [];
      }
      return json({
        parent: { id: user.id, email: user.email, relation: user.user_metadata?.relation || "parent", role: member.role },
        learners: learners.map((l: any) => ({ id: l.id, display_name: l.display_name, slug: l.slug, grade_level: l.grade_level })),
        states,
        attempts,
        reward_claims: claims,
      }, 200, origin);
    }

    return json({ error: "UNKNOWN_ACTION" }, 400, origin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SERVER_ERROR";
    const status = msg === "TOO_MANY_LOGIN_ATTEMPTS" ? 429
      : ["AUTH_REQUIRED", "INVALID_SESSION", "SESSION_EXPIRED", "INVALID_PARENT_SESSION"].includes(msg) ? 401
      : msg === "NOT_A_PARENT_MEMBER" ? 403
      : 500;
    return json({ error: msg }, status, origin);
  }
});
