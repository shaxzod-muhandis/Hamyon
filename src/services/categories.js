const db = require("../lib/db");
const { UserError } = require("./transactions");

// TZ 1.2: yangi kategoriyaga palitradan navbatdagi rang
const PALETTE = ["#2d78bd", "#7c5ce6", "#e08a1e", "#2f9e5f", "#d9475a", "#c25fc9", "#2a9bab", "#b7791f", "#5b8def", "#8a93a0"];

async function list(userId) {
  return (await db.query(
    `select id, kind, name, emoji, color, is_fixed, system_key, sort,
            exists (select 1 from transactions t where t.category_id = categories.id and t.deleted_at is null) as used
       from categories where user_id=$1 and not archived order by kind, sort, id`, [userId])).rows;
}

async function create(userId, { kind, name, color }) {
  if (!["expense", "income"].includes(kind)) throw new UserError("Tur noto‘g‘ri");
  name = String(name || "").trim().slice(0, 40);
  if (!name) throw new UserError("Kategoriya nomini kiriting");
  const count = (await db.query("select count(*)::int n from categories where user_id=$1 and kind=$2 and system_key is null", [userId, kind])).rows[0].n;
  try {
    return (await db.query(
      `insert into categories (user_id, kind, name, emoji, color, sort) values ($1,$2,$3,$4,$5,(select coalesce(max(sort),0)+1 from categories where user_id=$1)) returning *`,
      [userId, kind, name, kind === "income" ? "➕" : name[0].toUpperCase(), color || PALETTE[count % PALETTE.length]])).rows[0];
  } catch (e) {
    if (e.code === "23505") throw new UserError("Bunday kategoriya allaqachon bor");
    throw e;
  }
}

async function update(userId, id, { name, color, is_fixed }) {
  const cur = (await db.query("select * from categories where id=$1 and user_id=$2 and system_key is null", [id, userId])).rows[0];
  if (!cur) throw new UserError("Kategoriya topilmadi");
  name = name !== undefined ? String(name).trim().slice(0, 40) : cur.name;
  if (!name) throw new UserError("Kategoriya nomini kiriting");
  if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new UserError("Rang noto‘g‘ri");
  try {
    return (await db.query("update categories set name=$3, color=$4, is_fixed=$5 where id=$1 and user_id=$2 returning *",
      [id, userId, name, color || cur.color, is_fixed !== undefined ? !!is_fixed : cur.is_fixed])).rows[0];
  } catch (e) {
    if (e.code === "23505") throw new UserError("Bunday kategoriya allaqachon bor");
    throw e;
  }
}

// Operatsiyasi bo'lsa — faqat boshqa kategoriyaga ko'chirib o'chiriladi (moveTo)
async function remove(userId, id, moveTo) {
  return db.tx(async (c) => {
    const q = c.query.bind(c);
    const cat = (await q("select * from categories where id=$1 and user_id=$2 and system_key is null for update", [id, userId])).rows[0];
    if (!cat) throw new UserError("Kategoriya topilmadi");
    const used = (await q("select 1 from transactions where category_id=$1 limit 1", [id])).rows[0] ||
      (await q("select 1 from planned_transactions where category_id=$1 limit 1", [id])).rows[0];
    if (used) {
      if (!moveTo) throw new UserError("Bu kategoriyada operatsiyalar bor, o‘chirib bo‘lmaydi");
      const target = (await q("select id from categories where id=$1 and user_id=$2 and kind=$3 and not archived and system_key is null", [moveTo, userId, cat.kind])).rows[0];
      if (!target || Number(moveTo) === Number(id)) throw new UserError("Ko‘chiriladigan kategoriya noto‘g‘ri");
      await q("update transactions set category_id=$2 where category_id=$1", [id, moveTo]);
      await q("update planned_transactions set category_id=$2 where category_id=$1", [id, moveTo]);
    }
    await q("delete from budget_limits where category_id=$1", [id]);
    await q("delete from categories where id=$1", [id]);
    return { moved: !!used };
  });
}

module.exports = { list, create, update, remove, PALETTE };
