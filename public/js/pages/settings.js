// Sozlamalar (TZ 13).
import { h, icon, fmt, group, openModal, confirmBox, toast, bindMoneyInput } from "../ui.js";
import { put, post, del, get, auth } from "../api.js";
import { store, reload, loadMeta, applyTheme, navigate } from "../app.js";
import { panel, ph } from "./shared.js";

const ZONES = ["Asia/Tashkent", "Asia/Samarkand", "Europe/Moscow", "Asia/Almaty", "Europe/Istanbul", "Asia/Dubai", "UTC"];
const PALETTE = ["#2d78bd", "#7c5ce6", "#e08a1e", "#2f9e5f", "#d9475a", "#c25fc9", "#2a9bab", "#b7791f", "#5b8def", "#8a93a0"];

export default {
  sub: () => "Profil va ilova parametrlari",

  async render(ctx) {
    const meta = await loadMeta();
    const u = meta.user;
    const me = await ctx.cached("/me");
    const themeSeg = h("div", { class: "seg", role: "tablist" }, ...[["light", "Yorug‘"], ["dark", "Qorong‘i"], ["system", "Tizim bo‘yicha"]].map(([v, t]) =>
      h("button", { role: "tab", "aria-selected": String(u.theme === v), onClick: async () => { try { await put("/settings", { theme: v }); applyTheme(v); toast("Saqlandi"); reload(); } catch (e) { toast(e.message); } } }, t)));
    const row = (label, value, onClick) => h(onClick ? "button" : "div", { class: "li", onClick }, h("div", { class: "t" }, h("b", null, label)), h("span", { class: "muted" }, value), onClick ? icon("chev") : null);
    const info = panel(h("div", { class: "ph" }, h("h2", null, "Mavzu"), themeSeg),
      h("div", { class: "list", style: { margin: "0 -20px" } },
        row("Asosiy valyuta", "UZS"),
        row("Vaqt zonasi", u.tz, () => tzForm(u)),
        row("Telegram holati", u.bot_connected ? "Ulangan" : "Ulanmagan"),
        row("Hisob turi", "Shaxsiy"),
        row("Xavfsiz chegara", fmt(u.safe_threshold), () => numForm("Xavfsiz chegara (so‘m)", u.safe_threshold, (v) => put("/settings", { safe_threshold: v }))),
        row("USD kursi", `${group(u.usd_rate)} so‘m`, () => numForm("1 USD kursi (so‘m)", u.usd_rate, (v) => put("/settings", { usd_rate: v }))),
        row("Keyingi maosh kuni", "Reja sahifasida", () => navigate("/plan")),
        row("Zaxira nusxa", "JSON yuklab olish", async () => {
          try {
            const r = await fetch("/api/export", { headers: { Authorization: auth.header() } });
            const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `hamyon-${store.today}.json`; a.click(); URL.revokeObjectURL(a.href);
          } catch { toast("Yuklab bo‘lmadi"); }
        })));
    return [info, catBlock("Xarajat kategoriyalari", "expense", meta), catBlock("Daromad kategoriyalari", "income", meta)];
  },
};

function catBlock(title, kind, meta) {
  const cats = meta.categories.filter((c) => c.kind === kind && !c.system_key);
  const nameI = h("input", { class: "inp", placeholder: "Yangi kategoriya nomi", maxlength: 40, "aria-label": "Yangi kategoriya nomi" });
  return panel(ph(title),
    h("div", { class: "chips" }, ...cats.map((c) => h("span", { class: "chip", style: { paddingRight: "6px" } },
      h("button", { class: "gap8", style: { fontWeight: 800 }, "aria-label": `${c.name}: tahrirlash`, onClick: () => catForm(c) }, h("span", { class: "dot", style: { background: c.color } }), c.name),
      h("button", { class: "iconbtn", style: { width: "26px", height: "26px", border: 0, background: "none" }, "aria-label": `${c.name}: o‘chirish`, onClick: () => removeCat(c, cats) }, icon("x"))))),
    h("div", { class: "gap8", style: { marginTop: "14px" } }, nameI,
      h("button", { class: "btn pri", onClick: async () => {
        if (!nameI.value.trim()) return toast("Kategoriya nomini kiriting");
        try { await post("/categories", { kind, name: nameI.value.trim() }); await loadMeta(); toast("Kategoriya qo‘shildi"); reload(); } catch (e) { toast(e.message); }
      } }, "Qo‘shish")));
}

async function removeCat(c, cats) {
  try {
    if (!c.used) {
      if (!(await confirmBox("Kategoriyani o‘chirish", `${c.name} o‘chiriladi.`, "O‘chirish", true))) return;
      await del(`/categories/${c.id}`);
    } else {
      // operatsiyalari bor — boshqa kategoriyaga ko'chirib o'chirish taklif etiladi
      const others = cats.filter((x) => x.id !== c.id);
      if (!others.length) return toast("Bu kategoriyada operatsiyalar bor, o‘chirib bo‘lmaydi");
      const target = await new Promise((res) => openModal((m, api) => m.append(
        h("div", { class: "mh" }, h("h2", null, "Boshqa kategoriyaga ko‘chirish"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
        h("p", { class: "muted" }, `“${c.name}” da operatsiyalar bor. Ularni qaysi kategoriyaga ko‘chiramiz?`),
        h("div", { class: "chips" }, ...others.map((o) => h("button", { class: "chip", onClick: () => { res(o.id); api.close(); } }, h("span", { class: "dot", style: { background: o.color } }), o.name)))), { onClose: () => res(null) }));
      if (!target) return;
      await del(`/categories/${c.id}?move_to=${target}`);
    }
    await loadMeta(); toast("Kategoriya o‘chirildi"); reload();
  } catch (e) { toast(e.message); }
}

function catForm(c) {
  const st = { name: c.name, color: c.color };
  const sw = h("div", { class: "chips" });
  const draw = () => sw.replaceChildren(...PALETTE.map((p) => h("button", { class: "chip" + (st.color === p ? " on" : ""), "aria-label": p, style: { width: "40px", padding: 0, justifyContent: "center" }, onClick: () => { st.color = p; draw(); } }, h("span", { class: "dot", style: { background: p, width: "18px", height: "18px" } }))));
  draw();
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, "Kategoriyani tahrirlash"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "field" }, h("label", null, "Nomi"), h("input", { class: "inp", value: st.name, maxlength: 40, "data-autofocus": true, onInput: (e) => { st.name = e.target.value; } })),
    h("div", { class: "field" }, h("label", null, "Rang"), sw),
    h("button", { class: "btn pri lg block", onClick: async () => { try { await put(`/categories/${c.id}`, st); api.close(); await loadMeta(); toast("Saqlandi"); reload(); } catch (e) { toast(e.message); } } }, "Saqlash")));
}

function numForm(title, value, save) {
  let val = value;
  const inp = h("input", { class: "inp", inputmode: "numeric", value: group(value).replace(/ /g, " "), "data-autofocus": true });
  bindMoneyInput(inp, (n) => { val = n; });
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, title), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    inp, h("button", { class: "btn pri lg block", onClick: async () => { try { await save(val); api.close(); await loadMeta(); toast("Saqlandi"); reload(); } catch (e) { toast(e.message); } } }, "Saqlash")));
}
function tzForm(u) {
  openModal((m, api) => m.append(
    h("div", { class: "mh" }, h("h2", null, "Vaqt zonasi"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
    h("div", { class: "chips" }, ...ZONES.map((z) => h("button", { class: "chip" + (u.tz === z ? " on" : ""), onClick: async () => { try { await put("/settings", { tz: z }); api.close(); await loadMeta(); toast("Saqlandi"); reload(); } catch (e) { toast(e.message); } } }, z)))));
}
