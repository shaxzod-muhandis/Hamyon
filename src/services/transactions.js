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


// 'YYYY-MM-DD' + 'HH:MM' (foydalanuvchi vaqt zonasida) -> timestamptz
async function occurredFrom(tz, date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new UserError("Sana noto‘g‘ri");
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new UserError("Vaqt noto‘g‘ri");
  const r = await db.query("select (($1::date + $2::time) at time zone $3) as ts", [date, time || "12:00", tz]);
  return r.rows[0].ts;
}

const LIST_SELECT = `t.id, t.kind, t.amount, t.to_amount, t.note, t.occurred_at, t.debt_id,
  (t.occurred_at at time zone $2)::date::text as local_date, to_char(t.occurred_at at time zone $2, 'HH24:MI') as local_time,
  t.account_id, a.name account_name, a.currency, t.to_account_id, ta.name to_account_name,
  t.category_id, c.name category_name, c.color category_color, c.system_key`;
const LIST_FROM = `from transactions t join accounts a on a.id=t.account_id
  left join accounts ta on ta.id=t.to_account_id left join categories c on c.id=t.category_id`;

// Filtrlangan ro'yxat: { items, summary, day_totals, has_more }
async function search(user, f = {}) {
  const p = [user.id, user.tz];
  const w = ["t.user_id=$1", "$2::text is not null", "t.deleted_at is null"];
  const add = (sql, v) => { p.push(v); w.push(sql.replace("?", "$" + p.length)); };
  if (["expense", "income", "transfer"].includes(f.type)) add("t.kind = ?", f.type);
  if (f.account_id) { p.push(Number(f.account_id)); w.push(`(t.account_id = $${p.length} or t.to_account_id = $${p.length})`); }
  if (f.category_id) add("t.category_id = ?", Number(f.category_id));
  if (f.from) add("(t.occurred_at at time zone $2)::date >= ?::date", f.from);
  if (f.to) add("(t.occurred_at at time zone $2)::date <= ?::date", f.to);
  if (f.min) add("t.amount >= ?", Number(f.min));
  if (f.max) add("t.amount <= ?", Number(f.max));
  if (f.q && String(f.q).trim()) {
    p.push("%" + String(f.q).trim().toLowerCase().replace(/[%_\\]/g, "\\$&") + "%");
    const n = "$" + p.length;
    w.push(`(lower(coalesce(t.note,'')) like ${n} or lower(coalesce(c.name,'')) like ${n} or lower(a.name) like ${n} or lower(coalesce(ta.name,'')) like ${n})`);
  }
  const where = w.join(" and ");
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const rows = (await db.query(`select ${LIST_SELECT} ${LIST_FROM} where ${where} order by t.occurred_at desc, t.id desc limit ${limit + 1} offset ${offset}`, p)).rows;
  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);
  const sum = (await db.query(
    `select count(*)::int n, coalesce(sum(case when t.kind='income' then t.amount end),0)::bigint income,
            coalesce(sum(case when t.kind='expense' then t.amount end),0)::bigint expense ${LIST_FROM} where ${where}`, p)).rows[0];
  const dates = [...new Set(items.map((x) => x.local_date))];
  const day_totals = {};
  if (dates.length) {
    const dp = [...p, dates];
    const dt = await db.query(
      `select (t.occurred_at at time zone $2)::date::text d,
              coalesce(sum(case when t.kind='income' then t.amount end),0)::bigint income,
              coalesce(sum(case when t.kind='expense' then t.amount end),0)::bigint expense
         ${LIST_FROM} where ${where} and (t.occurred_at at time zone $2)::date::text = any($${dp.length}) group by 1`, dp);
    for (const r of dt.rows) day_totals[r.d] = { income: r.income, expense: r.expense };
  }
  return { items, summary: { count: sum.n, income: sum.income, expense: sum.expense }, day_totals, has_more };
}

// Operatsiyani tahrirlash (qarz bilan bog'liq bo'lmaganlar)
async function update(user, id, i) {
  const cur = (await db.query("select * from transactions where id=$1 and user_id=$2 and deleted_at is null", [id, user.id])).rows[0];
  if (!cur) throw new UserError("Operatsiya topilmadi");
  if (cur.debt_id) throw new UserError("Qarz to‘lovlari Qarzlar bo‘limida boshqariladi");
  const amount = i.amount !== undefined ? Math.trunc(Number(i.amount)) : cur.amount;
  if (!(amount > 0)) throw new UserError("Summani kiriting, u 0 dan katta bo‘lishi kerak");
  const accountId = i.account_id !== undefined ? Number(i.account_id) : cur.account_id;
  const acc = await getAccount(user.id, accountId);
  let toId = cur.to_account_id, catId = cur.category_id, toAmount = cur.to_amount;
  if (cur.kind === "transfer") {
    if (i.to_account_id !== undefined) toId = Number(i.to_account_id);
    if (toId === accountId) throw new UserError("Bir hisobdan o‘ziga o‘tkazib bo‘lmaydi");
    const to = await getAccount(user.id, toId);
    if (i.to_amount !== undefined) toAmount = i.to_amount ? Math.trunc(Number(i.to_amount)) : null;
    if (to.currency !== acc.currency && !(toAmount > 0)) throw new UserError("Valyutalar orasida o‘tkazmada qabul qilingan summa kerak");
    if (to.currency === acc.currency) toAmount = null;
  } else if (i.category_id !== undefined) {
    const cat = await getCategory(user.id, Number(i.category_id));
    if (cat.kind !== cur.kind) throw new UserError("Kategoriya turi mos emas");
    catId = cat.id;
  }
  let occurred = cur.occurred_at;
  if (i.date) {
    const oldTime = (await db.query("select to_char($1::timestamptz at time zone $2,'HH24:MI') t", [cur.occurred_at, user.tz])).rows[0].t;
    occurred = await occurredFrom(user.tz, i.date, i.time || oldTime);
  }
  const note = i.note !== undefined ? (String(i.note).trim().slice(0, 200) || null) : cur.note;
  await db.query(
    `update transactions set amount=$3, account_id=$4, to_account_id=$5, to_amount=$6, category_id=$7, note=$8, occurred_at=$9 where id=$1 and user_id=$2`,
    [id, user.id, amount, accountId, toId, toAmount, catId, note, occurred]);
  return getTx(user.id, id);
}

async function restoreTx(userId, id) {
  const r = await db.query("update transactions set deleted_at=null where id=$1 and user_id=$2 and deleted_at is not null returning id", [id, userId]);
  return r.rows.length > 0;
}

module.exports = {
  occurredFrom, search, update, restoreTx,
  UserError, createTx, getTx, deleteTx, setTxAccount, setTxCategory, recent, onDate,
  guessCategory, listCategories, systemCategory, getAccount, getCategory,
};
