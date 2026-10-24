const test = require("node:test");
const assert = require("node:assert");
const H = require("./_helper");

let server, base;
test.before(async () => {
  await H.reset();
  server = require("../src/app").listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await H.db.close(); });

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("health", async () => assert.strictEqual((await (await fetch(base + "/api/health")).json()).ok, true));

test("webhook maxfiy so'zsiz rad etiladi, bilan ishlaydi", async () => {
  const upd = { update_id: 424242, message: { message_id: 1, from: H.FROM, chat: { id: H.FROM.id, type: "private" }, text: "/start" } };
  assert.strictEqual((await post("/api/bot", upd)).status, 401);
  assert.strictEqual((await post("/api/bot", upd, { "x-telegram-bot-api-secret-token": "xato" })).status, 401);
  assert.strictEqual((await post("/api/bot", upd, { "x-telegram-bot-api-secret-token": "whsec" })).status, 200);
  assert.ok(await H.user());
});

test("cron va admin CRON_SECRET talab qiladi", async () => {
  assert.strictEqual((await fetch(base + "/api/cron/tick")).status, 401);
  assert.strictEqual((await fetch(base + "/api/cron/tick", { headers: { authorization: "Bearer cronsec" } })).status, 200);
  assert.strictEqual((await post("/api/admin/setup", {})).status, 401);
});

test("Mini App API initData siz kirmaydi", async () => {
  assert.strictEqual((await fetch(base + "/api/dashboard")).status, 401);
  assert.strictEqual((await fetch(base + "/api/dashboard", { headers: { authorization: "tma user=%7B%7D&hash=00" } })).status, 401);
});
