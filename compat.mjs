// Endpoint kompatibel dengan val lama: POST /api  { action, payload, stream }
// "action" = nama proxy di dashboard (mis. chat, mistral, search).
import { S, getEnv } from "../lib/store.mjs";

export const config = { path: ["/api", "/api/"] };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-proxy-token",
};
const j = (d, s = 200) => Response.json(d, { status: s, headers: CORS });
const str = (v, d) => (typeof v === "string" && v.trim() ? v.trim() : d);

async function tts(p) {
  if (!/^[\w.\-\/]+$/.test(String(p.model || ""))) return j({ error: "Model TTS tidak valid." }, 400);
  const r = await fetch("https://api-inference.huggingface.co/models/" + p.model, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getEnv("HF_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: p.inputs, options: { wait_for_model: true, use_cache: true } }),
  });
  const ct = r.headers.get("content-type") || "";
  if (ct.startsWith("audio")) return new Response(r.body, { status: r.status, headers: { ...CORS, "Content-Type": ct } });
  return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function stt(p) {
  const key = await getEnv("GROQ_KEY");
  if (!key) return j({ error: "GROQ key tidak dikonfigurasi di environment." }, 500);
  if (!p || typeof p.audio !== "string" || !p.audio.trim()) return j({ error: "Payload audio base64 wajib diisi." }, 400);
  let bytes;
  try { bytes = Uint8Array.from(atob(p.audio), (c) => c.charCodeAt(0)); }
  catch { return j({ error: "Audio base64 tidak valid." }, 400); }
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: str(p.mime, "audio/webm") }), "recording");
  form.append("model", str(p.model, "whisper-large-v3-turbo"));
  form.append("language", str(p.language, "id"));
  let r;
  try {
    r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  } catch { return j({ error: "Gagal terhubung ke Groq Speech-to-Text API." }, 502); }
  const d = await r.json().catch(() => null);
  if (!r.ok) return j({ error: `Groq STT gagal: ${d?.error?.message || d?.message || "terjadi kesalahan"}` }, r.status || 502);
  return j({ text: d?.text ?? "" });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return j({ error: "Gunakan method POST." }, 405);

  let body;
  try { body = await req.json(); } catch { return j({ error: "Body harus JSON." }, 400); }
  const { action, payload, stream } = body || {};
  if (action === "tts") return tts(payload || {});
  if (action === "stt") return stt(payload);
  if (typeof action !== "string" || !/^[a-z0-9-]+$/.test(action)) return j({ error: "Action tidak dikenali." }, 400);

  let cfg;
  try { cfg = await S("proxies").get(action, { type: "json" }); }
  catch { return j({ error: "Penyimpanan tidak bisa dibaca." }, 500); }
  if (!cfg) return j({ error: "Action tidak dikenali." }, 400);

  if (cfg.token && req.headers.get("x-proxy-token") !== cfg.token) return j({ error: "Unauthorized." }, 401);
  if (cfg.allowedModel && payload?.model !== cfg.allowedModel)
    return j({ error: `Model tidak diizinkan. Hanya "${cfg.allowedModel}" yang didukung.` }, 400);

  const key = cfg.apiKey || await getEnv(cfg.keyEnv);
  if (!key) return j({ error: `${cfg.keyEnv || "API key"} tidak dikonfigurasi.` }, 500);

  const call = (model) => {
    const b = { ...(cfg.bodyDefaults || {}), ...(payload || {}), ...(cfg.bodyForce || {}) };
    if (model) b.model = model;
    if (cfg.noStream) b.stream = false;
    return fetch(cfg.target + (cfg.path || ""), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [cfg.authHeader || "Authorization"]: (cfg.authPrefix ?? "Bearer ") + key,
        ...(cfg.extraHeaders || {}),
      },
      body: JSON.stringify(b),
    });
  };

  let r;
  try {
    r = await call();
    const m = payload?.model;
    // Poolside: kalau model ditolak, ulangi tanpa prefix
    if (!r.ok && cfg.stripPrefix && typeof m === "string" && m.startsWith(cfg.stripPrefix)) {
      const t = await r.text();
      if (r.status !== 404 && !/model/i.test(t))
        return new Response(t, { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
      r = await call(m.slice(cfg.stripPrefix.length));
    }
  } catch { return j({ error: "Gagal terhubung ke API tujuan." }, 502); }

  const sse = r.ok && stream && !cfg.noStream;
  const headers = { ...CORS, "Content-Type": sse ? "text/event-stream" : (r.headers.get("content-type") || "application/json") };
  if (sse) headers["Cache-Control"] = "no-cache";
  return new Response(r.body, { status: r.status, headers });
};
