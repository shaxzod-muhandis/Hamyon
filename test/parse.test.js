const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { parseAmount, fmt, short, fmtSigned } = require("../src/lib/money");
const { parseEntry, parseDueDate } = require("../src/bot/parse");
const D = require("../src/lib/dates");
const { verifyInitData } = require("../src/lib/auth");

test("parseAmount", () => {
  const cases = { "45000": 45000, "45 000": 45000, "45k": 45000, "1.5mln": 1500000, "1,5 mln": 1500000, "45.000": 45000, "2 mln": 2000000, "500к": 500000, "1mlrd": 1e9 };
  for (const [k, v] of Object.entries(cases)) assert.strictEqual(parseAmount(k), v, k);
  for (const bad of ["abc", "0", "1.5", "", null, "12 kg", "-5"]) assert.strictEqual(parseAmount(bad), null, String(bad));
});

test("formatlash (TZ 1.6)", () => {
  assert.strictEqual(fmt(7655000), "7 655 000 so‘m");
  assert.strictEqual(fmt(-145000), "−145 000 so‘m");
  assert.strictEqual(short(7655000), "7,66 mln");
  assert.strictEqual(short(16900000), "16,9 mln");
  assert.strictEqual(short(3030000), "3,03 mln");
  assert.strictEqual(short(2000000), "2 mln");
  assert.strictEqual(short(800000), "0,8 mln");
  assert.strictEqual(fmtSigned(-5), "−5");
});

test("parseEntry", () => {
  assert.deepStrictEqual(parseEntry("45000 non"), { kind: null, amount: 45000, note: "non", daysAgo: 0 });
  assert.deepStrictEqual(parseEntry("+5mln oylik"), { kind: "income", amount: 5000000, note: "oylik", daysAgo: 0 });
  assert.deepStrictEqual(parseEntry("korzinka 45 000 kecha"), { kind: null, amount: 45000, note: "korzinka", daysAgo: 1 });
  assert.strictEqual(parseEntry("salom"), null);
});

test("parseDueDate", () => {
  assert.strictEqual(parseDueDate("10.11", "2026-10-24"), "2026-11-10");
  assert.strictEqual(parseDueDate("10.10", "2026-10-24"), "2027-10-10");
  assert.strictEqual(parseDueDate("31.02", "2026-10-24"), null);
});

test("sana yordamchilari", () => {
  assert.deepStrictEqual(D.occurrences("2026-01-31", "monthly", "2026-10-01", "2026-12-31"), ["2026-10-31", "2026-11-30", "2026-12-31"]);
  assert.deepStrictEqual(D.occurrences("2026-10-05", "weekly", "2026-10-20", "2026-11-03"), ["2026-10-26", "2026-11-02"]);
  assert.strictEqual(D.weekdayName("2026-10-24"), "shanba");
  assert.strictEqual(D.fmtDay("2026-10-24"), "24-oktabr");
});

test("initData imzosi", () => {
  const token = "123:ABC";
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 5, first_name: "A" }) });
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  assert.strictEqual(verifyInitData(params.toString(), token).id, 5);
  assert.strictEqual(verifyInitData(params.toString(), "other:token"), null);
  assert.strictEqual(verifyInitData(params.toString(), ""), null);
  params.set("hash", "00".repeat(32));
  assert.strictEqual(verifyInitData(params.toString(), token), null);
});
