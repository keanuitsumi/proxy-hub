// /f/<nama>  ->  menjalankan kode yang ditulis di dashboard.
// Kode: export default async function (req, { env, path }) { return Response.json({...}) }
import { S, getEnv } from "../lib/store.mjs";

export const config = { path: "/f/*" };

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "*" };
const err = (message, status) => Response.json({ error: message }, { status, headers: CORS });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const m = new URL(req.url).pathname.match(/^\/f\/([a-z0-9-]+)(\/.*)?$/);
  if (!m) return err("Format URL: /f/<nama-fungsi>", 404);

  let rec;
  try { rec = await S("code").get(m[1], { type: "json" }); }
  catch { return err("Penyimpanan tidak bisa dibaca", 500); }
  if (!rec) return err(`Fungsi "${m[1]}" tidak ditemukan`, 404);

  try {
    const mod = await import("data:text/javascript;base64," + Buffer.from(rec.code).toString("base64"));
    if (typeof mod.default !== "function")
      return err("Kode harus berisi: export default async function (req, { env }) { ... }", 500);
    const out = await mod.default(req, { env: getEnv, path: m[2] || "" });
    const res = out instanceof Response ? out : Response.json(out ?? null);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) if (!h.has(k)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  } catch (e) {
    return err("Kode error: " + String(e?.message || e), 500);
  }
};
