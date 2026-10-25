// Keyingi oy rejasi: nimalarga pul ajratish (muhim xarajatlar va jamg'arma/maqsadlar).
import { h, icon, fmt, short, group, fmtDay, monthName, cap, openModal, toast, bindMoneyInput, MINUS, signed } from "../ui.js";
import { post, put, del } from "../api.js";
import { store, navigate } from "../app.js";
import { panel, ph, link } from "./shared.js";

const mname = (p) => cap(monthName(p.month_start));

export function monthPlanPanel(p, { compact = false, onChanged, month } = {}) {
  const out = [];
  const addBtn = h("button", { class: "btn pri", onClick: () => planItemForm(null, { month: p.month, kind: "spend", onSaved: onChanged }) }, icon("plus"), "Qo‘shish");
  out.push(ph(`${mname(p)} rejasi`, h("div", { class: "gap8" }, p.is_next ? h("span", { class: "pill b" }, "keyingi oy") : null, compact ? link("Barchasi →", () => navigate("/plan"), "/plan") : null, addBtn)));

  const allocated = p.spend + p.save;
  const base = p.income || 1;
  const seg = (v, c) => h("span", { style: { width: Math.min(100, (v / base) * 100) + "%", background: c, display: "block", height: "100%" } });
  out.push(h("div", { class: "grid", style: { marginBottom: "14px" } },
    stat("Kutilayotgan tushum", `+${group(p.income)}`, "pos"),
    stat("Majburiy (avtomatik)", p.mandatory ? `${MINUS}${group(p.mandatory)}` : "0"),
    stat("Siz ajratdingiz", allocated ? `${MINUS}${group(allocated)}` : "0", "", p.save ? `shundan jamg‘arma ${short(p.save)}` : ""),
    stat("Ajratilmagan", `${p.free < 0 ? MINUS : ""}${group(p.free)}`, p.free < 0 ? "neg" : "pos", p.free < 0 ? "tushumdan ko‘p ajratilgan" : "")));
  if (p.income > 0)
    out.push(h("div", { class: "bar", style: { display: "flex", overflow: "hidden", height: "12px", marginBottom: "6px" }, role: "img", "aria-label": `Tushumning ${Math.round(((p.mandatory + allocated) / base) * 100)}% i ajratilgan` },
      seg(p.mandatory, "var(--ink3)"), seg(p.spend, "var(--blue)"), seg(p.save, "var(--green)")),
      h("div", { class: "legend", style: { marginTop: "6px" } },
        h("span", null, h("i", { style: { background: "var(--ink3)" } }), "Majburiy"), h("span", null, h("i", { style: { background: "var(--blue)" } }), "Xarajat"), h("span", null, h("i", { style: { background: "var(--green)" } }), "Jamg‘arma")));
  else out.push(h("p", { class: "hint", style: { marginBottom: "10px" } }, "Kutilayotgan tushum belgilanmagan. Reja sahifasida maosh yoki tushum qo‘shing — shunda qancha ajratish mumkinligi hisoblanadi."));

  if (!p.items.length) {
    out.push(h("div", { class: "empty", style: { padding: "20px 8px" } }, h("b", null, "Nimalarga pul ajratmoqchisiz?"), "Keyingi oyning muhim xarajatlari va jamg‘arma maqsadlarini kiriting.",
      h("div", { class: "gap8", style: { justifyContent: "center", flexWrap: "wrap", marginTop: "14px" } },
        h("button", { class: "btn pri", onClick: () => planItemForm(null, { month: p.month, kind: "spend", onSaved: onChanged }) }, "Muhim xarajat qo‘shish"),
        h("button", { class: "btn", onClick: () => planItemForm(null, { month: p.month, kind: "save", onSaved: onChanged }) }, "🐖 Jamg‘arma / maqsad"))));
  } else {
    const groups = [["Muhim xarajatlar", (i) => i.kind === "spend" && i.important], ["Boshqa xarajatlar", (i) => i.kind === "spend" && !i.important], ["Jamg‘arma va maqsadlar", (i) => i.kind === "save"]];
    for (const [title, f] of groups) {
      const list = p.items.filter(f);
      if (!list.length) continue;
      out.push(h("div", { class: "lbl", style: { margin: "8px 0 2px" } }, title),
        h("div", { class: "list", style: { margin: "0 -20px" } }, ...list.map((i) => itemRow(i, p, onChanged))));
    }
    if (compact && p.count > p.items.length) out.push(link(`Yana ${p.count - p.items.length} ta band →`, () => navigate("/plan"), "/plan"));
  }
  if (p.auto.length && !compact) {
    out.push(h("div", { class: "lbl", style: { margin: "14px 0 6px" } }, "Majburiy to‘lovlar (avtomatik)"),
      h("div", { class: "stack", style: { gap: "6px" } }, ...p.auto.map((x) => h("div", { class: "gap8 small" }, h("span", { class: "muted", style: { width: "78px", flex: "none" } }, fmtDay(x.date).replace("-", " ")), h("span", { class: "sp" }, x.name + (x.kind === "debt" ? " · qarz" : "")), h("b", null, `${MINUS}${group(x.amount)}`)))));
  }
  return panel(...out);
}

const stat = (label, value, cls = "", sub = "") => h("div", { style: { minWidth: 0 } }, h("div", { class: "lbl", style: { fontSize: "11.5px" } }, label), h("div", { class: "num-lg " + cls, style: { fontSize: "20px", marginTop: "4px", overflowWrap: "anywhere" } }, value), sub ? h("div", { class: "muted small" }, sub) : null);

function itemRow(i, p, onChanged) {
  const cb = h("button", { class: "cbx" + (i.done ? " on" : ""), "aria-pressed": String(i.done), "aria-label": `${i.title}: bajarildi`, style: { borderRadius: "50%" },
    onClick: async (e) => { e.stopPropagation(); try { await put(`/month-plan/${i.id}`, { done: !i.done }); onChanged?.(); } catch (er) { toast(er.message); } } }, i.done ? "✓" : "");
  return h("div", { class: "li", style: { cursor: "pointer", opacity: i.done ? 0.6 : 1 }, role: "button", tabindex: 0, onClick: () => planItemForm(i, { month: p.month, onSaved: onChanged }), onKeydown: (e) => e.key === "Enter" && planItemForm(i, { month: p.month, onSaved: onChanged }) },
    cb,
    h("div", { class: "t" }, h("b", { style: i.done ? { textDecoration: "line-through" } : null }, i.title), i.category_name ? h("small", null, i.category_name) : null),
    h("div", { class: "amt" }, group(i.amount)));
}

// Qo'shish / tahrirlash oynasi
export function planItemForm(item, { month, kind = "spend", onSaved } = {}) {
  const editing = !!item;
  const cats = store.meta.categories.filter((c) => c.kind === "expense" && !c.system_key);
  const st = { kind: item?.kind || kind, title: item?.title || "", amount: item?.amount || 0, important: item ? item.important : true, cat: item?.category_id || null };
  const err = h("div", { class: "errtxt", role: "alert" });
  const amt = h("input", { class: "inp", inputmode: "numeric", placeholder: "0", value: st.amount ? group(st.amount).replace(/ /g, " ") : "", "aria-label": "Summa", style: { fontSize: "22px", fontWeight: 900, minHeight: "52px" } });
  bindMoneyInput(amt, (n) => { st.amount = n; err.textContent = ""; });
  const body = h("div", { class: "stack", style: { gap: "14px" } });
  const draw = () => {
    const seg = h("div", { class: "seg full", role: "tablist" }, ...[["spend", "Xarajat"], ["save", "🐖 Jamg‘arma / maqsad"]].map(([v, t]) => h("button", { role: "tab", "aria-selected": String(st.kind === v), onClick: () => { st.kind = v; st.important = v === "spend"; draw(); } }, t)));
    body.replaceChildren(...[
      seg,
      h("div", { class: "field" }, h("label", null, st.kind === "save" ? "Maqsad nomi" : "Nima uchun"), h("input", { class: "inp", value: st.title, maxlength: 80, placeholder: st.kind === "save" ? "Masalan: Safar uchun" : "Masalan: Ijara, dori-darmon", "data-autofocus": true, onInput: (e) => { st.title = e.target.value; err.textContent = ""; } })),
      h("div", { class: "field" }, h("label", null, "Summa (so‘m)"), amt),
      st.kind === "spend" ? h("div", { class: "gap8" }, h("button", { class: "toggle", role: "switch", "aria-pressed": String(st.important), "aria-label": "Muhim xarajat", onClick: () => { st.important = !st.important; draw(); } }), h("span", null, "Muhim xarajat")) : null,
      st.kind === "spend" ? h("div", null, h("div", { class: "flbl", style: { marginBottom: "8px" } }, "Kategoriya (ixtiyoriy)"),
        h("div", { class: "chips" }, ...cats.map((c) => h("button", { class: "chip" + (st.cat === c.id ? " on" : ""), "aria-pressed": String(st.cat === c.id), onClick: () => { st.cat = st.cat === c.id ? null : c.id; draw(); } }, h("span", { class: "dot", style: { background: c.color } }), c.name)))) : null,
    ].filter(Boolean));
  };
  draw();
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, editing ? "Reja bandini tahrirlash" : "Rejaga qo‘shish"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    body, err,
    h("div", { class: "gap8 mfoot" },
      editing ? h("button", { class: "btn dng lg", "aria-label": "O‘chirish", onClick: async () => { try { await del(`/month-plan/${item.id}`); api.close(); toast("O‘chirildi"); onSaved?.(); } catch (e) { err.textContent = e.message; } } }, icon("trash")) : null,
      h("button", { class: "btn pri lg block", onClick: async (e) => {
        if (!st.title.trim()) { err.textContent = "Nomini kiriting"; return; }
        if (!st.amount) { err.textContent = "Summani kiriting, u 0 dan katta bo‘lishi kerak"; return; }
        e.currentTarget.disabled = true;
        try {
          const body = { title: st.title.trim(), amount: st.amount, kind: st.kind, important: st.kind === "spend" ? st.important : false, category_id: st.kind === "spend" ? st.cat : null };
          editing ? await put(`/month-plan/${item.id}`, body) : await post("/month-plan", { ...body, month });
          api.close(); toast(editing ? "Saqlandi" : "Rejaga qo‘shildi"); onSaved?.();
        } catch (er) { e.currentTarget.disabled = false; err.textContent = er.message; }
      } }, "Saqlash"))));
}
