// Tahlil (TZ 11).
import { h, fmt, short, group, change, pill, monthName, cap, MINUS, signed } from "../ui.js";
import { navigate, reload, store } from "../app.js";
import { barsChart } from "../charts.js";
import { panel, ph, emptyBox } from "./shared.js";

let months = 6;
const GOOD = { income: "up", net: "up", saved: "up", payables: "down", expense: "neutral" };

export default {
  sub: () => "Davrlar bo‘yicha taqqoslash",

  async render(ctx) {
    const a = await get6(ctx);
    const today = store.today, cur = today.slice(0, 7);
    const wrap = h("div", { class: "chartwrap" });
    const last = a.chart.at(-1);
    const avg = a.average;
    const text = avg ? `Oldingi ${avg.n} oyda o‘rtacha daromad ${fmt(avg.income)}, xarajat ${fmt(avg.expense)}. ${cap(monthName(cur + "-01"))} xarajati o‘rtachadan ${last.expense >= avg.expense ? "yuqori" : "past"}, daromad ${last.income >= avg.income ? "yuqori" : "past"}.` : "Taqqoslash uchun oldingi oylar ma’lumoti yo‘q.";
    const seg = h("div", { class: "seg", role: "tablist" }, ...[3, 6, 12].map((n) => h("button", { role: "tab", "aria-selected": String(months === n), onClick: () => { months = n; reload(); } }, `${n} oy`)));
    const chartPanel = panel(ph("Daromad va xarajat", seg),
      h("div", { class: "legend" }, h("span", null, h("i", { style: { background: "var(--green)" } }), "Daromad"), h("span", null, h("i", { style: { background: "var(--blue)" } }), "Xarajat")),
      wrap, h("p", { class: "muted small", style: { marginTop: "10px" } }, text));
    queueMicrotask(() => barsChart(wrap, a.chart, { currentMonth: cur, label: `Daromad va xarajat, oxirgi ${months} oy. ${text}`, onMonth: (m) => navigate(`/transactions?from=${m}-01&to=${m}-31`.replace("-31", "-" + String(new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()).padStart(2, "0"))) }));

    const tbl = panel(ph("Joriy oy va o‘tgan oy"),
      h("p", { class: "muted small", style: { marginBottom: "8px" } }, `${a.compare.current_label} ↔ ${a.compare.previous_label}`),
      h("div", { class: "tblwrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", null, "Ko‘rsatkich"), h("th", null, "Joriy oy"), h("th", null, "O‘tgan oy"), h("th", null, "Farq"))),
        h("tbody", null,
          ...a.compare.table.map((r) => h("tr", null, h("td", null, h("b", null, r.label)), h("td", null, fmt(r.current)), h("td", { class: "muted" }, fmt(r.previous)), h("td", null, pill(change(r.current, r.previous, GOOD[r.key]))))),
          ...a.compare.categories.map((c) => h("tr", null, h("td", null, h("span", { class: "gap8" }, h("span", { class: "dot", style: { background: c.color } }), c.name)), h("td", null, fmt(c.current)), h("td", { class: "muted" }, fmt(c.previous)), h("td", null, pill(change(c.current, c.previous, "down")))))))));
    const ins = panel(ph("Xulosalar"),
      a.insights.length ? h("div", { class: "stack", style: { gap: "12px" } }, ...a.insights.map((i) => h("div", { class: "gap8", style: { alignItems: "flex-start" } }, h("span", { class: "tag " + (i.tag === "forecast" ? "f" : "") }, i.tag === "forecast" ? "Prognoz" : "Fakt"), h("span", { class: "sp" }, i.text)))) : h("div", { class: "empty", style: { padding: "14px" } }, "Xulosa uchun kamida 1 oylik ma’lumot kerak"),
      h("p", { class: "hint", style: { marginTop: "12px" } }, "“Prognoz” belgili xulosalar siz kiritgan reja va o‘rtacha xarajatga asoslanadi, ular fakt emas."));
    return [chartPanel, tbl, ins];
  },
};
const get6 = (ctx) => ctx.cached(`/analytics?months=${months}`);
