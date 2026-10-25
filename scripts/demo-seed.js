// Namuna ma'lumot (lokal ko'rish uchun): 3 oylik tarix, qarzlar, reja, budjet.
// Ishlatish:  DATABASE_URL=... BOT_TOKEN=... node scripts/demo-seed.js   -> sessiya tokenini chiqaradi
require("./_env").loadEnv();
const db = require("../src/lib/db");
const D = require("../src/lib/dates");
const { ensureUser } = require("../src/services/users");
const T = require("../src/services/transactions");
const Debts = require("../src/services/debts");
const Planned = require("../src/services/planned");
const session = require("../src/lib/session");

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

(async () => {
  const tgId = Number(process.env.DEMO_TG_ID || 777000);
  const old = (await db.query("select id from users where tg_id=$1", [tgId])).rows[0];
  if (old) {
    await db.query("delete from debt_payments where debt_id in (select id from debts where user_id=$1)", [old.id]);
    await db.query("delete from transactions where user_id=$1", [old.id]);
    await db.query("delete from users where id=$1", [old.id]);
  }
  const { user: u0 } = await ensureUser({ id: tgId, first_name: "Shaxzod", username: "demo" }, tgId);
  await db.query("update users set chat_id=$2 where id=$1", [u0.id, tgId]);
  const user = (await db.query("select * from users where id=$1", [u0.id])).rows[0];
  const today = D.localDate(user.tz);
  const cats = Object.fromEntries((await db.query("select * from categories where user_id=$1", [user.id])).rows.map((c) => [c.name, c]));
  const accs = Object.fromEntries((await db.query("select * from accounts where user_id=$1", [user.id])).rows.map((a) => [a.name, a]));
  await db.query("update accounts set initial_balance=4000000 where id=$1", [accs.Naqd.id]);
  await db.query("update accounts set initial_balance=12000000 where id=$1", [accs.Uzcard.id]);
  const mk = (name, type, cur, init, liquid) => db.query("insert into accounts (user_id,name,short_name,type,currency,initial_balance,is_liquid,sort) values ($1,$2,$2,$3,$4,$5,$6,9) returning *", [user.id, name, type, cur, init, liquid]).then((r) => r.rows[0]);
  const save = await mk("Jamg‘arma", "savings", "UZS", 4000000, false);
  const usd = await mk("USD", "currency", "USD", 42000, false);

  const tx = (kind, amount, accId, cat, note, daysAgo, hour = 12) => {
    const when = new Date(Date.now() - daysAgo * 86400000);
    when.setUTCHours(hour - 5, Math.floor(rnd() * 59), 0, 0);
    return T.createTx(user.id, { kind, amount, accountId: accId, categoryId: cat?.id, note, occurredAt: when });
  };
  const spend = [
    ["Oziq-ovqat", ["Korzinka", "Bozor", "Makro", "Non", "Havas"], 30000, 150000],
    ["Transport", ["Yandex Go", "Benzin", "Metro"], 10000, 90000],
    ["Uy-joy va kommunal", ["Elektr", "Internet", "Gaz"], 50000, 200000],
    ["Ta’lim", ["Kurs", "Kitoblar"], 60000, 300000],
    ["Sog‘liq", ["Apteka", "Klinika"], 20000, 160000],
    ["Ko‘ngilochar", ["Kino", "Kafe", "Konsert"], 40000, 220000],
  ];
  for (let d = 85; d >= 0; d--) {
    const n = rnd() > 0.35 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const [cn, notes, lo, hi] = pick(spend);
      await tx("expense", Math.round((lo + rnd() * (hi - lo)) / 1000) * 1000, rnd() > 0.45 ? accs.Uzcard.id : accs.Naqd.id, cats[cn], pick(notes), d, 9 + Math.floor(rnd() * 12));
    }
    const dt = D.addDays(today, -d);
    if (D.dayNum(dt) === 5) await tx("income", 8000000, accs.Uzcard.id, cats["Ish haqi"], "Oylik maosh", d, 10);
    if (D.dayNum(dt) === 18 && rnd() > 0.3) await tx("income", 1500000, accs.Uzcard.id, cats["Biznes daromadi"], "Mijoz to‘lovi", d, 15);
    if (D.dayNum(dt) === 6) await T.createTx(user.id, { kind: "transfer", amount: 1000000, accountId: accs.Uzcard.id, toAccountId: save.id, occurredAt: new Date(Date.now() - d * 86400000) });
  }
  await tx("expense", 1200000, accs.Uzcard.id, cats["Uy-joy va kommunal"], "Ijara", 12, 9);
  for (const [name, lim, fixed] of [["Oziq-ovqat", 2500000, false], ["Transport", 900000, false], ["Uy-joy va kommunal", 1800000, true], ["Ko‘ngilochar", 700000, false], ["Sog‘liq", 500000, false]]) {
    await db.query("insert into budget_limits (user_id, category_id, limit_amount) values ($1,$2,$3)", [user.id, cats[name].id, lim]);
    if (fixed) await db.query("update categories set is_fixed=true where id=$1", [cats[name].id]);
  }
  const mid = (n) => D.withDay(D.addMonths(today, n), 5);
  await Planned.add(user, { kind: "income", name: "Maosh", amount: 8000000, startDate: mid(D.dayNum(today) >= 5 ? 1 : 0), recurrence: "monthly", isSalary: true });
  await Planned.add(user, { kind: "expense", name: "Ijara", amount: 1200000, startDate: D.withDay(D.addMonths(today, 1), 12), recurrence: "monthly" });
  await Planned.add(user, { kind: "expense", name: "Internet", amount: 120000, startDate: D.addDays(today, 3), recurrence: "monthly" });
  await Planned.add(user, { kind: "income", name: "Frilans loyiha", amount: 3000000, startDate: D.addDays(today, 16), recurrence: "none", include: false });
  const bank = await Debts.createDebt(user, { direction: "payable", who: "Kapital Bank", amount: 6000000, accountId: accs.Uzcard.id, dueDate: D.addDays(today, 16), monthly: 1000000, payDay: 5 });
  await db.query("update debts set interest_pct=22, start_date=$2 where id=$1", [bank.id, D.addDays(today, -140)]);
  await Debts.payDebt(user, bank.id, 1000000, accs.Uzcard.id);
  await Debts.createDebt(user, { direction: "payable", who: "Akmal aka", amount: 1500000, accountId: accs.Naqd.id, dueDate: D.addDays(today, -4) });
  await Debts.createDebt(user, { direction: "receivable", who: "Dilshod", amount: 2000000, accountId: accs.Naqd.id, dueDate: D.addDays(today, 20) });
  console.log(session.sign(user.id));
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
