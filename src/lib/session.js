// Brauzer uchun sessiya tokeni (Telegram Login Widget orqali kirgandan keyin).
// Format: <userId>.<exp>.<hmac>. Kalit BOT_TOKEN dan hosil qilinadi — token almashsa sessiyalar bekor bo'ladi.
const crypto = require("crypto");

const key = () => crypto.createHash("sha256").update("hamyon-session:" + (process.env.BOT_TOKEN || "")).digest();
const mac = (s) => crypto.createHmac("sha256", key()).update(s).digest("hex");

function sign(userId, ttlDays = 30) {
  if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN yo'q");
  const body = `${userId}.${Math.floor(Date.now() / 1000) + ttlDays * 86400}`;
  return `${body}.${mac(body)}`;
}
function verify(token) {
  if (!process.env.BOT_TOKEN || !token) return null;
  const m = String(token).match(/^(\d+)\.(\d+)\.([0-9a-f]{64})$/);
  if (!m) return null;
  const a = Buffer.from(mac(`${m[1]}.${m[2]}`)), b = Buffer.from(m[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (+m[2] < Date.now() / 1000) return null;
  return Number(m[1]);
}
module.exports = { sign, verify };
