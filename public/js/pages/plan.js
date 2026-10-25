// Reja va prognoz (TZ 10).
import { h, icon, fmt, short, group, fmtDay, monthName, openModal, confirmBox, toast, bindMoneyInput, MINUS, signed } from "../ui.js";
import { get, post, put, del } from "../api.js";
import { store, reload, navigate } from "../app.js";
import { panel, ph, emptyBox } from "./shared.js";
import { monthPlanPanel } from "./monthplan.js";

const REC = { none: "Bir marta", daily: "Har kuni", weekly: "Har hafta", monthly: "Har oy", yearly: "Har yil" };
let planMonth = null;
const KIND_TXT = { planned: "Rejalashtirilgan xarajat", debt: "Qarz to‘lovi", income: "Kutilayotgan tushum" };

export default {
  sub: () => "Nimalarga pul ajratish va prognoz",

  async render(ctx) {
    const cur = store.today.slice(0, 7);
    const nxt = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7), 1)).toISOString().slice(0, 7);
    if (!planMonth || ![cur, nxt].includes(planMonth)) planMonth = nxt;
    const mp = await get(`/month-plan?month=${planMonth}`);
    const p = await ctx.cached("/plan");
    ctx.setHead("Reja va prognoz", `${fmtDay(p.period.start)} — ${fmtDay(p.period.end)}`);
    const f = p.formula, r = p.reliability;
    const line = (label, val, cls = "") => h("div", { class: "gap8", style: { padding: "9px 0", borderBottom: "1px solid var(--line2)" } }, h("span", { class: "sp" }, label), h("b", { class: cls }, val));
    const formula = panel(
      ph(`${fmtDay(p.period.end)} oxiridagi balans`),
      line("Hozirgi tezkor mablag‘", group(f.liquid)),
      line("+ Kutilayotgan tushumlar (faqat yoqilganlari)", `+${group(f.incoming)}`, "pos"),
      line("− Rejalashtirilgan xarajatlar", `${MINUS}${group(f.planned)}`),
      line("− Qarz to‘lovlari", `${MINUS}${group(f.debts)}`),
      line(`− Kundalik xarajat, ${short(f.avg_daily)} × ${f.days} kun`, `${MINUS}${group(f.daily_total)}`),
      h("div", { class: "gap8", style: { paddingTop: "14px" } }, h("b", { class: "sp" }, "Kutilayotgan balans"), h("b", { style: { fontSize: "24px" }, class: f.expected < 0 ? "neg" : "" }, fmt(f.expected))),
      h("div", { class: "msgbox " + (r.below_threshold ? "red" : "amber"), style: { marginTop: "16px" } },
        r.below_threshold
          ? `Diqqat: ${fmtDay(r.min_date)} kuni qoldiq ${fmt(r.min_balance)} gacha tushib, xavfsiz chegaradan (${fmt(r.threshold)}) pastga tushadi. Ishonchlilik siz kiritgan reja va tushumlarga bog‘liq.`
          : `Eng past nuqta ${fmtDay(r.min_date)} kuni ≈ ${fmt(r.min_balance)}. Pul yetishmasligi kutilmaydi. Ishonchlilik siz kiritgan reja va tushumlarga bog‘liq.`));

    const incomes = panel(ph("Kutilayotgan tushumlar"),
      h("p", { class: "muted small", style: { marginBottom: "12px" } }, "Ishonchingiz komil bo‘lganlarini yoqing. Ular mavjud pulga qo‘shilmaydi, faqat prognozga ta’sir qiladi."),
      p.incomes.length ? h("div", { class: "stack", style: { gap: "12px" } }, ...p.incomes.map((i) => {
        const tg = h("button", { class: "toggle", role: "switch", "aria-pressed": String(i.include_in_forecast), "aria-label": `${i.name}: prognozga kiritish`,
          onClick: async () => { tg.setAttribute("aria-pressed", String(!i.include_in_forecast)); try { await put(`/plan/${i.id}`, { include_in_forecast: !i.include_in_forecast }); reload(); } catch (e) { toast(e.message); reload(); } } });
        return h("div", { class: "gap8" }, h("div", { class: "sp" }, h("b", null, i.name), h("div", { class: "muted small" }, `${i.next_date ? fmtDay(i.next_date) + " · " : ""}+${group(i.amount)}${i.recurrence !== "none" ? " · " + REC[i.recurrence].toLowerCase() : ""}`)), tg);
      })) : h("div", { class: "empty", style: { padding: "16px" } }, "Kutilayotgan tushum yo‘q"),
      h("button", { class: "btn", style: { marginTop: "14px" }, onClick: () => form(null, "income") }, icon("plus"), "Tushum qo‘shish"));

    const rows = p.items.map((x) => {
      const rec = x.planned_id ? p.planned.find((q) => q.id === x.planned_id) : null;
      const dim = x.kind === "income" && !x.included;
      const click = () => (x.kind === "debt" ? navigate("/debts") : rec && form(rec, rec.kind, x.date));
      return h("button", { class: "li", style: dim ? { opacity: 0.5 } : null, onClick: click },
        h("div", { style: { width: "46px", textAlign: "center", borderRadius: "10px", padding: "4px 0", background: "var(--chip)", flex: "none" } },
          h("div", { style: { fontWeight: 900, fontSize: "16px", lineHeight: 1 } }, +x.date.slice(8)), h("div", { style: { fontSize: "11px" } }, monthName(x.date).slice(0, 3))),
        h("div", { class: "t" }, h("b", null, x.name), h("small", null, KIND_TXT[x.kind] + (dim ? " · hisobga olinmagan" : ""))),
        h("div", { class: "amt " + (x.amount > 0 ? "in" : "") }, `${x.amount > 0 ? "+" : MINUS}${group(x.amount)}`),
        h("div", { class: "acc desk-only", style: { textAlign: "right", color: x.balance_after < p.reliability.threshold ? "var(--red-ink)" : "var(--ink2)" } }, x.balance_after == null ? "" : `qoldiq ${group(x.balance_after)}`));
    });
    const ops = panel(ph("Kelgusi operatsiyalar va qoldiq"),
      rows.length ? h("div", { class: "list", style: { margin: "0 -20px" } }, ...rows) : emptyBox("Rejali operatsiya yo‘q", "Maosh, ijara kabi takrorlanuvchi to‘lovlarni qo‘shing."),
      h("button", { class: "btn", style: { marginTop: "14px" }, onClick: () => form(null, "expense") }, icon("plus"), "Rejali operatsiya qo‘shish"));
    const monthSeg = h("div", { class: "seg", role: "tablist" }, ...[[nxt, "Keyingi oy"], [cur, "Shu oy"]].map(([v, t]) => h("button", { role: "tab", "aria-selected": String(planMonth === v), onClick: () => { planMonth = v; reload(); } }, t)));
    return [h("div", { class: "lbl" }, "Nimalarga pul ajratish"), monthSeg, monthPlanPanel(mp, { onChanged: () => reload() }), h("div", { class: "lbl" }, "Prognoz"), h("div", { class: "row" }, h("div", { class: "grow-l" }, formula), h("div", { class: "grow-r" }, incomes)), ops];
  },
};

function form(rec, kind, occDate) {
  const today = store.today;
  const st = {
    kind, name: rec?.name || "", amount: rec?.amount || 0, date: rec?.start_date || today, rec: rec?.recurrence || "none",
    include: rec ? rec.include_in_forecast : kind === "expense", salary: false,
  };
  const err = h("div", { class: "errtxt", role: "alert" });
  const amt = h("input", { class: "inp", inputmode: "numeric", placeholder: "0", value: st.amount ? group(st.amount).replace(/ /g, " ") : "", "aria-label": "Summa" });
  bindMoneyInput(amt, (n) => { st.amount = n; err.textContent = ""; });
  const kindSeg = h("div", { class: "seg full", role: "tablist" });
  const drawKind = () => kindSeg.replaceChildren(...[["expense", "Xarajat"], ["income", "Tushum"]].map(([v, t]) => h("button", { role: "tab", "aria-selected": String(st.kind === v), disabled: !!rec, onClick: () => { st.kind = v; st.include = v === "expense"; drawKind(); drawInc(); } }, t)));
  drawKind();
  const incBox = h("div", { class: "gap8" });
  const drawInc = () => incBox.replaceChildren(...(st.kind === "income" ? [h("button", { class: "toggle", role: "switch", "aria-pressed": String(st.include), "aria-label": "Prognozga kiritish", onClick: () => { st.include = !st.include; drawInc(); } }), h("span", null, "Prognozga kiritish")] : []));
  drawInc();
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, rec ? "Rejali operatsiya" : "Yangi rejali operatsiya"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    kindSeg,
    h("div", { class: "field" }, h("label", null, "Nomi"), h("input", { class: "inp", value: st.name, maxlength: 80, "data-autofocus": true, placeholder: "Masalan: Ijara", onInput: (e) => { st.name = e.target.value; } })),
    h("div", { class: "field" }, h("label", null, "Summa (so‘m)"), amt),
    h("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr" } },
      h("div", { class: "field" }, h("label", null, "Sana"), h("input", { class: "inp", type: "date", value: st.date, onChange: (e) => { st.date = e.target.value; } })),
      h("div", { class: "field" }, h("label", null, "Takrorlanish"), h("select", { class: "sel", onChange: (e) => { st.rec = e.target.value; } }, ...Object.entries(REC).map(([v, t]) => h("option", { value: v, selected: v === st.rec || null }, t))))),
    incBox, err,
    h("div", { class: "gap8", style: { flexWrap: "wrap" } },
      rec ? h("button", { class: "btn grn lg sp", onClick: async () => { try { await post(`/plan/${rec.id}/done`, { date: occDate || rec.start_date }); api.close(); toast("Bajarildi: haqiqiy operatsiyaga aylantirildi"); reload(); } catch (e) { err.textContent = e.message; } } }, icon("check"), "Bajarildi") : null,
      rec ? h("button", { class: "btn dng lg", "aria-label": "O‘chirish", onClick: async () => { if (await confirmBox("Rejani o‘chirish", "Bu rejali operatsiya prognozdan olib tashlanadi.", "O‘chirish", true)) { await del(`/plan/${rec.id}`); api.close(); toast("O‘chirildi"); reload(); } } }, icon("trash")) : null,
      h("button", { class: "btn pri lg sp", onClick: async () => {
        if (!st.name.trim()) { err.textContent = "Nomini kiriting"; return; }
        if (!st.amount) { err.textContent = "Summani kiriting, u 0 dan katta bo‘lishi kerak"; return; }
        try {
          const body = { name: st.name.trim(), amount: st.amount, start_date: st.date, recurrence: st.rec, include_in_forecast: st.include };
          rec ? await put(`/plan/${rec.id}`, body) : await post("/plan", { ...body, kind: st.kind });
          api.close(); toast("Saqlandi"); reload();
        } catch (e) { err.textContent = e.message; }
      } }, "Saqlash"))));
}
