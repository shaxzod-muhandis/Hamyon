// Keyingi oy rejasi: kutilayotgan tushum − majburiy to'lovlar − siz ajratgan summalar = ajratilmagan qoldiq.
const db = require("../lib/db");
const D = require("../lib/dates");
const F = require("./finance");
const T = require("./transactions");

const { UserError } = T;

const monthStartOf = (today, offset = 1) => D.monthStart(D.addMonths(today, offset));

function checkMonth(m, today) {
  if (!m) return monthStartOf(today, 1);
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(m)) throw new UserError("Oy noto‘g‘ri");
  return D.monthStart(m.length === 7 ? m + "-01" : m);
}

async function get(user, today, month) {
  const from = checkMonth(month, today);
  const to = D.monthEnd(from);
  const items = (await db.query(
    `select i.*, c.name category_name, c.color category_color from month_plan_items i
       left join categories c on c.id=i.category_id
      where i.user_id=$1 and i.month=$2::date order by i.kind desc, i.important desc, i.id`, [user.id, from])).rows;
  const sched = await F.scheduled(user.id, from, to, { forecastOnlyIncome: true });
  const income = sched.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const auto = sched.filter((x) => x.amount < 0).map((x) => ({ date: x.date, name: x.name, amount: -x.amount, kind: x.kind }));
  const mandatory = auto.reduce((s, x) => s + x.amount, 0);
  const sum = (kind) => items.filter((i) => i.kind === kind).reduce((s, i) => s + i.amount, 0);
  const spend = sum("spend"), save = sum("save");
  return {
    month: from.slice(0, 7), month_start: from, is_next: from === monthStartOf(today, 1),
    income, mandatory, auto, spend, save, free: income - mandatory - spend - save,
    important: items.filter((i) => i.kind === "spend" && i.important).reduce((s, i) => s + i.amount, 0),
    items, done_count: items.filter((i) => i.done).length,
  };
}

function clean(i, partial) {
  const out = {};
  if (!partial || i.title !== undefined) {
    const t = String(i.title || "").trim().slice(0, 80);
    if (!t) throw new UserError("Nomini kiriting");
    out.title = t;
  }
  if (!partial || i.amount !== undefined) {
    const a = Math.trunc(Number(i.amount));
    if (!(a > 0)) throw new UserError("Summani kiriting, u 0 dan katta bo‘lishi kerak");
    out.amount = a;
  }
  if (!partial || i.kind !== undefined) {
    if (!["spend", "save"].includes(i.kind)) throw new UserError("Tur noto‘g‘ri");
    out.kind = i.kind;
  }
  if (i.important !== undefined) out.important = !!i.important;
  if (i.done !== undefined) out.done = !!i.done;
  if (i.category_id !== undefined) out.category_id = i.category_id || null;
  return out;
}

async function add(user, today, i) {
  const c = clean(i, false);
  const month = checkMonth(i.month, today);
  if (c.category_id) await T.getCategory(user.id, Number(c.category_id));
  const important = c.important !== undefined ? c.important : c.kind === "spend";
  return (await db.query(
    `insert into month_plan_items (user_id, month, title, amount, kind, important, category_id) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [user.id, month, c.title, c.amount, c.kind, important, c.category_id || null])).rows[0];
}

async function update(user, id, i) {
  const cur = (await db.query("select * from month_plan_items where id=$1 and user_id=$2", [id, user.id])).rows[0];
  if (!cur) throw new UserError("Reja bandi topilmadi");
  const c = clean(i, true);
  if (c.category_id) await T.getCategory(user.id, Number(c.category_id));
  const m = { ...cur, ...c };
  return (await db.query(
    "update month_plan_items set title=$3, amount=$4, kind=$5, important=$6, category_id=$7, done=$8 where id=$1 and user_id=$2 returning *",
    [id, user.id, m.title, m.amount, m.kind, m.important, m.category_id, m.done])).rows[0];
}

async function remove(user, id) {
  return (await db.query("delete from month_plan_items where id=$1 and user_id=$2 returning id", [id, user.id])).rows.length > 0;
}

module.exports = { get, add, update, remove, monthStartOf };
