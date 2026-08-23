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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  return new Response(JSON.stringify({
    error: "LEGACY_EXAM_RETIRED",
    replacement: "exam-v2-api",
  }), { status: 410, headers: cors(origin) });
});
