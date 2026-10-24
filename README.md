# Hamyon

Shaxsiy moliya: **Telegram bot** (web-ilovasiz ham to'liq ishlaydi) va keyingi bosqichda Mini App.
Interfeys va hisob-kitob qoidalari: `TZ — Hamyon UI/UX` hujjati.

## Hozir nima ishlaydi (1-bosqich: bot)

- **Tez kiritish** — shunchaki yozing: `45000 non`, `45k korzinka kecha`, `+5mln oylik`.
  Kategoriya kalit so'zdan aniqlanadi, aniqlanmasa tugmalar chiqadi. Har saqlashdan keyin
  `↩️ Bekor qilish · 💳 Hisob · 🏷 Kategoriya` tugmalari.
- **Tugmalar**: ➖ Chiqim · ➕ Kirim · 🔁 O'tkazma · 🏠 Asosiy · 📊 Bugun · 🗓 Oy · 🧾 Oxirgi · 💳 Hisoblar · 🎯 Budjet · 🤝 Qarzlar · 🔮 Prognoz
- **Buyruqlar**: `/bugun /oy /oxirgi /bekor /hisoblar /budjet /qarz /prognoz /reja /eslatma /sozlamalar /yordam`
  `/limit oziq 2mln` · `/hisob Humo karta 1mln` · `/qoldiq Naqd 500000` · `/maosh 8mln 5` ·
  `/majburiy 1.2mln 10 Ijara` · `/qarzolish Akmal 2mln 10.11` · `/qarzberish Akmal 1mln` · `/kurs` · `/chegara`
- **Hisob-kitoblar (serverda)**: hisob qoldiqlari, erkin pul (maoshgacha), oy natijasi, budjet holatlari
  (Me'yorda / Diqqat / Oshishi mumkin / Limitdan oshdi), prognoz va xavfsiz chegara, qarzlar (to'lov tarixi bilan).
- **Eslatmalar**: kiritish, kunlik/haftalik/oylik hisobot, qarz va majburiy to'lovlar, mablag' yetishmasligi;
  budjet 80%/100% ogohlantirishi darhol.
- **Mini App uchun API** (tayyor): `GET /api/dashboard`, `GET|POST|DELETE /api/transactions`
  (`Authorization: tma <initData>`, imzo tekshiriladi). Frontend — 2-bosqich.

## Tuzilma

| Yo'l | Nima |
|---|---|
| `api/index.js` | Vercel kirish nuqtasi → `src/app.js` (Express) |
| `src/bot/` | webhook mantiqi: `index.js` (buyruq/tugma/holat), `parse.js` (matn tahlili), `views.js` (xabarlar) |
| `src/services/` | `finance` (hisob-kitob), `transactions`, `debts`, `planned`, `reminders`, `users` |
| `src/lib/` | `db`, `tg` (Bot API), `auth` (initData), `money`, `dates` |
| `migrations/` | SQL sxema (`npm run db:migrate`) |
| `test/` | 26 ta test, **alohida test bazasi** kerak |
| `.github/workflows/tick.yml` | eslatmalar uchun har 10 daqiqada cron |

Qoidalar: summalar butun son (so'm; USD — sent). O'tkazma va qarz operatsiyalari daromad/xarajatga
kirmaydi. Hamma hisob serverda; frontend faqat ko'rsatadi.

## Ishga tushirish

`docs/SETUP.md` — BotFather, Supabase, Vercel, GitHub qadamma-qadam.

```bash
npm install
cp .env.example .env.local   # to'ldiring
npm run db:migrate
npm test                      # TEST_DATABASE_URL kerak
```
