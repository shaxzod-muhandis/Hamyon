const test = require("node:test");
const assert = require("node:assert");
const H = require("./_helper");
const F = require("../src/services/finance");
const D = require("../src/lib/dates");
const Reminders = require("../src/services/reminders");

const { say, press, acc, db } = H;

test.before(async () => { await H.reset(); });
test.after(async () => { await db.close(); });

test("/start: foydalanuvchi, hisoblar va kategoriyalar yaratiladi", async () => {
  const t = await say("/start");
  assert.match(t, /Salom/);
  const u = await H.user();
  assert.ok(u);
  const accs = await db.query("select name from accounts where user_id=$1 order by sort", [u.id]);
  assert.deepStrictEqual(accs.rows.map((r) => r.name), ["Naqd", "Uzcard"]);
  const cats = await db.query("select count(*)::int n from categories where user_id=$1", [u.id]);
  assert.ok(cats.rows[0].n >= 16);
  // asosiy klaviatura yuborilgan
  assert.ok(H.out.some((m) => m.reply_markup?.keyboard));
});

test("/qoldiq hozirgi qoldiqni belgilaydi", async () => {
  await say("/qoldiq Naqd 1mln");
  assert.strictEqual((await acc("Naqd")).balance, 1000000);
  await say("/qoldiq Uzcard 3.5mln");
  assert.strictEqual((await acc("Uzcard")).balance, 3500000);
});

test("tez kiritish: '45000 non' -> Oziq-ovqat chiqimi", async () => {
  const t = await say("45000 non");
  assert.match(t, /Saqlandi/);
  assert.match(t, /Oziq-ovqat/);
  assert.strictEqual((await acc("Naqd")).balance, 955000);
});

test("takroriy update ikki marta ishlamaydi", async () => {
  const before = (await acc("Naqd")).balance;
  const upd = { update_id: 999001, message: { message_id: 9001, from: H.FROM, chat: { id: H.FROM.id, type: "private" }, text: "10000 non" } };
  await H.bot.handleUpdate(upd);
  const r = await H.bot.handleUpdate(upd);
  assert.strictEqual(r.duplicate, true);
  assert.strictEqual((await acc("Naqd")).balance, before - 10000);
});

test("kirim: '+5mln oylik' -> Ish haqi", async () => {
  const before = (await acc("Naqd")).balance;
  const t = await say("+5mln oylik");
  assert.match(t, /Ish haqi/);
  assert.strictEqual((await acc("Naqd")).balance, before + 5000000);
});

test("kategoriya noma'lum bo'lsa tugmalar chiqadi, tanlansa saqlanadi", async () => {
  const before = (await acc("Naqd")).balance;
  const t = await say("12000 kofe");
  assert.match(t, /Kategoriyani tanlang/);
  const kb = H.lastMarkup();
  const btn = kb.inline_keyboard.flat().find((b) => b.text.includes("Ko‘ngilochar"));
  await press(btn.callback_data);
  assert.strictEqual((await acc("Naqd")).balance, before - 12000);
});

test("↩️ Bekor qilish balansni qaytaradi", async () => {
  await say("77000 taksi");
  const before = (await acc("Naqd")).balance;
  const kb = H.lastMarkup();
  const undo = kb.inline_keyboard.flat().find((b) => b.callback_data.startsWith("undo:"));
  await press(undo.callback_data);
  assert.strictEqual((await acc("Naqd")).balance, before + 77000);
  // ikkinchi bosish zarar qilmaydi
  await press(undo.callback_data);
  assert.strictEqual((await acc("Naqd")).balance, before + 77000);
});

test("hisobni almashtirish tugmasi", async () => {
  await say("30000 ovqat");
  const kb = H.lastMarkup();
  const ca = kb.inline_keyboard.flat().find((b) => b.callback_data.startsWith("ca:"));
  const before = (await acc("Uzcard")).balance;
  const out = await press(ca.callback_data);
  const pick = out.find((m) => m.method === "editMessageText").reply_markup.inline_keyboard.flat().find((b) => b.text === "Uzcard");
  await press(pick.callback_data);
  assert.strictEqual((await acc("Uzcard")).balance, before - 30000);
});

test("o'tkazma: xarajat ham, daromad ham emas", async () => {
  const u = await H.user();
  const today = D.localDate(u.tz);
  const stats0 = await F.periodStats(u.id, u.tz, today, today);
  await say("/otkazma");
  let kb = H.lastMarkup();
  await press(kb.inline_keyboard.flat().find((b) => b.text === "Uzcard").callback_data);
  kb = H.lastMarkup();
  await press(kb.inline_keyboard.flat().find((b) => b.text === "Naqd").callback_data);
  const naqd0 = (await acc("Naqd")).balance, card0 = (await acc("Uzcard")).balance;
  const t = await say("500k");
  assert.match(t, /O‘tkazma saqlandi/);
  assert.strictEqual((await acc("Naqd")).balance, naqd0 + 500000);
  assert.strictEqual((await acc("Uzcard")).balance, card0 - 500000);
  const stats1 = await F.periodStats(u.id, u.tz, today, today);
  assert.deepStrictEqual([stats1.income, stats1.expense], [stats0.income, stats0.expense]);
});

test("budjet: limit va 80%/100% ogohlantirish", async () => {
  const t = await say("/limit transport 100000");
  assert.match(t, /Limit yangilandi/);
  const t0 = await say("0 taksi");
  assert.match(t0, /Tushunmadim/);
  const a = await say("85000 taksi");
  assert.match(a, /Diqqat: Transport/);
  const b = await say("20000 taksi");
  assert.match(b, /Limitdan oshdi: Transport/);
  const view = await say("/budjet");
  assert.match(view, /Limitdan oshdi/);
  assert.match(await say("/limit transport 0"), /Limit 0 dan katta bo‘lishi kerak/);
});

test("qarz olish: hisob qoldig'i oshadi, daromad emas; to'lov va yopilish", async () => {
  const u = await H.user();
  const today = D.localDate(u.tz);
  const inc0 = (await F.periodStats(u.id, u.tz, today, today)).income;
  const total0 = (await F.totals(u)).total;
  assert.match(await say("/qarzolish Akmal 2mln 10.12"), /Qarz olindi/);
  assert.strictEqual((await F.totals(u)).total, total0 + 2000000);
  assert.strictEqual((await F.periodStats(u.id, u.tz, today, today)).income, inc0);
  const tot = await F.totals(u);
  assert.strictEqual(tot.payables, 2000000);

  await say("/qarz");
  const pay = H.lastMarkup().inline_keyboard.flat().find((b) => b.callback_data.startsWith("dpay:"));
  await press(pay.callback_data);
  assert.match(await say("3mln"), /Qolgan qarzdan ko‘p/);
  assert.match(await say("500k"), /qolgan <b>1 500 000/);
  await say("/qarz");
  await press(H.lastMarkup().inline_keyboard.flat().find((b) => b.callback_data.startsWith("dpay:")).callback_data);
  assert.match(await say("to'liq"), /to‘liq yopildi/);
  assert.strictEqual((await F.totals(u)).payables, 0);
  assert.strictEqual((await F.totals(u)).total, total0);
});

test("erkin pul va prognoz formulasi (TZ 4.1, 4.3)", async () => {
  const u = await H.user();
  const today = D.localDate(u.tz);
  await say("/maosh 8mln 5");
  await say("/majburiy 1.2mln 10 Ijara");
  const accs = await F.accounts(u);
  const t = await F.totals(u, accs);
  const s = await F.safeToSpend(u, today, t.liquid);
  assert.strictEqual(s.mode, "salary");
  assert.ok(s.days >= 1 && s.next_income_date > today);
  // erkin pul = tezkor - maoshgacha bo'lgan majburiy to'lovlar
  const items = await F.scheduled(u.id, today, D.addDays(s.next_income_date, -1), { forecastOnlyIncome: true });
  const oblig = items.filter((x) => x.amount < 0).reduce((a, x) => a - x.amount, 0);
  assert.strictEqual(s.amount, t.liquid - oblig);
  assert.strictEqual(s.per_day, Math.floor(Math.max(0, s.amount) / s.days));
  const f = await F.forecast(u, today, t.liquid);
  assert.strictEqual(f.daily_balance.length, D.diffDays(f.end_date, today));
  assert.strictEqual(f.end_balance, t.liquid + f.incoming - f.planned - f.daily_total);
  const view = await say("/prognoz");
  assert.match(view, /Kutilayotgan balans/);
  // tushum toggle: o'chirilsa jami pul o'zgarmaydi, prognoz o'zgaradi
  const pl = (await db.query("select id from planned_transactions where user_id=$1 and kind='income'", [u.id])).rows[0];
  await say("/reja");
  await press(`pl:${pl.id}`);
  const t2 = await F.totals(u);
  const f2 = await F.forecast(u, today, t2.liquid);
  assert.strictEqual(t2.total, t.total);
  assert.ok(f2.end_balance < f.end_balance);
});

test("/asosiy, /bugun, /oy, /hisoblar, /oxirgi xatosiz ishlaydi", async () => {
  for (const c of ["/asosiy", "/bugun", "/oy", "/hisoblar", "/oxirgi", "/qarz", "/eslatma", "/sozlamalar", "/yordam", "/ilova", "🏠 Asosiy", "📊 Bugun"]) {
    const t = await say(c);
    assert.ok(t.length > 10, c);
    assert.doesNotMatch(t, /Saqlanmadi/, c);
  }
});

test("dashboard API shakli (TZ 17)", async () => {
  const u = await H.user();
  const d = await F.dashboard(u);
  for (const k of ["safe_to_spend", "totals", "accounts", "today", "spending_pace", "budget_top", "month_stats", "forecast", "upcoming", "debts_summary"])
    assert.ok(k in d, k);
  assert.ok(Array.isArray(d.spending_pace.daily_cumulative));
  assert.strictEqual(d.spending_pace.daily_cumulative.length, D.dayNum(d.today_date));
});

test("eslatma vaqti kelganda bir marta yuboriladi", async () => {
  const u = await H.user();
  const hm = D.localHM(u.tz);
  await db.query("update reminders set enabled=(kind='expense_reminder'), at_time = case when at_time is null then null else $2 end where user_id=$1", [u.id, hm]);
  H.out.length = 0;
  const r1 = await Reminders.tick();
  assert.strictEqual(r1.sent, 1);
  assert.match(H.out[0].text, /xarajatlarni kiritdingizmi/);
  const r2 = await Reminders.tick();
  assert.strictEqual(r2.sent, 0);
});

test("o'chirish: /oxirgi -> tasdiq -> o'chirildi", async () => {
  await say("/oxirgi");
  const ask = H.lastMarkup().inline_keyboard.flat().find((b) => b.callback_data.startsWith("ask:"));
  const u = await H.user();
  const before = (await F.totals(u)).total;
  const out = await press(ask.callback_data);
  const del = out.find((m) => m.method === "editMessageText").reply_markup.inline_keyboard.flat().find((b) => b.callback_data.startsWith("del:"));
  await press(del.callback_data);
  assert.notStrictEqual((await F.totals(u)).total, before);
});
