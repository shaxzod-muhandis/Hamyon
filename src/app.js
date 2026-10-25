// Hamyon backend: Telegram webhook, cron va Mini App uchun API.
const express = require("express");
const crypto = require("crypto");
const db = require("./lib/db");
const tg = require("./lib/tg");
const bot = require("./bot");
const Reminders = require("./services/reminders");

const app = express();
app.use(express.json({ limit: "1mb" }));

const eq = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

app.get("/api/health", async (req, res) => {
  try { await db.query("select 1"); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false }); }
});

// ── Telegram webhook ───────────────────────────────────────────────────
app.post("/api/bot", async (req, res) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !eq(req.get("x-telegram-bot-api-secret-token"), secret)) return res.status(401).json({ ok: false });
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error("webhook xato:", e);
  }
  res.json({ ok: true }); // doim 200: Telegram qayta yubormasin (dedupe baribir bor)
});

// ── Cron / admin (CRON_SECRET) ─────────────────────────────────────────
const cronAuth = (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  const given = (req.get("authorization") || "").replace(/^Bearer\s+/i, "") || req.query.key;
  if (!secret || !eq(given, secret)) return res.status(401).json({ ok: false });
  next();
};
app.all("/api/cron/tick", cronAuth, async (req, res) => {
  try {
    const out = await Reminders.tick();
    await db.query("delete from processed_updates where created_at < now() - interval '3 days'");
    await db.query("delete from bot_state where updated_at < now() - interval '1 day'");
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error("tick xato:", e);
    res.status(500).json({ ok: false });
  }
});
// Webhook va buyruqlar ro'yxatini o'rnatish: POST /api/admin/setup (Bearer CRON_SECRET)
app.post("/api/admin/setup", cronAuth, async (req, res) => {
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  if (!base || !process.env.WEBHOOK_SECRET) return res.status(400).json({ ok: false, error: "APP_URL va WEBHOOK_SECRET kerak" });
  const hook = await tg.call("setWebhook", { url: `${base}/api/bot`, secret_token: process.env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  const cmds = await tg.call("setMyCommands", { commands: bot.BOT_COMMANDS });
  const menu = process.env.WEBAPP_ENABLED === "1"
    ? await tg.call("setChatMenuButton", { menu_button: { type: "web_app", text: "Hamyon", web_app: { url: base } } })
    : await tg.call("setChatMenuButton", { menu_button: { type: "commands" } });
  res.json({ ok: hook.ok && cmds.ok, webhook: hook.ok, commands: cmds.ok, menu: menu.ok });
});

// ── Mini App / web API ─────────────────────────────────────────────────
app.use("/api", require("./api"));

// ── Frontend (public/) va sahifa manzillari (SPA) ──────────────────────
const path = require("path");
const PUBLIC = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC, { maxAge: process.env.NODE_ENV === "production" ? "5m" : 0 }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC, "index.html")));

module.exports = app;
