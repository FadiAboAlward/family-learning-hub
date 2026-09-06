import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKSPACE_ID = "55f9224c-8ba7-4cbc-9f88-713e6a6b41df";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

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
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

function fromB64url(s: string) {
  const norm = s.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((s.length + 3) % 4);
  const raw = atob(norm);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}
function b64urlText(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decodeCursor(raw: unknown): { submitted_at: string; id: string } | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const bytes = fromB64url(raw);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed?.submitted_at || !parsed?.id) return null;
    if (Number.isNaN(Date.parse(parsed.submitted_at))) return null;
    return { submitted_at: String(parsed.submitted_at), id: String(parsed.id) };
  } catch {
    return null;
  }
}
function encodeCursor(row: { submitted_at: string; id: string }) {
  return b64urlText(JSON.stringify({ submitted_at: row.submitted_at, id: row.id }));
}
async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let binary = "";
  for (const b of sig) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function authenticateLearner(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const [body, sig] = auth.slice(7).trim().split(".");
  if (!body || !sig || (await hmac(body)) !== sig) throw new Error("INVALID_SESSION");
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  if (payload.typ !== "learner" || payload.workspace_id !== WORKSPACE_ID || !payload.learner_id) {
    throw new Error("INVALID_SESSION");
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("SESSION_EXPIRED");
  return String(payload.learner_id);
}

async function contextForVersions(versionIds: string[]) {
  const ids = [...new Set(versionIds.filter(Boolean))];
  if (!ids.length) return new Map<string, any>();
  const { data: versions } = await admin
    .from("quiz_versions")
    .select("id,quiz_id,version_no")
    .eq("workspace_id", WORKSPACE_ID)
    .in("id", ids);
  const quizIds = [...new Set((versions || []).map((v: any) => v.quiz_id).filter(Boolean))];
  const { data: quizzes } = quizIds.length
    ? await admin
      .from("quizzes")
      .select("id,slug,title,description,subject_id,book_id,unit_id,lesson_id")
      .eq("workspace_id", WORKSPACE_ID)
      .in("id", quizIds)
    : { data: [] as any[] };
  const subjectIds = [...new Set((quizzes || []).map((q: any) => q.subject_id).filter((x: any) => x != null))];
  const bookIds = [...new Set((quizzes || []).map((q: any) => q.book_id).filter(Boolean))];
  const unitIds = [...new Set((quizzes || []).map((q: any) => q.unit_id).filter(Boolean))];
  const [{ data: subjects }, { data: books }, { data: units }] = await Promise.all([
    subjectIds.length ? admin.from("subjects").select("id,code,name_ar,name_en").in("id", subjectIds) : Promise.resolve({ data: [] }),
    bookIds.length ? admin.from("books").select("id,code,title,grade_level,school_year,language").in("id", bookIds) : Promise.resolve({ data: [] }),
    unitIds.length ? admin.from("units").select("id,slug,title").in("id", unitIds) : Promise.resolve({ data: [] }),
  ]);
  const sm = new Map((subjects || []).map((x: any) => [String(x.id), x]));
  const bm = new Map((books || []).map((x: any) => [String(x.id), x]));
  const um = new Map((units || []).map((x: any) => [String(x.id), x]));
  const qm = new Map((quizzes || []).map((x: any) => [x.id, x]));
  const out = new Map<string, any>();
  for (const v of versions || []) {
    const q: any = qm.get(v.quiz_id);
    if (!q) continue;
    out.set(v.id, {
      version_no: v.version_no,
      quiz: {
        id: q.id,
        slug: q.slug,
        title: q.title,
        description: q.description,
      },
      subject: q.subject_id != null ? sm.get(String(q.subject_id)) || null : null,
      book: q.book_id ? bm.get(String(q.book_id)) || null : null,
      unit: q.unit_id ? um.get(String(q.unit_id)) || null : null,
      lesson_id: q.lesson_id || null,
    });
  }
  return out;
}

async function answerStats(attemptIds: string[]) {
  const ids = [...new Set(attemptIds.filter(Boolean))];
  const out = new Map<string, { question_count: number; wrong_count: number; hints_used: number }>();
  if (!ids.length) return out;
  const { data } = await admin
    .from("quiz_attempt_answers")
    .select("attempt_id,is_correct,hints_used")
    .eq("workspace_id", WORKSPACE_ID)
    .in("attempt_id", ids);
  for (const row of data || []) {
    const key = row.attempt_id;
    const cur = out.get(key) || { question_count: 0, wrong_count: 0, hints_used: 0 };
    cur.question_count += 1;
    if (row.is_correct === false) cur.wrong_count += 1;
    cur.hints_used += Number(row.hints_used || 0);
    out.set(key, cur);
  }
  return out;
}

async function listAttempts(learnerId: string, body: any) {
  const pageSize = Math.max(1, Math.min(20, Number(body.page_size || 10)));
  const mode = ["learning", "exam"].includes(String(body.mode || "")) ? String(body.mode) : "all";
  const cursor = decodeCursor(body.cursor);
  let query = admin
    .from("quiz_attempts")
    .select("id,quiz_version_id,delivery_mode,status,started_at,submitted_at,score_points,max_points,percentage,duration_seconds,metadata")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("learner_id", learnerId)
    .eq("status", "submitted")
    .in("delivery_mode", ["learning", "exam"])
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (mode !== "all") query = query.eq("delivery_mode", mode);
  if (cursor) {
    query = query.or(`submitted_at.lt.${cursor.submitted_at},and(submitted_at.eq.${cursor.submitted_at},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("HISTORY_LOAD_FAILED");
  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const visible = rows.slice(0, pageSize);
  const contexts = await contextForVersions(visible.map((x: any) => x.quiz_version_id));
  const stats = await answerStats(visible.map((x: any) => x.id));
  const items = visible.map((a: any) => {
    const s = stats.get(a.id) || { question_count: 0, wrong_count: 0, hints_used: 0 };
    const metadata = a.metadata || {};
    return {
      id: a.id,
      delivery_mode: a.delivery_mode,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
      score_points: Number(a.score_points || 0),
      max_points: Number(a.max_points || 0),
      percentage: Number(a.percentage || 0),
      duration_seconds: Number(a.duration_seconds || 0),
      question_count: s.question_count,
      wrong_count: s.wrong_count,
      hints_used: Number(metadata.hints_used ?? s.hints_used ?? 0),
      first_try_correct: Number(metadata.first_try_correct || 0),
      context: contexts.get(a.quiz_version_id) || null,
    };
  });
  const last = visible[visible.length - 1];
  return {
    items,
    has_more: hasMore,
    next_cursor: hasMore && last?.submitted_at ? encodeCursor({ submitted_at: last.submitted_at, id: last.id }) : null,
    mode,
  };
}

function optionPosition(value: any): number | null {
  if (!value || typeof value !== "object") return null;
  const raw = value.option_position ?? value.selected_option_position ?? value.position;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}
function responseFallback(value: any) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    for (const k of ["text", "value", "answer"]) if (value[k] != null) return String(value[k]);
  }
  return "";
}

async function attemptDetail(learnerId: string, body: any) {
  const attemptId = String(body.attempt_id || "");
  if (!attemptId) throw new Error("INVALID_ATTEMPT");
  const { data: attempt } = await admin
    .from("quiz_attempts")
    .select("id,quiz_version_id,delivery_mode,status,started_at,submitted_at,score_points,max_points,percentage,duration_seconds,metadata")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("learner_id", learnerId)
    .eq("id", attemptId)
    .eq("status", "submitted")
    .in("delivery_mode", ["learning", "exam"])
    .maybeSingle();
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");

  const [{ data: queueRows }, { data: answers }] = await Promise.all([
    admin
      .from("quiz_attempt_question_queue")
      .select("sequence_no,question_id,source_role,hint_level_requested,is_flagged")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("quiz_attempt_id", attemptId)
      .order("sequence_no"),
    admin
      .from("quiz_attempt_answers")
      .select("question_id,response,evaluation,is_correct,points_awarded,answered_at,attempts_used,hints_used,first_try_correct,mastery_result")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("attempt_id", attemptId),
  ]);

  const queue = queueRows || [];
  const answerRows = answers || [];
  const orderedIds = queue.length
    ? queue.map((x: any) => x.question_id)
    : answerRows.map((x: any) => x.question_id);
  const questionIds = [...new Set(orderedIds.filter(Boolean))];

  const [{ data: questions }, { data: options }, { data: keys }, { data: questionAssets }] = await Promise.all([
    questionIds.length
      ? admin.from("quiz_questions").select("id,question_code,position,prompt,points,source_page_start,source_page_end").eq("workspace_id", WORKSPACE_ID).in("id", questionIds)
      : Promise.resolve({ data: [] }),
    questionIds.length
      ? admin.from("quiz_question_options").select("question_id,position,label,content").eq("workspace_id", WORKSPACE_ID).in("question_id", questionIds).order("position")
      : Promise.resolve({ data: [] }),
    questionIds.length
      ? admin.from("quiz_question_answer_keys").select("question_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation").eq("workspace_id", WORKSPACE_ID).in("question_id", questionIds)
      : Promise.resolve({ data: [] }),
    questionIds.length
      ? admin.from("quiz_question_assets").select("question_id,asset_id,position,purpose,alt_text").eq("workspace_id", WORKSPACE_ID).in("question_id", questionIds).order("position")
      : Promise.resolve({ data: [] }),
  ]);

  const assetIds = [...new Set((questionAssets || []).map((x: any) => x.asset_id).filter(Boolean))];
  const { data: assets } = assetIds.length
    ? await admin.from("assets").select("id,kind,mime_type,storage_bucket,storage_path,metadata").eq("workspace_id", WORKSPACE_ID).in("id", assetIds)
    : { data: [] as any[] };

  const qm = new Map((questions || []).map((x: any) => [x.id, x]));
  const km = new Map((keys || []).map((x: any) => [x.question_id, x]));
  const am = new Map((answers || []).map((x: any) => [x.question_id, x]));
  const queueMap = new Map(queue.map((x: any) => [x.question_id, x]));
  const optionsMap = new Map<string, any[]>();
  for (const o of options || []) {
    if (!optionsMap.has(o.question_id)) optionsMap.set(o.question_id, []);
    optionsMap.get(o.question_id)!.push(o);
  }
  const assetMap = new Map((assets || []).map((x: any) => [x.id, x]));
  const qAssetMap = new Map<string, any[]>();
  for (const link of questionAssets || []) {
    const asset: any = assetMap.get(link.asset_id);
    if (!asset) continue;
    if (!qAssetMap.has(link.question_id)) qAssetMap.set(link.question_id, []);
    const metadata = asset.metadata || {};
    qAssetMap.get(link.question_id)!.push({
      position: link.position,
      purpose: link.purpose,
      alt_text: link.alt_text,
      kind: asset.kind,
      mime_type: asset.mime_type,
      url: metadata.public_url || metadata.url || null,
      storage_bucket: asset.storage_bucket,
      storage_path: asset.storage_path,
    });
  }

  const context = (await contextForVersions([attempt.quiz_version_id])).get(attempt.quiz_version_id) || null;
  const review = orderedIds.map((questionId: string, index: number) => {
    const q: any = qm.get(questionId) || {};
    const a: any = am.get(questionId) || null;
    const key: any = km.get(questionId) || {};
    const qrow: any = queueMap.get(questionId) || {};
    const opts = optionsMap.get(questionId) || [];
    const selectedPos = optionPosition(a?.response);
    const correctPos = optionPosition(key.correct_answer);
    const selected = selectedPos == null ? null : opts.find((o: any) => Number(o.position) === selectedPos) || null;
    const correct = correctPos == null ? null : opts.find((o: any) => Number(o.position) === correctPos) || null;
    const isCorrect = a?.is_correct === true;
    const explanation = isCorrect
      ? (key.correct_explanation || key.explanation || "")
      : (key.final_incorrect_explanation || key.explanation || "");
    return {
      sequence_no: Number(qrow.sequence_no || index + 1),
      question_id: questionId,
      question_code: q.question_code || null,
      prompt: q.prompt || "",
      source_page_start: q.source_page_start || null,
      source_page_end: q.source_page_end || null,
      source_role: qrow.source_role || null,
      was_flagged: Boolean(qrow.is_flagged),
      response: a?.response || null,
      selected_option_position: selectedPos,
      selected_option: selected ? { position: selected.position, label: selected.label, content: selected.content } : null,
      selected_text_fallback: responseFallback(a?.response),
      correct_answer: key.correct_answer || null,
      correct_option_position: correctPos,
      correct_option: correct ? { position: correct.position, label: correct.label, content: correct.content } : null,
      is_correct: isCorrect,
      points_awarded: Number(a?.points_awarded || 0),
      max_points: Number(q.points || 0),
      attempts_used: Number(a?.attempts_used || 0),
      hints_used: Number(a?.hints_used ?? qrow.hint_level_requested ?? 0),
      first_try_correct: Boolean(a?.first_try_correct),
      mastery_result: a?.mastery_result || null,
      explanation,
      assets: (qAssetMap.get(questionId) || []).filter((x: any) => x.url),
    };
  });

  return {
    attempt: {
      id: attempt.id,
      delivery_mode: attempt.delivery_mode,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      score_points: Number(attempt.score_points || 0),
      max_points: Number(attempt.max_points || 0),
      percentage: Number(attempt.percentage || 0),
      duration_seconds: Number(attempt.duration_seconds || 0),
      question_count: review.length,
      wrong_count: review.filter((x: any) => !x.is_correct).length,
      hints_used: review.reduce((n: number, x: any) => n + Number(x.hints_used || 0), 0),
      context,
    },
    review,
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
  try {
    const learnerId = await authenticateLearner(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "list_attempts") return json(await listAttempts(learnerId, body), 200, origin);
    if (action === "attempt_detail") return json(await attemptDetail(learnerId, body), 200, origin);
    return json({ error: "UNKNOWN_ACTION" }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SERVER_ERROR";
    const authErrors = ["AUTH_REQUIRED", "INVALID_SESSION", "SESSION_EXPIRED"];
    const notFound = ["ATTEMPT_NOT_FOUND"];
    const bad = ["INVALID_ATTEMPT", "UNKNOWN_ACTION"];
    return json({ error: message }, authErrors.includes(message) ? 401 : notFound.includes(message) ? 404 : bad.includes(message) ? 400 : 500, origin);
  }
});
