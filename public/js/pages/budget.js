// Budjet (TZ 8): kategoriya limitlari, holat va joyida tahrirlash.
import { h, icon, fmt, short, group, cap, monthName, openModal, toast, bindMoneyInput, parseDigits, MINUS } from "../ui.js";
import { get, put, del } from "../api.js";
import { store, reload } from "../app.js";
import { panel, kpi, emptyBox } from "./shared.js";

const TONE = { over: "r", may_exceed: "a", attention: "a", ok: "g" };
const INK = { over: "red-ink", may_exceed: "amber-ink", attention: "amber-ink", ok: "green-ink" };
let editing = null; // category_id

export default {
  sub: (s) => (s.today ? `${cap(monthName(s.today))} ${s.today.slice(0, 4)} · kategoriyalar bo‘yicha limit` : ""),

  async render(ctx) {
    const b = await ctx.cached("/budget");
    const out = [];
    if (!b.items.length) {
      out.push(panel(emptyBox("Limit belgilang", "Kategoriya bo‘yicha oylik limit qo‘ying — sarf ularga nisbatan kuzatiladi.", h("button", { class: "btn pri", onClick: () => addLimit(b) }, icon("plus"), "Kategoriyaga limit qo‘shish"))));
      return out;
    }
    out.push(h("div", { class: "grid" },
      kpi("Umumiy limit", fmt(b.limit)),
      kpi("Sarflangan", fmt(b.spent)),
      kpi("Qolgan", fmt(b.left), "", { cls: b.left < 0 ? "neg" : "" }),
      kpi("Limitdan oshgan", `${b.over_count} ta`, "", { cls: b.over_count > 0 ? "neg" : "" })));
    const tot = b.pct;
    out.push(panel(
      h("div", { class: "bar", style: { height: "10px" } }, h("i", { class: tot > 100 ? "r" : tot >= 80 ? "a" : "", style: { width: Math.min(100, tot) + "%" } }), h("u", { class: "red", style: { left: b.month_pct + "%" } })),
      h("p", { class: "muted", style: { marginTop: "12px" } }, `Budjetning ${b.pct}% i ishlatildi, oyning ${b.month_pct}% i o‘tdi.`)));
    out.push(h("div", { class: "stack", style: { gap: "14px" } }, ...b.items.map((x) => row(x, b))));
    out.push(h("div", { class: "gap8", style: { flexWrap: "wrap" } },
      h("button", { class: "btn", onClick: () => addLimit(b) }, icon("plus"), "Kategoriyaga limit qo‘shish")));
    out.push(h("p", { class: "hint" }, "Qizil belgi: oyning qancha qismi o‘tgani. Kulrang belgi: joriy sur’atda oy oxiridagi taxminiy sarf."));
    return out;
  },
};

function row(x, b) {
  const barPct = (v) => Math.min(100, Math.round((v / x.limit) * 100));
  const limitEl = editing === x.category_id ? editor(x) : h("button", { class: "lnk", style: { color: "var(--blue-ink)", fontWeight: 800 }, onClick: () => { editing = x.category_id; reload(); }, "aria-label": `${x.name} limitini o‘zgartirish` }, `Limit: ${fmt(x.limit)} ✎`);
  return h("section", { class: "panel" },
    h("div", { class: "gap8", style: { flexWrap: "wrap" } }, h("span", { class: "dot", style: { background: x.color } }), h("b", null, x.name), h("span", { class: "pill " + TONE[x.status] }, x.label), h("span", { class: "sp" }), limitEl),
    h("div", { class: "bar", style: { margin: "14px 0 10px", height: "10px" } },
      h("i", { class: TONE[x.status] === "g" ? "" : TONE[x.status], style: { width: barPct(x.spent) + "%" } }),
      x.is_fixed ? null : h("u", { style: { left: barPct(x.pace_projection) + "%" } })),
    h("div", { class: "muted small gap8", style: { flexWrap: "wrap", gap: "4px 16px" } },
      h("span", null, `Sarflangan ${fmt(x.spent)} (${x.pct}%)`),
      h("span", { style: { color: `var(--${INK[x.status]})` } }, x.left >= 0 ? `${fmt(x.left)} qoldi` : `${fmt(-x.left)} oshdi`),
      h("span", null, x.is_fixed ? "Doimiy to‘lov" : `Oy oxirida ≈ ${fmt(x.pace_projection)}`)));
}

function editor(x) {
  const inp = h("input", { class: "inp", inputmode: "numeric", value: group(x.limit).replace(/ /g, " "), style: { width: "170px", minHeight: "38px" }, "aria-label": "Limit", "data-autofocus": true });
  let val = x.limit;
  bindMoneyInput(inp, (n) => { val = n; });
  const save = async () => {
    if (!val) { toast("Limit 0 dan katta bo‘lishi kerak"); return; }
    try { await put(`/budget/${x.category_id}`, { limit: val }); editing = null; toast("Limit yangilandi"); reload(); } catch (e) { toast(e.message); }
  };
  const cancel = () => { editing = null; reload(); };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); });
  queueMicrotask(() => inp.focus());
  return h("div", { class: "gap8" }, inp,
    h("button", { class: "btn pri", style: { minHeight: "38px" }, onClick: save }, "Saqlash"),
    h("button", { class: "iconbtn", style: { width: "38px", height: "38px" }, "aria-label": "Bekor qilish", onClick: cancel }, icon("x")),
    h("button", { class: "iconbtn", style: { width: "38px", height: "38px" }, "aria-label": "Limitni olib tashlash", onClick: async () => { await del(`/budget/${x.category_id}`); editing = null; toast("Limit olib tashlandi"); reload(); } }, icon("trash")));
}

function addLimit(b) {
  const list = b.unbudgeted;
  if (!list.length) return toast("Barcha kategoriyalarga limit qo‘yilgan");
  let cat = list[0].id, val = 0;
  const inp = h("input", { class: "inp", inputmode: "numeric", placeholder: "0", "aria-label": "Limit" });
  bindMoneyInput(inp, (n) => { val = n; });
  const err = h("div", { class: "errtxt" });
  const chips = h("div", { class: "chips" });
  const draw = () => chips.replaceChildren(...list.map((c) => h("button", { class: "chip" + (cat === c.id ? " on" : ""), onClick: () => { cat = c.id; draw(); } }, h("span", { class: "dot", style: { background: c.color } }), c.name)));
  draw();
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, "Yangi limit"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "field" }, h("label", null, "Kategoriya"), chips),
    h("div", { class: "field" }, h("label", null, "Oylik limit (so‘m)"), inp), err,
    h("button", { class: "btn pri lg block", onClick: async () => {
      if (!val) { err.textContent = "Limit 0 dan katta bo‘lishi kerak"; return; }
      try { await put(`/budget/${cat}`, { limit: val }); api.close(); toast("Limit yangilandi"); reload(); } catch (e) { err.textContent = e.message; }
    } }, "Saqlash")));
}
