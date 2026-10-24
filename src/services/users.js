const db = require("../lib/db");

// Standart kategoriyalar (TZ 1.2). keywords — bot'da matndan kategoriyani taxmin qilish uchun.
const EXPENSE_CATS = [
  ["Oziq-ovqat", "🛒", "#2d78bd", "non ovqat korzinka bozor market osh lagmon kafe restoran fastfood pizza burger go'sht sabzavot meva ichimlik choy suv oziq".split(" ")],
  ["Transport", "🚕", "#7c5ce6", "taksi yandex benzin metro avtobus yo'l transport mashina parkovka gaz".split(" ")],
  ["Uy-joy va kommunal", "🏠", "#e08a1e", "kommunal ijara elektr svet internet uy kvartira remont mebel".split(" ")],
  ["Ta’lim", "📚", "#2f9e5f", "kurs kitob maktab o'qish talim universitet kontrakt repetitor".split(" ")],
  ["Sog‘liq", "💊", "#d9475a", "dori apteka shifokor klinika tish analiz davolanish".split(" ")],
  ["Ko‘ngilochar", "🎬", "#c25fc9", "kino o'yin konsert dam sayohat teatr cafe".split(" ")],
  ["Biznes", "💼", "#2a9bab", "reklama tovar xomashyo ofis soliq".split(" ")],
  ["Boshqa", "📦", "#8a93a0", []],
];
const INCOME_CATS = [
  ["Ish haqi", "💰", "#2f9e5f", "maosh oylik ish avans".split(" ")],
  ["Biznes daromadi", "📈", "#2a9bab", "savdo mijoz sotuv foyda".split(" ")],
  ["Sovg‘a", "🎁", "#c25fc9", "sovga sovg'a hadya".split(" ")],
  ["Boshqa kirim", "➕", "#8a93a0", []],
];
const SYSTEM_CATS = [
  ["expense", "Qarz to‘lovi", "debt_payment"],
  ["income", "Qarz qaytdi", "debt_return"],
  ["expense", "Qarz berildi", "debt_given"],
  ["income", "Qarz olindi", "debt_taken"],
];

const REMINDER_DEFAULTS = [
  ["expense_reminder", true, "21:00"],
  ["daily_report", false, "22:00"],
  ["weekly", true, "20:00"],
  ["monthly", true, "10:00"],
  ["debt_due", true, "09:00"],
  ["mandatory", true, "09:00"],
  ["budget", true, null],
  ["low_funds", true, "09:00"],
];

async function seedUser(q, userId) {
  await q("insert into accounts (user_id, name, short_name, type, sort) values ($1,'Naqd','Naqd','cash',1),($1,'Uzcard','Uzcard','card',2)", [userId]);
  let sort = 0;
  for (const [name, emoji, color, kw] of EXPENSE_CATS)
    await q("insert into categories (user_id, kind, name, emoji, color, keywords, sort) values ($1,'expense',$2,$3,$4,$5,$6)", [userId, name, emoji, color, kw.map(norm), ++sort]);
  for (const [name, emoji, color, kw] of INCOME_CATS)
    await q("insert into categories (user_id, kind, name, emoji, color, keywords, sort) values ($1,'income',$2,$3,$4,$5,$6)", [userId, name, emoji, color, kw.map(norm), ++sort]);
  for (const [kind, name, key] of SYSTEM_CATS)
    await q("insert into categories (user_id, kind, name, emoji, system_key, sort) values ($1,$2,$3,'🤝',$4,900)", [userId, kind, name, key]);
  for (const [kind, enabled, at] of REMINDER_DEFAULTS)
    await q("insert into reminders (user_id, kind, enabled, at_time) values ($1,$2,$3,$4)", [userId, kind, enabled, at]);
}

// Apostrof/tutuq belgilarini bir xillashtirish, kichik harf
function norm(s) {
  return String(s || "").toLowerCase().replace(/[’‘ʻʼ`´]/g, "'").replace(/\s+/g, " ").trim();
}

// Foydalanuvchini topadi yoki yaratadi. { user, isNew }
async function ensureUser(from, chatId) {
  const found = await db.query("select * from users where tg_id=$1", [from.id]);
  if (found.rows[0]) {
    const u = found.rows[0];
    if (chatId && u.chat_id !== chatId)
      await db.query("update users set chat_id=$2 where id=$1", [u.id, chatId]);
    return { user: { ...u, chat_id: chatId || u.chat_id }, isNew: false };
  }
  return db.tx(async (c) => {
    const q = c.query.bind(c);
    const ins = await q(
      `insert into users (tg_id, chat_id, first_name, username) values ($1,$2,$3,$4)
       on conflict (tg_id) do nothing returning *`,
      [from.id, chatId || null, from.first_name || null, from.username || null],
    );
    if (!ins.rows[0]) return { user: (await q("select * from users where tg_id=$1", [from.id])).rows[0], isNew: false };
    await seedUser(q, ins.rows[0].id);
    return { user: ins.rows[0], isNew: true };
  });
}

module.exports = { ensureUser, norm };
