// Dashboard (TZ 4): bitta so'rov — uch blok.
import { h, icon, fmt, short, signed, group, change, pill, cap, fmtDay, weekdayName, monthName, daysInMonth, diffDays, longDay, MINUS, skel, money } from "../ui.js";
import { cached, navigate, newTx } from "../app.js";
import { paceChart, forecastChart } from "../charts.js";
import { txRow, panel, ph, link, kpi, emptyBox } from "./shared.js";

export default {
  sub(store) {
    const t = store.today;
    if (!t) return "";
    return `${cap(weekdayName(t))}, ${fmtDay(t)} · oy tugashiga ${daysInMonth(t) - +t.slice(8, 10)} kun`;
  },

  async render(ctx) {
    const d = await ctx.cached("/dashboard");
    const today = d.today_date;
    const first = d.accounts.every((a) => a.balance === 0) && d.month_stats.income === 0 && d.month_stats.expense === 0;
    const mName = monthName(today);
    const prevName = monthName(`2000-${String((+today.slice(5, 7) + 10) % 12 + 1).padStart(2, "0")}-01`);
    const out = [];

    // ── 1-blok: Hozir ──
    out.push(h("div", { class: "lbl" }, "Hozir"));
    out.push(h("div", { class: "row" },
      h("div", { class: "grow-l" }, freePanel(d, first)),
      h("div", { class: "grow-r" }, todayPanel(d, today))));

    // ── 2-blok ──
    out.push(h("div", { class: "lbl" }, `${cap(mName)} qayerga ketyapti`));
    out.push(h("div", { class: "row" },
      h("div", { class: "grow-l" }, pacePanel(d, today, mName, prevName)),
      h("div", { class: "grow-r" }, budgetPanel(d))));
    out.push(monthRow(d, prevName));

    // ── 3-blok ──
    out.push(h("div", { class: "lbl" }, "Keyingi oy nima bo‘ladi"));
    out.push(h("div", { class: "row" },
      h("div", { class: "grow-l" }, forecastPanel(d)),
      h("div", { class: "grow-r stack" }, upcomingPanel(d, today), debtsCard(d))));
    return out;
  },
};

function freePanel(d, first) {
  const s = d.safe_to_spend;
  if (first)
    return panel(emptyBox("Boshlash uchun birinchi hisobingizni qo‘shing", "Qoldiqlarni kiriting — erkin pul va prognoz shundan hisoblanadi.",
      h("button", { class: "btn pri", onClick: () => navigate("/accounts") }, icon("plus"), "Hisob qo‘shish")));
  const when = s.mode === "salary" ? `${s.days} kun · ${fmtDay(s.next_income_date)}` : `${s.days} kun · oy oxiri`;
  const t = d.totals;
  const prevCh = change(t.total, t.total_prev_month_end, "up");
  return panel(
    h("div", { class: "ph", style: { marginBottom: "6px" } }, h("div", { class: "lbl" }, s.mode === "salary" ? "Keyingi maoshgacha erkin pul" : "Oy oxirigacha erkin pul"), h("span", { class: "pill" }, when)),
    h("div", { class: "bignum " + (s.amount < 0 ? "neg" : ""), "aria-label": `Erkin pul ${fmt(s.amount)}` }, fmt(s.amount)),
    s.amount < 0
      ? h("p", { class: "neg", style: { marginTop: "8px" } }, `Maoshgacha ${group(-s.amount)} so‘m yetishmaydi`)
      : h("p", { style: { marginTop: "8px" } }, `Kuniga ≈ ${fmt(s.per_day)} ishlatish mumkin`),
    h("p", { class: "muted small", style: { marginTop: "4px" } }, `Naqd va kartalardagi ${fmt(s.liquid)} dan ${s.mode === "salary" ? "maoshgacha" : "oy oxirigacha"} bo‘lgan majburiy to‘lovlar (${fmt(s.obligations)}) ayirildi.`),
    h("div", { class: "grid", style: { gridTemplateColumns: "repeat(3, 1fr)", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--line2)", gap: "10px" } },
      miniStat("Jami pul", t.total, d.totals.total_prev_month_end ? pill(prevCh) : null, () => navigate("/accounts")),
      miniStat("Sof holat", t.net_worth, h("span", { class: "muted small" }, "aktiv − majburiyat"), () => navigate("/accounts")),
      miniStat("Qarzim", t.payables, t.receivables ? h("span", { class: "pos small" }, `+${short(t.receivables)} olinadi`) : null, () => navigate("/debts"))),
    h("div", { class: "chips scroll", style: { marginTop: "14px" } }, ...d.accounts.map((a) =>
      h("button", { class: "chip", onClick: () => navigate("/transactions?account=" + a.id) }, `${a.short_name || a.name} · ${a.currency === "USD" ? "$" + group(Math.round(a.balance / 100)) : short(a.balance)}`))));
}
const both = (n) => [h("span", { class: "desk-only" }, fmt(n)), h("span", { class: "mob-only" }, short(n))];
const miniStat = (l, n, sub, onClick) => h("button", { style: { textAlign: "left", minWidth: 0 }, onClick },
  h("div", { class: "lbl", style: { fontSize: "11.5px" } }, l), h("div", { style: { fontWeight: 900, fontSize: "16px", marginTop: "4px" } }, ...both(n)), sub ? h("div", { style: { marginTop: "4px" } }, sub) : null);

function todayPanel(d, today) {
  const tx = d.today.transactions;
  return panel(
    h("div", { class: "lbl" }, `Bugun · ${fmtDay(today)}, ${weekdayName(today)}`),
    h("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr", margin: "10px 0 14px" } },
      h("div", null, h("div", { class: "muted small" }, "Chiqim"), h("div", { class: "num-lg" }, d.today.expense ? `${MINUS}${group(d.today.expense)}` : "0")),
      h("div", null, h("div", { class: "muted small" }, "Kirim"), h("div", { class: d.today.income ? "num-lg pos" : "num-lg" }, d.today.income ? `+${group(d.today.income)}` : "0"))),
    h("div", { class: "gap8" },
      h("button", { class: "btn pri sp", onClick: () => newTx({ kind: "expense" }) }, `${MINUS} Chiqim`),
      h("button", { class: "btn grn sp", onClick: () => newTx({ kind: "income" }) }, "+ Kirim"),
      h("button", { class: "btn sp", onClick: () => newTx({ kind: "transfer" }) }, "⇄ O‘tkazma")),
    h("div", { class: "list", style: { margin: "12px -20px 0" } },
      tx.length ? tx.map((t) => txRow(t, { onChanged: () => newTxRefresh() })) : h("div", { class: "empty", style: { padding: "20px" } }, "Bugun hali operatsiya kiritilmagan")),
    h("div", { style: { marginTop: "10px" } }, link("Barcha operatsiyalar →", () => navigate("/transactions"), "/transactions")));
}
const newTxRefresh = () => import("../app.js").then((m) => m.reload());

function pacePanel(d, today, mName, prevName) {
  const sp = d.spending_pace;
  const n = sp.daily_cumulative.length;
  const spent = sp.daily_cumulative.at(-1) || 0;
  const prevSame = sp.prev_month_cumulative[n - 1] || 0;
  const wrap = h("div", { class: "chartwrap" });
  const hasData = n >= 3 && spent > 0;
  let note = "";
  if (hasData) {
    const p = prevSame ? Math.round(((spent - prevSame) / prevSame) * 100) : null;
    note = `${n}-${mName}gacha ${fmt(spent)} sarfladingiz${p === null ? "" : `, ${prevName}ning shu kunidagidan ${Math.abs(p)}% ${p >= 0 ? "ko‘p" : "kam"}`}. Shu sur’atda oy oxirida ≈ ${fmt(sp.projection)} bo‘ladi${sp.budget_total ? `, umumiy limit ${fmt(sp.budget_total)}` : ""}.`;
  }
  const el = panel(ph("Xarajat sur’ati"),
    hasData ? h("div", { class: "legend" }, h("span", null, h("i", { style: { background: "var(--blue)" } }), cap(mName)), h("span", null, h("i", { style: { background: "var(--ink3)" } }), cap(prevName)), sp.budget_total ? h("span", null, h("i", { style: { background: "var(--amber)" } }), "Limit") : null) : null,
    hasData ? wrap : h("div", { class: "empty" }, "Grafik uchun kamida 3 kunlik ma’lumot kerak"),
    note ? h("p", { class: "muted small", style: { marginTop: "10px" } }, note) : null);
  if (hasData) queueMicrotask(() => paceChart(wrap, { cur: sp.daily_cumulative, prev: sp.prev_month_cumulative, projection: sp.projection, limit: sp.budget_total, monthStart: today.slice(0, 8) + "01" },
    { label: `Xarajat sur’ati: ${n} kunda ${fmt(spent)}, prognoz ${fmt(sp.projection)}`, onDay: (date) => navigate(`/transactions?from=${date}&to=${date}&type=expense`) }));
  return el;
}

const STATUS_COLOR = { over: "r", may_exceed: "a", attention: "a", ok: "g" };
function budgetPanel(d) {
  const b = d.budget;
  const items = d.budget_top;
  return panel(ph("Budjet", link("Barchasi →", () => navigate("/budget"), "/budget")),
    items.length ? [
      h("p", { class: "muted small", style: { marginBottom: "12px" } }, `${fmt(b.spent)} / ${fmt(b.limit)} · ${b.pct}% ishlatildi`),
      h("div", { class: "stack", style: { gap: "14px" } }, ...items.map((x) => h("div", null,
        h("div", { class: "gap8", style: { marginBottom: "6px" } }, h("span", { class: "dot", style: { background: x.color } }), h("b", { class: "sp" }, x.name),
          h("span", { class: "small", style: { color: `var(--${STATUS_COLOR[x.status] === "r" ? "red-ink" : STATUS_COLOR[x.status] === "a" ? "amber-ink" : "green-ink"})` } }, `${x.pct}% · ${x.label}`)),
        h("div", { class: "bar" }, h("i", { class: STATUS_COLOR[x.status] === "g" ? "" : STATUS_COLOR[x.status], style: { width: Math.min(100, x.pct) + "%" } }), h("u", { style: { left: b.month_pct + "%" } }))))),
      h("p", { class: "hint", style: { marginTop: "12px" } }, `Kulrang belgi: oyning ${b.month_pct}% i o‘tdi`),
    ] : emptyBox("Limit belgilang", "Kategoriyalar bo‘yicha oylik limit qo‘ying.", h("button", { class: "btn pri", onClick: () => navigate("/budget") }, "Budjetga o‘tish")));
}

function monthRow(d, prevName) {
  const m = d.month_stats, p = m.prev;
  const overLimit = d.budget.limit && m.expense > d.budget.limit;
  const sub = (cur, prev, tone) => h("div", { class: "gap8", style: { marginTop: "6px", flexWrap: "wrap" } }, p.income + p.expense === 0 && !prev ? h("span", { class: "pill" }, "Taqqoslash uchun ma’lumot yo‘q") : pill(change(cur, prev, tone)), h("span", { class: "muted small" }, `${prevName}ga`));
  const hasPrev = p.income + p.expense > 0;
  const mk = (label, v, cls, cur, prev, tone, to) => h("button", { class: "panel kpi clickable", style: { textAlign: "left" }, onClick: () => navigate(to) },
    h("div", { class: "lbl" }, label), h("div", { class: "v " + cls }, v),
    hasPrev || prev ? sub(cur, prev, tone) : h("div", { style: { marginTop: "6px" } }, h("span", { class: "pill" }, "Taqqoslash uchun ma’lumot yo‘q")));
  return h("div", { class: "grid" },
    mk("Daromad", `+${group(m.income)}`, "pos", m.income, p.income, "up", "/transactions?type=income"),
    mk("Xarajat", `${MINUS}${group(m.expense)}`, "", m.expense, p.expense, overLimit ? "down" : "neutral", "/transactions?type=expense"),
    mk("Sof pul oqimi", signed(m.net_flow), m.net_flow >= 0 ? "pos" : "neg", m.net_flow, p.income - p.expense, "up", "/analytics"),
    mk("Jamg‘armaga", group(m.saved), "", m.saved, 0, "up", "/accounts"));
}

function forecastPanel(d) {
  const f = d.forecast;
  const wrap = h("div", { class: "chartwrap" });
  const el = panel(ph("Tezkor mablag‘ prognozi", link("Reja →", () => navigate("/plan"), "/plan")),
    h("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr", marginBottom: "10px" } },
      h("div", null, h("div", { class: "muted small" }, "Prognoz davri oxirida"), h("div", { class: "num-lg" }, ...both(f.end_balance))),
      h("div", null, h("div", { class: "muted small" }, "Eng past nuqta"), h("div", { class: "num-lg " + (f.below_threshold ? "neg" : ""), style: f.below_threshold ? null : { color: "var(--amber-ink)" } }, ...both(f.min_balance)),
        h("div", { class: "small " + (f.below_threshold ? "neg" : ""), style: f.below_threshold ? null : { color: "var(--amber-ink)" } }, `${fmtDay(f.min_date)}${f.below_threshold ? " · chegaradan past" : ""}`))),
    f.daily_balance.length >= 2 ? wrap : h("div", { class: "empty" }, "Prognoz uchun ma’lumot yetarli emas"),
    h("p", { class: "muted small", style: { marginTop: "10px" } }, `Faqat naqd va kartalar. Tasdiqlanmagan tushumlar hisobga olinmagan, kundalik xarajat o‘rtacha ${fmt(f.avg_daily)}.`));
  if (f.daily_balance.length >= 2) queueMicrotask(() => forecastChart(wrap, { points: f.daily_balance, threshold: f.threshold, min: { balance: f.min_balance, date: f.min_date, below: f.below_threshold } },
    { label: `Prognoz: davr oxirida ${fmt(f.end_balance)}, eng past nuqta ${fmt(f.min_balance)} (${fmtDay(f.min_date)})` }));
  return el;
}

function upcomingPanel(d, today) {
  const items = d.upcoming;
  const total = items.reduce((s, x) => s - x.amount, 0);
  return panel(ph("Yaqin to‘lovlar", h("span", { class: "muted small" }, `14 kun · ${items.length ? fmt(total) : "—"}`)),
    items.length ? h("div", { class: "stack", style: { gap: "10px" } }, ...items.map((x) => {
      const left = diffDays(x.date, today);
      return h("div", { class: "gap8" },
        h("div", { style: { width: "44px", textAlign: "center", borderRadius: "10px", padding: "4px 0", background: left <= 3 ? "var(--amber-soft)" : "var(--chip)", color: left <= 3 ? "var(--amber-ink)" : "var(--ink)" } },
          h("div", { style: { fontWeight: 900, fontSize: "16px", lineHeight: 1 } }, +x.date.slice(8)), h("div", { style: { fontSize: "11px" } }, monthName(x.date).slice(0, 3))),
        h("div", { class: "sp", style: { minWidth: 0 } }, h("b", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, x.name),
          h("small", { class: "muted" }, `${left === 0 ? "bugun" : left + " kundan keyin"}${x.kind === "debt" ? " · qarz" : ""}`)),
        h("b", null, group(-x.amount)));
    })) : h("div", { class: "empty", style: { padding: "16px" } }, "Yaqin 14 kunda to‘lov yo‘q"));
}

function debtsCard(d) {
  const s = d.debts_summary;
  return h("button", { class: "panel clickable", style: { textAlign: "left" }, onClick: () => navigate("/debts") },
    ph("Qarzlar"),
    h("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr", gap: "10px" } },
      h("div", { style: { background: "var(--green-soft)", borderRadius: "14px", padding: "12px" } }, h("div", { class: "small", style: { color: "var(--green-ink)" } }, "Olinadigan"), h("b", null, fmt(s.receivables))),
      h("div", { style: { background: "var(--red-soft)", borderRadius: "14px", padding: "12px" } }, h("div", { class: "small", style: { color: "var(--red-ink)" } }, "To‘lanadigan"), h("b", null, fmt(s.payables)))),
    s.overdue.length ? h("p", { class: "neg", style: { marginTop: "10px" } }, "⚠ " + s.overdue.map((o) => `${o.who}: ${o.days_late} kun kechikdi`).join(", ")) : null);
}
