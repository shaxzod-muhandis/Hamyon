// Operatsiya kiritish va tahrirlash oynasi (TZ 6): mobilda pastdan chiqadi va raqam klaviaturasi bor.
import { h, icon, openModal, confirmBox, toast, short, group, fmt, money, bindMoneyInput, parseDigits, addDays, MINUS, cap } from "./ui.js";
import { post, put, del, ApiError } from "./api.js";

const isMobile = () => matchMedia("(max-width: 859px)").matches || !!window.Telegram?.WebApp?.initData;
const HINT = {
  expense: "Hisob balansi darhol kamayadi.",
  income: "Hisob balansi darhol oshadi.",
  transfer: "O‘tkazma daromad yoki xarajat hisoblanmaydi, faqat hisoblar orasida pul ko‘chadi.",
};
const REC = { daily: "Har kuni", weekly: "Har hafta", monthly: "Har oy", yearly: "Har yil" };

export function openTxForm({ store, kind = "expense", tx = null, accountId, categoryId, date, onSaved }) {
  const meta = store.meta;
  const today = store.today;
  const editing = !!tx;
  const accs = meta.accounts.filter((a) => !a.archived);
  const catsOf = (k) => meta.categories.filter((c) => c.kind === k && !c.system_key);
  const defAcc = () => (accs.find((a) => a.id === meta.user.last_account_id && a.currency === "UZS") || accs.find((a) => a.is_liquid && a.currency === "UZS") || accs[0])?.id;

  const st = {
    kind: tx?.kind || kind,
    amount: tx ? (tx.currency === "USD" ? Math.round(tx.amount / 100) : tx.amount) : 0,
    categoryId: tx?.category_id || categoryId || null,
    accountId: tx?.account_id || accountId || defAcc(),
    toAccountId: tx?.to_account_id || null,
    toAmount: tx?.to_amount ? Math.round(tx.to_amount / (accs.find((a) => a.id === tx.to_account_id)?.currency === "USD" ? 100 : 1)) : 0,
    dateKey: "today", customDate: today, time: null,
    recurring: false, period: "monthly", note: tx?.note || "",
    busy: false, error: "",
  };
  if (!st.categoryId && st.kind !== "transfer") st.categoryId = catsOf(st.kind)[0]?.id;
  if (st.kind === "transfer" && !st.toAccountId) st.toAccountId = accs.find((a) => a.id !== st.accountId)?.id;
  const d0 = tx?.local_date || date;
  if (d0) {
    st.customDate = d0;
    st.dateKey = d0 === today ? "today" : d0 === addDays(today, -1) ? "yday" : d0 === addDays(today, -2) ? "d2" : "custom";
    st.time = tx?.local_time || null;
  }
  const idemKey = (crypto.randomUUID?.() || String(Date.now()) + Math.random());
  const snapshot = () => JSON.stringify([st.kind, st.amount, st.categoryId, st.accountId, st.toAccountId, st.toAmount, st.dateKey, st.customDate, st.recurring, st.note]);
  const initial = snapshot();
  const acc = (id) => accs.find((a) => a.id === id);
  const mobile = isMobile();

  let api, root;
  const body = h("div", { class: "stack", style: { gap: "14px" } });

  const dateValue = () => st.dateKey === "today" ? today : st.dateKey === "yday" ? addDays(today, -1) : st.dateKey === "d2" ? addDays(today, -2) : st.customDate;

  // ── bo'laklar ──
  const amountInput = h("input", { class: "", inputmode: mobile ? "none" : "numeric", readonly: mobile || null, placeholder: "0", "aria-label": "Summa", "data-autofocus": !mobile || null, autocomplete: "off" });
  const unitEl = h("span", null, "so‘m");
  const amtBox = h("div", { class: "amtbox" }, amountInput, unitEl);
  const errEl = h("div", { class: "errtxt", role: "alert" });
  const warnEl = h("div", { class: "warntxt" });
  const setAmount = (n) => {
    st.amount = n; amountInput.value = n ? group(n).replace(/ /g, " ") : "";
    amtBox.classList.toggle("inc", st.kind === "income");
    clearError(); updateWarn();
  };
  const clearError = () => { st.error = ""; errEl.textContent = ""; amtBox.classList.remove("err"); };
  const showError = (m) => { st.error = m; errEl.textContent = m; amtBox.classList.add("err"); };
  if (!mobile) bindMoneyInput(amountInput, (n) => { st.amount = n; amtBox.classList.toggle("inc", st.kind === "income"); clearError(); updateWarn(); });
  function updateWarn() {
    const a = acc(st.accountId);
    let t = "";
    if (st.kind !== "income" && a && st.amount) {
      const factor = a.currency === "USD" ? 100 : 1;
      let avail = a.balance;
      if (editing && tx.account_id === a.id && tx.kind !== "income") avail += tx.amount;
      if (st.amount * factor > avail) t = "Hisobda yetarli mablag‘ yo‘q, qoldiq manfiy bo‘ladi.";
    }
    warnEl.textContent = t;
  }

  const seg = () => h("div", { class: "seg full", role: "tablist" },
    ...[["expense", "Chiqim"], ["income", "Kirim"], ["transfer", "O‘tkazma"]].map(([k, t]) =>
      h("button", { role: "tab", "aria-selected": String(st.kind === k), disabled: editing && k !== st.kind, onClick: () => switchKind(k) }, t)));
  function switchKind(k) {
    if (st.kind === k) return;
    st.kind = k;
    if (k !== "transfer") {
      st.categoryId = catsOf(k)[0]?.id;
      if (acc(st.accountId)?.currency !== "UZS") st.accountId = defAcc();
    } else if (!st.toAccountId || st.toAccountId === st.accountId) st.toAccountId = accs.find((a) => a.id !== st.accountId)?.id;
    clearError(); redraw();
  }

  const catGrid = () => st.kind === "transfer" ? null : h("div", null,
    h("div", { class: "flbl", style: { marginBottom: "8px" } }, "Kategoriya"),
    h("div", { class: "catgrid" },
      ...catsOf(st.kind).map((c) => h("button", { class: "cat" + (st.categoryId === c.id ? " on" : ""), "aria-pressed": String(st.categoryId === c.id), onClick: () => { st.categoryId = c.id; redraw(); } },
        h("i", { style: { background: c.color } }, c.name[0].toUpperCase()), h("span", null, c.name))),
      h("button", { class: "cat", onClick: () => { api.close(true); location.assign("/settings"); } }, h("i", { style: { background: "var(--chip)", color: "var(--ink2)" } }, "+"), h("span", null, "Yangi"))));

  const accLabel = (a) => `${a.name} · ${a.currency === "USD" ? "$" + group(Math.round(a.balance / 100)) : short(a.balance)}`;
  const accChips = (label, key, list) => h("div", null, h("div", { class: "flbl", style: { marginBottom: "8px" } }, label),
    h("div", { class: "chips scroll" }, ...list.map((a) => h("button", { class: "chip" + (st[key] === a.id ? " on" : ""), "aria-pressed": String(st[key] === a.id), onClick: () => { st[key] = a.id; if (key === "accountId" && st.toAccountId === a.id) st.toAccountId = accs.find((x) => x.id !== a.id)?.id; redraw(); } }, accLabel(a)))));

  const dateRow = () => {
    const chip = (k, t) => h("button", { class: "chip" + (st.dateKey === k ? " on" : ""), "aria-pressed": String(st.dateKey === k), onClick: () => { st.dateKey = k; redraw(); } }, t);
    const dateInput = st.dateKey === "custom" ? h("input", { class: "inp", type: "date", value: st.customDate, max: today, "aria-label": "Sana", style: { maxWidth: "190px" }, onChange: (e) => { st.customDate = e.target.value || today; } }) : null;
    const rec = st.kind === "transfer" ? null : h("div", { class: "gap8", style: { flexWrap: "wrap" } },
      h("button", { class: "chip" + (st.recurring ? " on" : ""), "aria-pressed": String(st.recurring), onClick: () => { st.recurring = !st.recurring; redraw(); } }, icon("repeat"), st.recurring ? REC[st.period] : "Takrorlash"),
      st.recurring ? h("select", { class: "sel", "aria-label": "Takrorlash davri", onChange: (e) => { st.period = e.target.value; redraw(); } }, ...Object.entries(REC).map(([v, t]) => h("option", { value: v, selected: v === st.period || null }, t))) : null);
    return h("div", null, h("div", { class: "flbl", style: { marginBottom: "8px" } }, "Sana"),
      h("div", { class: "chips" }, chip("today", "Bugun"), chip("yday", "Kecha"), chip("d2", "2 kun oldin"), chip("custom", "📅")),
      dateInput ? h("div", { style: { marginTop: "8px" } }, dateInput) : null,
      rec ? h("div", { style: { marginTop: "10px" } }, rec) : null);
  };

  const crossCur = () => st.kind === "transfer" && acc(st.accountId) && acc(st.toAccountId) && acc(st.accountId).currency !== acc(st.toAccountId).currency;
  const toAmtBox = () => {
    if (!crossCur()) return null;
    const to = acc(st.toAccountId);
    const inp = h("input", { class: "inp", inputmode: "numeric", placeholder: "0", value: st.toAmount ? group(st.toAmount).replace(/ /g, " ") : "", "aria-label": "Qabul qilingan summa" });
    bindMoneyInput(inp, (n) => { st.toAmount = n; });
    return h("div", { class: "field" }, h("label", null, `Qabul qilingan summa (${to.currency === "USD" ? "$" : "so‘m"})`), inp);
  };

  const noteEl = h("textarea", { class: "inp", rows: 1, placeholder: "Izoh (ixtiyoriy): masalan, Korzinka", maxlength: 200, "aria-label": "Izoh", onInput: (e) => { st.note = e.target.value; } });
  noteEl.value = st.note;

  const numpad = () => !mobile ? null : h("div", { class: "numpad" },
    ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "⌫"].map((k) =>
      h("button", { type: "button", "aria-label": k === "⌫" ? "O‘chirish" : k, onClick: () => key(k) }, k === "⌫" ? icon("back") : k)));
  function key(k) {
    let s = String(st.amount || "");
    if (k === "⌫") s = s.slice(0, -1);
    else s = (s + k).replace(/^0+/, "");
    if (s.length > 12) return;
    setAmount(+s || 0);
  }

  const saveBtn = h("button", { class: "btn pri lg block", onClick: save }, "Saqlash");
  const delBtn = editing ? h("button", { class: "btn dng lg", style: { flex: "none" }, onClick: remove }, icon("trash"), "O‘chirish") : null;

  function redraw() {
    amtBox.classList.toggle("inc", st.kind === "income");
    const from = acc(st.accountId);
    unitEl.textContent = from?.currency === "USD" && st.kind === "transfer" ? "$" : "so‘m";
    const lblFrom = st.kind === "income" ? "Qaysi hisobga" : "Qaysi hisobdan";
    const list = st.kind === "transfer" ? accs : accs.filter((a) => a.currency === "UZS");
    body.replaceChildren(...[
      seg(), h("div", null, amtBox, errEl, warnEl), numpad(), catGrid(),
      accChips(lblFrom, "accountId", list),
      st.kind === "transfer" ? accChips("Qaysi hisobga", "toAccountId", accs.filter((a) => a.id !== st.accountId)) : null,
      toAmtBox(), dateRow(), noteEl, h("p", { class: "hint" }, HINT[st.kind])].filter(Boolean));
    updateWarn();
  }

  // ── saqlash ──
  async function save() {
    if (st.busy) return;
    const from = acc(st.accountId);
    if (!st.amount || st.amount <= 0) { showError("Summani kiriting, u 0 dan katta bo‘lishi kerak"); return; }
    if (st.kind === "transfer" && st.accountId === st.toAccountId) { showError("Bir hisobdan o‘ziga o‘tkazib bo‘lmaydi"); return; }
    const fromFactor = from?.currency === "USD" && st.kind === "transfer" ? 100 : 1;
    const payload = { kind: st.kind, amount: st.amount * fromFactor, account_id: st.accountId, note: st.note.trim() || null, date: dateValue() };
    if (st.time && editing && st.dateKey === "custom") payload.time = st.time;
    if (st.kind === "transfer") {
      payload.to_account_id = st.toAccountId;
      if (crossCur()) {
        if (!st.toAmount) { showError("Qabul qilingan summani kiriting"); return; }
        payload.to_amount = st.toAmount * (acc(st.toAccountId).currency === "USD" ? 100 : 1);
      }
    } else payload.category_id = st.categoryId;
    if (st.recurring && !editing) payload.recurrence = st.period;
    setBusy(true);
    try {
      let res;
      if (editing) { delete payload.kind; res = await put(`/transactions/${tx.id}`, payload); }
      else res = await post("/transactions", { ...payload, idempotency_key: idemKey });
      const amt = editing ? res.amount : res.transaction.amount;
      const sign = st.kind === "income" ? "+" : st.kind === "expense" ? MINUS : "";
      toast(editing ? "O‘zgartirildi, balanslar qayta hisoblandi" : st.kind === "transfer" ? `O‘tkazildi: ${group(amt)} so‘m` : `Saqlandi: ${sign}${fmt(amt)}`);
      api.close(true);
      onSaved?.();
    } catch (e) {
      setBusy(false);
      showError(e instanceof ApiError && e.status >= 400 && e.status < 500 ? e.message : "Saqlanmadi. Internetni tekshirib, qayta urinib ko‘ring.");
    }
  }
  function setBusy(b) {
    st.busy = b; saveBtn.disabled = b;
    saveBtn.replaceChildren(...(b ? [h("span", { class: "spin" }, "")] : ["Saqlash"]));
  }
  async function remove() {
    if (st.busy) return;
    if (!(await confirmBox("Operatsiyani o‘chirish", "Balanslar qayta hisoblanadi.", "O‘chirish", true))) return;
    try {
      await del(`/transactions/${tx.id}`);
      api.close(true);
      toast("O‘chirildi, balanslar qayta hisoblandi", { label: "Bekor qilish", run: async () => { try { await post(`/transactions/${tx.id}/restore`); toast("Qaytarildi"); } catch { toast("Qaytarib bo‘lmadi"); } onSaved?.(); } });
      onSaved?.();
    } catch (e) { showError(e.message || "O‘chirilmadi"); }
  }

  api = openModal((m, a) => {
    root = m;
    m.append(
      h("div", { class: "mh" }, h("h2", null, editing ? "Operatsiyani tahrirlash" : "Yangi operatsiya"),
        h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => a.close(false) }, icon("x"))),
      body,
      h("div", { class: "gap8 mfoot" }, delBtn, saveBtn));
    redraw();
    setAmount(st.amount);
  }, {
    canClose: () => {
      if (snapshot() === initial) return true;
      confirmBox("O‘zgarishlar saqlanmaydi. Yopilsinmi?", "", "Yopish", true).then((ok) => ok && api.close(true));
      return false;
    },
  });
  return api;
}
