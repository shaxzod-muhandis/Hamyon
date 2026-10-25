const db = require("../lib/db");
const D = require("../lib/dates");
const F = require("./finance");
const { UserError } = require("./transactions");

const TYPES = ["cash", "card", "savings", "currency", "bank"];

// Hisoblar + shu oydagi kirim/chiqim (kirimga kelgan o'tkazmalar ham kiradi)
async function list(user, today, { archived = false } = {}) {
  const accs = await F.accounts(user, { archived });
  const from = D.monthStart(today);
  const r = await db.query(
    `select a.id,
            coalesce(sum(case when t.kind='income' and t.account_id=a.id then t.amount
                              when t.kind='transfer' and t.to_account_id=a.id then coalesce(t.to_amount, t.amount) end), 0)::bigint inc,
            coalesce(sum(case when t.kind in ('expense','transfer') and t.account_id=a.id then t.amount end), 0)::bigint out
       from accounts a
       left join transactions t on t.deleted_at is null and (t.account_id=a.id or t.to_account_id=a.id)
            and (t.occurred_at at time zone $2)::date between $3::date and $4::date
      where a.user_id=$1 group by a.id`, [user.id, user.tz, from, today]);
  const m = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  return accs.map((a) => ({ ...a, month_in: m[a.id]?.inc || 0, month_out: m[a.id]?.out || 0 }));
}

function clean(i, partial = false) {
  const out = {};
  if (!partial || i.name !== undefined) {
    const name = String(i.name || "").trim().slice(0, 40);
    if (!name) throw new UserError("Hisob nomini kiriting");
    out.name = name;
  }
  if (!partial || i.type !== undefined) {
    if (!TYPES.includes(i.type)) throw new UserError("Hisob turi noto‘g‘ri");
    out.type = i.type;
  }
  if (i.initial_balance !== undefined) {
    const v = Math.trunc(Number(i.initial_balance));
    if (!Number.isFinite(v)) throw new UserError("Boshlang‘ich qoldiq noto‘g‘ri");
    out.initial_balance = v;
  }
  if (i.is_liquid !== undefined) out.is_liquid = !!i.is_liquid;
  return out;
}

async function create(user, i) {
  const c = clean(i);
  const currency = c.type === "currency" ? (["USD"].includes(i.currency) ? i.currency : "USD") : "UZS";
  try {
    const r = await db.query(
      `insert into accounts (user_id, name, short_name, type, currency, initial_balance, is_liquid, sort)
       values ($1,$2,$2,$3,$4,$5,$6,(select coalesce(max(sort),0)+1 from accounts where user_id=$1)) returning *`,
      [user.id, c.name, c.type, currency, c.initial_balance || 0, i.is_liquid !== undefined ? !!i.is_liquid : c.type === "cash" || c.type === "card"]);
    return r.rows[0];
  } catch (e) {
    if (e.code === "23505") throw new UserError("Bunday nomli hisob allaqachon bor");
    throw e;
  }
}

async function update(user, id, i) {
  const c = clean(i, true);
  const keys = Object.keys(c);
  if (!keys.length) throw new UserError("O‘zgartirish yo‘q");
  const sets = keys.map((k, n) => `${k}=$${n + 3}`).join(", ");
  try {
    const r = await db.query(`update accounts set ${sets}${c.name ? ", short_name=" + "$" + (keys.indexOf("name") + 3) : ""} where id=$1 and user_id=$2 returning *`, [id, user.id, ...keys.map((k) => c[k])]);
    if (!r.rows[0]) throw new UserError("Hisob topilmadi");
    return r.rows[0];
  } catch (e) {
    if (e.code === "23505") throw new UserError("Bunday nomli hisob allaqachon bor");
    throw e;
  }
}

async function setArchived(user, id, archived) {
  const r = await db.query("update accounts set archived=$3 where id=$1 and user_id=$2 returning *", [id, user.id, archived]);
  if (!r.rows[0]) throw new UserError("Hisob topilmadi");
  return r.rows[0];
}

async function remove(user, id) {
  const used = await db.query("select 1 from transactions where (account_id=$1 or to_account_id=$1) and user_id=$2 limit 1", [id, user.id]);
  if (used.rows[0]) throw new UserError("Operatsiyasi bor hisobni o‘chirib bo‘lmaydi. Arxivlang.");
  const debt = await db.query("select 1 from debts where account_id=$1 and user_id=$2 limit 1", [id, user.id]);
  if (debt.rows[0]) throw new UserError("Qarz bog‘langan hisobni o‘chirib bo‘lmaydi. Arxivlang.");
  const r = await db.query("delete from accounts where id=$1 and user_id=$2 returning id", [id, user.id]);
  if (!r.rows[0]) throw new UserError("Hisob topilmadi");
  return true;
}

module.exports = { list, create, update, setArchived, remove };
