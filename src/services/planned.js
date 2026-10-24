const db = require("../lib/db");
const { UserError } = require("./transactions");

async function add(user, i) {
  const amount = Math.trunc(Number(i.amount));
  if (!(amount > 0)) throw new UserError("Summani kiriting, u 0 dan katta bo‘lishi kerak");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.startDate || "")) throw new UserError("Sana noto‘g‘ri");
  const cat = i.categoryId
    ? i.categoryId
    : (await db.query("select id from categories where user_id=$1 and kind=$2 and name=$3 and not archived", [user.id, i.kind, i.kind === "income" ? "Ish haqi" : "Uy-joy va kommunal"])).rows[0]?.id || null;
  const r = await db.query(
    `insert into planned_transactions (user_id, kind, name, amount, category_id, account_id, start_date, recurrence, include_in_forecast, is_salary)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [user.id, i.kind, String(i.name).slice(0, 80), amount, cat, i.accountId || null, i.startDate, i.recurrence || "monthly",
      i.include !== false, !!i.isSalary],
  );
  return r.rows[0];
}

const list = async (userId) => (await db.query("select * from planned_transactions where user_id=$1 and active order by kind desc, start_date", [userId])).rows;
const remove = async (userId, id) => (await db.query("update planned_transactions set active=false where id=$1 and user_id=$2 returning id", [id, userId])).rows.length > 0;
const toggle = async (userId, id) =>
  (await db.query("update planned_transactions set include_in_forecast = not include_in_forecast where id=$1 and user_id=$2 returning *", [id, userId])).rows[0];

module.exports = { add, list, remove, toggle };
