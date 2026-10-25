// Kirim va chiqimlar (TZ 5): filtrlar, kunlar bo'yicha guruhlangan ro'yxat, sahifalash, guruhli amallar.
import { h, icon, fmt, group, cap, monthName, longDay, MINUS, debounce, toast, openModal, confirmBox } from "../ui.js";
import { get, post, qs } from "../api.js";
import { store, reload, newTx, navigate } from "../app.js";
import { txRow, panel } from "./shared.js";

const PAGE = 50;
const EMPTY = { type: "", account: "", category: "", q: "", from: "", to: "", min: "", max: "" };

export default {
  sub: (s) => (s.today ? `${cap(monthName(s.today))} ${s.today.slice(0, 4)}` : ""),

  async render(ctx) {
    const F = { ...EMPTY };
    for (const k of Object.keys(F)) F[k] = ctx.query.get(k) || "";
    const meta = store.meta;
    const state = { items: [], summary: null, dayTotals: {}, more: false, loading: false, select: false, sel: new Set() };

    const list = h("div", { class: "panel sm", style: { minHeight: "120px" } });
    const summaryEl = h("div", { class: "gap8", style: { flexWrap: "wrap", justifyContent: "space-between" } });
    const bulkEl = h("div", { class: "sticky-bulk", hidden: true });
    const sentinel = h("div", { style: { height: "1px" } });

    const params = (offset) => qs({ type: F.type, account_id: F.account, category_id: F.category, q: F.q, from: F.from, to: F.to, min: F.min, max: F.max, limit: PAGE, offset });
    const syncUrl = () => history.replaceState({}, "", "/transactions" + qs({ type: F.type, account: F.account, category: F.category, q: F.q, from: F.from, to: F.to, min: F.min, max: F.max }));
    const active = () => Object.entries(F).some(([, v]) => v);

    async function load(reset) {
      if (state.loading) return;
      state.loading = true;
      try {
        const r = await get("/transactions" + params(reset ? 0 : state.items.length));
        if (reset) { state.items = r.items; state.dayTotals = {}; state.sel.clear(); } else state.items = state.items.concat(r.items);
        Object.assign(state.dayTotals, r.day_totals);
        state.summary = r.summary; state.more = r.has_more;
      } catch { toast("Yuklab bo‘lmadi. Qayta urinib ko‘ring."); }
      state.loading = false;
      draw();
    }
    const refilter = () => { syncUrl(); load(true); };

    function draw() {
      // xulosa qatori
      const s = state.summary;
      summaryEl.replaceChildren(
        h("div", { class: "muted" }, s ? `${s.count} ta operatsiya · Kirim ` : "", s ? h("b", { class: "pos" }, `+${group(s.income)}`) : "", s ? " · Chiqim " : "", s ? h("b", null, `${MINUS}${group(s.expense)}`) : ""),
        h("div", { class: "gap8" },
          active() ? h("button", { class: "btn", onClick: () => { Object.assign(F, EMPTY); refilter(); redrawFilters(); } }, "Filtrni tozalash") : null,
          h("button", { class: "btn desk-only", onClick: () => { state.select = !state.select; state.sel.clear(); draw(); } }, state.select ? "Tanlashni yopish" : "Tanlash")));
      // ro'yxat
      if (!state.items.length) {
        list.replaceChildren(h("div", { class: "empty" }, state.loading ? "Yuklanmoqda…" : [h("b", null, "Hech narsa topilmadi"), "Filtr yoki qidiruv so‘zini o‘zgartirib ko‘ring"]));
      } else {
        const out = [];
        let day = null;
        for (const t of state.items) {
          if (t.local_date !== day) {
            day = t.local_date;
            const dt = state.dayTotals[day] || { income: 0, expense: 0 };
            out.push(h("div", { class: "dayhdr" }, h("span", null, longDay(day, store.today)), h("span", null, dt.income ? h("span", { class: "pos" }, `+${group(dt.income)}   `) : "", dt.expense ? `${MINUS}${group(dt.expense)}` : "")));
          }
          out.push(txRow(t, {
            selectable: state.select && !t.debt_id, selected: state.sel.has(t.id), onChanged: () => reload(),
            onSelect: (x) => { state.sel.has(x.id) ? state.sel.delete(x.id) : state.sel.add(x.id); draw(); },
          }));
        }
        if (state.more) out.push(h("div", { class: "empty", style: { padding: "14px" } }, h("button", { class: "btn", onClick: () => load(false) }, "Yana yuklash")), sentinel);
        list.replaceChildren(h("div", { class: "list" }, ...out));
      }
      // guruhli amallar paneli
      bulkEl.hidden = !(state.select && state.sel.size);
      bulkEl.replaceChildren(panel(h("div", { class: "gap8", style: { flexWrap: "wrap" } },
        h("b", { class: "sp" }, `${state.sel.size} ta tanlandi`),
        h("button", { class: "btn", onClick: () => bulk("category") }, "Kategoriyani o‘zgartirish"),
        h("button", { class: "btn", onClick: () => bulk("account") }, "Hisobni o‘zgartirish"),
        h("button", { class: "btn dng", onClick: () => bulk("delete") }, "O‘chirish"),
        h("button", { class: "btn", onClick: () => { state.sel.clear(); draw(); } }, "Bekor qilish"))));
    }

    async function bulk(action) {
      const ids = [...state.sel];
      const run = async (extra = {}) => {
        try { await post("/transactions/bulk", { ids, action, ...extra }); toast("Saqlandi, balanslar qayta hisoblandi"); state.sel.clear(); await load(true); } catch (e) { toast(e.message); }
      };
      if (action === "delete") {
        if (await confirmBox("O‘chirish", `${ids.length} ta operatsiya o‘chiriladi. Balanslar qayta hisoblanadi.`, "O‘chirish", true)) run();
      } else {
        const opts = action === "category" ? meta.categories.filter((c) => !c.system_key).map((c) => [c.id, c.name]) : meta.accounts.filter((a) => !a.archived).map((a) => [a.id, a.name]);
        openModal((m, api) => m.append(
          h("div", { class: "mh" }, h("h2", null, action === "category" ? "Kategoriyani tanlang" : "Hisobni tanlang"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
          h("div", { class: "chips" }, ...opts.map(([id, name]) => h("button", { class: "chip", onClick: () => { api.close(); run(action === "category" ? { category_id: id } : { account_id: id }); } }, name)))));
      }
    }

    // ── filtrlar ──
    const filters = h("section", { class: "panel" });
    function redrawFilters() {
      const segs = [["", "Hammasi"], ["income", "Kirim"], ["expense", "Chiqim"], ["transfer", "O‘tkazma"]];
      const search = h("input", { class: "inp", placeholder: "Qidirish: izoh, kategoriya, hisob", value: F.q, "aria-label": "Qidirish", onInput: debounce((e) => { F.q = e.target.value.trim(); refilter(); }, 300) });
      const accSel = h("select", { class: "sel", "aria-label": "Hisob", onChange: (e) => { F.account = e.target.value; refilter(); } },
        h("option", { value: "" }, "Barcha hisoblar"), ...meta.accounts.filter((a) => a.currency === "UZS").map((a) => h("option", { value: a.id, selected: String(a.id) === F.account || null }, a.name)));
      const catSel = h("select", { class: "sel", "aria-label": "Kategoriya", onChange: (e) => { F.category = e.target.value; refilter(); } },
        h("option", { value: "" }, "Barcha kategoriyalar"), ...meta.categories.map((c) => h("option", { value: c.id, selected: String(c.id) === F.category || null }, c.name)));
      const date = (k, label) => h("input", { class: "sel", type: "date", value: F[k], "aria-label": label, onChange: (e) => { F[k] = e.target.value; refilter(); } });
      const amt = (k, ph) => h("input", { class: "sel", inputmode: "numeric", placeholder: ph, value: F[k], style: { width: "130px" }, "aria-label": ph, onChange: (e) => { F[k] = e.target.value.replace(/\D/g, ""); refilter(); } });
      filters.replaceChildren(
        h("div", { class: "gap8", style: { flexWrap: "wrap" } },
          h("div", { class: "seg", role: "tablist" }, ...segs.map(([v, t]) => h("button", { role: "tab", "aria-selected": String(F.type === v), onClick: () => { F.type = v; refilter(); redrawFilters(); } }, t))),
          h("div", { class: "search" }, icon("search"), search), accSel, catSel),
        h("div", { class: "gap8 desk-only", style: { flexWrap: "wrap", marginTop: "12px" } },
          h("span", { class: "muted small" }, "Sana:"), date("from", "Dan"), "—", date("to", "Gacha"), h("span", { class: "muted small", style: { marginLeft: "12px" } }, "Summa:"), amt("min", "dan"), "—", amt("max", "gacha"),
          h("button", { class: "btn", onClick: () => { const t = store.today; F.from = t.slice(0, 8) + "01"; F.to = t; refilter(); redrawFilters(); } }, "Joriy oy")));
    }
    redrawFilters();
    const r = await get("/transactions" + params(0));
    state.items = r.items; state.dayTotals = r.day_totals; state.summary = r.summary; state.more = r.has_more;
    draw();
    // cheksiz yuklash
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && state.more && !state.loading) load(false); }, { rootMargin: "300px" });
    queueMicrotask(() => io.observe(sentinel));
    return [filters, summaryEl, list, bulkEl];
  },
};
