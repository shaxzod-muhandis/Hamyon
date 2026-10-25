const db = require("../lib/db");
const T = require("./transactions");
const F = require("./finance");
const { group } = require("../lib/money");

const { UserError } = T;

// direction: 'payable' (men qarz oldim) | 'receivable' (men qarz berdim)
async function createDebt(user, i) {
  const amount = Math.trunc(Number(i.amount));
  if (!(amount > 0)) throw new UserError("Summani kiriting, u 0 dan katta bo‘lishi kerak");
  if (!i.who || !String(i.who).trim()) throw new UserError("Kim ekanini yozing");
  return db.tx(async (c) => {
    const q = c.query.bind(c);
    const acc = await T.getAccount(user.id, i.accountId, q);
    const d = (await q(
      `insert into debts (user_id, direction, who, principal, account_id, due_date, monthly_payment, pay_day)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [user.id, i.direction, String(i.who).trim().slice(0, 80), amount, acc.id, i.dueDate || null, i.monthly || null, i.payDay || null],
    )).rows[0];
    // Pul hisobga kirdi/chiqdi, lekin daromad yoki xarajat emas (system kategoriya)
    const cat = await T.systemCategory(user.id, i.direction === "payable" ? "debt_taken" : "debt_given", q);
    await T.createTx(user.id, {
      kind: i.direction === "payable" ? "income" : "expense", amount, accountId: acc.id, categoryId: cat.id,
      note: `Qarz: ${d.who}`, debtId: d.id, source: i.source || "bot",
    }, q);
    return d;
  });
}

async function payDebt(user, debtId, amount, accountId) {
  return db.tx(async (c) => {
    const q = c.query.bind(c);
    const d = (await q("select * from debts where id=$1 and user_id=$2 for update", [debtId, user.id])).rows[0];
    if (!d) throw new UserError("Qarz topilmadi");
    const paid = (await q("select coalesce(sum(amount),0)::bigint s from debt_payments where debt_id=$1", [d.id])).rows[0].s;
    const remaining = d.principal - paid;
    if (remaining <= 0) throw new UserError("Bu qarz allaqachon yopilgan");
    amount = Math.trunc(Number(amount));
    if (!(amount > 0)) throw new UserError("Summani kiriting");
    if (amount > remaining) throw new UserError(`Qolgan qarzdan ko‘p: eng ko‘pi ${group(remaining)} so‘m`);
    const acc = await T.getAccount(user.id, accountId, q);
    const cat = await T.systemCategory(user.id, d.direction === "payable" ? "debt_payment" : "debt_return", q);
    const tx = await T.createTx(user.id, {
      kind: d.direction === "payable" ? "expense" : "income", amount, accountId: acc.id, categoryId: cat.id,
      note: `Qarz: ${d.who}`, debtId: d.id,
    }, q);
    await q("insert into debt_payments (debt_id, amount, account_id, transaction_id) values ($1,$2,$3,$4)", [d.id, amount, acc.id, tx.id]);
    const left = remaining - amount;
    if (left <= 0) await q("update debts set closed_at=now() where id=$1", [d.id]);
    return { debt: d, left, closed: left <= 0, tx };
  });
}

async function listOpen(user) {
  return F.debts(user.id, { openOnly: true });
}

const D = require("../lib/dates");

// Qarz kartasi uchun to'liq ro'yxat (TZ 9.3): holat, muddat qatori, to'lovlar tarixi
async function view(user, today) {
  const ds = await F.debts(user.id);
  const pays = (await db.query(
    `select p.id, p.debt_id, p.amount, to_char(p.paid_at at time zone $2, 'YYYY-MM-DD') date, a.name account_name
       from debt_payments p join debts d on d.id=p.debt_id join accounts a on a.id=p.account_id
      where d.user_id=$1 order by p.paid_at desc, p.id desc`, [user.id, user.tz])).rows;
  const by = {};
  for (const p of pays) (by[p.debt_id] ||= []).push(p);
  const items = ds.map((d) => {
    let status = "active", label = "Faol";
    if (d.closed) { status = "closed"; label = "Yopilgan"; }
    else if (d.due_date && d.due_date < today) { status = "overdue"; label = "Muddati o‘tgan"; }
    else if (d.paid > 0) { status = "partial"; label = d.direction === "payable" ? "Qisman to‘langan" : "Qisman qaytarilgan"; }
    let next = null;
    if (!d.closed && d.pay_day) {
      const tm = D.withDay(today, d.pay_day);
      next = tm >= today ? tm : D.withDay(D.addMonths(today, 1), d.pay_day);
    }
    return {
      ...d, status, status_label: label, days_left: d.due_date ? D.diffDays(d.due_date, today) : null,
      days_late: d.due_date && d.due_date < today && !d.closed ? D.diffDays(today, d.due_date) : 0,
      next_payment: next, payments: by[d.id] || [], start_date: d.start_date,
    };
  });
  const open = items.filter((x) => !x.closed);
  const sum = (dir) => open.filter((x) => x.direction === dir).reduce((s, x) => s + x.remaining, 0);
  const order = (a, b) => (a.closed - b.closed) || ((a.due_date || "9999") < (b.due_date || "9999") ? -1 : (a.due_date || "9999") > (b.due_date || "9999") ? 1 : 0);
  return {
    summary: { receivables: sum("receivable"), payables: sum("payable"), net: sum("payable") - sum("receivable"), overdue: open.filter((x) => x.status === "overdue").length },
    items: items.sort(order),
  };
}

async function update(user, id, i) {
  const cur = (await db.query("select * from debts where id=$1 and user_id=$2", [id, user.id])).rows[0];
  if (!cur) throw new UserError("Qarz topilmadi");
  const who = i.who !== undefined ? String(i.who).trim().slice(0, 80) : cur.who;
  if (!who) throw new UserError("Kim ekanini yozing");
  const due = i.due_date !== undefined ? (i.due_date || null) : cur.due_date;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new UserError("Sana noto‘g‘ri");
  return (await db.query(
    `update debts set who=$3, due_date=$4, interest_pct=$5, monthly_payment=$6, pay_day=$7, note=$8 where id=$1 and user_id=$2 returning *`,
    [id, user.id, who, due, i.interest_pct !== undefined ? i.interest_pct : cur.interest_pct,
      i.monthly_payment !== undefined ? i.monthly_payment || null : cur.monthly_payment, i.pay_day !== undefined ? i.pay_day || null : cur.pay_day,
      i.note !== undefined ? i.note || null : cur.note])).rows[0];
}

// Qarzni o'chirish: bog'liq operatsiyalar ham o'chiriladi, balanslar qayta hisoblanadi
async function remove(user, id) {
  return db.tx(async (c) => {
    const q = c.query.bind(c);
    const d = (await q("select id from debts where id=$1 and user_id=$2 for update", [id, user.id])).rows[0];
    if (!d) throw new UserError("Qarz topilmadi");
    await q("update transactions set deleted_at=now() where debt_id=$1 and deleted_at is null", [id]);
    await q("delete from debt_payments where debt_id=$1", [id]);
    await q("delete from debts where id=$1", [id]);
    return true;
  });
}

module.exports = { createDebt, payDebt, listOpen, view, update, remove };
