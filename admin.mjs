// API pengelola proxy. Dilindungi ADMIN_PASSWORD (header x-admin-password).
import { S, getEnv } from "../lib/store.mjs";

export const config = { path: "/admin-api/*" };

const J = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const pub = ({ apiKey, token, ...r }) => ({
  ...r, hasKey: !!apiKey, hasToken: !!token, envKey: null,
});

const OAI = "/v1/chat/completions";
const PRESETS = [
  { slug: "chat", target: "https://api.groq.com", path: "/openai" + OAI, keyEnv: "GROQ_KEY" },
  { slug: "multimodal", target: "https://router.huggingface.co", path: OAI, keyEnv: "HF_TOKEN" },
  { slug: "multimodal-nvidia", target: "https://integrate.api.nvidia.com", path: OAI, keyEnv: "NVIDIA_KEY" },
  { slug: "gemma", target: "https://generativelanguage.googleapis.com", path: "/v1beta/openai/chat/completions", keyEnv: "GEMINI_KEY" },
  { slug: "mistral", target: "https://api.mistral.ai", path: OAI, keyEnv: "MISTRAL_KEY" },
  { slug: "zai", target: "https://api.z.ai", path: "/api/paas/v4/chat/completions", keyEnv: "ZAI_KEY" },
  { slug: "poolside", target: "https://inference.poolside.ai", path: OAI, keyEnv: "POOLSIDE_API_KEY", stripPrefix: "poolside/" },
  { slug: "deepinfra", target: "https://api.deepinfra.com", path: "/v1/openai/chat/completions", keyEnv: "DEEPINFRA_API_KEY" },
  { slug: "openrouter-image", target: "https://openrouter.ai", path: "/api/v1/chat/completions", keyEnv: "OPENROUTER_KEY", noStream: true,
    extraHeaders: { "HTTP-Referer": "https://askscratch.netlify.app", "X-Title": "AskScratch - K-Oss Image" } },
  { slug: "openrouter-nex", target: "https://openrouter.ai", path: "/api/v1/chat/completions", keyEnv: "OPENROUTER_API_KEY_NEX",
    allowedModel: "nex-agi/nex-n2.5-pro", extraHeaders: { "HTTP-Referer": "AskScratch", "X-Title": "AskScratch" } },
  { slug: "search", target: "https://google.serper.dev", path: "/search", keyEnv: "SERPER_KEY", authHeader: "X-API-KEY", authPrefix: "" },
  { slug: "shopping", target: "https://google.serper.dev", path: "/shopping", keyEnv: "SERPER_KEY", authHeader: "X-API-KEY", authPrefix: "" },
  { slug: "news", target: "https://google.serper.dev", path: "/news", keyEnv: "SERPER_KEY", authHeader: "X-API-KEY", authPrefix: "",
    bodyDefaults: { q: "berita terbaru indonesia" }, bodyForce: { gl: "id", hl: "id", num: 8 } },
];

export default async (req) => {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return J({ error: "ADMIN_PASSWORD belum diisi di Environment variables Netlify." }, 500);
  if (req.headers.get("x-admin-password") !== pw) return J({ error: "Password salah." }, 401);

  const path = new URL(req.url).pathname.replace(/^\/admin-api/, "") || "/";
  const store = S("proxies");
  try {
    if (path === "/ping") return J({ ok: true });

    if (path === "/proxies" && req.method === "GET") {
      const { blobs } = await store.list();
      const all = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
      all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return J({ proxies: await Promise.all(all.map(async (p) => ({ ...pub(p), envKey: p.keyEnv ? !!(await getEnv(p.keyEnv)) : null }))) });
    }

    if (path === "/import-presets" && req.method === "POST") {
      let added = 0;
      for (const p of PRESETS) {
        if (await store.get(p.slug, { type: "json" })) continue;
        await store.setJSON(p.slug, { apiKey: "", token: "", authHeader: "Authorization", authPrefix: "Bearer ",
          origins: "*", extraHeaders: {}, createdAt: Date.now(), ...p });
        added++;
      }
      return J({ added, total: PRESETS.length });
    }

    if (path === "/proxies" && req.method === "POST") {
      const b = await req.json();
      const slug = String(b.slug || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug)) return J({ error: "Nama: 2-39 karakter, huruf kecil, angka, atau tanda minus." }, 400);
      let target = String(b.target || "").trim().replace(/\/+$/, "");
      try { if (!/^https?:$/.test(new URL(target).protocol)) throw 0; } catch { return J({ error: "Target harus berupa URL lengkap, mis. https://api.contoh.com" }, 400); }
      let extra = {};
      if (String(b.extraHeaders || "").trim()) {
        try { extra = JSON.parse(b.extraHeaders); if (typeof extra !== "object" || Array.isArray(extra)) throw 0; }
        catch { return J({ error: "Header tambahan harus berupa objek JSON." }, 400); }
      }
      const old = await store.get(slug, { type: "json" });
      const pick = (k, d) => (b[k] !== undefined ? b[k] : (old?.[k] ?? d));
      const cfg = {
        ...(old || {}),
        slug, target,
        apiKey: b.clearKey ? "" : (b.apiKey || old?.apiKey || ""),
        token: b.clearToken ? "" : (b.token || old?.token || ""),
        authHeader: String(b.authHeader || "Authorization").trim(),
        authPrefix: typeof b.authPrefix === "string" ? b.authPrefix : "Bearer ",
        origins: String(b.origins || "*").trim(),
        extraHeaders: extra,
        keyEnv: String(pick("keyEnv", "")).trim(),
        path: String(pick("path", "")).trim(),
        allowedModel: String(pick("allowedModel", "")).trim(),
        noStream: !!pick("noStream", false),
        createdAt: old?.createdAt || Date.now(),
      };
      await store.setJSON(slug, cfg);
      return J({ proxy: pub(cfg) });
    }

    const envStore = S("env"), codeStore = S("code");
    if (path === "/env" && req.method === "GET") {
      const { blobs } = await envStore.list();
      return J({ names: blobs.map((x) => x.key).sort() });
    }
    if (path === "/env" && req.method === "POST") {
      const b = await req.json();
      const name = String(b.name || "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) return J({ error: "Nama env: huruf, angka, underscore (maks 64), tidak diawali angka." }, 400);
      if (!String(b.value ?? "")) return J({ error: "Nilai tidak boleh kosong." }, 400);
      await envStore.set(name, String(b.value));
      return J({ ok: true });
    }
    const delEnv = path.match(/^\/env\/([A-Za-z_][A-Za-z0-9_]{0,63})$/);
    if (delEnv && req.method === "DELETE") { await envStore.delete(delEnv[1]); return J({ ok: true }); }

    if (path === "/functions" && req.method === "GET") {
      const { blobs } = await codeStore.list();
      const all = (await Promise.all(blobs.map((x) => codeStore.get(x.key, { type: "json" })))).filter(Boolean);
      all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return J({ functions: all });
    }
    if (path === "/functions" && req.method === "POST") {
      const b = await req.json();
      const slug = String(b.slug || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug)) return J({ error: "Nama: 2-39 karakter, huruf kecil, angka, atau tanda minus." }, 400);
      const code = String(b.code || "");
      if (!code.trim()) return J({ error: "Kode tidak boleh kosong." }, 400);
      if (code.length > 200000) return J({ error: "Kode terlalu besar (maks 200 KB)." }, 400);
      await codeStore.setJSON(slug, { slug, code, updatedAt: Date.now() });
      return J({ ok: true });
    }
    const delFn = path.match(/^\/functions\/([a-z0-9-]+)$/);
    if (delFn && req.method === "DELETE") { await codeStore.delete(delFn[1]); return J({ ok: true }); }

    const del = path.match(/^\/proxies\/([a-z0-9-]+)$/);
    if (del && req.method === "DELETE") { await store.delete(del[1]); return J({ ok: true }); }

    return J({ error: "Endpoint tidak dikenal" }, 404);
  } catch (e) {
    return J({ error: "Terjadi kesalahan", detail: String(e?.message || e) }, 500);
  }
};
