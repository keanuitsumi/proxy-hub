import { getStore } from "@netlify/blobs";

// consistency "strong": hasil simpan langsung terbaca di dashboard
export const S = (name) => getStore({ name, consistency: "strong" });

// Urutan: env Netlify dulu, lalu env yang disimpan dari dashboard
export async function getEnv(name) {
  if (!name) return "";
  if (process.env[name]) return process.env[name];
  try { return (await S("env").get(name)) || ""; } catch { return ""; }
}
