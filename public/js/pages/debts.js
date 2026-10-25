// Qarzlar (TZ 9).
import { h, icon, fmt, short, group, fmtDay, openModal, confirmBox, toast, bindMoneyInput, money } from "../ui.js";
import { get, post, put, del } from "../api.js";
import { store, reload, loadMeta, loadBadges } from "../app.js";
import { panel, kpi, emptyBox } from "./shared.js";

let dir = "payable";
const initials = (s) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const STATUS_CLS = { closed: "", overdue: "r", partial: "a", active: "b" };

export default {
  sub: () => "Olinadigan va to‘lanadigan",

  async render(ctx) {
    const d = await ctx.cached("/debts");
    const s = d.summary;
    const out = [];
    out.push(h("div", { class: "grid" },
      kpi("Olinadigan", fmt(s.receivables), "", { cls: "pos" }),
      kpi("To‘lanadigan", fmt(s.payables)),
      kpi("Sof qarz", fmt(s.net), "to‘lanadigan − olinadigan"),
      kpi("Muddati o‘tgan", `${s.overdue} ta`, "", { cls: s.overdue > 0 ? "neg" : "" })));
    const sum = (x) => d.items.filter((i) => i.direction === x && !i.closed).reduce((a, i) => a + i.remaining, 0);
    out.push(h("div", { class: "gap8", style: { flexWrap: "wrap" } },
      h("div", { class: "seg", role: "tablist" },
        h("button", { role: "tab", "aria-selected": String(dir === "payable"), onClick: () => { dir = "payable"; reload(); } }, `To‘lanadigan · ${short(sum("payable"))}`),
        h("button", { role: "tab", "aria-selected": String(dir === "receivable"), onClick: () => { dir = "receivable"; reload(); } }, `Olinadigan · ${short(sum("receivable"))}`)),
      h("span", { class: "sp" }),
      h("button", { class: "btn pri", onClick: () => debtForm() }, icon("plus"), "Yangi qarz")));
    const items = d.items.filter((i) => i.direction === dir);
    out.push(items.length ? h("div", { class: "grid w420" }, ...items.map(card)) : panel(emptyBox("Qarzlar yo‘q", "", h("button", { class: "btn pri", onClick: () => debtForm() }, "Yangi qarz"))));
    return out;
  },
};

function card(d) {
  const pay = d.direction === "payable";
  const sub = [pay ? `Olingan ${fmtDay(d.start_date)}` : `Berilgan ${fmtDay(d.start_date)}`, d.interest_pct ? `${d.interest_pct}% yillik` : null, d.monthly_payment ? `oyiga ${group(d.monthly_payment)}` : null].filter(Boolean).join(" · ");
  const pct = Math.round((d.paid / d.principal) * 100);
  let dueLine = null;
  if (d.due_date && !d.closed) {
    const cls = d.status === "overdue" ? "neg" : d.days_left <= 14 ? "" : "muted";
    const style = d.status !== "overdue" && d.days_left <= 14 ? { color: "var(--amber-ink)" } : null;
    dueLine = h("div", { class: "small " + cls, style }, `Muddat ${fmtDay(d.due_date)} · ${d.status === "overdue" ? `${d.days_late} kun kechikdi` : `${d.days_left} kun qoldi`}${d.next_payment ? ` · keyingi to‘lov ${fmtDay(d.next_payment)}` : ""}`);
  }
  return h("section", { class: "panel stack", style: { gap: "12px" } },
    h("div", { class: "gap8" },
      h("div", { class: "ico", style: { width: "44px", height: "44px", background: pay ? "var(--blue-soft)" : "var(--green-soft)", color: pay ? "var(--blue-ink)" : "var(--green-ink)" } }, initials(d.who)),
      h("div", { class: "sp", style: { minWidth: 0 } }, h("b", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, d.who), h("small", { class: "muted" }, sub)),
      h("span", { class: "pill " + STATUS_CLS[d.status] }, d.status_label),
      h("button", { class: "iconbtn", style: { width: "34px", height: "34px", border: 0, background: "none" }, "aria-label": `${d.who}: amallar`, onClick: () => menu(d) }, icon("more"))),
    h("div", { class: "gap8", style: { alignItems: "flex-end", justifyContent: "space-between" } },
      h("div", { class: "num-lg" }, fmt(d.remaining)),
      h("div", { class: "muted small" }, `${pay ? "To‘langan" : "Qaytarilgan"} ${group(d.paid)} / ${group(d.principal)}`)),
    h("div", { class: "bar" }, h("i", { class: pay ? "" : "g", style: { width: Math.min(100, pct) + "%" } })),
    dueLine,
    d.closed ? null : h("button", { class: "btn pri block", onClick: () => payForm(d) }, pay ? "To‘lov qo‘shish" : "Qaytgan summani kiritish"),
    d.payments.length ? h("div", { class: "stack", style: { gap: "6px", borderTop: "1px solid var(--line2)", paddingTop: "10px" } }, h("div", { class: "lbl" }, "To‘lovlar tarixi"),
      ...d.payments.map((p) => h("div", { class: "gap8 small" }, h("span", { class: "muted sp" }, fmtDay(p.date)), h("b", null, group(p.amount))))) : null);
}

function menu(d) {
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, d.who), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "list" },
      h("button", { class: "li", onClick: () => { api.close(); editForm(d); } }, icon("edit"), h("div", { class: "t" }, h("b", null, "Tahrirlash"))),
      h("button", { class: "li", onClick: async () => {
        api.close();
        if (!(await confirmBox("Qarzni o‘chirish", "Qarz va unga bog‘liq operatsiyalar o‘chiriladi, hisob qoldiqlari qayta hisoblanadi.", "O‘chirish", true))) return;
        try { await del(`/debts/${d.id}`); await loadMeta(); toast("Qarz o‘chirildi"); reload(); } catch (e) { toast(e.message); }
      } }, icon("trash"), h("div", { class: "t" }, h("b", { class: "neg" }, "O‘chirish"))))));
}

function accChips(state, key = "acc") {
  const accs = store.meta.accounts.filter((a) => !a.archived && a.currency === "UZS");
  const box = h("div", { class: "chips scroll" });
  const draw = () => box.replaceChildren(...accs.map((a) => h("button", { class: "chip" + (state[key] === a.id ? " on" : ""), "aria-pressed": String(state[key] === a.id), onClick: () => { state[key] = a.id; draw(); } }, `${a.name} · ${short(a.balance)}`)));
  draw();
  return box;
}
const defAcc = (pay) => { const a = store.meta.accounts.filter((x) => !x.archived && x.currency === "UZS"); return (pay ? a.find((x) => x.id === store.meta.user.last_account_id) : a.find((x) => x.name === "Naqd")) ?.id || a[0]?.id; };

function payForm(d) {
  const pay = d.direction === "payable";
  const st = { amount: 0, acc: defAcc(pay) };
  const inp = h("input", { class: "inp", inputmode: "numeric", placeholder: "0", "aria-label": "Summa", "data-autofocus": true, style: { fontSize: "24px", fontWeight: 900, minHeight: "54px" } });
  const err = h("div", { class: "errtxt", role: "alert" });
  bindMoneyInput(inp, (n) => { st.amount = n; err.textContent = ""; });
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, pay ? "Qarz to‘lovi" : "Qaytgan summa"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "msgbox", style: { background: "var(--chip)" } }, `${d.who} · qolgan ${fmt(d.remaining)}`),
    h("div", null, inp, err, h("div", { style: { marginTop: "8px" } }, h("button", { class: "chip", onClick: () => { inp.value = group(d.remaining).replace(/ /g, " "); st.amount = d.remaining; err.textContent = ""; } }, `To‘liq: ${group(d.remaining)}`))),
    h("div", null, h("div", { class: "flbl", style: { marginBottom: "8px" } }, pay ? "Qaysi hisobdan" : "Qaysi hisobga"), accChips(st)),
    h("button", { class: "btn pri lg block", onClick: async (e) => {
      if (!st.amount) { err.textContent = "Summani kiriting"; return; }
      if (st.amount > d.remaining) { err.textContent = `Qolgan qarzdan ko‘p: eng ko‘pi ${group(d.remaining)} so‘m`; return; }
      e.currentTarget.disabled = true;
      try {
        const r = await post(`/debts/${d.id}/payments`, { amount: st.amount, account_id: st.acc });
        api.close(); await loadMeta();
        toast(r.closed ? "Qarz to‘liq yopildi" : `Saqlandi, qolgan ${fmt(r.left)}`); reload();
      } catch (er) { e.currentTarget.disabled = false; err.textContent = er.message; }
    } }, "Saqlash")));
}

function debtForm() {
  const st = { direction: dir, who: "", amount: 0, due: "", monthly: 0, payDay: "", interest: "", acc: defAcc(dir === "payable"), note: "" };
  const err = h("div", { class: "errtxt", role: "alert" });
  const amt = h("input", { class: "inp", inputmode: "numeric", placeholder: "0", "aria-label": "Summa" });
  bindMoneyInput(amt, (n) => { st.amount = n; });
  const mon = h("input", { class: "inp", inputmode: "numeric", placeholder: "0", "aria-label": "Oylik to‘lov" });
  bindMoneyInput(mon, (n) => { st.monthly = n; });
  const segBox = h("div", { class: "seg full", role: "tablist" });
  const drawSeg = () => segBox.replaceChildren(...[["payable", "Men qarz oldim"], ["receivable", "Men qarz berdim"]].map(([v, t]) => h("button", { role: "tab", "aria-selected": String(st.direction === v), onClick: () => { st.direction = v; drawSeg(); } }, t)));
  drawSeg();
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, "Yangi qarz"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    segBox,
    h("div", { class: "field" }, h("label", null, "Kim yoki qaysi tashkilot"), h("input", { class: "inp", maxlength: 80, "data-autofocus": true, onInput: (e) => { st.who = e.target.value; } })),
    h("div", { class: "field" }, h("label", null, "Summa (so‘m)"), amt),
    h("div", { class: "field" }, h("label", null, "Qaytarish muddati"), h("input", { class: "inp", type: "date", onChange: (e) => { st.due = e.target.value; } })),
    h("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr" } },
      h("div", { class: "field" }, h("label", null, "Oylik to‘lov"), mon),
      h("div", { class: "field" }, h("label", null, "To‘lov kuni (1–31)"), h("input", { class: "inp", inputmode: "numeric", maxlength: 2, onInput: (e) => { st.payDay = e.target.value.replace(/\D/g, ""); } }))),
    h("div", { class: "field" }, h("label", null, "Yillik foiz (ixtiyoriy)"), h("input", { class: "inp", inputmode: "decimal", onInput: (e) => { st.interest = e.target.value.replace(",", "."); } })),
    h("div", null, h("div", { class: "flbl", style: { marginBottom: "8px" } }, "Hisob"), accChips(st)),
    h("p", { class: "hint" }, "Pul hisobga kiradi yoki chiqadi, lekin bu daromad yoki xarajat hisoblanmaydi."),
    err,
    h("button", { class: "btn pri lg block", onClick: async (e) => {
      if (!st.who.trim()) { err.textContent = "Kim ekanini yozing"; return; }
      if (!st.amount) { err.textContent = "Summani kiriting, u 0 dan katta bo‘lishi kerak"; return; }
      const pd = st.payDay ? +st.payDay : null;
      if (pd && (pd < 1 || pd > 31)) { err.textContent = "To‘lov kuni 1 dan 31 gacha"; return; }
      e.currentTarget.disabled = true;
      try {
        await post("/debts", { direction: st.direction, who: st.who.trim(), amount: st.amount, account_id: st.acc, due_date: st.due || null, monthly_payment: st.monthly || null, pay_day: pd, interest_pct: st.interest ? +st.interest : null });
        dir = st.direction; api.close(); await loadMeta(); toast("Qarz qo‘shildi"); reload();
      } catch (er) { e.currentTarget.disabled = false; err.textContent = er.message; }
    } }, "Saqlash")));
}

function editForm(d) {
  const st = { who: d.who, due: d.due_date || "", monthly: d.monthly_payment || 0, payDay: d.pay_day || "", interest: d.interest_pct ?? "" };
  const mon = h("input", { class: "inp", inputmode: "numeric", value: st.monthly ? group(st.monthly).replace(/ /g, " ") : "" });
  bindMoneyInput(mon, (n) => { st.monthly = n; });
  const err = h("div", { class: "errtxt" });
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, "Qarzni tahrirlash"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "field" }, h("label", null, "Kim"), h("input", { class: "inp", value: st.who, maxlength: 80, onInput: (e) => { st.who = e.target.value; } })),
    h("div", { class: "field" }, h("label", null, "Qaytarish muddati"), h("input", { class: "inp", type: "date", value: st.due, onChange: (e) => { st.due = e.target.value; } })),
    h("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr" } },
      h("div", { class: "field" }, h("label", null, "Oylik to‘lov"), mon),
      h("div", { class: "field" }, h("label", null, "To‘lov kuni"), h("input", { class: "inp", inputmode: "numeric", value: st.payDay, maxlength: 2, onInput: (e) => { st.payDay = e.target.value.replace(/\D/g, ""); } }))),
    h("div", { class: "field" }, h("label", null, "Yillik foiz"), h("input", { class: "inp", inputmode: "decimal", value: st.interest, onInput: (e) => { st.interest = e.target.value.replace(",", "."); } })),
    err,
    h("button", { class: "btn pri lg block", onClick: async () => {
      try { await put(`/debts/${d.id}`, { who: st.who, due_date: st.due || null, monthly_payment: st.monthly || null, pay_day: st.payDay ? +st.payDay : null, interest_pct: st.interest === "" ? null : +st.interest }); api.close(); toast("Saqlandi"); reload(); } catch (e) { err.textContent = e.message; }
    } }, "Saqlash")));
}
