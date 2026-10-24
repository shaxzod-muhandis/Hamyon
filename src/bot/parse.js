// Bot'ga yozilgan matnni tahlil qilish: "45000 non", "45k korzinka", "+5mln oylik", "korzinka 45 000 kecha"
const { parseAmount } = require("../lib/money");
const { norm } = require("../services/users");

const MAX_AMOUNT_TOKENS = 4; // "1 500 000" yoki "1.5 mln"

function findAmount(tokens, fromStart) {
  for (let n = Math.min(MAX_AMOUNT_TOKENS, tokens.length); n >= 1; n--) {
    const part = fromStart ? tokens.slice(0, n) : tokens.slice(tokens.length - n);
    const a = parseAmount(part.join(" "));
    if (a) return { amount: a, rest: fromStart ? tokens.slice(n) : tokens.slice(0, tokens.length - n) };
  }
  return null;
}

// -> { kind: 'expense'|'income'|null, amount, note, daysAgo } | null
function parseEntry(text) {
  let s = String(text || "").trim();
  if (!s) return null;
  let kind = null;
  if (s[0] === "+") { kind = "income"; s = s.slice(1).trim(); }
  else if (/^[-−–]/.test(s)) { kind = "expense"; s = s.slice(1).trim(); }
  let daysAgo = 0;
  const tokens = s.split(/\s+/).filter((t) => {
    const n = norm(t);
    if (n === "kecha") { daysAgo = 1; return false; }
    if (n === "bugun") return false;
    return true;
  });
  if (!tokens.length) return null;
  const found = findAmount(tokens, true) || findAmount(tokens, false);
  if (!found) return null;
  return { kind, amount: found.amount, note: found.rest.join(" ").trim(), daysAgo };
}

// "10.11" yoki "10.11.2026" -> 'YYYY-MM-DD' (yil bo'lmasa — eng yaqin kelajak)
function parseDueDate(token, today) {
  const m = String(token || "").match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (!m) return null;
  const dd = +m[1], mm = +m[2];
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  const pad = (n) => String(n).padStart(2, "0");
  let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
  let d = `${y}-${pad(mm)}-${pad(dd)}`;
  if (!m[3] && d < today) d = `${y + 1}-${pad(mm)}-${pad(dd)}`;
  const chk = new Date(d + "T00:00:00Z");
  if (Number.isNaN(chk.getTime()) || chk.getUTCDate() !== dd) return null;
  return d;
}

module.exports = { parseEntry, parseDueDate };
