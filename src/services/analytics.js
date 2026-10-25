const db = require("../lib/db");
const D = require("../lib/dates");
const F = require("./finance");
const { group } = require("../lib/money");

async function monthly(user, fromMonth, toDate) {
  const r = await db.query(
    `select to_char(t.occurred_at at time zone $2, 'YYYY-MM') m, t.kind, sum(${F.AMT_UZS})::bigint amount ${F.STAT_FROM}
      where ${F.STAT_WHERE} and (t.occurred_at at time zone $2)::date between $3::date and $4::date group by 1, 2`,
    [user.id, user.tz, fromMonth, toDate]);
  const out = {};
  for (const x of r.rows) (out[x.m] ||= { income: 0, expense: 0 })[x.kind] = x.amount;
  return out;
}

async function savedBetween(user, from, to) {
  return (await db.query(
    `select coalesce(sum(t.amount),0)::bigint s from transactions t join accounts fa on fa.id=t.account_id join accounts ta on ta.id=t.to_account_id
      where t.user_id=$1 and t.deleted_at is null and t.kind='transfer' and ta.type='savings' and fa.type<>'savings'
        and (t.occurred_at at time zone $2)::date between $3::date and $4::date`, [user.id, user.tz, from, to])).rows[0].s;
}

async function payablesAt(user, date) {
  return (await db.query(
    `select coalesce(sum(greatest(d.principal - coalesce((select sum(p.amount) from debt_payments p where p.debt_id=d.id and (p.paid_at at time zone $2)::date <= $3::date), 0), 0)), 0)::bigint s
       from debts d where d.user_id=$1 and d.direction='payable' and d.start_date <= $3::date`, [user.id, user.tz, date])).rows[0].s;
}

async function catBreakdown(user, from, to) {
  const s = await F.periodStats(user.id, user.tz, from, to);
  return Object.fromEntries(s.byCategory.expense.map((c) => [c.category_id, c.amount]));
}

async function get(user, today, months = 6) {
  months = [3, 6, 12].includes(Number(months)) ? Number(months) : 6;
  const curFrom = D.monthStart(today);
  const first = D.monthStart(D.addMonths(today, -(months - 1)));
  const series = await monthly(user, first, today);
  const chart = [];
  for (let m = first; m <= curFrom; m = D.addMonths(m, 1)) chart.push({ month: m.slice(0, 7), income: series[m.slice(0, 7)]?.income || 0, expense: series[m.slice(0, 7)]?.expense || 0 });

  const prevFrom = D.monthStart(D.addMonths(today, -1));
  const prevTo = D.withDay(prevFrom, D.dayNum(today));
  const [cur, prev, names, curSaved, prevSaved, curPay, prevPay] = await Promise.all([
    F.periodStats(user.id, user.tz, curFrom, today), F.periodStats(user.id, user.tz, prevFrom, prevTo), F.categoryNames(user.id),
    savedBetween(user, curFrom, today), savedBetween(user, prevFrom, prevTo),
    payablesAt(user, today), payablesAt(user, D.addDays(curFrom, -1)),
  ]);
  const cc = await catBreakdown(user, curFrom, today), pc = await catBreakdown(user, prevFrom, prevTo);
  const ids = [...new Set([...Object.keys(cc), ...Object.keys(pc)])];
  const categories = ids.map((id) => ({ id: Number(id), name: names[id]?.name || "Kategoriyasiz", color: names[id]?.color || "#8a93a0", current: cc[id] || 0, previous: pc[id] || 0 }))
    .filter((c) => c.current || c.previous).sort((a, b) => b.current - a.current);
  const table = [
    { key: "income", label: "Daromad", current: cur.income, previous: prev.income, good: "up" },
    { key: "expense", label: "Xarajat", current: cur.expense, previous: prev.expense, good: "neutral" },
    { key: "net", label: "Sof pul oqimi", current: cur.income - cur.expense, previous: prev.income - prev.expense, good: "up" },
    { key: "saved", label: "Jamg‘arma", current: curSaved, previous: prevSaved, good: "up" },
    { key: "payables", label: "To‘lanadigan qarz", current: curPay, previous: prevPay, good: "down" },
  ];
  const first_tx = (await db.query("select min(occurred_at) f from transactions where user_id=$1 and deleted_at is null", [user.id])).rows[0].f;
  const enough = first_tx && (Date.now() - new Date(first_tx).getTime()) / 86400000 >= 30;
  const insights = enough ? await buildInsights(user, today, cur, prev, series, curFrom) : [];
  // o'rtacha (oldingi oylar)
  const before = chart.slice(0, -1);
  const avg = before.length ? { income: Math.round(before.reduce((s, x) => s + x.income, 0) / before.length), expense: Math.round(before.reduce((s, x) => s + x.expense, 0) / before.length), n: before.length } : null;
  return { months, chart, average: avg, compare: { current_label: `${D.monthName(curFrom)} (1–${D.dayNum(today)})`, previous_label: `${D.monthName(prevFrom)} (1–${D.dayNum(prevTo)})`, table, categories }, insights };
}

async function buildInsights(user, today, cur, prev, series, curFrom) {
  const out = [];
  if (prev.expense > 0) {
    const p = Math.round(((cur.expense - prev.expense) / prev.expense) * 100);
    out.push({ tag: "fact", text: p === 0 ? "Bu oy xarajat o‘tgan oyning shu davri bilan teng." : `Bu oy xarajat o‘tgan oyning shu davriga nisbatan ${Math.abs(p)}% ${p > 0 ? "ko‘p" : "kam"}.` });
  }
  const bud = await F.budget(user, today);
  const near = bud.items.filter((x) => !x.is_fixed && x.pct >= 70).sort((a, b) => b.pct - a.pct)[0];
  if (near) out.push({ tag: "fact", text: `${near.name} limitning ${near.pct}% iga yetdi, oyning ${bud.month_pct}% i o‘tdi.` });
  const accs = await F.accounts(user);
  const t = await F.totals(user, accs);
  const fc = await F.forecast(user, today, t.liquid);
  if (t.liquid > 0 && fc.min_balance < t.liquid * 0.5)
    out.push({ tag: "forecast", text: `${D.fmtDay(fc.min_date)} kuni tezkor mablag‘ taxminan ${Math.round(fc.min_balance).toLocaleString("ru-RU").replace(/ | /g, " ")} so‘mgacha tushishi mumkin.` });
  const m0 = D.addMonths(curFrom, -2), m1 = D.addMonths(curFrom, -1);
  const saved = [await savedBetween(user, m0, D.monthEnd(m0)), await savedBetween(user, m1, D.monthEnd(m1)), await savedBetween(user, curFrom, today)];
  if (saved[0] < saved[1] && saved[1] < saved[2]) out.push({ tag: "fact", text: "Jamg‘arma oxirgi 3 oyda muntazam oshdi." });
  else if (saved[0] > saved[1] && saved[1] > saved[2]) out.push({ tag: "fact", text: "Jamg‘arma oxirgi 3 oyda muntazam kamaydi." });
  return out;
}

module.exports = { get };
