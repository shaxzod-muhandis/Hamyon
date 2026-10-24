// Eslatmalar: tashqi cron har 5–15 daqiqada /api/cron/tick ni chaqiradi.
// Har bir eslatma bir davr uchun (reminder_log) faqat bir marta yuboriladi.
const db = require("../lib/db");
const tg = require("../lib/tg");
const D = require("../lib/dates");
const { NB, MINUS, group, fmt, fmtSigned, short } = require("../lib/money");
const F = require("./finance");
const V = require("../bot/views");

const { esc } = tg;
const WINDOW_MIN = 90; // belgilangan vaqtdan keyin shuncha daqiqagacha yuboriladi (cron o'tkazib yuborsa)

const minutes = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

async function claim(userId, kind, periodKey) {
  const r = await db.query("insert into reminder_log (user_id, kind, period_key) values ($1,$2,$3) on conflict do nothing returning 1", [userId, kind, periodKey]);
  return r.rows.length > 0;
}

const BUILDERS = {
  async expense_reminder(u, today) {
    const s = await F.periodStats(u.id, u.tz, today, today);
    return { key: today, text: `🔔 <b>Bugungi xarajatlarni kiritdingizmi?</b>\nBugun: ${MINUS}${group(s.expense)} · +${group(s.income)}\n<i>Yozing: 45000 non</i>` };
  },
  async daily_report(u, today) {
    const [s, names] = await Promise.all([F.periodStats(u.id, u.tz, today, today), F.categoryNames(u.id)]);
    const top = s.byCategory.expense.slice(0, 3).map((c) => `${names[c.category_id]?.emoji || "•"} ${esc(names[c.category_id]?.name || "")} — ${short(c.amount)}`);
    return { key: today, text: `📊 <b>Kunlik hisobot · ${D.fmtDay(today)}</b>\nXarajat: ${MINUS}${group(s.expense)}\nDaromad: +${group(s.income)}\nSof: ${fmtSigned(s.income - s.expense)}${top.length ? "\n\n" + top.join("\n") : ""}` };
  },
  async weekly(u, today) {
    if (D.weekday(today) !== 0) return null; // yakshanba
    const [cur, prev] = await Promise.all([
      F.periodStats(u.id, u.tz, D.addDays(today, -6), today),
      F.periodStats(u.id, u.tz, D.addDays(today, -13), D.addDays(today, -7)),
    ]);
    const p = F.pctChange(cur.expense, prev.expense);
    return { key: today, text: `🗓 <b>Haftalik xulosa</b>\nXarajat: ${MINUS}${group(cur.expense)} ${p.text === "yangi" || p.text === "—" ? "" : `(${p.text} oldingi haftaga)`}\nDaromad: +${group(cur.income)}\nSof pul oqimi: ${fmtSigned(cur.income - cur.expense)}` };
  },
  async monthly(u, today) {
    if (D.dayNum(today) !== 1) return null;
    const pf = D.monthStart(D.addMonths(today, -1));
    const [cur, prev, names] = await Promise.all([
      F.periodStats(u.id, u.tz, pf, D.monthEnd(pf)),
      F.periodStats(u.id, u.tz, D.monthStart(D.addMonths(pf, -1)), D.monthEnd(D.addMonths(pf, -1))),
      F.categoryNames(u.id),
    ]);
    const top = cur.byCategory.expense.slice(0, 3).map((c) => `${names[c.category_id]?.emoji || "•"} ${esc(names[c.category_id]?.name || "")} — ${short(c.amount)}`);
    return { key: pf.slice(0, 7), text: `📅 <b>${D.monthName(pf)[0].toUpperCase() + D.monthName(pf).slice(1)} hisoboti</b>\nDaromad: +${group(cur.income)} ${F.pctChange(cur.income, prev.income).text}\nXarajat: ${MINUS}${group(cur.expense)} ${F.pctChange(cur.expense, prev.expense).text}\nSof: ${fmtSigned(cur.income - cur.expense)}${top.length ? "\n\n" + top.join("\n") : ""}` };
  },
  async debt_due(u, today) {
    const ds = await F.debts(u.id, { openOnly: true });
    const lines = [];
    for (const d of ds) {
      if (d.direction !== "payable") continue;
      const thisMonth = d.pay_day && D.withDay(today, d.pay_day);
      const due = d.pay_day ? (thisMonth >= today ? thisMonth : D.withDay(D.addMonths(today, 1), d.pay_day)) : d.due_date;
      if (!due) continue;
      const left = D.diffDays(due, today);
      if (left === 3 || left === 0) lines.push(`• ${esc(d.who)} — ${fmt(d.monthly_payment ? Math.min(d.monthly_payment, d.remaining) : d.remaining)} ${left === 0 ? "<b>bugun</b>" : "3 kundan keyin"}`);
      else if (d.due_date && d.due_date < today) lines.push(`• ${esc(d.who)} — ⚠️ ${D.diffDays(today, d.due_date)} kun kechikdi (${fmt(d.remaining)})`);
    }
    return lines.length ? { key: today, text: `💸 <b>Qarz to‘lovlari</b>\n${lines.join("\n")}\n<i>To‘lov kiritish: /qarz</i>` } : null;
  },
  async mandatory(u, today) {
    const tomorrow = D.addDays(today, 1);
    const items = (await F.scheduled(u.id, tomorrow, tomorrow, { forecastOnlyIncome: false })).filter((x) => x.kind === "planned");
    return items.length ? { key: tomorrow, text: `⏰ <b>Ertaga majburiy to‘lov</b>\n${items.map((x) => `• ${esc(x.name)} — ${fmt(-x.amount)}`).join("\n")}` } : null;
  },
  async low_funds(u, today) {
    const accs = await F.accounts(u);
    const t = await F.totals(u, accs);
    const fc = await F.forecast(u, today, t.liquid);
    return fc.below_threshold
      ? { key: today, text: `🔴 <b>Mablag‘ yetishmasligi ehtimoli</b>\n${D.fmtDay(fc.min_date)} kuni qoldiq ≈ ${fmt(fc.min_balance)} gacha tushadi (xavfsiz chegara ${short(fc.threshold)}).\n/prognoz` }
      : null;
  },
};

async function tick(now = new Date()) {
  const rows = (await db.query(
    `select u.*, r.kind, r.at_time from reminders r join users u on u.id = r.user_id
      where r.enabled and r.at_time is not null and u.chat_id is not null`)).rows;
  let sent = 0;
  for (const r of rows) {
    const build = BUILDERS[r.kind];
    if (!build) continue;
    const nowMin = minutes(D.localHM(r.tz, now));
    const diff = nowMin - minutes(r.at_time);
    if (diff < 0 || diff > WINDOW_MIN) continue;
    const today = D.localDate(r.tz, now);
    try {
      const msg = await build(r, today);
      if (!msg) continue;
      if (!(await claim(r.id, r.kind, msg.key))) continue;
      const res = await tg.send(r.chat_id, msg.text, null, true);
      if (res.ok) sent++;
    } catch (e) {
      console.error(`eslatma xato (${r.kind}, user ${r.id}):`, e.message);
    }
  }
  return { checked: rows.length, sent };
}

module.exports = { tick };
