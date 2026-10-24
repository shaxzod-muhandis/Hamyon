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

module.exports = { createDebt, payDebt, listOpen };
