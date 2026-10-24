// Webhook + buyruqlar: lokal .env.local dagi BOT_TOKEN, APP_URL, WEBHOOK_SECRET bilan.
require("./_env").loadEnv();
const tg = require("../src/lib/tg");
const bot = require("../src/bot");
(async () => {
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  if (!process.env.BOT_TOKEN || !base || !process.env.WEBHOOK_SECRET) {
    console.error("BOT_TOKEN, APP_URL va WEBHOOK_SECRET kerak (.env.local)");
    process.exit(1);
  }
  console.log("webhook:", (await tg.call("setWebhook", { url: `${base}/api/bot`, secret_token: process.env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] })).ok);
  console.log("commands:", (await tg.call("setMyCommands", { commands: bot.BOT_COMMANDS })).ok);
  console.log("info:", JSON.stringify((await tg.call("getWebhookInfo", {})).result));
})();
