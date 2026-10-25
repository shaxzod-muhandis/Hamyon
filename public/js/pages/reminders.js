// Eslatmalar (TZ 12).
import { h, icon, fmt, group, short, toast, MINUS } from "../ui.js";
import { put, get } from "../api.js";
import { store, reload } from "../app.js";
import { panel, ph } from "./shared.js";

export default {
  sub: () => "Telegram bildirishnomalari",

  async render(ctx) {
    const [r, dash] = await Promise.all([ctx.cached("/reminders"), ctx.cached("/dashboard")]);
    const list = h("div", { class: "list", style: { margin: "0 -20px" } }, ...r.items.map((it) => {
      const tg = h("button", { class: "toggle", role: "switch", "aria-pressed": String(it.enabled), "aria-label": it.label,
        onClick: async () => { const v = !it.enabled; tg.setAttribute("aria-pressed", String(v)); timeEl && (timeEl.disabled = !v, timeEl.style.opacity = v ? 1 : 0.45); try { await put(`/reminders/${it.kind}`, { enabled: v }); it.enabled = v; toast("Saqlandi"); } catch (e) { toast(e.message); reload(); } } });
      const timeEl = it.has_time ? h("input", { class: "sel", type: "time", value: it.at_time, disabled: !it.enabled, style: { opacity: it.enabled ? 1 : 0.45, width: "112px" }, "aria-label": `${it.label}: vaqt`,
        onChange: async (e) => { try { await put(`/reminders/${it.kind}`, { at_time: e.target.value }); toast("Saqlandi"); } catch (er) { toast(er.message); reload(); } } }) : null;
      return h("div", { class: "li" }, h("div", { class: "t" }, h("b", { style: { whiteSpace: "normal" } }, it.label), h("small", { style: { whiteSpace: "normal" } }, it.enabled ? it.hint : "O‘chirilgan")), timeEl, tg);
    }));
    const b = r.bot;
    const botPanel = panel(ph("Telegram bot"),
      h("div", { class: "gap8" }, h("span", { class: "dot", style: { background: b.connected ? "var(--green)" : "var(--red)", width: "12px", height: "12px" } }),
        h("b", null, b.connected ? `${b.username ? "@" + b.username : "Bot"} ulangan` : "Bot ulanmagan")),
      h("p", { class: "muted small", style: { margin: "8px 0" } }, `Vaqt zonasi: ${b.tz} · ${b.enabled} ta eslatma yoqilgan`),
      h("p", { class: "hint" }, "Eslatmalar faqat sizning shaxsiy chatingizga yuboriladi. Moliyaviy ma’lumotlaringiz boshqalarga ko‘rinmaydi."),
      b.connected ? null : h("a", { class: "btn pri", style: { marginTop: "12px" }, href: `https://t.me/${b.username || ""}?start=app`, target: "_blank", rel: "noopener" }, "Botni ulash"));
    const m = dash.month_stats;
    const sample = panel(ph("Xabar namunasi"), h("div", { class: "tgmsg" }, `Oylik xulosa (namuna)\nXarajat: ${MINUS}${group(m.expense)}\nDaromad: +${group(m.income)}\nSof pul oqimi: ${m.net_flow < 0 ? MINUS : "+"}${group(m.net_flow)}\nJamg‘armaga: ${group(m.saved)}`));
    return h("div", { class: "row" }, h("div", { class: "grow-l" }, panel(list)), h("div", { class: "grow-r stack" }, botPanel, sample));
  },
};
