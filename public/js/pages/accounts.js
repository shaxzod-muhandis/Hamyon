// Hisoblar va hamyonlar (TZ 7).
import { h, icon, fmt, short, group, money, openModal, confirmBox, toast, bindMoneyInput, MINUS } from "../ui.js";
import { get, post, put, del } from "../api.js";
import { store, reload, navigate, newTx, loadMeta } from "../app.js";
import { panel, ph, kpi } from "./shared.js";

const TYPES = { cash: "Naqd", card: "Karta", savings: "Jamg‘arma", currency: "Valyuta", bank: "Bank hisobi" };
let showArchive = false;

export default {
  sub: () => "Barcha mablag‘lar bir joyda",

  async render(ctx) {
    const d = await ctx.cached("/accounts");
    const s = d.summary;
    const out = [];
    out.push(h("div", { class: "grid" },
      kpi("Jami", fmt(s.total), "faol hisoblar, so‘mda"),
      kpi("Tezkor", fmt(s.liquid), "naqd va kartalar"),
      kpi("Jamg‘arma", fmt(s.savings), `${s.saved_month > 0 ? "+" + group(s.saved_month) : "0"} bu oy`, { cls: "" }),
      kpi("Valyuta", s.usd ? `$${group(Math.round(s.usd / 100))}` : "$0", `kurs ${group(s.usd_rate)} so‘m`)));
    out.push(h("div", { class: "ph", style: { marginBottom: 0 } }, h("div", { class: "lbl" }, "Faol hisoblar"),
      h("button", { class: "btn", onClick: () => newTx({ kind: "transfer" }) }, "⇄ Hisoblar orasida o‘tkazma")));
    out.push(h("div", { class: "grid w250" },
      ...d.accounts.map(card),
      h("button", { class: "panel clickable", style: { borderStyle: "dashed", display: "grid", placeItems: "center", minHeight: "150px", color: "var(--ink2)" }, onClick: () => accountForm() }, h("div", { style: { textAlign: "center" } }, icon("plus"), h("div", null, "Yangi hisob")))));
    if (d.archived.length) {
      out.push(h("button", { class: "lnk", style: { textAlign: "left", color: "var(--blue-ink)", fontWeight: 800 }, onClick: () => { showArchive = !showArchive; reload(); } }, showArchive ? "Arxivni yashirish" : `Arxivdagi hisoblar (${d.archived.length})`));
      if (showArchive) out.push(h("div", { class: "stack", style: { gap: "10px" } }, ...d.archived.map((a) =>
        h("div", { class: "panel gap8", style: { borderStyle: "dashed", padding: "14px 18px" } }, h("div", { class: "sp" }, h("b", null, a.name), h("div", { class: "muted small" }, "arxivda, jami pulga qo‘shilmaydi")), h("b", null, money(a.balance, a.currency)),
          h("button", { class: "btn", onClick: async () => { await post(`/accounts/${a.id}/archive`, { archived: false }); await loadMeta(); toast("Arxivdan chiqarildi"); reload(); } }, "Qaytarish")))));
    }
    return out;
  },
};

function card(a) {
  const menu = h("button", { class: "iconbtn", style: { width: "34px", height: "34px", border: 0, background: "none" }, "aria-label": `${a.name}: amallar`, onClick: (e) => { e.stopPropagation(); accountMenu(a); } }, icon("more"));
  return h("div", { class: "panel clickable", role: "button", tabindex: 0, style: { display: "flex", flexDirection: "column", gap: "8px", cursor: "pointer" }, onClick: () => navigate("/transactions?account=" + a.id), onKeydown: (e) => e.key === "Enter" && navigate("/transactions?account=" + a.id) },
    h("div", { class: "gap8" }, h("span", { class: "pill b" }, TYPES[a.type]), h("span", { class: "sp" }), h("span", { class: "muted small" }, a.currency), menu),
    h("b", { style: { fontSize: "17px" } }, a.name),
    h("div", { class: "num-lg " + (a.balance < 0 ? "neg" : "") }, money(a.balance, a.currency)),
    h("div", { class: "muted small" }, a.currency === "USD" ? `≈ ${fmt(a.balance_uzs)}` : `Boshlang‘ich qoldiq ${fmt(a.initial_balance)}`),
    h("div", { class: "small", style: { marginTop: "auto", paddingTop: "8px", borderTop: "1px solid var(--line2)" } }, h("span", { class: a.month_in ? "pos" : "" }, a.month_in ? `+${group(a.month_in)}` : "0"), "  ", h("span", null, a.month_out ? `${MINUS}${group(a.month_out)}` : "0"), h("span", { class: "muted" }, "  bu oy")));
}

function accountMenu(a) {
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, a.name), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "list" },
      h("button", { class: "li", onClick: () => { api.close(); accountForm(a); } }, icon("edit"), h("div", { class: "t" }, h("b", null, "Tahrirlash"))),
      h("button", { class: "li", onClick: async () => { api.close(); await post(`/accounts/${a.id}/archive`, {}); await loadMeta(); toast("Arxivlandi"); reload(); } }, icon("archive"), h("div", { class: "t" }, h("b", null, "Arxivlash"))),
      h("button", { class: "li", onClick: async () => {
        api.close();
        if (!(await confirmBox("Hisobni o‘chirish", `${a.name} o‘chiriladi. Faqat operatsiyasi yo‘q hisobni o‘chirib bo‘ladi.`, "O‘chirish", true))) return;
        try { await del(`/accounts/${a.id}`); await loadMeta(); toast("Hisob o‘chirildi"); reload(); } catch (e) { toast(e.message); }
      } }, icon("trash"), h("div", { class: "t" }, h("b", { class: "neg" }, "O‘chirish"))))));
}

function accountForm(a) {
  const editing = !!a;
  const st = { name: a?.name || "", type: a?.type || "card", initial: a ? (a.currency === "USD" ? Math.round(a.initial_balance / 100) : a.initial_balance) : 0, liquid: a ? a.is_liquid : true, err: "" };
  const err = h("div", { class: "errtxt", role: "alert" });
  const nameI = h("input", { class: "inp", value: st.name, placeholder: "Masalan: Humo karta", maxlength: 40, "data-autofocus": true, onInput: (e) => { st.name = e.target.value; } });
  const balI = h("input", { class: "inp", inputmode: "numeric", value: st.initial ? group(st.initial).replace(/ /g, " ") : "", placeholder: "0" });
  bindMoneyInput(balI, (n) => { st.initial = n; });
  const typeBox = h("div", { class: "chips" });
  const liqBtn = h("button", { class: "toggle", role: "switch", "aria-pressed": String(st.liquid), "aria-label": "Tezkor mablag‘ga kiradi", onClick: () => { st.liquid = !st.liquid; liqBtn.setAttribute("aria-pressed", String(st.liquid)); } });
  const drawTypes = () => typeBox.replaceChildren(...Object.entries(TYPES).map(([k, t]) => h("button", { class: "chip" + (st.type === k ? " on" : ""), disabled: editing && (k === "currency" || a.type === "currency") && k !== st.type, onClick: () => { st.type = k; if (!editing) { st.liquid = k === "cash" || k === "card"; liqBtn.setAttribute("aria-pressed", String(st.liquid)); } drawTypes(); } }, t)));
  drawTypes();
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, editing ? "Hisobni tahrirlash" : "Yangi hisob"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "field" }, h("label", null, "Nomi"), nameI),
    h("div", { class: "field" }, h("label", null, "Turi"), typeBox),
    h("div", { class: "field" }, h("label", null, `Boshlang‘ich qoldiq (${(editing ? a.currency : st.type === "currency" ? "USD" : "UZS") === "USD" ? "$" : "so‘m"})`), balI),
    h("div", { class: "gap8" }, liqBtn, h("span", null, "Tezkor mablag‘ga kiradi"), h("span", { class: "hint" }, "(erkin pul hisobida)")),
    err,
    h("button", { class: "btn pri lg block", onClick: async () => {
      if (!st.name.trim()) { err.textContent = "Hisob nomini kiriting"; return; }
      const cur = editing ? a.currency : st.type === "currency" ? "USD" : "UZS";
      const body = { name: st.name.trim(), type: st.type, initial_balance: st.initial * (cur === "USD" ? 100 : 1), is_liquid: st.liquid };
      try { editing ? await put(`/accounts/${a.id}`, body) : await post("/accounts", body); api.close(); await loadMeta(); toast(editing ? "Saqlandi" : "Hisob qo‘shildi"); reload(); } catch (e) { err.textContent = e.message; }
    } }, "Saqlash")));
}
