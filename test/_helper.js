// Testlar FAQAT TEST_DATABASE_URL bilan ishlaydi (asosiy bazaga tegmaslik uchun).
require("../scripts/_env").loadEnv();
if (!process.env.TEST_DATABASE_URL) {
  console.error("❌ TEST_DATABASE_URL sozlanmagan — testlar to‘xtatildi (alohida bo‘sh baza kerak).");
  process.exit(1);
}
if (process.env.DATABASE_URL && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL) {
  console.error("❌ TEST_DATABASE_URL va DATABASE_URL bir xil.");
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BOT_TOKEN = "123456:TEST";
process.env.WEBHOOK_SECRET = "whsec";
process.env.CRON_SECRET = "cronsec";

const db = require("../src/lib/db");
const tg = require("../src/lib/tg");
const bot = require("../src/bot");

const out = [];
tg.setTransport(async (method, payload) => { out.push({ method, ...payload }); return { ok: true, result: { message_id: 1 } }; });

let uid = 1000;
let mid = 1;
const FROM = { id: 777, first_name: "Test", username: "tester" };

async function reset() {
  await db.query("truncate users, processed_updates, bot_state, notification_log restart identity cascade");
}
async function say(text, from = FROM) {
  out.length = 0;
  const update_id = ++uid;
  await bot.handleUpdate({ update_id, message: { message_id: ++mid, from, chat: { id: from.id, type: "private" }, text } });
  return out.map((m) => m.text || "").join("\n---\n");
}
async function press(data, from = FROM, messageId = 55) {
  out.length = 0;
  await bot.handleUpdate({ update_id: ++uid, callback_query: { id: "cb" + uid, from, data, message: { message_id: messageId, chat: { id: from.id } } } });
  return out;
}
const lastMarkup = () => [...out].reverse().find((m) => m.reply_markup)?.reply_markup;
const user = async () => (await db.query("select * from users where tg_id=$1", [FROM.id])).rows[0];
const acc = async (name) => {
  const u = await user();
  return (await require("../src/services/finance").accounts(u)).find((a) => a.name === name);
};

module.exports = { db, out, reset, say, press, lastMarkup, user, acc, FROM, bot, nextUpdateId: () => ++uid };
