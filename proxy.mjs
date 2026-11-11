// /p/<nama>/<path>  ->  {target}/<path>  (konfigurasi dibaca dari Netlify Blobs)
import { S, getEnv } from "../lib/store.mjs";

export const config = { path: "/p/*" };

const STRIP_REQ = new Set(["host","connection","content-length","cookie","authorization","x-proxy-token",
  "x-forwarded-for","x-forwarded-host","x-forwarded-proto","x-real-ip","forwarded","origin","referer","accept-encoding"]);
const STRIP_RES = new Set(["content-encoding","content-length","transfer-encoding","connection","set-cookie"]);

const json = (d, s, h = {}) => new Response(JSON.stringify(d, null, 2), {
  status: s, headers: { "Content-Type": "application/json; charset=utf-8", ...h } });

function cors(req, origins) {
  const list = String(origins || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") || "";
  const allow = list.includes("*") ? "*" : (list.includes(origin) ? origin : list[0] || "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": req.headers.get("access-control-request-headers") || "*",
    "Access-Control-Expose-Headers": "*",
    ...(allow !== "*" ? { Vary: "Origin" } : {}),
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/p\/([a-z0-9-]+)(\/.*)?$/);
  if (!m) return json({ error: "Format URL: /p/<nama-proxy>/<path>" }, 404);
  const [, slug, rest = ""] = m;

  let cfg;
  try { cfg = await S("proxies").get(slug, { type: "json" }); }
  catch (e) { return json({ error: "Penyimpanan tidak bisa dibaca", detail: String(e?.message || e) }, 500); }
  if (!cfg) return json({ error: `Proxy "${slug}" tidak ditemukan` }, 404);

  const c = cors(req, cfg.origins);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });

  if (cfg.token) {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if ((req.headers.get("x-proxy-token") || bearer) !== cfg.token)
      return json({ error: "Unauthorized. Kirim header x-proxy-token yang benar." }, 401, c);
  }

  try {
    const headers = new Headers();
    for (const [k, v] of req.headers) {
      const key = k.toLowerCase();
      if (STRIP_REQ.has(key) || key.startsWith("x-nf-") || key.startsWith("x-netlify")) continue;
      headers.set(k, v);
    }
    const key = cfg.apiKey || await getEnv(cfg.keyEnv);
    if (key) headers.set(cfg.authHeader || "Authorization", (cfg.authPrefix ?? "Bearer ") + key);
    for (const [k, v] of Object.entries(cfg.extraHeaders || {})) headers.set(k, String(v));

    const upstream = await fetch(cfg.target + rest + url.search, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
    });
    const out = new Headers();
    for (const [k, v] of upstream.headers) {
      const key = k.toLowerCase();
      if (!STRIP_RES.has(key) && !key.startsWith("access-control-")) out.set(k, v);
    }
    for (const [k, v] of Object.entries(c)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    return json({ error: "Gagal menghubungi server tujuan", detail: String(e?.message || e) }, 502, c);
  }
};
