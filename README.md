# Proxy Hub (Netlify)

Platform kecil seperti Val Town, tapi khusus proxy API.

- Dashboard: buat proxy, URL-nya https://SITUS.netlify.app/p/<nama>/...
- Mode action (kompatibel dengan val lama): POST https://SITUS.netlify.app/api
  dengan body { "action": "chat", "payload": {...}, "stream": true }.
  "action" = nama proxy. Tombol "Impor preset dari main.ts" membuat semua action lama.
- Action bawaan tanpa dashboard: tts (butuh HF_TOKEN) dan stt (butuh GROQ_KEY).

## Semua dari website
- Tab Proxy: buat proxy atau impor preset.
- Tab Kode: tulis JavaScript, jalan di /f/<nama>.
- Tab Environment: simpan key dari dashboard, tanpa buka Netlify.
Hanya ADMIN_PASSWORD yang wajib di env Netlify.

## Deploy
1. Env vars Netlify: ADMIN_PASSWORD + semua key lama (GROQ_KEY, HF_TOKEN, NVIDIA_KEY, GEMINI_KEY,
   MISTRAL_KEY, ZAI_KEY, POOLSIDE_API_KEY, DEEPINFRA_API_KEY, OPENROUTER_KEY, OPENROUTER_API_KEY_NEX, SERPER_KEY).
2. Deploy lewat Git atau CLI (netlify deploy --prod).
3. Buka situs, masuk, klik "Impor preset dari main.ts".
