// Hamyon backend: Telegram webhook, cron va Mini App uchun API.
const express = require("express");
const crypto = require("crypto");
const db = require("./lib/db");
const tg = require("./lib/tg");
const { verifyInitData } = require("./lib/auth");
const bot = require("./bot");
const F = require("./services/finance");
const T = require("./services/transactions");
const Reminders = require("./services/reminders");

const app = express();
app.use(express.json({ limit: "1mb" }));

const eq = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

app.get("/", (req, res) => res.type("html").send("<!doctype html><meta charset=utf-8><title>Hamyon</title><body style='font-family:sans-serif;padding:40px'><h1>Hamyon</h1><p>Shaxsiy moliya — Telegram bot.</p>"));
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

// ── Mini App API (initData bilan) ──────────────────────────────────────
async function miniAuth(req, res, next) {
  const initData = (req.get("authorization") || "").replace(/^tma\s+/i, "");
  const tgUser = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: "unauthorized" });
  const r = await db.query("select * from users where tg_id=$1", [tgUser.id]);
  if (!r.rows[0]) return res.status(403).json({ error: "Avval botda /start bosing" });
  req.user = r.rows[0];
  next();
}
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (e instanceof T.UserError) return res.status(400).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: "server" });
});

app.get("/api/dashboard", miniAuth, wrap(async (req, res) => res.json(await F.dashboard(req.user))));
app.get("/api/transactions", miniAuth, wrap(async (req, res) => res.json(await T.recent(req.user.id, Math.min(Number(req.query.limit) || 50, 200)))));
app.post("/api/transactions", miniAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const tx = await T.createTx(req.user.id, { ...b, accountId: b.account_id, toAccountId: b.to_account_id, categoryId: b.category_id, idemKey: b.idempotency_key, source: "web" });
  res.status(tx.created ? 201 : 200).json({ id: tx.id, created: tx.created });
}));
app.delete("/api/transactions/:id", miniAuth, wrap(async (req, res) => res.json({ ok: await T.deleteTx(req.user.id, Number(req.params.id)) })));

module.exports = app;
