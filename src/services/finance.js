// Barcha moliyaviy hisob-kitoblar shu yerda (serverda). Bot ham, web ham shu funksiyalardan foydalanadi.
const db = require("../lib/db");
const D = require("../lib/dates");

// Operatsiya summasini so'mga o'tkazish (USD hisob: sent * kurs / 100)
const AMT_UZS = "round(t.amount * case a.currency when 'USD' then u.usd_rate / 100.0 else 1 end)";
const STAT_FROM = `from transactions t
  join accounts a on a.id = t.account_id
  join users u on u.id = t.user_id
  left join categories c on c.id = t.category_id`;
const STAT_WHERE = `t.user_id = $1 and t.deleted_at is null and t.kind in ('expense','income') and c.system_key is null`;

const toUzs = (balance, currency, rate) => (currency === "USD" ? Math.round((balance * rate) / 100) : balance);

async function accounts(user, { archived = false } = {}) {
  const r = await db.query(
    `select a.id, a.name, a.short_name, a.type, a.currency, a.is_liquid, a.archived, a.initial_balance,
            a.initial_balance + coalesce(sum(case
              when t.kind='income'   and t.account_id=a.id then t.amount
              when t.kind='expense'  and t.account_id=a.id then -t.amount
              when t.kind='transfer' and t.account_id=a.id then -t.amount
              when t.kind='transfer' and t.to_account_id=a.id then coalesce(t.to_amount, t.amount)
              else 0 end), 0)::bigint as balance
       from accounts a
       left join transactions t on t.deleted_at is null and (t.account_id=a.id or t.to_account_id=a.id)
      where a.user_id=$1 and a.archived = $2
      group by a.id order by a.sort, a.id`, [user.id, archived]);
  return r.rows.map((a) => ({ ...a, balance_uzs: toUzs(a.balance, a.currency, user.usd_rate) }));
}

async function debts(userId, { openOnly = false } = {}) {
  const r = await db.query(
    `select d.*, coalesce(p.paid, 0)::bigint as paid, (d.principal - coalesce(p.paid, 0))::bigint as remaining
       from debts d
       left join (select debt_id, sum(amount) paid from debt_payments group by debt_id) p on p.debt_id = d.id
      where d.user_id=$1
      order by (d.principal - coalesce(p.paid, 0) <= 0), d.due_date nulls last, d.id`, [userId]);
  const rows = r.rows.map((d) => ({ ...d, closed: d.remaining <= 0 }));
  return openOnly ? rows.filter((d) => !d.closed) : rows;
}

async function totals(user, accs, debtRows) {
  const active = accs || (await accounts(user));
  const ds = debtRows || (await debts(user.id, { openOnly: true }));
  const total = active.reduce((s, a) => s + a.balance_uzs, 0);
  const liquid = active.filter((a) => a.is_liquid && a.currency === "UZS").reduce((s, a) => s + a.balance, 0);
  const receivables = ds.filter((d) => d.direction === "receivable").reduce((s, d) => s + d.remaining, 0);
  const payables = ds.filter((d) => d.direction === "payable").reduce((s, d) => s + d.remaining, 0);
  return { total, liquid, receivables, payables, net_worth: total + receivables - payables };
}

async function periodStats(userId, tz, from, to) {
  const r = await db.query(
    `select t.kind, c.id category_id, sum(${AMT_UZS})::bigint amount ${STAT_FROM}
      where ${STAT_WHERE} and (t.occurred_at at time zone $2)::date between $3::date and $4::date
      group by t.kind, c.id`, [userId, tz, from, to]);
  const out = { income: 0, expense: 0, byCategory: { expense: [], income: [] } };
  for (const row of r.rows) {
    out[row.kind] += row.amount;
    out.byCategory[row.kind].push({ category_id: row.category_id, amount: row.amount });
  }
  for (const k of ["expense", "income"]) out.byCategory[k].sort((a, b) => b.amount - a.amount);
  return out;
}

// Oy ichidagi kunlik xarajat (jamlanma grafik uchun)
async function dailyExpense(userId, tz, from, to) {
  const r = await db.query(
    `select (t.occurred_at at time zone $2)::date::text d, sum(${AMT_UZS})::bigint amount ${STAT_FROM}
      where ${STAT_WHERE} and t.kind='expense' and (t.occurred_at at time zone $2)::date between $3::date and $4::date
      group by 1`, [userId, tz, from, to]);
  return Object.fromEntries(r.rows.map((x) => [x.d, x.amount]));
}

async function categoryNames(userId) {
  const r = await db.query("select id, name, emoji, color, is_fixed, kind from categories where user_id=$1", [userId]);
  return Object.fromEntries(r.rows.map((c) => [c.id, c]));
}

function budgetStatusOf({ spent, limit, projection, fixed }) {
  if (spent > limit) return { status: "over", label: "Limitdan oshdi" };
  if (!fixed && projection > limit) return { status: "may_exceed", label: "Oshishi mumkin" };
  if (!fixed && limit > 0 && (spent / limit) * 100 >= 80) return { status: "attention", label: "Diqqat" };
  return { status: "ok", label: "Me’yorda" };
}

async function budget(user, today) {
  const from = D.monthStart(today), to = D.monthEnd(today);
  const elapsed = D.dayNum(today), dim = D.daysInMonth(today);
  const spentRows = await db.query(
    `select t.category_id, sum(${AMT_UZS})::bigint spent ${STAT_FROM}
      where ${STAT_WHERE} and t.kind='expense' and (t.occurred_at at time zone $2)::date between $3::date and $4::date
      group by t.category_id`, [user.id, user.tz, from, to]);
  const spentBy = Object.fromEntries(spentRows.rows.map((r) => [r.category_id, r.spent]));
  const lim = await db.query(
    `select b.category_id, b.limit_amount, c.name, c.emoji, c.color, c.is_fixed
       from budget_limits b join categories c on c.id=b.category_id
      where b.user_id=$1 and not c.archived`, [user.id]);
  const items = lim.rows.map((b) => {
    const spent = spentBy[b.category_id] || 0;
    const projection = b.is_fixed ? spent : Math.round((spent / elapsed) * dim);
    const pct = Math.round((spent / b.limit_amount) * 100);
    return {
      category_id: b.category_id, name: b.name, emoji: b.emoji, color: b.color, is_fixed: b.is_fixed,
      limit: b.limit_amount, spent, pct, left: b.limit_amount - spent, pace_projection: projection,
      ...budgetStatusOf({ spent, limit: b.limit_amount, projection, fixed: b.is_fixed }),
    };
  }).sort((a, b) => b.pct - a.pct);
  const limit = items.reduce((s, x) => s + x.limit, 0);
  const spent = items.reduce((s, x) => s + x.spent, 0);
  return {
    items, limit, spent, left: limit - spent, pct: limit ? Math.round((spent / limit) * 100) : 0,
    month_pct: Math.round((elapsed / dim) * 100), over_count: items.filter((x) => x.status === "over").length,
  };
}

async function plannedRows(userId) {
  return (await db.query("select * from planned_transactions where user_id=$1 and active", [userId])).rows;
}

// [from, to] oralig'idagi rejali tushum/chiqim va qarz to'lovlari: [{date, name, amount(+/-), kind}]
async function scheduled(userId, from, to, { forecastOnlyIncome = true } = {}) {
  const out = [];
  for (const p of await plannedRows(userId)) {
    if (p.kind === "income" && forecastOnlyIncome && !p.include_in_forecast) continue;
    for (const date of D.occurrences(p.start_date, p.recurrence, from, to))
      out.push({ date, name: p.name, amount: p.kind === "income" ? p.amount : -p.amount, kind: p.kind === "income" ? "income" : "planned", planned_id: p.id });
  }
  for (const d of await debts(userId, { openOnly: true })) {
    if (d.direction !== "payable") continue;
    if (d.pay_day && d.monthly_payment) {
      let left = d.remaining;
      for (let m = D.monthStart(from); m <= to; m = D.addMonths(m, 1)) {
        const date = D.withDay(m, d.pay_day);
        if (date < from || date > to || date < d.start_date || left <= 0) continue;
        const amt = Math.min(d.monthly_payment, left);
        left -= amt;
        out.push({ date, name: d.who, amount: -amt, kind: "debt", debt_id: d.id });
      }
    } else if (d.due_date && d.due_date >= from && d.due_date <= to) {
      out.push({ date: d.due_date, name: d.who, amount: -d.remaining, kind: "debt", debt_id: d.id });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function safeToSpend(user, today, liquid) {
  const salaries = (await plannedRows(user.id)).filter((p) => p.kind === "income" && p.is_salary);
  let target = null;
  const horizon = D.addDays(today, 400);
  for (const p of salaries)
    for (const d of D.occurrences(p.start_date, p.recurrence, D.addDays(today, 1), horizon)) { if (!target || d < target) target = d; break; }
  let mode = "salary";
  if (!target) {
    mode = "month_end";
    target = D.monthEnd(today);
    if (target <= today) target = D.monthEnd(D.addMonths(today, 1));
  }
  const days = D.diffDays(target, today);
  const items = await scheduled(user.id, today, D.addDays(target, -1), { forecastOnlyIncome: true });
  const obligations = items.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
  const amount = liquid - obligations;
  return { amount, liquid, obligations, next_income_date: target, days, per_day: Math.floor(Math.max(0, amount) / days), mode };
}

async function avgDailySpend(user, today) {
  const from = D.addDays(today, -89);
  const r = await db.query(
    `select coalesce(sum(${AMT_UZS}),0)::bigint spent, min((t.occurred_at at time zone $2)::date)::text first_day ${STAT_FROM}
      where ${STAT_WHERE} and t.kind='expense' and (t.occurred_at at time zone $2)::date between $3::date and $4::date`,
    [user.id, user.tz, from, today]);
  const { spent, first_day } = r.rows[0];
  if (!first_day) return 0;
  const span = Math.min(90, Math.max(1, D.diffDays(today, first_day) + 1));
  return Math.round(spent / span);
}

async function forecast(user, today, liquid) {
  const lastDay = D.monthEnd(D.addMonths(today, 1));
  const start = D.addDays(today, 1);
  const avg = await avgDailySpend(user, today);
  const items = await scheduled(user.id, start, lastDay);
  const byDate = {};
  for (const it of items) byDate[it.date] = (byDate[it.date] || 0) + it.amount;
  const daily = [];
  let bal = liquid, min = { balance: liquid, date: today };
  for (let d = start; d <= lastDay; d = D.addDays(d, 1)) {
    bal += (byDate[d] || 0) - avg;
    daily.push({ date: d, balance: bal });
    if (bal < min.balance) min = { balance: bal, date: d };
  }
  const planned = items.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
  const incoming = items.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const days = daily.length;
  return {
    start_date: start, end_date: lastDay, daily_balance: daily, end_balance: bal, min_balance: min.balance, min_date: min.date,
    threshold: user.safe_threshold, below_threshold: min.balance < user.safe_threshold,
    avg_daily: avg, days, incoming, planned, daily_total: avg * days, liquid,
  };
}

async function upcoming(user, today, days = 14, limit = 5) {
  const items = (await scheduled(user.id, today, D.addDays(today, days), { forecastOnlyIncome: false })).filter((x) => x.amount < 0);
  const total = items.reduce((s, x) => s - x.amount, 0);
  return { total, items: items.slice(0, limit).map((x) => ({ ...x, days_left: D.diffDays(x.date, today) })) };
}

async function dashboard(user, now = new Date()) {
  const today = D.localDate(user.tz, now);
  const accs = await accounts(user);
  const ds = await debts(user.id);
  const open = ds.filter((d) => !d.closed);
  const t = await totals(user, accs, open);
  const monthFrom = D.monthStart(today);
  const prevFrom = D.monthStart(D.addMonths(today, -1));
  const prevTo = D.monthEnd(prevFrom);
  const [stats, prevStats, todayStats, bud, fc, up, safe, cur, prev] = await Promise.all([
    periodStats(user.id, user.tz, monthFrom, today),
    periodStats(user.id, user.tz, prevFrom, prevTo),
    periodStats(user.id, user.tz, today, today),
    budget(user, today),
    forecast(user, today, t.liquid),
    upcoming(user, today),
    safeToSpend(user, today, t.liquid),
    dailyExpense(user.id, user.tz, monthFrom, today),
    dailyExpense(user.id, user.tz, prevFrom, prevTo),
  ]);
  let run = 0;
  const daily = [];
  for (let d = monthFrom; d <= today; d = D.addDays(d, 1)) { run += cur[d] || 0; daily.push(run); }
  run = 0;
  const prevCum = [];
  for (let d = prevFrom; d <= prevTo; d = D.addDays(d, 1)) { run += prev[d] || 0; prevCum.push(run); }
  const saved = (await db.query(
    `select coalesce(sum(t.amount),0)::bigint s from transactions t join accounts fa on fa.id=t.account_id join accounts ta on ta.id=t.to_account_id
      where t.user_id=$1 and t.deleted_at is null and t.kind='transfer' and ta.type='savings' and fa.type<>'savings'
        and (t.occurred_at at time zone $2)::date between $3::date and $4::date`, [user.id, user.tz, monthFrom, today])).rows[0].s;
  const elapsed = D.dayNum(today), dim = D.daysInMonth(today);
  const restPlanned = (await scheduled(user.id, D.addDays(today, 1), D.monthEnd(today), { forecastOnlyIncome: false }))
    .filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
  const projection = Math.round(daily[daily.length - 1] + fc.avg_daily * (dim - elapsed) + restPlanned);
  return {
    today_date: today,
    safe_to_spend: safe,
    totals: { ...t, total_prev_month_end: null },
    accounts: accs,
    today: { income: todayStats.income, expense: todayStats.expense },
    spending_pace: { daily_cumulative: daily, prev_month_cumulative: prevCum, budget_total: bud.limit, projection },
    budget_top: bud.items.slice(0, 5),
    budget: { limit: bud.limit, spent: bud.spent, pct: bud.pct, month_pct: bud.month_pct },
    month_stats: { income: stats.income, expense: stats.expense, net_flow: stats.income - stats.expense, saved, prev: { income: prevStats.income, expense: prevStats.expense } },
    forecast: fc,
    upcoming: up.items,
    debts_summary: {
      receivables: t.receivables, payables: t.payables,
      overdue: open.filter((d) => d.due_date && d.due_date < today).map((d) => ({ who: d.who, days_late: D.diffDays(today, d.due_date) })),
    },
  };
}

// Foiz o'zgarishi (TZ 1.7)
function pctChange(cur, prev) {
  if (!prev) return cur > 0 ? { text: "yangi" } : { text: "—" };
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return { p, text: p > 0 ? `▲ +${p}%` : p < 0 ? `▼ −${Math.abs(p)}%` : "0%" };
}

module.exports = {
  accounts, debts, totals, periodStats, dailyExpense, categoryNames, budget, scheduled, safeToSpend,
  forecast, upcoming, dashboard, pctChange, avgDailySpend, toUzs,
};
