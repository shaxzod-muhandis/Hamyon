// Telegram Mini App initData imzosini tekshirish (BOT_TOKEN bo'lmasa — har doim rad etiladi).
const crypto = require("crypto");

function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!botToken || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

// Telegram Login Widget (brauzerda kirish): kalit = SHA256(bot_token)
function verifyWidget(data, botToken, maxAgeSec = 86400) {
  if (!botToken || !data || !data.hash || !data.id) return null;
  const { hash, ...rest } = data;
  const check = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc), b = Buffer.from(String(hash));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number(rest.auth_date) || Date.now() / 1000 - Number(rest.auth_date) > maxAgeSec) return null;
  return { id: Number(rest.id), first_name: rest.first_name, username: rest.username };
}

module.exports = { verifyInitData, verifyWidget };
