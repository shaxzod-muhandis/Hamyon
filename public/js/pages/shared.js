import { h, catIcon, transferIcon, group, fmt, money, toast, MINUS } from "../ui.js";
import { newTx } from "../app.js";

// Operatsiya qatori (TZ 5.3). row — /api/transactions elementi.
export function txRow(t, { selectable = false, selected = false, onSelect, onChanged } = {}) {
  const transfer = t.kind === "transfer";
  const title = transfer ? "O‘tkazma" : t.note || t.category_name;
  const mobAcc = h("span", { class: "mob-only" }, ` · ${t.account_name}`);
  const sub = transfer
    ? `${t.account_name} → ${t.to_account_name} · xarajat emas · ${t.local_time}`
    : h("span", null, t.category_name, mobAcc, ` · ${t.local_time}`);
  const sign = t.kind === "income" ? "+" : transfer ? "" : MINUS;
  const amt = h("div", { class: "amt " + (t.kind === "income" ? "in" : transfer ? "tr" : "") }, `${sign}${group(t.amount)}`);
  const click = () => {
    if (selectable) return onSelect?.(t);
    if (t.debt_id) return toast("Qarz to‘lovlari Qarzlar bo‘limida boshqariladi");
    newTx({ tx: t, onSaved: onChanged });
  };
  return h("button", { class: "li", onClick: click, "aria-label": `${title}, ${sign}${group(t.amount)} so‘m` },
    selectable ? h("span", { class: "cbx" + (selected ? " on" : ""), style: { opacity: t.debt_id ? 0.35 : 1 } }, selected ? "✓" : "") : null,
    transfer ? transferIcon() : catIcon(t.category_color, t.category_name),
    h("div", { class: "t" }, h("b", null, title), h("small", null, sub)),
    h("div", { class: "acc desk-only" }, transfer ? "" : t.account_name),
    amt);
}

export const panel = (...kids) => h("section", { class: "panel" }, ...kids);
export const ph = (title, right) => h("div", { class: "ph" }, h("h2", null, title), right || null);
export const link = (text, onClick, href = "#") => h("a", { class: "lnk", href, onClick: (e) => { e.preventDefault(); onClick(); } }, text);

export function kpi(label, value, sub, { cls = "", onClick } = {}) {
  const el = h(onClick ? "button" : "div", { class: "panel kpi" + (onClick ? " clickable" : ""), style: { textAlign: "left" }, onClick },
    h("div", { class: "lbl" }, label), h("div", { class: "v " + cls }, value), sub ? h("div", { class: "s" }, sub) : null);
  return el;
}
export const emptyBox = (title, text, btn) => h("div", { class: "empty" }, h("b", null, title), text ? h("div", null, text) : null, btn || null);
