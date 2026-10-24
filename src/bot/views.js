// Bot xabarlari va klaviaturalari. Xabar tuzilishi: qalin sarlavha + 3–4 qator raqam (TZ 12.2).
const { NB, MINUS, group, fmt, fmtSigned, short, fmtUsd } = require("../lib/money");
const D = require("../lib/dates");
const { esc } = require("../lib/tg");

const BTN = {
  expense: "➖ Chiqim", income: "➕ Kirim", transfer: "🔁 O‘tkazma",
  home: "🏠 Asosiy", today: "📊 Bugun", month: "🗓 Oy",
  recent: "🧾 Oxirgi", accounts: "💳 Hisoblar", budget: "🎯 Budjet",
  debts: "🤝 Qarzlar", forecast: "🔮 Prognoz", settings: "⚙️ Sozlamalar", app: "📱 Ilova",
};
// tugma yozuvi -> buyruq
const BTN_TO_CMD = Object.fromEntries(Object.entries(BTN).map(([k, v]) => [v, k]));

function mainKeyboard(webAppUrl) {
  const rows = [
    [BTN.expense, BTN.income, BTN.transfer],
    [BTN.home, BTN.today, BTN.month],
    [BTN.recent, BTN.accounts, BTN.budget],
    [BTN.debts, BTN.forecast, BTN.settings],
  ];
  const kb = rows.map((r) => r.map((text) => ({ text })));
  if (webAppUrl) kb.push([{ text: BTN.app, web_app: { url: webAppUrl } }]);
  return { keyboard: kb, resize_keyboard: true, is_persistent: true, input_field_placeholder: "45000 non  ·  +5mln oylik" };
}

const bar = (pct, w = 10) => {
  const f = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  return "▓".repeat(f) + "░".repeat(w - f);
};

const dayHeader = (date, today) =>
  `${D.dayNum(date)}-${D.monthName(date).toUpperCase()} · ${D.weekdayName(date).toUpperCase()}${date === today ? " · BUGUN" : ""}`;

function money(n, currency) {
  return currency === "USD" ? fmtUsd(n) : fmt(n);
}

// Operatsiya qatori (ro'yxatlarda)
function txLine(t, { withAccount = true } = {}) {
  const note = t.note ? ` «${esc(t.note)}»` : "";
  if (t.kind === "transfer")
    return `🔁 ${esc(t.account_name)} → ${esc(t.to_account_name)} · ${group(t.amount)}${NB}so‘m <i>(xarajat emas)</i>`;
  const sign = t.kind === "income" ? "+" : MINUS;
  const acc = withAccount ? ` · ${esc(t.account_name)}` : "";
  return `${t.category_emoji || "•"} ${sign}${group(t.amount)} · ${esc(t.category_name || "")}${acc}${note}`;
}

// Foiz o'zgarishi pilli: yaxshi → 🟢, yomon → 🟡 (qizil ishlatilmaydi), baho berib bo'lmaydi → ⚪
function pill(change, tone) {
  if (change.p === undefined) return change.text;
  const dot = change.p === 0 ? "⚪" : tone === "up_good" ? (change.p > 0 ? "🟢" : "🟡") : tone === "down_good" ? (change.p < 0 ? "🟢" : "🟡") : "⚪";
  return `${dot} ${change.text}`;
}

function saved(tx, { accountBalance, todaySums, currency }) {
  const sign = tx.kind === "income" ? "+" : tx.kind === "expense" ? MINUS : "";
  const cat = tx.category ? ` · ${tx.category.emoji} ${esc(tx.category.name)}` : "";
  const note = tx.note ? `\n«${esc(tx.note)}»` : "";
  let s = `✅ <b>Saqlandi</b>\n<b>${sign}${money(tx.amount, currency)}</b>${cat}\n💳 ${esc(tx.account.name)}${note}`;
  if (accountBalance != null) s += `\nHisob qoldig‘i: ${money(accountBalance, currency)}`;
  if (todaySums) s += `\nBugun: ${MINUS}${group(todaySums.expense)} · +${group(todaySums.income)}`;
  return s;
}

function txKeyboard(id) {
  return { inline_keyboard: [
    [{ text: "↩️ Bekor qilish", callback_data: `undo:${id}` }],
    [{ text: "💳 Hisob", callback_data: `ca:${id}` }, { text: "🏷 Kategoriya", callback_data: `cc:${id}` }],
  ] };
}

function grid(buttons, perRow = 3) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return rows;
}
const categoryKeyboard = (cats, prefix, cancelData = "cancel") => ({
  inline_keyboard: [...grid(cats.map((c) => ({ text: `${c.emoji} ${c.name}`, callback_data: `${prefix}${c.id}` })), 2), [{ text: "✖️ Bekor", callback_data: cancelData }]],
});
const accountKeyboard = (accs, prefix, cancelData = "cancel") => ({
  inline_keyboard: [...grid(accs.map((a) => ({ text: a.name, callback_data: `${prefix}${a.id}` })), 2), [{ text: "✖️ Bekor", callback_data: cancelData }]],
});

function accountsView(accs, totals) {
  const lines = accs.map((a) => {
    const extra = a.currency === "USD" ? ` <i>(≈ ${group(a.balance_uzs)}${NB}so‘m)</i>` : "";
    return `${accIcon(a.type)} <b>${esc(a.name)}</b> — ${money(a.balance, a.currency)}${extra}`;
  });
  return `<b>Hisoblar va hamyonlar</b>\n\n${lines.join("\n") || "Hisob yo‘q"}\n\n` +
    `Jami: <b>${fmt(totals.total)}</b>\nTezkor (naqd + karta): ${fmt(totals.liquid)}`;
}
const accIcon = (t) => ({ cash: "💵", card: "💳", savings: "🐖", currency: "💲", bank: "🏦" }[t] || "💳");

function budgetView(b, today) {
  if (!b.items.length)
    return `<b>Budjet</b>\n\nHali limit belgilanmagan.\nLimit qo‘yish: <code>/limit oziq 2mln</code>`;
  const head = `<b>Budjet · ${D.monthName(today)} ${today.slice(0, 4)}</b>\n` +
    `${fmt(b.spent)} / ${fmt(b.limit)} · ${b.pct}% ishlatildi\n${bar(b.pct)} oyning ${b.month_pct}% i o‘tdi`;
  const rows = b.items.map((x) => {
    const tail = x.left >= 0 ? `${short(x.left)} qoldi` : `${short(-x.left)} oshdi`;
    const proj = x.is_fixed ? "doimiy to‘lov" : `oy oxirida ≈ ${short(x.pace_projection)}`;
    const mark = { over: "🔴", may_exceed: "🟡", attention: "🟡", ok: "🟢" }[x.status];
    return `${mark} ${x.emoji} <b>${esc(x.name)}</b> — ${x.label}\n${bar(Math.min(x.pct, 100))} ${x.pct}% · ${short(x.spent)} / ${short(x.limit)}\n<i>${tail} · ${proj}</i>`;
  });
  return `${head}\n\n${rows.join("\n\n")}\n\n<i>Limit o‘zgartirish: /limit oziq 2mln</i>`;
}

function safeView(s, today) {
  const label = s.mode === "salary" ? "maoshgacha" : "oy oxirigacha";
  const when = s.mode === "salary" ? `${s.days} kun · ${D.fmtDay(s.next_income_date)}` : `${s.days} kun · oy oxiri`;
  let t = `<b>Erkin pul ${label}</b> (${when})\n`;
  if (s.amount < 0) {
    t += `🔴 <b>Maoshgacha ${group(-s.amount)}${NB}so‘m yetishmaydi</b>`;
  } else {
    t += `<b>${fmt(s.amount)}</b>\nKuniga ≈ ${fmt(s.per_day)} ishlatish mumkin`;
  }
  t += `\n<i>Tezkor ${short(s.liquid)} dan majburiy to‘lovlar (${short(s.obligations)}) ayirildi</i>`;
  return t;
}

function forecastView(f, safe, up, today) {
  const low = f.below_threshold
    ? `🔴 Diqqat: ${D.fmtDay(f.min_date)} kuni qoldiq ≈ ${fmt(f.min_balance)} gacha tushib, xavfsiz chegaradan (${short(f.threshold)}) pastga tushadi.`
    : `🟡 Eng past nuqta ${D.fmtDay(f.min_date)} kuni ≈ ${fmt(f.min_balance)}. Pul yetishmasligi kutilmaydi.`;
  const upLines = up.items.map((x) => `• ${D.fmtShort(x.date)} — ${esc(x.name)}: ${fmt(-x.amount)}${x.kind === "debt" ? " · qarz" : ""} <i>(${x.days_left === 0 ? "bugun" : x.days_left + " kundan keyin"})</i>`);
  return `${safeView(safe, today)}\n\n<b>Prognoz · ${D.fmtDay(f.end_date)} gacha</b>\n` +
    `Hozirgi tezkor mablag‘: ${fmt(f.liquid)}\n+ Kutilayotgan tushumlar: ${fmtSigned(f.incoming)}\n${MINUS} Rejalashtirilgan va qarz to‘lovlari: ${group(f.planned)}\n` +
    `${MINUS} Kundalik xarajat, ${short(f.avg_daily)} × ${f.days} kun: ${group(f.daily_total)}\n<b>Kutilayotgan balans: ${fmt(f.end_balance)}</b>\n\n${low}\n` +
    `<i>Ishonchlilik siz kiritgan reja va tushumlarga bog‘liq.</i>` +
    (upLines.length ? `\n\n<b>Yaqin to‘lovlar · 14 kun · ${short(up.total)}</b>\n${upLines.join("\n")}` : "");
}

module.exports = {
  BTN, BTN_TO_CMD, mainKeyboard, bar, dayHeader, money, txLine, pill, saved, txKeyboard, grid,
  categoryKeyboard, accountKeyboard, accountsView, accIcon, budgetView, safeView, forecastView,
};
