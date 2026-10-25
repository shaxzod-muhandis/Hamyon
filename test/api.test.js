const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const H = require("./_helper");
const D = require("../src/lib/dates");

let server, base, auth;
const token = process.env.BOT_TOKEN;

function initData(user) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
async function api(method, path, body, headers = auth) {
  const r = await fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const ok = async (...a) => { const r = await api(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

let accNaqd, accCard, catFood, catSalary, today;
test.before(async () => {
  await H.reset();
  server = require("../src/app").listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await H.say("/start");
  auth = { authorization: "tma " + initData(H.FROM) };
  const meta = await ok("GET", "/meta");
  today = meta.today;
  accNaqd = meta.accounts.find((a) => a.name === "Naqd").id;
  accCard = meta.accounts.find((a) => a.name === "Uzcard").id;
  catFood = meta.categories.find((c) => c.name === "Oziq-ovqat").id;
  catSalary = meta.categories.find((c) => c.name === "Ish haqi").id;
});
test.after(async () => { server.close(); await H.db.close(); });

test("autentifikatsiya: initData, sessiya, Login Widget", async () => {
  assert.strictEqual((await api("GET", "/me", null, {})).status, 401);
  assert.strictEqual((await api("GET", "/me", null, { authorization: "tma user=%7B%7D&hash=00" })).status, 401);
  assert.strictEqual((await api("GET", "/me")).status, 200);
  // widget
  const data = { id: H.FROM.id, first_name: "Test", username: "tester", auth_date: String(Math.floor(Date.now() / 1000)) };
  const secret = crypto.createHash("sha256").update(token).digest();
  data.hash = crypto.createHmac("sha256", secret).update(Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join("\n")).digest("hex");
  const w = await api("POST", "/auth/widget", data, {});
  assert.strictEqual(w.status, 200);
  assert.strictEqual((await api("GET", "/me", null, { authorization: "Bearer " + w.body.token })).status, 200);
  assert.strictEqual((await api("GET", "/me", null, { authorization: "Bearer 1.9999999999.00" })).status, 401);
  assert.strictEqual((await api("POST", "/auth/widget", { ...data, hash: "00".repeat(32) }, {})).status, 401);
  // begona foydalanuvchi botda /start bosmagan
  const stranger = { id: 555, first_name: "X", auth_date: data.auth_date };
  stranger.hash = crypto.createHmac("sha256", secret).update(Object.keys(stranger).sort().map((k) => `${k}=${stranger[k]}`).join("\n")).digest("hex");
  assert.strictEqual((await api("POST", "/auth/widget", stranger, {})).status, 403);
});

test("operatsiya: yaratish, idempotentlik, manfiy qoldiq ogohlantirishi", async () => {
  const key = "k-" + Date.now();
  const a = await ok("POST", "/transactions", { kind: "expense", amount: 145000, account_id: accNaqd, category_id: catFood, note: "Korzinka", idempotency_key: key });
  assert.strictEqual(a.created, true);
  assert.strictEqual(a.transaction.category_name, "Oziq-ovqat");
  assert.match(a.warning, /yetarli mablag‘ yo‘q/);
  const b = await api("POST", "/transactions", { kind: "expense", amount: 145000, account_id: accNaqd, category_id: catFood, idempotency_key: key });
  assert.strictEqual(b.status, 200);
  assert.strictEqual(b.body.transaction.id, a.transaction.id);
  const accs = await ok("GET", "/accounts");
  assert.strictEqual(accs.accounts.find((x) => x.id === accNaqd).balance, -145000);
  // tekshiruv xatolari
  assert.match((await api("POST", "/transactions", { kind: "expense", amount: 0, account_id: accNaqd, category_id: catFood })).body.error, /0 dan katta/);
  assert.match((await api("POST", "/transactions", { kind: "transfer", amount: 5, account_id: accNaqd, to_account_id: accNaqd })).body.error, /o‘ziga/);
});

test("tahrirlash, o'chirish va qaytarish", async () => {
  const t = (await ok("POST", "/transactions", { kind: "income", amount: 5000000, account_id: accCard, category_id: catSalary, note: "oylik", idempotency_key: "i1" })).transaction;
  const upd = await ok("PUT", `/transactions/${t.id}`, { amount: 6000000, note: "oylik+bonus", date: D.addDays(today, -1) });
  assert.strictEqual(upd.amount, 6000000);
  assert.strictEqual(upd.note, "oylik+bonus");
  assert.strictEqual(await ok("GET", "/accounts").then((r) => r.accounts.find((a) => a.id === accCard).balance), 6000000);
  await ok("DELETE", `/transactions/${t.id}`);
  assert.strictEqual(await ok("GET", "/accounts").then((r) => r.accounts.find((a) => a.id === accCard).balance), 0);
  await ok("POST", `/transactions/${t.id}/restore`);
  assert.strictEqual(await ok("GET", "/accounts").then((r) => r.accounts.find((a) => a.id === accCard).balance), 6000000);
});

test("qidiruv, filtrlar, sahifalash va kunlik jami", async () => {
  for (let i = 0; i < 5; i++) await ok("POST", "/transactions", { kind: "expense", amount: 10000 + i, account_id: accCard, category_id: catFood, note: "non " + i, idempotency_key: "s" + i });
  const all = await ok("GET", "/transactions?limit=3");
  assert.strictEqual(all.items.length, 3);
  assert.strictEqual(all.has_more, true);
  const page2 = await ok("GET", "/transactions?limit=3&offset=3");
  assert.ok(page2.items.length >= 1);
  const q = await ok("GET", "/transactions?q=NON");
  assert.strictEqual(q.summary.count, 5);
  assert.strictEqual(q.summary.expense, 10000 * 5 + 10);
  const inc = await ok("GET", "/transactions?type=income");
  assert.ok(inc.items.every((x) => x.kind === "income"));
  const byAcc = await ok("GET", `/transactions?account_id=${accNaqd}`);
  assert.ok(byAcc.items.every((x) => x.account_id === accNaqd || x.to_account_id === accNaqd));
  assert.ok(all.day_totals[today]);
  const range = await ok("GET", `/transactions?from=${D.addDays(today, 5)}&to=${D.addDays(today, 6)}`);
  assert.strictEqual(range.summary.count, 0);
});

test("guruhli amallar", async () => {
  const list = (await ok("GET", "/transactions?q=non")).items.map((x) => x.id);
  const r = await ok("POST", "/transactions/bulk", { ids: list.slice(0, 2), action: "delete" });
  assert.strictEqual(r.affected, 2);
  assert.strictEqual((await ok("GET", "/transactions?q=non")).summary.count, 3);
});

test("hisoblar: yaratish, arxiv, o'chirish qoidasi", async () => {
  const a = await ok("POST", "/accounts", { name: "Jamg‘arma", type: "savings", initial_balance: 1000000 });
  assert.strictEqual(a.is_liquid, false);
  assert.match((await api("POST", "/accounts", { name: "jamg‘arma", type: "savings" })).body.error, /allaqachon/);
  const usd = await ok("POST", "/accounts", { name: "USD", type: "currency", initial_balance: 42000 });
  assert.strictEqual(usd.currency, "USD");
  const sum = (await ok("GET", "/accounts")).summary;
  assert.strictEqual(sum.usd, 42000);
  await ok("PUT", `/accounts/${a.id}`, { name: "Zaxira", initial_balance: 2000000 });
  await ok("POST", "/transactions", { kind: "transfer", amount: 500000, account_id: accCard, to_account_id: a.id, idempotency_key: "tr1" });
  assert.match((await api("DELETE", `/accounts/${a.id}`)).body.error, /Operatsiyasi bor/);
  await ok("POST", `/accounts/${a.id}/archive`, {});
  const accs = await ok("GET", "/accounts");
  assert.ok(accs.archived.some((x) => x.id === a.id));
  const empty = await ok("POST", "/accounts", { name: "Bo‘sh", type: "bank" });
  await ok("DELETE", `/accounts/${empty.id}`);
  // arxivdagi hisob operatsiya kiritishda qabul qilinmaydi
  assert.strictEqual((await api("POST", "/transactions", { kind: "expense", amount: 1, account_id: a.id, category_id: catFood })).status, 400);
});

test("kategoriyalar: yaratish va ko'chirib o'chirish", async () => {
  const c = await ok("POST", "/categories", { kind: "expense", name: "Sport" });
  assert.match(c.color, /^#[0-9a-f]{6}$/i);
  await ok("POST", "/transactions", { kind: "expense", amount: 1000, account_id: accCard, category_id: c.id, idempotency_key: "c1" });
  assert.match((await api("DELETE", `/categories/${c.id}`)).body.error, /operatsiyalar bor/);
  await ok("DELETE", `/categories/${c.id}?move_to=${catFood}`);
  assert.ok(!(await ok("GET", "/categories")).some((x) => x.id === c.id));
  assert.match((await api("POST", "/categories", { kind: "expense", name: "  " })).body.error, /nomini/);
});

test("budjet: limit va holat", async () => {
  assert.match((await api("PUT", `/budget/${catFood}`, { limit: 0 })).body.error, /0 dan katta/);
  await ok("PUT", `/budget/${catFood}`, { limit: 100000 });
  const b = await ok("GET", "/budget");
  const it = b.items.find((x) => x.category_id === catFood);
  assert.strictEqual(it.status, "over"); // 145 000 + ... > 100 000
  assert.ok(b.unbudgeted.length > 0 && !b.unbudgeted.some((x) => x.id === catFood));
  await ok("DELETE", `/budget/${catFood}`);
  assert.strictEqual((await ok("GET", "/budget")).items.length, 0);
});

test("qarzlar: yaratish, to'lov, holatlar", async () => {
  const d = await ok("POST", "/debts", { direction: "payable", who: "Kapital Bank", amount: 3000000, account_id: accCard, due_date: D.addDays(today, -3), monthly_payment: 1000000, pay_day: 5 });
  let v = await ok("GET", "/debts");
  const it = v.items.find((x) => x.id === d.id);
  assert.strictEqual(it.status, "overdue");
  assert.strictEqual(it.days_late, 3);
  assert.strictEqual(v.summary.payables, 3000000);
  assert.strictEqual(v.summary.overdue, 1);
  assert.match((await api("POST", `/debts/${d.id}/payments`, { amount: 9000000, account_id: accCard })).body.error, /Qolgan qarzdan ko‘p/);
  const p = await ok("POST", `/debts/${d.id}/payments`, { amount: 1000000, account_id: accCard });
  assert.strictEqual(p.left, 2000000);
  v = await ok("GET", "/debts");
  assert.strictEqual(v.items.find((x) => x.id === d.id).payments.length, 1);
  // qarz operatsiyasi tahrirlanmaydi
  const dtx = (await ok("GET", "/transactions?q=kapital")).items[0];
  assert.match((await api("PUT", `/transactions/${dtx.id}`, { amount: 5 })).body.error, /Qarzlar bo‘limida/);
  await ok("POST", `/debts/${d.id}/payments`, { amount: 2000000, account_id: accCard });
  assert.strictEqual((await ok("GET", "/debts")).items.find((x) => x.id === d.id).status, "closed");
  const r = await ok("POST", "/debts", { direction: "receivable", who: "Akmal", amount: 500000, account_id: accNaqd });
  await ok("DELETE", `/debts/${r.id}`);
  assert.ok(!(await ok("GET", "/debts")).items.some((x) => x.id === r.id));
});

test("reja: tushum, toggle, bajarildi", async () => {
  const inc = await ok("POST", "/plan", { kind: "income", name: "Maosh", amount: 8000000, start_date: D.addDays(today, 3), recurrence: "monthly", is_salary: true });
  const exp = await ok("POST", "/plan", { kind: "expense", name: "Ijara", amount: 1200000, start_date: D.addDays(today, 2), recurrence: "monthly" });
  let p = await ok("GET", "/plan");
  assert.strictEqual(p.incomes.length, 1);
  assert.strictEqual(p.formula.expected, p.formula.liquid + p.formula.incoming - p.formula.planned - p.formula.debts - p.formula.daily_total);
  assert.ok(p.items.some((x) => x.name === "Ijara" && x.balance_after !== null));
  const before = p.formula.expected;
  await ok("PUT", `/plan/${inc.id}`, { include_in_forecast: false });
  p = await ok("GET", "/plan");
  assert.ok(p.formula.expected < before);
  assert.strictEqual(p.items.find((x) => x.name === "Maosh").included, false);
  const date = D.addDays(today, 2);
  const done = await ok("POST", `/plan/${exp.id}/done`, { date, account_id: accCard });
  assert.ok(done.transaction_id);
  p = await ok("GET", "/plan");
  assert.ok(!p.items.some((x) => x.name === "Ijara" && x.date === date));
  assert.ok(p.items.some((x) => x.name === "Ijara" && x.date > date)); // keyingi oy qoladi
  await ok("DELETE", `/plan/${exp.id}`);
});

test("takrorlanuvchi operatsiya rejaga yoziladi", async () => {
  await ok("POST", "/transactions", { kind: "expense", amount: 70000, account_id: accCard, category_id: catFood, note: "Internet", recurrence: "monthly", idempotency_key: "rec1" });
  const p = await ok("GET", "/plan");
  assert.ok(p.planned.some((x) => x.name === "Internet" && x.recurrence === "monthly"));
});

test("dashboard (TZ 17) va tahlil", async () => {
  const d = await ok("GET", "/dashboard");
  assert.ok(Array.isArray(d.today.transactions));
  assert.strictEqual(typeof d.totals.total_prev_month_end, "number");
  assert.ok(d.forecast.daily_balance.length > 0);
  const a = await ok("GET", "/analytics?months=6");
  assert.strictEqual(a.chart.length, 6);
  assert.strictEqual(a.chart.at(-1).month, today.slice(0, 7));
  assert.deepStrictEqual(a.compare.table.map((r) => r.key), ["income", "expense", "net", "saved", "payables"]);
  assert.deepStrictEqual(a.insights, []); // tarix 30 kundan kam — xulosa ko'rsatilmaydi
  assert.strictEqual((await ok("GET", "/analytics?months=3")).chart.length, 3);
});

test("eslatmalar va sozlamalar", async () => {
  const r = await ok("GET", "/reminders");
  assert.ok(r.items.length >= 8);
  await ok("PUT", "/reminders/expense_reminder", { enabled: true, at_time: "20:15" });
  assert.strictEqual((await ok("GET", "/reminders")).items.find((x) => x.kind === "expense_reminder").at_time, "20:15");
  assert.match((await api("PUT", "/reminders/expense_reminder", { at_time: "25:00" })).body.error, /Vaqt noto‘g‘ri/);
  assert.match((await api("PUT", "/reminders/budget", { at_time: "10:00" })).body.error, /vaqt yo‘q/);
  const s = await ok("PUT", "/settings", { theme: "dark", safe_threshold: 2000000 });
  assert.strictEqual(s.theme, "dark");
  assert.match((await api("PUT", "/settings", { theme: "pink" })).body.error, /Mavzu/);
  assert.match((await api("PUT", "/settings", { tz: "Mars/Olympus" })).body.error, /zonasi/);
  const exp = await api("GET", "/export");
  assert.strictEqual(exp.status, 200);
  assert.ok(exp.body.transactions.length > 0);
});

test("boshqa foydalanuvchi ma'lumotiga tegib bo'lmaydi", async () => {
  const other = { id: 888, first_name: "Other" };
  await H.say("/start", other);
  const oa = { authorization: "tma " + initData(other) };
  const tx = (await ok("GET", "/transactions?limit=1")).items[0];
  assert.strictEqual((await api("PUT", `/transactions/${tx.id}`, { amount: 1 }, oa)).status, 400);
  assert.strictEqual((await api("DELETE", `/transactions/${tx.id}`, null, oa)).body.ok, false);
  assert.strictEqual((await api("POST", "/transactions", { kind: "expense", amount: 1, account_id: accNaqd, category_id: catFood }, oa)).status, 400);
  assert.strictEqual((await api("GET", "/transactions", null, oa)).body.items.length, 0);
});
