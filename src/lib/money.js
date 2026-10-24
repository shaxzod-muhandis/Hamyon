// So'm formatlash va kiritilgan summani tahlil qilish (TZ 1.6).
const NB = " ";
const MINUS = "−";

function group(n) {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
}
const sign = (n) => (n < 0 ? MINUS : "");
// 7 655 000 so‘m
const fmt = (n) => `${sign(n)}${group(n)}${NB}so‘m`;
// +7 655 000 / −145 000  (so'msiz, yonida belgi bilan)
const fmtSigned = (n, plus = true) => `${n < 0 ? MINUS : plus ? "+" : ""}${group(n)}`;
// 7,66 mln  (10 mln dan katta bo'lsa bitta kasr, kichik bo'lsa ikkita, oxirgi nollar tashlanadi)
function short(n) {
  const a = Math.abs(n);
  if (a >= 1e5) {
    const v = a / 1e6;
    const s = Number(v.toFixed(v >= 10 ? 1 : 2)).toString().replace(".", ",");
    return `${sign(n)}${s} mln`;
  }
  return `${sign(n)}${group(a)}`;
}
const fmtUsd = (cents) => `${sign(cents)}$${group(Math.round(Math.abs(cents) / 100))}`;

const UNITS = { k: 1e3, ming: 1e3, "к": 1e3, m: 1e6, mln: 1e6, million: 1e6, "млн": 1e6, mlrd: 1e9, milliard: 1e9 };

// "45000", "45 000", "45k", "1.5mln", "1,5 mln", "45.000" -> son yoki null
function parseAmount(input) {
  if (input == null) return null;
  let s = String(input).toLowerCase().trim().replace(/ /g, " ").replace(/so['‘’ʻ`]?m$/, "").trim();
  const m = s.match(/^(\d[\d\s.,]*?)\s*([a-zк-я]+)?$/i);
  if (!m) return null;
  let num = m[1].trim();
  const unit = m[2] ? UNITS[m[2]] : undefined;
  if (m[2] && !unit) return null;
  let v;
  if (unit) {
    num = num.replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(num)) return null;
    v = Math.round(parseFloat(num) * unit);
  } else {
    // 45 000 / 45.000 / 1,000,000 — minglik ajratgich; boshqa nuqta/vergul — noto'g'ri
    const compact = num.replace(/\s/g, "");
    if (/^\d+$/.test(compact)) v = parseInt(compact, 10);
    else if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) v = parseInt(compact.replace(/[.,]/g, ""), 10);
    else return null;
  }
  if (!Number.isFinite(v) || v <= 0 || v > 999999999999) return null;
  return v;
}

module.exports = { NB, MINUS, group, fmt, fmtSigned, short, fmtUsd, parseAmount };
