# Noldan sozlash: BotFather → Supabase → Vercel → GitHub

Kalitlar (bot tokeni, baza paroli) **hech qachon** chatga yoki repoga yozilmaydi — faqat Vercel
Environment Variables va lokal `.env.local` ga.

## 1. Bot ochish (@BotFather, Telegram'da)

1. `/newbot` → nom: `Hamyon` → username: masalan `hamyon_moliya_bot` (oxiri `bot` bilan tugashi shart).
2. BotFather bergan **token**ni saqlab qo'ying → `BOT_TOKEN`.
3. `/setdescription` — "Shaxsiy moliyangiz bir joyda: kirim-chiqim, budjet, qarzlar, prognoz".
4. `/setuserpic` — logotip (ixtiyoriy).
5. Buyruqlar ro'yxatini qo'lda kiritish shart emas — 5-qadamdagi `setup` o'zi o'rnatadi.
6. Token oshkor bo'lib qolsa: BotFather → `/revoke`.

## 2. Baza (Supabase)

1. supabase.com → New project (region: sizga yaqin).
2. Settings → Database → **Connection pooling** (Transaction, port `6543`) satrini oling → `DATABASE_URL`.
3. Test uchun **ikkinchi, bo'sh** loyiha oching → `TEST_DATABASE_URL` (testlar yozuv yaratadi).
4. Lokal: `.env.local` ga `DATABASE_URL` yozing, `npm run db:migrate`. Test bazasi: `npm run db:migrate:test`.

## 3. GitHub

Repo: `shaxzod-muhandis/Hamyon`. Actions secrets (Settings → Secrets → Actions):
`APP_URL` (masalan `https://hamyon.vercel.app`), `CRON_SECRET`. Workflow `tick.yml` har 10 daqiqada
eslatmalarni tekshiradi (Vercel Hobby cron'i kuniga 1 marta, shuning uchun).

## 4. Vercel

1. vercel.com → Add New → Project → `Hamyon` repo'sini import qiling (Framework: Other).
2. Environment Variables:

| O'zgaruvchi | Qiymat |
|---|---|
| `DATABASE_URL` | Supabase pooler (6543) |
| `BOT_TOKEN` | BotFather tokeni |
| `WEBHOOK_SECRET` | uzun tasodifiy satr (`openssl rand -hex 24`) |
| `CRON_SECRET` | boshqa uzun tasodifiy satr |
| `APP_URL` | `https://<loyiha>.vercel.app` — **oxirida `/` yo'q**. Sozlanmasa bot tugmalari noto'g'ri manzilga olib borishi mumkin. |
| `WEBAPP_ENABLED` | hozircha `0` |

3. Deploy. Tekshirish: `https://<loyiha>.vercel.app/api/health` → `{"ok":true}`.

## 5. Webhook va buyruqlarni ulash

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<loyiha>.vercel.app/api/admin/setup
# {"ok":true,"webhook":true,"commands":true,"menu":true}
```
Keyin botga `/start` yozing.

## 6. Mini App (veb-ilova)

Frontend `public/` papkasida (build yo'q) va shu Vercel loyihasidan xizmat qiladi. Yoqish:

1. Vercel env: `WEBAPP_ENABLED=1`, `BOT_USERNAME=<bot username, @ siz>` → qayta deploy.
2. `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<loyiha>.vercel.app/api/admin/setup` —
   botning menyu tugmasi (**Hamyon**) endi ilovani ochadi, `📱 Ilova` tugmasi ham paydo bo'ladi.
3. Brauzerdan kirish uchun (Telegram Login Widget): BotFather → `/setdomain` → botni tanlang → `<loyiha>.vercel.app`.
4. Mini App ochilganda `Telegram.WebApp.initData` serverda imzo bilan tekshiriladi; brauzerda 30 kunlik sessiya tokeni beriladi.

## 7. Lokal ishlab chiqish

`npm run dev` (http://localhost:3000) + namunaviy ma'lumot: `node scripts/demo-seed.js` (sessiya tokenini chiqaradi — brauzerda `localStorage.hamyon_token` ga qo'ying) + `cloudflared tunnel --url http://localhost:3000` (yoki ngrok) → vaqtinchalik
`APP_URL` qilib `npm run setup:bot`.

## Asosiy qoidalar

- Production'da `BOT_TOKEN` bo'lmasa initData tekshiruvi **rad etadi** (ochiq qolmaydi).
- Webhook faqat `X-Telegram-Bot-Api-Secret-Token` bilan; update'lar `processed_updates` orqali takrorlanmaydi.
- Serverless'da javobdan oldin hamma narsa `await` qilinadi (cold-cut bo'lmasligi uchun).
- Testlar faqat alohida bazada; asosiy bazaga tushib ketmaydi (`test/_helper.js`).
- Xabar yuborish `notification_log` ga yoziladi (audit).
- O'chirish — yumshoq (`deleted_at`), tarix va qoldiq qayta hisoblanadi.
