// Telegram bot: buyruqlar, tugmalar va tezkor matn kiritish.
// Serverless: suhbat holati bot_state jadvalida, takroriy update'lar processed_updates bilan filtrlanadi.
const db = require("../lib/db");
const tg = require("../lib/tg");
const D = require("../lib/dates");
const { NB, MINUS, group, fmt, fmtSigned, short, parseAmount } = require("../lib/money");
const { ensureUser, norm } = require("../services/users");
const T = require("../services/transactions");
const F = require("../services/finance");
const Debts = require("../services/debts");
const Planned = require("../services/planned");
const MonthPlan = require("../services/monthplan");
const { parseEntry, parseDueDate } = require("./parse");
const V = require("./views");

const { esc } = tg;
const { UserError } = T;

const REMINDER_LABELS = {
  expense_reminder: "Xarajatlarni kiritish eslatmasi", daily_report: "Kunlik kirim-chiqim hisoboti", weekly: "Haftalik xulosa",
  monthly: "Oylik hisobot", debt_due: "Qarz to‘lovlari", mandatory: "Majburiy to‘lovlar", budget: "Budjet limiti",
  low_funds: "Mablag‘ yetishmasligi ehtimoli",
};
const REMINDER_CODES = {
  kiritish: "expense_reminder", kunlik: "daily_report", haftalik: "weekly", oylik: "monthly",
  qarz: "debt_due", majburiy: "mandatory", budjet: "budget", mablag: "low_funds",
};

const webAppUrl = () => (process.env.WEBAPP_ENABLED === "1" && process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : null);

// ── Suhbat holati ──────────────────────────────────────────────────────
const getState = async (tgId) => (await db.query("select state, data from bot_state where tg_id=$1", [tgId])).rows[0] || null;
const setState = (tgId, state, data = {}) =>
  db.query(
    `insert into bot_state (tg_id, state, data, updated_at) values ($1,$2,$3,now())
     on conflict (tg_id) do update set state=$2, data=$3, updated_at=now()`, [tgId, state, JSON.stringify(data)]);
const clearState = (tgId) => db.query("delete from bot_state where tg_id=$1", [tgId]);

// Holat 30 daqiqadan eski bo'lsa — eskirgan hisoblanadi
const STATE_TTL_MIN = 30;
async function freshState(tgId) {
  const s = await getState(tgId);
  if (!s) return null;
  const old = (await db.query("select updated_at < now() - ($2 || ' minutes')::interval as old from bot_state where tg_id=$1", [tgId, STATE_TTL_MIN])).rows[0].old;
  if (old) { await clearState(tgId); return null; }
  return s;
}

const cancelKb = { inline_keyboard: [[{ text: "✖️ Bekor", callback_data: "cancel" }]] };

// ── Yordamchilar ───────────────────────────────────────────────────────
async function uzsAccounts(user) {
  return (await F.accounts(user)).filter((a) => a.currency === "UZS");
}
async function defaultAccount(user) {
  const accs = await uzsAccounts(user);
  if (!accs.length) throw new UserError("Avval hisob qo‘shing: /hisob Naqd naqd 500000");
  return accs.find((a) => a.id === user.last_account_id) || accs.find((a) => a.is_liquid) || accs[0];
}
const toMinor = (currency, n) => (currency === "USD" ? n * 100 : n);

async function reply(ctx, text, markup) {
  return tg.send(ctx.chatId, text, markup);
}

// ── Operatsiya saqlash va tasdiq xabari ────────────────────────────────
async function savedText(ctx, tx) {
  const accs = await F.accounts(ctx.user);
  const acc = accs.find((a) => a.id === tx.account_id);
  const today = await F.periodStats(ctx.user.id, ctx.user.tz, ctx.today, ctx.today);
  const cat = tx.category || (tx.category_id ? await T.getCategory(ctx.user.id, tx.category_id) : null);
  return V.saved({ ...tx, category: cat, account: acc || tx.account }, { accountBalance: acc?.balance, todaySums: today, currency: acc?.currency });
}

async function saveEntry(ctx, draft, categoryId, idemKey, editMessageId) {
  const acc = await defaultAccount(ctx.user);
  const tx = await T.createTx(ctx.user.id, {
    kind: draft.kind, amount: draft.amount, accountId: acc.id, categoryId, note: draft.note, daysAgo: draft.daysAgo || 0, idemKey,
  });
  if (!tx.created) return tx; // takroriy update — qayta xabar yubormaymiz
  await clearState(ctx.tgId);
  const text = await savedText(ctx, tx);
  if (editMessageId) await tg.edit(ctx.chatId, editMessageId, text, V.txKeyboard(tx.id));
  else await reply(ctx, text, V.txKeyboard(tx.id));
  if (tx.kind === "expense") await budgetAlert(ctx, tx);
  return tx;
}

// Limitning 80% yoki 100% iga yetganda darhol xabar
async function budgetAlert(ctx, tx) {
  try {
    const r = (await db.query("select enabled from reminders where user_id=$1 and kind='budget'", [ctx.user.id])).rows[0];
    if (r && !r.enabled) return;
    const localDay = (await db.query("select (($2::timestamptz) at time zone $1)::date::text d", [ctx.user.tz, tx.occurred_at])).rows[0].d;
    if (D.ym(localDay) !== D.ym(ctx.today)) return;
    const b = await F.budget(ctx.user, ctx.today);
    const it = b.items.find((x) => x.category_id === tx.category_id);
    if (!it) return;
    const before = it.spent - tx.amount;
    if (it.spent > it.limit && before <= it.limit)
      await reply(ctx, `🔴 <b>Limitdan oshdi: ${esc(it.name)}</b>\n${fmt(it.spent)} / ${fmt(it.limit)} (${it.pct}%)`);
    else if (it.pct >= 80 && (before / it.limit) * 100 < 80)
      await reply(ctx, `🟡 <b>Diqqat: ${esc(it.name)}</b> limitning ${it.pct}% iga yetdi\n${fmt(it.spent)} / ${fmt(it.limit)} · ${fmt(it.left)} qoldi`);
  } catch (e) {
    console.error("budgetAlert:", e.message);
  }
}

async function processEntry(ctx, entry, forcedKind) {
  let kind = forcedKind || entry.kind;
  let cat = null;
  if (kind) cat = await T.guessCategory(ctx.user.id, kind, entry.note);
  else {
    cat = await T.guessCategory(ctx.user.id, "expense", entry.note);
    kind = "expense";
    if (!cat) {
      const ic = await T.guessCategory(ctx.user.id, "income", entry.note);
      if (ic) { kind = "income"; cat = ic; }
    }
  }
  const draft = { kind, amount: entry.amount, note: entry.note, daysAgo: entry.daysAgo };
  if (cat) return saveEntry(ctx, draft, cat.id, ctx.idemKey);
  const cats = await T.listCategories(ctx.user.id, kind);
  await setState(ctx.tgId, "pick_cat", { draft });
  const sign = kind === "income" ? "+" : MINUS;
  return reply(ctx, `<b>${sign}${group(entry.amount)}${NB}so‘m</b>${entry.note ? ` «${esc(entry.note)}»` : ""}\nKategoriyani tanlang:`, V.categoryKeyboard(cats, "c:"));
}

// ── Buyruqlar ──────────────────────────────────────────────────────────
const cmd = {};

cmd.start = async (ctx) => {
  await clearState(ctx.tgId);
  const name = esc(ctx.user.first_name || "");
  const intro = ctx.isNew
    ? `👋 Salom, <b>${name}</b>! <b>Hamyon</b> — shaxsiy moliyangiz bir joyda.\n\nMen sizga <b>Naqd</b> va <b>Uzcard</b> hisoblarini ochib qo‘ydim.\n`
    : `👋 Qaytganingiz bilan, <b>${name}</b>!\n`;
  await reply(ctx, intro + helpText(), V.mainKeyboard(webAppUrl()));
  if (ctx.isNew)
    await reply(ctx, "Boshlash uchun hisobdagi hozirgi qoldiqni kiriting:\n<code>/qoldiq Naqd 500000</code>\n<code>/qoldiq Uzcard 3.5mln</code>");
};

function helpText() {
  return (
    `<b>Tez kiritish</b> — shunchaki yozing:\n` +
    `<code>45000 non</code> → chiqim\n<code>45k korzinka kecha</code> → kechagi chiqim\n<code>+5mln oylik</code> → kirim\n\n` +
    `<b>Tugmalar:</b> ➖ Chiqim · ➕ Kirim · 🔁 O‘tkazma · 🏠 Asosiy · 📊 Bugun · 🗓 Oy\n\n` +
    `<b>Buyruqlar</b>\n` +
    `/bugun /oy /oxirgi /hisoblar /budjet /qarz /prognoz\n` +
    `/bekor — oxirgi operatsiyani bekor qilish\n` +
    `/limit <i>oziq 2mln</i> — kategoriya limiti\n` +
    `/hisob <i>Nomi tur summa</i> — yangi hisob (tur: naqd, karta, jamgarma, valyuta, bank)\n` +
    `/qoldiq <i>Naqd 500000</i> — hisobdagi hozirgi qoldiq\n` +
    `/maosh <i>8mln 5</i> — oylik tushum (har oyning 5-kuni)\n` +
    `/majburiy <i>1.2mln 10 Ijara</i> — oylik majburiy to‘lov\n` +
    `/qarzolish <i>Akmal 2mln 10.11</i> · /qarzberish <i>Akmal 1mln</i>\n` +
    `/keyingi — keyingi oy rejasi · /muhim <i>1.2mln Ijara</i> · /maqsad <i>1mln Safar</i>\n` +
    `/reja — rejali tushum va to‘lovlar · /eslatma · /kurs · /chegara`
  );
}
cmd.help = (ctx) => reply(ctx, helpText(), V.mainKeyboard(webAppUrl()));

async function amountPrompt(ctx, kind) {
  await setState(ctx.tgId, "amount", { kind });
  const title = kind === "income" ? "➕ <b>Kirim</b>" : "➖ <b>Chiqim</b>";
  return reply(ctx, `${title}\nSummani yozing, izoh bilan ham bo‘ladi:\n<code>45000</code> · <code>45k korzinka</code> · <code>1.5mln ijara</code>`, cancelKb);
}
cmd.expense = (ctx) => amountPrompt(ctx, "expense");
cmd.income = (ctx) => amountPrompt(ctx, "income");

cmd.transfer = async (ctx) => {
  const accs = await F.accounts(ctx.user);
  if (accs.length < 2) return reply(ctx, "O‘tkazma uchun kamida 2 ta hisob kerak: /hisob");
  await clearState(ctx.tgId);
  return reply(ctx, "🔁 <b>O‘tkazma</b>\nQaysi hisobdan?", V.accountKeyboard(accs, "trf:"));
};

cmd.today = async (ctx) => {
  const rows = await T.onDate(ctx.user.id, ctx.user.tz, ctx.today, 10);
  const s = await F.periodStats(ctx.user.id, ctx.user.tz, ctx.today, ctx.today);
  const lines = rows.map((t) => V.txLine(t));
  return reply(ctx,
    `<b>${V.dayHeader(ctx.today, ctx.today)}</b>\nChiqim <b>${MINUS}${group(s.expense)}</b> · Kirim <b>+${group(s.income)}</b>\n\n` +
    (lines.length ? lines.join("\n") : "Bugun hali operatsiya kiritilmagan") +
    `\n\n<i>Oxirgi operatsiyalarni tahrirlash: /oxirgi</i>`);
};

cmd.recent = async (ctx) => {
  const rows = await T.recent(ctx.user.id, 8);
  if (!rows.length) return reply(ctx, "Hali operatsiya yo‘q. Yozing: <code>45000 non</code>");
  const lines = rows.map((t, i) => `${i + 1}. ${V.txLine(t)} <i>· ${D.fmtShort(D.localDate(ctx.user.tz, new Date(t.occurred_at)))}</i>`);
  const kb = { inline_keyboard: V.grid(rows.map((t, i) => ({ text: `🗑 ${i + 1}`, callback_data: `ask:${t.id}` })), 4) };
  return reply(ctx, `<b>Oxirgi operatsiyalar</b>\n\n${lines.join("\n")}\n\n<i>O‘chirish uchun raqamni bosing</i>`, kb);
};

cmd.bekor = async (ctx) => {
  const last = (await T.recent(ctx.user.id, 1))[0];
  if (!last) return reply(ctx, "Bekor qilinadigan operatsiya yo‘q");
  await T.deleteTx(ctx.user.id, last.id);
  return reply(ctx, `↩️ Bekor qilindi:\n${V.txLine(last)}`);
};

cmd.month = async (ctx) => {
  const from = D.monthStart(ctx.today);
  const prevFrom = D.monthStart(D.addMonths(ctx.today, -1));
  const prevTo = D.addDays(prevFrom, D.dayNum(ctx.today) - 1);
  const [cur, prev, names, bud] = await Promise.all([
    F.periodStats(ctx.user.id, ctx.user.tz, from, ctx.today),
    F.periodStats(ctx.user.id, ctx.user.tz, prevFrom, prevTo > D.monthEnd(prevFrom) ? D.monthEnd(prevFrom) : prevTo),
    F.categoryNames(ctx.user.id),
    F.budget(ctx.user, ctx.today),
  ]);
  const incP = V.pill(F.pctChange(cur.income, prev.income), "up_good");
  const expTone = bud.limit && bud.pct > bud.month_pct + 10 ? "down_good" : "neutral";
  const expP = V.pill(F.pctChange(cur.expense, prev.expense), expTone);
  const top = cur.byCategory.expense.slice(0, 5).map((c) => {
    const n = names[c.category_id];
    const pct = cur.expense ? Math.round((c.amount / cur.expense) * 100) : 0;
    return `${n?.emoji || "•"} ${esc(n?.name || "Kategoriyasiz")} — ${short(c.amount)} (${pct}%)`;
  });
  const net = cur.income - cur.expense;
  return reply(ctx,
    `<b>${D.monthName(ctx.today)[0].toUpperCase() + D.monthName(ctx.today).slice(1)} ${ctx.today.slice(0, 4)}</b> · ${D.dayNum(ctx.today)}-kun\n` +
    `Daromad: <b>+${group(cur.income)}</b>  ${incP} <i>o‘tgan oyning shu kuniga</i>\n` +
    `Xarajat: <b>${MINUS}${group(cur.expense)}</b>  ${expP}\n` +
    `Sof pul oqimi: <b>${fmtSigned(net)}</b> ${net >= 0 ? "🟢" : "🟡"}` +
    (top.length ? `\n\n<b>Qayerga ketdi</b>\n${top.join("\n")}` : "\n\nBu oy hali xarajat yo‘q") +
    (bud.limit ? `\n\n🎯 Budjet: ${bud.pct}% ishlatildi, oyning ${bud.month_pct}% i o‘tdi → /budjet` : ""));
};

cmd.accounts = async (ctx) => {
  const accs = await F.accounts(ctx.user);
  const totals = await F.totals(ctx.user, accs);
  return reply(ctx, V.accountsView(accs, totals) +
    `\n\n<i>Yangi hisob: /hisob Nomi karta 1mln\nQoldiqni to‘g‘rilash: /qoldiq Naqd 500000</i>`);
};

cmd.budget = async (ctx) => reply(ctx, V.budgetView(await F.budget(ctx.user, ctx.today), ctx.today));

cmd.home = async (ctx) => {
  const d = await F.dashboard(ctx.user);
  const weekday = D.weekdayName(d.today_date);
  const eom = D.diffDays(D.monthEnd(d.today_date), d.today_date);
  const t = d.totals;
  const incP = V.pill(F.pctChange(d.month_stats.income, d.month_stats.prev.income), "up_good");
  const lines = [
    `<b>Asosiy · ${weekday[0].toUpperCase() + weekday.slice(1)}, ${D.fmtDay(d.today_date)}</b> · oy tugashiga ${eom} kun`,
    "",
    V.safeView(d.safe_to_spend, d.today_date),
    "",
    `Jami pul: <b>${fmt(t.total)}</b>`,
    `Sof holat: ${fmt(t.net_worth)} <i>(aktiv − majburiyat)</i>`,
    `Qarzim: ${fmt(t.payables)}${t.receivables ? ` · +${short(t.receivables)} olinadi` : ""}`,
    "",
    `<b>Bugun:</b> ${MINUS}${group(d.today.expense)} · +${group(d.today.income)}`,
    `<b>Oy natijasi:</b> daromad +${short(d.month_stats.income)} ${incP}, xarajat ${MINUS}${short(d.month_stats.expense)}, sof ${fmtSigned(d.month_stats.net_flow)}`,
  ];
  if (d.budget.limit) lines.push(`<b>Budjet:</b> ${d.budget.pct}% ishlatildi (oyning ${d.budget.month_pct}% i o‘tdi)`);
  const tight = d.budget_top.filter((x) => x.status !== "ok").slice(0, 3);
  for (const x of tight) lines.push(`  ${{ over: "🔴", may_exceed: "🟡", attention: "🟡" }[x.status]} ${x.emoji} ${esc(x.name)} — ${x.label} (${x.pct}%)`);
  if (d.debts_summary.overdue.length)
    lines.push("", "⚠️ " + d.debts_summary.overdue.map((o) => `${esc(o.who)}: ${o.days_late} kun kechikdi`).join(", "));
  if (d.forecast.below_threshold)
    lines.push("", `🔴 ${D.fmtDay(d.forecast.min_date)} kuni qoldiq xavfsiz chegaradan pastga tushishi mumkin → /prognoz`);
  const np = d.next_month_plan;
  lines.push("", `📅 <b>${D.monthName(np.month_start)[0].toUpperCase() + D.monthName(np.month_start).slice(1)} rejasi</b>`);
  if (np.count) lines.push(`Tushum +${short(np.income)} · majburiy ${MINUS}${short(np.mandatory)} · ajratilgan ${MINUS}${short(np.spend + np.save)}`, `<b>Ajratilmagan: ${np.free < 0 ? MINUS : ""}${short(Math.abs(np.free))}</b> ${np.free >= 0 ? "🟢" : "🔴"}`);
  else lines.push("Keyingi oyda nimalarga pul ajratmoqchisiz? Muhim xarajat va maqsadlarni kiriting.");
  return reply(ctx, lines.join("\n"), { inline_keyboard: [[{ text: "📅 Keyingi oy rejasi", callback_data: "mp:v" }, { text: "➕ Muhim xarajat", callback_data: "mp+:spend" }]] });
};

cmd.forecast = async (ctx) => {
  const accs = await F.accounts(ctx.user);
  const t = await F.totals(ctx.user, accs);
  const [safe, fc, up] = await Promise.all([F.safeToSpend(ctx.user, ctx.today, t.liquid), F.forecast(ctx.user, ctx.today, t.liquid), F.upcoming(ctx.user, ctx.today)]);
  const hasSalary = (await Planned.list(ctx.user.id)).some((p) => p.is_salary);
  return reply(ctx, V.forecastView(fc, safe, up, ctx.today) +
    (hasSalary ? "" : `\n\n<i>Maosh sanasi kiritilmagan, shuning uchun oy oxirigacha hisoblandi. Kiriting: /maosh 8mln 5</i>`) + `\n<i>Rejalarni boshqarish: /reja</i>`);
};

cmd.reja = async (ctx) => {
  const list = await Planned.list(ctx.user.id);
  if (!list.length)
    return reply(ctx, "<b>Reja</b>\n\nHali rejali operatsiya yo‘q.\n<code>/maosh 8mln 5</code> — har oyning 5-kuni tushum\n<code>/majburiy 1.2mln 10 Ijara</code> — har oyning 10-kuni to‘lov");
  const recName = { none: "bir marta", daily: "har kuni", weekly: "har hafta", monthly: "har oy", yearly: "har yil" };
  const lines = list.map((p) => `${p.kind === "income" ? "🟢 +" : "🔴 " + MINUS}${group(p.amount)} · ${esc(p.name)} · ${D.dayNum(p.start_date)}-kun, ${recName[p.recurrence]}` +
    (p.kind === "income" ? (p.include_in_forecast ? " · prognozda ✅" : " · prognozda ⬜") : ""));
  const kb = { inline_keyboard: [
    ...list.filter((p) => p.kind === "income").map((p) => [{ text: `${p.include_in_forecast ? "✅" : "⬜"} ${p.name}: prognozga ${p.include_in_forecast ? "kiritilgan" : "kiritilmagan"}`, callback_data: `pl:${p.id}` }]),
    ...list.map((p) => [{ text: `🗑 ${p.name}`, callback_data: `plx:${p.id}` }]),
  ] };
  return reply(ctx, `<b>Reja</b>\n\n${lines.join("\n")}\n\n<i>Kutilayotgan tushum mavjud pulga qo‘shilmaydi, faqat prognozga ta’sir qiladi.</i>`, kb);
};

async function showMonthPlan(ctx, editMsgId) {
  const p = await MonthPlan.get(ctx.user, ctx.today);
  const v = V.monthPlanView(p);
  return editMsgId ? tg.edit(ctx.chatId, editMsgId, v.text, v.kb) : reply(ctx, v.text, v.kb);
}
cmd.next = (ctx) => showMonthPlan(ctx);

async function addPlanItem(ctx, kind, text) {
  const e = parseEntry(text);
  if (!e || !e.note) return reply(ctx, "Summa va nomini yozing: <code>1.2mln Ijara</code>", cancelKb);
  let category_id = null;
  if (kind === "spend") category_id = (await T.guessCategory(ctx.user.id, "expense", e.note))?.id || null;
  const it = await MonthPlan.add(ctx.user, ctx.today, { title: e.note, amount: e.amount, kind, category_id });
  await clearState(ctx.tgId);
  await reply(ctx, `✅ Rejaga qo‘shildi: <b>${esc(it.title)}</b> — ${fmt(it.amount)}`);
  return showMonthPlan(ctx);
}
cmd.muhim = async (ctx, args) => (args ? addPlanItem(ctx, "spend", args) : (await setState(ctx.tgId, "mp_item", { kind: "spend" }), reply(ctx, "🔴 <b>Muhim xarajat</b> (keyingi oy)\nSumma va nomini yozing: <code>1.2mln Ijara</code>", cancelKb)));
cmd.maqsad = async (ctx, args) => (args ? addPlanItem(ctx, "save", args) : (await setState(ctx.tgId, "mp_item", { kind: "save" }), reply(ctx, "🐖 <b>Jamg‘arma / maqsad</b> (keyingi oy)\nSumma va nomini yozing: <code>1mln Safar uchun</code>", cancelKb)));

cmd.maosh = async (ctx, args) => {
  const [a, day] = args.split(/\s+/);
  const amount = parseAmount(a);
  const d = parseInt(day, 10);
  if (!amount || !(d >= 1 && d <= 31)) return reply(ctx, "Format: <code>/maosh 8mln 5</code> (summa va oyning qaysi kuni)");
  await db.query("update planned_transactions set active=false where user_id=$1 and is_salary", [ctx.user.id]);
  await Planned.add(ctx.user, { kind: "income", name: "Maosh", amount, startDate: D.withDay(ctx.today, d), recurrence: "monthly", isSalary: true });
  return reply(ctx, `✅ Maosh: <b>${fmt(amount)}</b>, har oyning ${d}-kuni. Prognozga kiritildi.\n/prognoz`);
};

cmd.majburiy = async (ctx, args) => {
  const m = args.match(/^(\S+(?:\s+\d+)?)\s+(\d{1,2})\s+(.+)$/) || args.match(/^(\S+)\s+(\d{1,2})\s+(.+)$/);
  const amount = m && parseAmount(m[1]);
  const day = m && parseInt(m[2], 10);
  if (!amount || !(day >= 1 && day <= 31)) return reply(ctx, "Format: <code>/majburiy 1.2mln 10 Ijara</code> (summa, oyning kuni, nomi)");
  await Planned.add(ctx.user, { kind: "expense", name: m[3], amount, startDate: D.withDay(ctx.today, day), recurrence: "monthly" });
  return reply(ctx, `✅ Majburiy to‘lov: <b>${esc(m[3])}</b> ${fmt(amount)}, har oyning ${day}-kuni.`);
};

cmd.limit = async (ctx, args) => {
  const m = args.match(/^(.+?)\s+(\S+)$/);
  if (!m) return reply(ctx, "Format: <code>/limit oziq 2mln</code>\nOlib tashlash: <code>/limit oziq ochir</code>");
  const q = norm(m[1]);
  const cats = await T.listCategories(ctx.user.id, "expense");
  const cat = cats.find((c) => norm(c.name) === q) || cats.find((c) => norm(c.name).startsWith(q)) || cats.find((c) => norm(c.name).includes(q));
  if (!cat) return reply(ctx, `Kategoriya topilmadi. Mavjud: ${cats.map((c) => esc(c.name)).join(", ")}`);
  if (/^(ochir|o'chir|o‘chir|olib|0)$/.test(norm(m[2])) && norm(m[2]) !== "0") {
    await db.query("delete from budget_limits where user_id=$1 and category_id=$2", [ctx.user.id, cat.id]);
    return reply(ctx, `Limit olib tashlandi: ${cat.emoji} ${esc(cat.name)}`);
  }
  const amount = parseAmount(m[2]);
  if (!amount) return reply(ctx, "Limit 0 dan katta bo‘lishi kerak");
  await db.query(
    `insert into budget_limits (user_id, category_id, limit_amount) values ($1,$2,$3)
     on conflict (user_id, category_id) do update set limit_amount=$3`, [ctx.user.id, cat.id, amount]);
  return reply(ctx, `✅ Limit yangilandi: ${cat.emoji} <b>${esc(cat.name)}</b> — ${fmt(amount)}\n/budjet`);
};

const TYPE_WORDS = { naqd: "cash", karta: "card", jamgarma: "savings", "jamg'arma": "savings", "jamg‘arma": "savings", valyuta: "currency", bank: "bank" };
cmd.hisob = async (ctx, args) => {
  const tokens = args.split(/\s+/).filter(Boolean);
  const help = "Format: <code>/hisob Nomi tur summa</code>\nTur: naqd, karta, jamgarma, valyuta, bank\nMasalan: <code>/hisob Humo karta 1.2mln</code>, <code>/hisob USD valyuta 420</code>";
  if (tokens.length < 3) return reply(ctx, help);
  const amount = parseAmount(tokens[tokens.length - 1]);
  const type = TYPE_WORDS[norm(tokens[tokens.length - 2])];
  const name = tokens.slice(0, -2).join(" ");
  if (amount == null || !type || !name) return reply(ctx, help);
  const currency = type === "currency" ? "USD" : "UZS";
  try {
    await db.query(
      `insert into accounts (user_id, name, short_name, type, currency, initial_balance, is_liquid, sort)
       values ($1,$2,$2,$3,$4,$5,$6, (select coalesce(max(sort),0)+1 from accounts where user_id=$1))`,
      [ctx.user.id, name.slice(0, 40), type, currency, toMinor(currency, amount), type === "cash" || type === "card"]);
  } catch (e) {
    if (e.code === "23505") return reply(ctx, "Bunday nomli hisob allaqachon bor");
    throw e;
  }
  return reply(ctx, `✅ Hisob qo‘shildi: <b>${esc(name)}</b>${currency === "USD" ? " (USD; kursni /kurs bilan belgilang)" : ""}`);
};

cmd.qoldiq = async (ctx, args) => {
  const m = args.match(/^(.+?)\s+(\S+)$/);
  const amount = m && (m[2] === "0" ? 0 : parseAmount(m[2]));
  if (!m || amount == null) return reply(ctx, "Format: <code>/qoldiq Naqd 500000</code>");
  const accs = await F.accounts(ctx.user);
  const q = norm(m[1]);
  const acc = accs.find((a) => norm(a.name) === q) || accs.find((a) => norm(a.name).startsWith(q));
  if (!acc) return reply(ctx, `Hisob topilmadi. Mavjud: ${accs.map((a) => esc(a.name)).join(", ")}`);
  const target = toMinor(acc.currency, amount);
  await db.query("update accounts set initial_balance = initial_balance + ($3::bigint - $4::bigint) where id=$1 and user_id=$2", [acc.id, ctx.user.id, target, acc.balance]);
  return reply(ctx, `✅ ${esc(acc.name)} qoldig‘i: <b>${V.money(target, acc.currency)}</b>`);
};

cmd.kurs = async (ctx, args) => {
  const v = parseAmount(args);
  if (!v) return reply(ctx, `1 USD kursi hozir: ${group(ctx.user.usd_rate)}${NB}so‘m\nO‘zgartirish: <code>/kurs 12650</code>`);
  await db.query("update users set usd_rate=$2 where id=$1", [ctx.user.id, v]);
  return reply(ctx, `✅ Kurs: 1 USD = ${fmt(v)}`);
};

cmd.chegara = async (ctx, args) => {
  const v = parseAmount(args);
  if (!v) return reply(ctx, `Xavfsiz chegara hozir: ${fmt(ctx.user.safe_threshold)}\nO‘zgartirish: <code>/chegara 1mln</code>`);
  await db.query("update users set safe_threshold=$2 where id=$1", [ctx.user.id, v]);
  return reply(ctx, `✅ Xavfsiz chegara: ${fmt(v)}`);
};

async function remindersView(ctx) {
  const rows = (await db.query("select * from reminders where user_id=$1", [ctx.user.id])).rows;
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  const lines = Object.keys(REMINDER_LABELS).map((k) => `${by[k]?.enabled ? "🔔" : "🔕"} ${REMINDER_LABELS[k]}${by[k]?.at_time ? ` — ${by[k].at_time}` : ""}`);
  const kb = { inline_keyboard: Object.keys(REMINDER_LABELS).map((k) => [{ text: `${by[k]?.enabled ? "✅" : "⬜"} ${REMINDER_LABELS[k]}`, callback_data: `rm:${k}` }]) };
  return { text: `<b>Eslatmalar</b> · vaqt zonasi ${esc(ctx.user.tz)}\n\n${lines.join("\n")}\n\n<i>Vaqtni o‘zgartirish: /eslatma kiritish 21:30\nKodlar: ${Object.keys(REMINDER_CODES).join(", ")}</i>`, kb };
}
cmd.eslatma = async (ctx, args) => {
  const m = args.match(/^(\S+)\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const kind = REMINDER_CODES[norm(m[1])];
    const h = +m[2], mi = +m[3];
    if (!kind || h > 23 || mi > 59) return reply(ctx, `Format: <code>/eslatma kiritish 21:30</code>\nKodlar: ${Object.keys(REMINDER_CODES).join(", ")}`);
    await db.query("update reminders set at_time=$3 where user_id=$1 and kind=$2 and at_time is not null", [ctx.user.id, kind, `${String(h).padStart(2, "0")}:${m[3]}`]);
  }
  const v = await remindersView(ctx);
  return reply(ctx, v.text, v.kb);
};

cmd.settings = async (ctx) => {
  const rem = (await db.query("select count(*)::int n from reminders where user_id=$1 and enabled", [ctx.user.id])).rows[0].n;
  return reply(ctx,
    `<b>Sozlamalar</b>\n\nAsosiy valyuta: UZS\nVaqt zonasi: ${esc(ctx.user.tz)}\nXavfsiz chegara: ${fmt(ctx.user.safe_threshold)} → /chegara\n` +
    `USD kursi: ${group(ctx.user.usd_rate)}${NB}so‘m → /kurs\nEslatmalar: ${rem} ta yoqilgan → /eslatma\nHisoblar → /hisoblar · Kategoriyalar limiti → /budjet`);
};

cmd.app = async (ctx) => {
  const url = webAppUrl();
  if (!url) return reply(ctx, "📱 Mini App tez orada. Hozircha hamma narsa botning o‘zida: /yordam");
  return reply(ctx, "Hamyon ilovasini oching:", { inline_keyboard: [[{ text: "📱 Hamyonni ochish", web_app: { url } }]] });
};

// ── Qarzlar ────────────────────────────────────────────────────────────
cmd.debts = async (ctx) => {
  const ds = await Debts.listOpen(ctx.user);
  const line = (d) => {
    const due = d.due_date ? ` · muddat ${D.fmtDay(d.due_date)}${d.due_date < ctx.today ? ` ⚠️ ${D.diffDays(ctx.today, d.due_date)} kun kechikdi` : ` (${D.diffDays(d.due_date, ctx.today)} kun qoldi)`}` : "";
    const pct = Math.round((d.paid / d.principal) * 100);
    return `<b>${esc(d.who)}</b> — ${fmt(d.remaining)}\n${V.bar(pct)} ${pct}%${due}`;
  };
  const pay = ds.filter((d) => d.direction === "payable"), rec = ds.filter((d) => d.direction === "receivable");
  if (!ds.length) return reply(ctx, "<b>Qarzlar</b>\n\nQarzlar yo‘q.\n<code>/qarzolish Akmal 2mln 10.11</code> — men qarz oldim\n<code>/qarzberish Akmal 1mln</code> — men qarz berdim");
  const sum = (a) => a.reduce((s, d) => s + d.remaining, 0);
  const parts = [`<b>Qarzlar</b>`];
  if (pay.length) parts.push(`\n<b>To‘lanadigan · ${fmt(sum(pay))}</b>\n` + pay.map(line).join("\n\n"));
  if (rec.length) parts.push(`\n<b>Olinadigan · ${fmt(sum(rec))}</b>\n` + rec.map(line).join("\n\n"));
  const kb = { inline_keyboard: ds.map((d) => [{ text: d.direction === "payable" ? `💸 To‘lov: ${d.who}` : `📥 Qaytdi: ${d.who}`, callback_data: `dpay:${d.id}` }]) };
  return reply(ctx, parts.join("\n"), kb);
};

async function newDebt(ctx, args, direction) {
  const tokens = args.split(/\s+/).filter(Boolean);
  let due = null;
  const rest = tokens.filter((t) => { const d = parseDueDate(t, ctx.today); if (d) { due = d; return false; } return true; });
  const e = parseEntry(rest.join(" "));
  const usage = direction === "payable" ? "/qarzolish Akmal 2mln 10.11" : "/qarzberish Akmal 1mln";
  if (!e || !e.note) return reply(ctx, `Format: <code>${usage}</code> (kim, summa, ixtiyoriy muddat KK.OO)`);
  const acc = await defaultAccount(ctx.user);
  const d = await Debts.createDebt(ctx.user, { direction, who: e.note, amount: e.amount, accountId: acc.id, dueDate: due });
  return reply(ctx, `✅ ${direction === "payable" ? "Qarz olindi" : "Qarz berildi"}: <b>${esc(d.who)}</b> ${fmt(d.principal)}\n💳 ${esc(acc.name)} qoldig‘i yangilandi (daromad/xarajat emas)${due ? `\nMuddat: ${D.fmtDay(due)}` : ""}\n/qarz`);
}
cmd.qarzolish = (ctx, args) => newDebt(ctx, args, "payable");
cmd.qarzberish = (ctx, args) => newDebt(ctx, args, "receivable");

async function finishDebtPay(ctx, debtId, amount) {
  const acc = await defaultAccount(ctx.user);
  const r = await Debts.payDebt(ctx.user, debtId, amount, acc.id);
  await clearState(ctx.tgId);
  return reply(ctx, r.closed ? `✅ <b>Qarz to‘liq yopildi:</b> ${esc(r.debt.who)} 🎉` : `✅ Saqlandi, qolgan <b>${fmt(r.left)}</b> (${esc(r.debt.who)})`);
}

// ── Holatga bog'liq matn kiritish ──────────────────────────────────────
async function handleStateText(ctx, st, text) {
  if (st.state === "amount") {
    const e = parseEntry(text);
    if (!e) return reply(ctx, "Summani tushunmadim. Masalan: <code>45000</code>, <code>45k korzinka</code>, <code>1.5mln</code>", cancelKb);
    return processEntry(ctx, e, st.data.kind);
  }
  if (st.state === "tr_amount" || st.state === "tr_to_amount") {
    const a = parseAmount(text);
    if (!a) return reply(ctx, "Summani tushunmadim. Masalan: <code>500000</code> yoki <code>500k</code>", cancelKb);
    const accs = await F.accounts(ctx.user);
    const from = accs.find((x) => x.id === st.data.from), to = accs.find((x) => x.id === st.data.to);
    if (!from || !to) { await clearState(ctx.tgId); return reply(ctx, "Hisob topilmadi, qayta urinib ko‘ring: /otkazma"); }
    if (from.currency !== to.currency && st.state === "tr_amount") {
      await setState(ctx.tgId, "tr_to_amount", { ...st.data, amount: toMinor(from.currency, a) });
      return reply(ctx, `${esc(to.name)} ga qabul qilinadigan summani yozing (${to.currency === "USD" ? "dollarda" : "so‘mda"}):`, cancelKb);
    }
    const amount = st.state === "tr_to_amount" ? st.data.amount : toMinor(from.currency, a);
    const toAmount = st.state === "tr_to_amount" ? toMinor(to.currency, a) : undefined;
    const tx = await T.createTx(ctx.user.id, { kind: "transfer", amount, accountId: from.id, toAccountId: to.id, toAmount, idemKey: ctx.idemKey });
    if (!tx.created) return;
    await clearState(ctx.tgId);
    const saveNote = to.type === "savings" ? "\n🐖 Jamg‘armaga qo‘shildi" : "";
    return reply(ctx,
      `✅ <b>O‘tkazma saqlandi</b>\n${esc(from.name)} → ${esc(to.name)}: <b>${V.money(amount, from.currency)}</b>${toAmount ? ` → ${V.money(toAmount, to.currency)}` : ""}\n<i>Daromad yoki xarajat hisoblanmaydi.</i>${saveNote}`,
      { inline_keyboard: [[{ text: "↩️ Bekor qilish", callback_data: `undo:${tx.id}` }]] });
  }
  if (st.state === "mp_item") return addPlanItem(ctx, st.data.kind, text);
  if (st.state === "debt_pay") {
    const ds = await Debts.listOpen(ctx.user);
    const d = ds.find((x) => x.id === st.data.debtId);
    if (!d) { await clearState(ctx.tgId); return reply(ctx, "Qarz topilmadi yoki yopilgan"); }
    const a = /^(to'?liq|to‘liq|toliq|hammasi)$/.test(norm(text)) ? d.remaining : parseAmount(text);
    if (!a) return reply(ctx, "Summani kiriting", cancelKb);
    return finishDebtPay(ctx, d.id, a);
  }
  await clearState(ctx.tgId);
  return null;
}

// ── Callback'lar ───────────────────────────────────────────────────────
async function onCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;
  const { user } = await ensureUser(cb.from, chatId);
  const ctx = { user, chatId, tgId: cb.from.id, today: D.localDate(user.tz), idemKey: `cb:${cb.id}` };
  const [a, p1, p2] = String(cb.data || "").split(":");
  const ack = (text) => tg.answer(cb.id, text);
  try {
    switch (a) {
      case "cancel":
        await clearState(ctx.tgId);
        await tg.edit(chatId, msgId, "Bekor qilindi");
        return ack();
      case "c": { // kategoriya tanlandi (qoralama)
        const st = await freshState(ctx.tgId);
        if (st?.state !== "pick_cat") { await tg.edit(chatId, msgId, "Eskirgan so‘rov. Qaytadan kiriting."); return ack(); }
        await saveEntry(ctx, st.data.draft, Number(p1), ctx.idemKey, msgId);
        return ack("Saqlandi");
      }
      case "undo": {
        const t = await T.getTx(user.id, Number(p1));
        const ok = await T.deleteTx(user.id, Number(p1));
        if (t) await tg.edit(chatId, msgId, `↩️ <b>Bekor qilindi</b>\n${ok ? "" : "(allaqachon bekor qilingan)\n"}${V.txLine({ ...t, category_name: t.category_name, category_emoji: t.category_emoji })}`);
        return ack("Bekor qilindi");
      }
      case "ca": { // hisobni almashtirish
        const accs = await uzsAccounts(user);
        await tg.edit(chatId, msgId, "Qaysi hisob?", V.accountKeyboard(accs, `sa:${p1}:`, `ok:${p1}`));
        return ack();
      }
      case "sa":
        await T.setTxAccount(user.id, Number(p1), Number(p2));
        await showSaved(ctx, Number(p1), msgId);
        return ack("Hisob o‘zgartirildi");
      case "cc": {
        const t = await T.getTx(user.id, Number(p1));
        if (!t) return ack("Topilmadi");
        const cats = await T.listCategories(user.id, t.kind);
        await tg.edit(chatId, msgId, "Qaysi kategoriya?", V.categoryKeyboard(cats, `sc:${p1}:`, `ok:${p1}`));
        return ack();
      }
      case "sc":
        await T.setTxCategory(user.id, Number(p1), Number(p2));
        await showSaved(ctx, Number(p1), msgId);
        return ack("Kategoriya o‘zgartirildi");
      case "ok":
        await showSaved(ctx, Number(p1), msgId);
        return ack();
      case "ask":
        await tg.edit(chatId, msgId, "Bu operatsiya o‘chirilsinmi? Balanslar qayta hisoblanadi.",
          { inline_keyboard: [[{ text: "🗑 Ha, o‘chirish", callback_data: `del:${p1}` }, { text: "Yo‘q", callback_data: "cancel" }]] });
        return ack();
      case "del": {
        const ok = await T.deleteTx(user.id, Number(p1));
        await tg.edit(chatId, msgId, ok ? "🗑 O‘chirildi, balanslar qayta hisoblandi" : "Operatsiya topilmadi");
        return ack();
      }
      case "trf": {
        const accs = (await F.accounts(user)).filter((x) => x.id !== Number(p1));
        await tg.edit(chatId, msgId, "Qaysi hisobga?", V.accountKeyboard(accs, `trt:${p1}:`));
        return ack();
      }
      case "trt": {
        const accs = await F.accounts(user);
        const from = accs.find((x) => x.id === Number(p1)), to = accs.find((x) => x.id === Number(p2));
        if (!from || !to) return ack("Hisob topilmadi");
        await setState(ctx.tgId, "tr_amount", { from: from.id, to: to.id });
        await tg.edit(chatId, msgId, `🔁 <b>${esc(from.name)} → ${esc(to.name)}</b>\nSummani yozing${from.currency === "USD" ? " (dollarda)" : ""}:`, cancelKb);
        return ack();
      }
      case "dpay": {
        const d = (await Debts.listOpen(user)).find((x) => x.id === Number(p1));
        if (!d) return ack("Qarz topilmadi");
        await setState(ctx.tgId, "debt_pay", { debtId: d.id });
        await reply(ctx, `${d.direction === "payable" ? "Qarz to‘lovi" : "Qaytgan summa"}: <b>${esc(d.who)}</b>, qolgan ${fmt(d.remaining)}\nSummani yozing:`,
          { inline_keyboard: [[{ text: `To‘liq: ${group(d.remaining)}`, callback_data: `dfull:${d.id}` }], [{ text: "✖️ Bekor", callback_data: "cancel" }]] });
        return ack();
      }
      case "dfull": {
        const d = (await Debts.listOpen(user)).find((x) => x.id === Number(p1));
        if (!d) return ack("Qarz topilmadi");
        await tg.edit(chatId, msgId, "…");
        await finishDebtPay(ctx, d.id, d.remaining);
        return ack();
      }
      case "mp": {
        await showMonthPlan(ctx);
        return ack();
      }
      case "mp+": {
        await setState(ctx.tgId, "mp_item", { kind: p1 });
        await reply(ctx, p1 === "spend" ? "🔴 <b>Muhim xarajat</b> (keyingi oy)\nSumma va nomini yozing: <code>1.2mln Ijara</code>" : "🐖 <b>Jamg‘arma / maqsad</b> (keyingi oy)\nSumma va nomini yozing: <code>1mln Safar uchun</code>", cancelKb);
        return ack();
      }
      case "mpd": {
        const cur = (await db.query("select done from month_plan_items where id=$1 and user_id=$2", [Number(p1), user.id])).rows[0];
        if (cur) await MonthPlan.update(user, Number(p1), { done: !cur.done });
        await showMonthPlan(ctx, msgId);
        return ack(cur && !cur.done ? "Bajarildi" : "Qaytarildi");
      }
      case "mpx":
        await MonthPlan.remove(user, Number(p1));
        await showMonthPlan(ctx, msgId);
        return ack("O‘chirildi");
      case "pl": {
        await Planned.toggle(user.id, Number(p1));
        await tg.edit(chatId, msgId, "Prognoz yangilandi ✅ — /prognoz");
        return ack("Prognoz qayta hisoblandi");
      }
      case "plx":
        await Planned.remove(user.id, Number(p1));
        await tg.edit(chatId, msgId, "🗑 Reja o‘chirildi — /reja");
        return ack("O‘chirildi");
      case "rm": {
        await db.query("update reminders set enabled = not enabled where user_id=$1 and kind=$2", [user.id, p1]);
        const v = await remindersView(ctx);
        await tg.edit(chatId, msgId, v.text, v.kb);
        return ack("Saqlandi");
      }
      default:
        return ack();
    }
  } catch (e) {
    if (e instanceof UserError) return ack(e.message);
    console.error("callback xato:", e);
    return tg.answer(cb.id, "Xatolik. Qayta urinib ko‘ring.", true);
  }
}

async function showSaved(ctx, txId, msgId) {
  const t = await T.getTx(ctx.user.id, txId);
  if (!t || t.deleted_at) return tg.edit(ctx.chatId, msgId, "Operatsiya topilmadi");
  const text = await savedText(ctx, { ...t, account_id: t.account_id, category: t.category_id ? { emoji: t.category_emoji, name: t.category_name } : null, account: { name: t.account_name } });
  return tg.edit(ctx.chatId, msgId, text, V.txKeyboard(txId));
}

// ── Xabarlar ───────────────────────────────────────────────────────────
const ALIASES = {
  start: "start", yordam: "help", help: "help", chiqim: "expense", kirim: "income", otkazma: "transfer", asosiy: "home",
  bugun: "today", oy: "month", oxirgi: "recent", hisoblar: "accounts", hisob: "hisob", budjet: "budget", qarz: "debts", qarzlar: "debts",
  prognoz: "forecast", sozlamalar: "settings", ilova: "app", app: "app", limit: "limit", qoldiq: "qoldiq", maosh: "maosh",
  majburiy: "majburiy", qarzolish: "qarzolish", qarzberish: "qarzberish", kurs: "kurs", chegara: "chegara", eslatma: "eslatma",
  bekor: "bekor", reja: "reja", keyingi: "next", muhim: "muhim", maqsad: "maqsad", ajrat: "maqsad",
};

async function onMessage(msg, updateId) {
  if (msg.chat.type !== "private") return;
  const text = (msg.text || "").trim();
  const { user, isNew } = await ensureUser(msg.from, msg.chat.id);
  const ctx = {
    user, isNew, chatId: msg.chat.id, tgId: msg.from.id, today: D.localDate(user.tz),
    idemKey: `msg:${msg.chat.id}:${msg.message_id}`, updateId,
  };
  if (!text) return reply(ctx, "Faqat matn qabul qilaman. Masalan: <code>45000 non</code>");
  try {
    let name = null, args = "";
    if (text.startsWith("/")) {
      const m = text.match(/^\/([\p{L}\p{N}_]+)(?:@\w+)?\s*([\s\S]*)$/u);
      if (m) { name = ALIASES[norm(m[1]).replace(/[^a-z0-9]/g, "")]; args = m[2].trim(); if (!name) return reply(ctx, "Bunday buyruq yo‘q. /yordam"); }
    } else if (V.BTN_TO_CMD[text]) name = V.BTN_TO_CMD[text];
    if (name) {
      if (name !== "start") await clearState(ctx.tgId);
      return await cmd[name](ctx, args);
    }
    const st = await freshState(ctx.tgId);
    if (st && st.state !== "pick_cat") return await handleStateText(ctx, st, text);
    const entry = parseEntry(text);
    if (!entry) return reply(ctx, "Tushunmadim 🤔 Summa bilan yozing: <code>45000 non</code> yoki <code>+5mln oylik</code>\nYordam: /yordam");
    return await processEntry(ctx, entry, null);
  } catch (e) {
    if (e instanceof UserError) return reply(ctx, `⚠️ ${esc(e.message)}`);
    console.error("message xato:", e);
    return reply(ctx, "Saqlanmadi. Internetni tekshirib, qayta urinib ko‘ring.");
  }
}

async function handleUpdate(update) {
  const ins = await db.query("insert into processed_updates (update_id) values ($1) on conflict do nothing returning update_id", [update.update_id]);
  if (!ins.rows[0]) return { duplicate: true };
  if (update.message) await onMessage(update.message, update.update_id);
  else if (update.callback_query) await onCallback(update.callback_query);
  return { ok: true };
}

const BOT_COMMANDS = [
  ["chiqim", "Chiqim kiritish"], ["kirim", "Kirim kiritish"], ["otkazma", "Hisoblar orasida o‘tkazma"], ["asosiy", "Asosiy: erkin pul va xulosa"],
  ["bugun", "Bugungi operatsiyalar"], ["oy", "Oy natijasi"], ["oxirgi", "Oxirgi operatsiyalar"], ["bekor", "Oxirgisini bekor qilish"],
  ["hisoblar", "Hisoblar va qoldiqlar"], ["budjet", "Budjet va limitlar"], ["qarz", "Qarzlar"], ["prognoz", "Prognoz va yaqin to‘lovlar"],
  ["keyingi", "Keyingi oy rejasi: nimalarga pul ajratish"], ["reja", "Rejali tushum va to‘lovlar"], ["eslatma", "Eslatmalar"], ["sozlamalar", "Sozlamalar"], ["yordam", "Yordam"],
].map(([command, description]) => ({ command, description }));

module.exports = { handleUpdate, BOT_COMMANDS, REMINDER_LABELS, helpText };
