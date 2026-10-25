// Mini App / web uchun REST API. Barcha moliyaviy hisob serverda; javoblarda tayyor qiymatlar.
const express = require("express");
const db = require("./lib/db");
const D = require("./lib/dates");
const { verifyInitData, verifyWidget } = require("./lib/auth");
const session = require("./lib/session");
const T = require("./services/transactions");
const F = require("./services/finance");
const Accounts = require("./services/accounts");
const Categories = require("./services/categories");
const Debts = require("./services/debts");
const Planned = require("./services/planned");
const Plan = require("./services/plan");
const Analytics = require("./services/analytics");
const MonthPlan = require("./services/monthplan");
const { REMINDER_LABELS } = require("./bot");

const { UserError } = T;
const router = express.Router();

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    console.error("api xato:", req.method, req.path, e);
    res.status(500).json({ error: "server" });
  });

// ── Kirish ─────────────────────────────────────────────────────────────
router.get("/config", (req, res) => res.json({ bot_username: process.env.BOT_USERNAME || null }));

// Telegram Login Widget -> sessiya tokeni (brauzer)
router.post("/auth/widget", wrap(async (req, res) => {
  const tgUser = verifyWidget(req.body || {}, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: "Kirish tasdiqlanmadi" });
  const u = (await db.query("select id from users where tg_id=$1", [tgUser.id])).rows[0];
  if (!u) return res.status(403).json({ error: "Avval botda /start bosing" });
  res.json({ token: session.sign(u.id) });
}));

async function auth(req, res, next) {
  try {
    const h = req.get("authorization") || "";
    let user = null;
    if (/^tma\s/i.test(h)) {
      const tgUser = verifyInitData(h.replace(/^tma\s+/i, ""), process.env.BOT_TOKEN);
      if (tgUser) user = (await db.query("select * from users where tg_id=$1", [tgUser.id])).rows[0];
      else return res.status(401).json({ error: "unauthorized" });
      if (!user) return res.status(403).json({ error: "Avval botda /start bosing" });
    } else if (/^bearer\s/i.test(h)) {
      const id = session.verify(h.replace(/^bearer\s+/i, ""));
      if (id) user = (await db.query("select * from users where id=$1", [id])).rows[0];
    }
    if (!user) return res.status(401).json({ error: "unauthorized" });
    req.user = user;
    req.today = D.localDate(user.tz);
    next();
  } catch (e) {
    console.error("auth xato:", e);
    res.status(500).json({ error: "server" });
  }
}
router.use(auth);

const id = (req) => Number(req.params.id);

// ── Profil, meta, sozlamalar ───────────────────────────────────────────
const publicUser = (u) => ({
  id: u.id, first_name: u.first_name, username: u.username, tz: u.tz, theme: u.theme,
  safe_threshold: u.safe_threshold, usd_rate: u.usd_rate, last_account_id: u.last_account_id, bot_connected: !!u.chat_id,
  bot_username: process.env.BOT_USERNAME || null,
});

router.get("/me", wrap(async (req, res) => {
  const n = (await db.query("select count(*)::int n from reminders where user_id=$1 and enabled", [req.user.id])).rows[0].n;
  res.json({ ...publicUser(req.user), reminders_enabled: n, today: req.today });
}));

router.get("/meta", wrap(async (req, res) => {
  const [accs, archived, cats] = await Promise.all([F.accounts(req.user), F.accounts(req.user, { archived: true }), Categories.list(req.user.id)]);
  res.json({ user: publicUser(req.user), today: req.today, accounts: [...accs, ...archived], categories: cats });
}));

// Menyudagi qizil nishonlar (TZ 3.1): muddati o'tgan qarzlar, limitdan oshgan kategoriyalar
router.get("/badges", wrap(async (req, res) => {
  const [debts, budget] = await Promise.all([F.debts(req.user.id, { openOnly: true }), F.budget(req.user, req.today)]);
  res.json({ debts: debts.filter((d) => d.due_date && d.due_date < req.today).length, budget: budget.over_count });
}));

router.put("/settings", wrap(async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const theme = b.theme !== undefined ? b.theme : u.theme;
  if (!["light", "dark", "system"].includes(theme)) throw new UserError("Mavzu noto‘g‘ri");
  let tz = u.tz;
  if (b.tz !== undefined) {
    try { new Intl.DateTimeFormat("en", { timeZone: b.tz }); tz = b.tz; } catch { throw new UserError("Vaqt zonasi noto‘g‘ri"); }
  }
  const thr = b.safe_threshold !== undefined ? Math.trunc(Number(b.safe_threshold)) : u.safe_threshold;
  const rate = b.usd_rate !== undefined ? Math.trunc(Number(b.usd_rate)) : u.usd_rate;
  if (!(thr >= 0)) throw new UserError("Xavfsiz chegara noto‘g‘ri");
  if (!(rate > 0)) throw new UserError("Kurs noto‘g‘ri");
  const r = await db.query("update users set theme=$2, tz=$3, safe_threshold=$4, usd_rate=$5 where id=$1 returning *", [u.id, theme, tz, thr, rate]);
  res.json(publicUser(r.rows[0]));
}));

router.get("/export", wrap(async (req, res) => {
  const q = (t) => db.query(`select * from ${t} where user_id=$1`, [req.user.id]).then((r) => r.rows);
  const data = {
    exported_at: new Date().toISOString(), user: publicUser(req.user),
    accounts: await q("accounts"), categories: await q("categories"), transactions: await q("transactions"),
    budget_limits: await q("budget_limits"), debts: await q("debts"), planned: await q("planned_transactions"),
  };
  res.setHeader("Content-Disposition", `attachment; filename="hamyon-${req.today}.json"`);
  res.json(data);
}));

// ── Dashboard ──────────────────────────────────────────────────────────
router.get("/dashboard", wrap(async (req, res) => res.json(await F.dashboard(req.user))));

// ── Operatsiyalar ──────────────────────────────────────────────────────
router.get("/transactions", wrap(async (req, res) => res.json(await T.search(req.user, req.query))));

router.post("/transactions", wrap(async (req, res) => {
  const b = req.body || {};
  let occurredAt;
  if (b.date) occurredAt = await T.occurredFrom(req.user.tz, b.date, b.time || D.localHM(req.user.tz));
  const tx = await T.createTx(req.user.id, {
    kind: b.kind, amount: b.amount, accountId: b.account_id, toAccountId: b.to_account_id, toAmount: b.to_amount,
    categoryId: b.category_id, note: b.note, occurredAt, idemKey: b.idempotency_key, source: "web",
  });
  if (tx.created && b.recurrence && b.recurrence !== "none" && tx.kind !== "transfer") {
    const date = b.date || req.today;
    const step = { daily: () => D.addDays(date, 1), weekly: () => D.addDays(date, 7), monthly: () => D.addMonths(date, 1), yearly: () => D.addMonths(date, 12) }[b.recurrence];
    if (!step) throw new UserError("Takrorlanish noto‘g‘ri");
    const base = step();
    const start = b.recurrence === "monthly" || b.recurrence === "yearly" ? D.withDay(base, D.dayNum(date)) : base;
    await Planned.add(req.user, {
      kind: tx.kind, name: tx.note || tx.category.name, amount: tx.amount, categoryId: tx.category_id, accountId: tx.account_id,
      startDate: start, recurrence: b.recurrence, include: tx.kind === "expense",
    });
  }
  let warning = null;
  if (tx.created && tx.kind !== "income") {
    const acc = (await F.accounts(req.user)).find((a) => a.id === tx.account_id);
    if (acc && acc.balance < 0) warning = "Hisobda yetarli mablag‘ yo‘q, qoldiq manfiy bo‘ladi.";
  }
  res.status(tx.created ? 201 : 200).json({ transaction: await T.getTx(req.user.id, tx.id), created: tx.created, warning });
}));

router.put("/transactions/:id", wrap(async (req, res) => res.json(await T.update(req.user, id(req), req.body || {}))));
router.delete("/transactions/:id", wrap(async (req, res) => {
  const t = await T.getTx(req.user.id, id(req));
  if (t?.debt_id) throw new UserError("Qarz to‘lovlari Qarzlar bo‘limida boshqariladi");
  res.json({ ok: await T.deleteTx(req.user.id, id(req)) });
}));
router.post("/transactions/:id/restore", wrap(async (req, res) => res.json({ ok: await T.restoreTx(req.user.id, id(req)) })));

// Guruhli amallar (TZ 5.4)
router.post("/transactions/bulk", wrap(async (req, res) => {
  const { ids, action, category_id, account_id } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new UserError("Operatsiyalar tanlanmagan");
  const clean = ids.map(Number).filter(Number.isFinite);
  const free = (await db.query("select id from transactions where user_id=$1 and id = any($2) and debt_id is null and deleted_at is null", [req.user.id, clean])).rows.map((r) => r.id);
  if (action === "delete") await db.query("update transactions set deleted_at=now() where id = any($1)", [free]);
  else if (action === "category") {
    const cat = await T.getCategory(req.user.id, Number(category_id));
    await db.query("update transactions set category_id=$2 where id = any($1) and kind=$3", [free, cat.id, cat.kind]);
  } else if (action === "account") {
    const acc = await T.getAccount(req.user.id, Number(account_id));
    await db.query("update transactions set account_id=$2 where id = any($1) and kind<>'transfer'", [free, acc.id]);
  } else throw new UserError("Amal noto‘g‘ri");
  res.json({ ok: true, affected: free.length, ids: free });
}));

// ── Hisoblar ───────────────────────────────────────────────────────────
router.get("/accounts", wrap(async (req, res) => {
  const [active, archived] = await Promise.all([Accounts.list(req.user, req.today), Accounts.list(req.user, req.today, { archived: true })]);
  const t = await F.totals(req.user, active);
  const usd = active.filter((a) => a.currency === "USD");
  const savings = active.filter((a) => a.type === "savings").reduce((s, a) => s + a.balance_uzs, 0);
  const savedMonth = active.filter((a) => a.type === "savings").reduce((s, a) => s + a.month_in, 0);
  res.json({
    accounts: active, archived,
    summary: { total: t.total, liquid: t.liquid, savings, saved_month: savedMonth, usd: usd.reduce((s, a) => s + a.balance, 0), usd_rate: req.user.usd_rate },
  });
}));
router.post("/accounts", wrap(async (req, res) => res.status(201).json(await Accounts.create(req.user, req.body || {}))));
router.put("/accounts/:id", wrap(async (req, res) => res.json(await Accounts.update(req.user, id(req), req.body || {}))));
router.post("/accounts/:id/archive", wrap(async (req, res) => res.json(await Accounts.setArchived(req.user, id(req), !(req.body && req.body.archived === false)))));
router.delete("/accounts/:id", wrap(async (req, res) => res.json({ ok: await Accounts.remove(req.user, id(req)) })));

// ── Kategoriyalar ──────────────────────────────────────────────────────
router.get("/categories", wrap(async (req, res) => res.json(await Categories.list(req.user.id))));
router.post("/categories", wrap(async (req, res) => res.status(201).json(await Categories.create(req.user.id, req.body || {}))));
router.put("/categories/:id", wrap(async (req, res) => res.json(await Categories.update(req.user.id, id(req), req.body || {}))));
router.delete("/categories/:id", wrap(async (req, res) => res.json(await Categories.remove(req.user.id, id(req), req.body?.move_to || req.query.move_to))));

// ── Budjet ─────────────────────────────────────────────────────────────
router.get("/budget", wrap(async (req, res) => {
  const b = await F.budget(req.user, req.today);
  const has = new Set(b.items.map((x) => x.category_id));
  const cats = (await Categories.list(req.user.id)).filter((c) => c.kind === "expense" && !c.system_key && !has.has(c.id));
  res.json({ ...b, month: req.today.slice(0, 7), elapsed_days: D.dayNum(req.today), days_in_month: D.daysInMonth(req.today), unbudgeted: cats });
}));
router.put("/budget/:id", wrap(async (req, res) => {
  const limit = Math.trunc(Number(req.body?.limit));
  if (!(limit > 0)) throw new UserError("Limit 0 dan katta bo‘lishi kerak");
  await T.getCategory(req.user.id, id(req));
  await db.query(
    `insert into budget_limits (user_id, category_id, limit_amount) values ($1,$2,$3)
     on conflict (user_id, category_id) do update set limit_amount=$3`, [req.user.id, id(req), limit]);
  res.json({ ok: true });
}));
router.delete("/budget/:id", wrap(async (req, res) => {
  await db.query("delete from budget_limits where user_id=$1 and category_id=$2", [req.user.id, id(req)]);
  res.json({ ok: true });
}));

// ── Qarzlar ────────────────────────────────────────────────────────────
router.get("/debts", wrap(async (req, res) => res.json(await Debts.view(req.user, req.today))));
router.post("/debts", wrap(async (req, res) => {
  const b = req.body || {};
  if (!["payable", "receivable"].includes(b.direction)) throw new UserError("Yo‘nalish noto‘g‘ri");
  const d = await Debts.createDebt(req.user, {
    direction: b.direction, who: b.who, amount: b.amount, accountId: b.account_id, dueDate: b.due_date || null,
    monthly: b.monthly_payment, payDay: b.pay_day, source: "web",
  });
  if (b.interest_pct || b.note || b.start_date)
    await db.query("update debts set interest_pct=$2, note=$3, start_date=coalesce($4::date, start_date) where id=$1", [d.id, b.interest_pct || null, b.note || null, b.start_date || null]);
  res.status(201).json(d);
}));
router.put("/debts/:id", wrap(async (req, res) => res.json(await Debts.update(req.user, id(req), req.body || {}))));
router.delete("/debts/:id", wrap(async (req, res) => res.json({ ok: await Debts.remove(req.user, id(req)) })));
router.post("/debts/:id/payments", wrap(async (req, res) => {
  const b = req.body || {};
  const accId = b.account_id || req.user.last_account_id;
  if (!accId) throw new UserError("Hisobni tanlang");
  const r = await Debts.payDebt(req.user, id(req), b.amount, accId);
  res.status(201).json({ left: r.left, closed: r.closed });
}));

// ── Reja va prognoz ────────────────────────────────────────────────────
router.get("/plan", wrap(async (req, res) => res.json(await Plan.get(req.user, req.today))));
router.post("/plan", wrap(async (req, res) => {
  const b = req.body || {};
  if (!["expense", "income"].includes(b.kind)) throw new UserError("Tur noto‘g‘ri");
  if (!String(b.name || "").trim()) throw new UserError("Nomini kiriting");
  res.status(201).json(await Planned.add(req.user, {
    kind: b.kind, name: String(b.name).trim(), amount: b.amount, categoryId: b.category_id, accountId: b.account_id,
    startDate: b.start_date, recurrence: b.recurrence || "none", include: b.include_in_forecast, isSalary: !!b.is_salary,
  }));
}));
router.put("/plan/:id", wrap(async (req, res) => res.json(await Plan.updatePlanned(req.user, id(req), req.body || {}))));
router.delete("/plan/:id", wrap(async (req, res) => res.json({ ok: await Planned.remove(req.user.id, id(req)) })));
router.post("/plan/:id/done", wrap(async (req, res) => {
  const tx = await Plan.markDone(req.user, id(req), req.body?.date, req.body?.account_id);
  res.status(201).json({ transaction_id: tx.id });
}));

// ── Keyingi oy rejasi: nimalarga pul ajratish ──────────────────────────
router.get("/month-plan", wrap(async (req, res) => res.json(await MonthPlan.get(req.user, req.today, req.query.month))));
router.post("/month-plan", wrap(async (req, res) => res.status(201).json(await MonthPlan.add(req.user, req.today, req.body || {}))));
router.put("/month-plan/:id", wrap(async (req, res) => res.json(await MonthPlan.update(req.user, id(req), req.body || {}))));
router.delete("/month-plan/:id", wrap(async (req, res) => res.json({ ok: await MonthPlan.remove(req.user, id(req)) })));

// ── Tahlil ─────────────────────────────────────────────────────────────
router.get("/analytics", wrap(async (req, res) => res.json(await Analytics.get(req.user, req.today, req.query.months))));

// ── Eslatmalar ─────────────────────────────────────────────────────────
const REMINDER_HINT = {
  expense_reminder: "Har kuni", daily_report: "Har kuni", weekly: "Har yakshanba", monthly: "Oyning 1-kuni",
  debt_due: "3 kun oldin, to‘lov kuni va kechikkanda", mandatory: "1 kun oldin", budget: "80% va 100% ga yetganda, darhol",
  low_funds: "Prognoz xavfsiz chegaradan tushsa",
};
router.get("/reminders", wrap(async (req, res) => {
  const rows = (await db.query("select kind, enabled, at_time from reminders where user_id=$1", [req.user.id])).rows;
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  const items = Object.keys(REMINDER_LABELS).filter((k) => by[k]).map((k) => ({
    kind: k, label: REMINDER_LABELS[k], hint: REMINDER_HINT[k], enabled: by[k].enabled, at_time: by[k].at_time, has_time: by[k].at_time !== null,
  }));
  res.json({ items, bot: { connected: !!req.user.chat_id, username: process.env.BOT_USERNAME || null, tz: req.user.tz, enabled: items.filter((x) => x.enabled).length } });
}));
router.put("/reminders/:kind", wrap(async (req, res) => {
  const b = req.body || {};
  const cur = (await db.query("select * from reminders where user_id=$1 and kind=$2", [req.user.id, req.params.kind])).rows[0];
  if (!cur) throw new UserError("Eslatma topilmadi");
  let t = cur.at_time;
  if (b.at_time !== undefined) {
    if (cur.at_time === null) throw new UserError("Bu eslatmada vaqt yo‘q");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.at_time)) throw new UserError("Vaqt noto‘g‘ri");
    t = b.at_time;
  }
  await db.query("update reminders set enabled=$3, at_time=$4 where user_id=$1 and kind=$2", [req.user.id, req.params.kind, b.enabled !== undefined ? !!b.enabled : cur.enabled, t]);
  res.json({ ok: true });
}));

router.use((req, res) => res.status(404).json({ error: "not_found" }));

module.exports = router;
