const db = require("../lib/db");
const { norm } = require("./users");

class UserError extends Error {}

const run = (q) => q || db.query;

async function getAccount(userId, id, q) {
  const r = await run(q)("select * from accounts where id=$1 and user_id=$2 and not archived", [id, userId]);
  if (!r.rows[0]) throw new UserError("Hisob topilmadi");
  return r.rows[0];
}
async function getCategory(userId, id, q) {
  const r = await run(q)("select * from categories where id=$1 and user_id=$2 and not archived", [id, userId]);
  if (!r.rows[0]) throw new UserError("Kategoriya topilmadi");
  return r.rows[0];
}

// Operatsiya yaratish. idemKey berilsa, takroriy chaqiruv mavjud yozuvni qaytaradi.
async function createTx(userId, i, q) {
  const Q = run(q);
  const amount = Math.trunc(Number(i.amount));
  if (!(amount > 0)) throw new UserError("Summani kiriting, u 0 dan katta bo‘lishi kerak");
  const acc = await getAccount(userId, i.accountId, q);
  let toAcc = null, cat = null;
  if (i.kind === "transfer") {
    if (!i.toAccountId || Number(i.toAccountId) === Number(i.accountId)) throw new UserError("Bir hisobdan o‘ziga o‘tkazib bo‘lmaydi");
    toAcc = await getAccount(userId, i.toAccountId, q);
    if (toAcc.currency !== acc.currency && !(i.toAmount > 0)) throw new UserError("Valyutalar orasida o‘tkazmada qabul qilingan summa kerak");
  } else {
    cat = await getCategory(userId, i.categoryId, q);
    if (cat.kind !== i.kind) throw new UserError("Kategoriya turi mos emas");
  }
  const occurredAt = i.occurredAt || (i.daysAgo ? new Date(Date.now() - i.daysAgo * 86400000) : new Date());
  const ins = await Q(
    `insert into transactions (user_id, kind, amount, account_id, to_account_id, to_amount, category_id, note, occurred_at, source, idem_key, debt_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (user_id, idem_key) where idem_key is not null do nothing returning *`,
    [userId, i.kind, amount, acc.id, toAcc?.id || null, i.toAmount || null, cat?.id || null,
      i.note ? String(i.note).slice(0, 200) : null, occurredAt, i.source || "bot", i.idemKey || null, i.debtId || null],
  );
  let row = ins.rows[0];
  let created = true;
  if (!row) {
    created = false;
    row = (await Q("select * from transactions where user_id=$1 and idem_key=$2", [userId, i.idemKey])).rows[0];
  } else if (i.kind !== "transfer") {
    await Q("update users set last_account_id=$2 where id=$1", [userId, acc.id]);
  }
  return { ...row, created, account: acc, toAccount: toAcc, category: cat };
}

async function getTx(userId, id) {
  const r = await db.query(
    `select t.*, a.name account_name, ta.name to_account_name, c.name category_name, c.emoji category_emoji, c.system_key
       from transactions t join accounts a on a.id=t.account_id
       left join accounts ta on ta.id=t.to_account_id
       left join categories c on c.id=t.category_id
      where t.id=$1 and t.user_id=$2`, [id, userId]);
  return r.rows[0] || null;
}

async function deleteTx(userId, id) {
  const r = await db.query("update transactions set deleted_at=now() where id=$1 and user_id=$2 and deleted_at is null returning id", [id, userId]);
  return !!r.rows[0];
}

async function setTxAccount(userId, id, accountId) {
  const acc = await getAccount(userId, accountId);
  const r = await db.query("update transactions set account_id=$3 where id=$1 and user_id=$2 and kind<>'transfer' and deleted_at is null returning id", [id, userId, acc.id]);
  if (!r.rows[0]) throw new UserError("Operatsiya topilmadi");
  await db.query("update users set last_account_id=$2 where id=$1", [userId, acc.id]);
}
async function setTxCategory(userId, id, categoryId) {
  const cat = await getCategory(userId, categoryId);
  const r = await db.query("update transactions set category_id=$3 where id=$1 and user_id=$2 and kind=$4 and deleted_at is null returning id", [id, userId, cat.id, cat.kind]);
  if (!r.rows[0]) throw new UserError("Operatsiya topilmadi yoki turi mos emas");
}

async function recent(userId, limit = 8) {
  const r = await db.query(
    `select t.id, t.kind, t.amount, t.note, t.occurred_at, a.name account_name, a.currency, ta.name to_account_name,
            c.name category_name, c.emoji category_emoji, c.system_key
       from transactions t join accounts a on a.id=t.account_id
       left join accounts ta on ta.id=t.to_account_id
       left join categories c on c.id=t.category_id
      where t.user_id=$1 and t.deleted_at is null
      order by t.occurred_at desc, t.id desc limit $2`, [userId, limit]);
  return r.rows;
}

async function onDate(userId, tz, date, limit = 50) {
  const r = await db.query(
    `select t.id, t.kind, t.amount, t.note, t.occurred_at, a.name account_name, a.currency, ta.name to_account_name,
            c.name category_name, c.emoji category_emoji, c.system_key
       from transactions t join accounts a on a.id=t.account_id
       left join accounts ta on ta.id=t.to_account_id
       left join categories c on c.id=t.category_id
      where t.user_id=$1 and t.deleted_at is null and (t.occurred_at at time zone $2)::date = $3::date
      order by t.occurred_at desc, t.id desc limit $4`, [userId, tz, date, limit]);
  return r.rows;
}

// Matndan kategoriya taxmin qilish: kalit so'zlardan biri matnda bo'lsa
async function guessCategory(userId, kind, text) {
  const t = norm(text);
  if (!t) return null;
  const words = t.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  const cats = (await db.query("select * from categories where user_id=$1 and kind=$2 and not archived and system_key is null order by sort", [userId, kind])).rows;
  for (const c of cats) {
    const names = [norm(c.name), ...c.keywords];
    if (words.some((w) => names.some((k) => k && (w === k || (w.length >= 4 && k.startsWith(w)) || (k.length >= 4 && w.startsWith(k)))))) return c;
  }
  return null;
}

async function listCategories(userId, kind) {
  return (await db.query("select * from categories where user_id=$1 and kind=$2 and not archived and system_key is null order by sort, id", [userId, kind])).rows;
}

async function systemCategory(userId, key, q) {
  return (await run(q)("select * from categories where user_id=$1 and system_key=$2", [userId, key])).rows[0];
}

module.exports = {
  UserError, createTx, getTx, deleteTx, setTxAccount, setTxCategory, recent, onDate,
  guessCategory, listCategories, systemCategory, getAccount, getCategory,
};
