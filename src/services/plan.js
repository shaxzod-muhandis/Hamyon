const db = require("../lib/db");
const D = require("../lib/dates");
const F = require("./finance");
const T = require("./transactions");
const Planned = require("./planned");

const { UserError } = T;

async function get(user, today) {
  const accs = await F.accounts(user);
  const totals = await F.totals(user, accs);
  const fc = await F.forecast(user, today, totals.liquid);
  const start = D.addDays(today, 1);
  const items = await F.scheduled(user.id, start, fc.end_date, { forecastOnlyIncome: false });
  const bal = Object.fromEntries(fc.daily_balance.map((x) => [x.date, x.balance]));
  const debtSum = items.filter((x) => x.kind === "debt").reduce((s, x) => s - x.amount, 0);
  const plannedSum = items.filter((x) => x.kind === "planned").reduce((s, x) => s - x.amount, 0);
  const rows = await Planned.list(user.id);
  const horizon = D.addDays(today, 400);
  const incomes = rows.filter((p) => p.kind === "income").map((p) => ({
    id: p.id, name: p.name, amount: p.amount, recurrence: p.recurrence, include_in_forecast: p.include_in_forecast, is_salary: p.is_salary,
    next_date: D.occurrences(p.start_date, p.recurrence, today, horizon)[0] || null,
  }));
  return {
    period: { start, end: fc.end_date },
    formula: {
      liquid: fc.liquid, incoming: fc.incoming, planned: plannedSum, debts: debtSum,
      avg_daily: fc.avg_daily, days: fc.days, daily_total: fc.daily_total, expected: fc.end_balance,
    },
    reliability: { below_threshold: fc.below_threshold, min_balance: fc.min_balance, min_date: fc.min_date, threshold: fc.threshold },
    incomes,
    items: items.map((x) => ({
      date: x.date, name: x.name, amount: x.amount, kind: x.kind, planned_id: x.planned_id || null, debt_id: x.debt_id || null,
      included: x.kind === "income" ? !!x.include : true, balance_after: bal[x.date] ?? null,
    })),
    planned: rows.map((p) => ({ id: p.id, kind: p.kind, name: p.name, amount: p.amount, start_date: p.start_date, recurrence: p.recurrence, include_in_forecast: p.include_in_forecast, category_id: p.category_id, account_id: p.account_id })),
    daily_balance: fc.daily_balance,
  };
}

async function updatePlanned(user, id, i) {
  const cur = (await db.query("select * from planned_transactions where id=$1 and user_id=$2 and active", [id, user.id])).rows[0];
  if (!cur) throw new UserError("Rejali operatsiya topilmadi");
  const amount = i.amount !== undefined ? Math.trunc(Number(i.amount)) : cur.amount;
  if (!(amount > 0)) throw new UserError("Summani kiriting, u 0 dan katta bo‘lishi kerak");
  const name = i.name !== undefined ? String(i.name).trim().slice(0, 80) : cur.name;
  if (!name) throw new UserError("Nomini kiriting");
  const rec = i.recurrence !== undefined ? i.recurrence : cur.recurrence;
  if (!["none", "daily", "weekly", "monthly", "yearly"].includes(rec)) throw new UserError("Takrorlanish noto‘g‘ri");
  const start = i.start_date || cur.start_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new UserError("Sana noto‘g‘ri");
  const inc = i.include_in_forecast !== undefined ? !!i.include_in_forecast : cur.include_in_forecast;
  return (await db.query(
    `update planned_transactions set name=$3, amount=$4, start_date=$5, recurrence=$6, include_in_forecast=$7 where id=$1 and user_id=$2 returning *`,
    [id, user.id, name, amount, start, rec, inc])).rows[0];
}

// Rejali operatsiyaning bitta sanasini haqiqiy operatsiyaga aylantirish va prognozdan chiqarish
async function markDone(user, id, date, accountId) {
  const p = (await db.query("select * from planned_transactions where id=$1 and user_id=$2 and active", [id, user.id])).rows[0];
  if (!p) throw new UserError("Rejali operatsiya topilmadi");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new UserError("Sana noto‘g‘ri");
  const u = (await db.query("select last_account_id from users where id=$1", [user.id])).rows[0];
  const accId = accountId || p.account_id || u.last_account_id || (await F.accounts(user)).find((a) => a.currency === "UZS")?.id;
  let catId = p.category_id;
  if (!catId) catId = (await db.query("select id from categories where user_id=$1 and kind=$2 and name=$3", [user.id, p.kind, p.kind === "income" ? "Boshqa kirim" : "Boshqa"])).rows[0]?.id;
  const tx = await T.createTx(user.id, { kind: p.kind, amount: p.amount, accountId: accId, categoryId: catId, note: p.name, idemKey: `plan:${p.id}:${date}`, source: "web" });
  await db.query("insert into planned_exceptions (planned_id, date) values ($1,$2) on conflict do nothing", [p.id, date]);
  return tx;
}

module.exports = { get, updatePlanned, markDone };
