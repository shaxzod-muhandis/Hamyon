// Sana yordamchilari. Sanalar 'YYYY-MM-DD' satr ko'rinishida (foydalanuvchi vaqt zonasida).
const MONTHS = ["yanvar","fevral","mart","aprel","may","iyun","iyul","avgust","sentabr","oktabr","noyabr","dekabr"];
const WEEKDAYS = ["yakshanba","dushanba","seshanba","chorshanba","payshanba","juma","shanba"];

function localDate(tz, d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function localHM(tz, d = new Date()) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = p.find((x) => x.type === "hour").value.replace("24", "00");
  return `${h}:${p.find((x) => x.type === "minute").value}`;
}
const toUTC = (s) => new Date(s + "T00:00:00Z");
const fromUTC = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => fromUTC(new Date(toUTC(s).getTime() + n * 86400000));
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 86400000); // a - b
const weekday = (s) => toUTC(s).getUTCDay(); // 0 = yakshanba
const ym = (s) => s.slice(0, 7);
const daysInMonth = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).getUTCDate();
const monthStart = (s) => s.slice(0, 7) + "-01";
const monthEnd = (s) => s.slice(0, 7) + "-" + String(daysInMonth(s)).padStart(2, "0");
function addMonths(s, n) {
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return fromUTC(d);
}
function withDay(monthAnyDay, day) {
  const dim = daysInMonth(monthAnyDay);
  return monthAnyDay.slice(0, 7) + "-" + String(Math.min(day, dim)).padStart(2, "0");
}
const dayNum = (s) => +s.slice(8, 10);
const monthName = (s) => MONTHS[+s.slice(5, 7) - 1];
const fmtDay = (s) => `${dayNum(s)}-${monthName(s)}`;
const fmtShort = (s) => `${dayNum(s)} ${monthName(s).slice(0, 3)}`;
const weekdayName = (s) => WEEKDAYS[weekday(s)];

// planned yozuv uchun [from, to] oralig'idagi barcha sanalar (ikkala chegara ham kiradi)
function occurrences(startDate, recurrence, from, to) {
  const out = [];
  if (recurrence === "none") {
    if (startDate >= from && startDate <= to) out.push(startDate);
    return out;
  }
  if (recurrence === "daily") {
    for (let d = from < startDate ? startDate : from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  if (recurrence === "weekly") {
    let d = startDate;
    if (d < from) d = addDays(d, Math.ceil(diffDays(from, d) / 7) * 7);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
    return out;
  }
  const baseDay = dayNum(startDate);
  if (recurrence === "monthly") {
    for (let m = monthStart(from > startDate ? from : startDate); m <= to; m = addMonths(m, 1)) {
      const d = withDay(m, baseDay);
      if (d >= startDate && d >= from && d <= to) out.push(d);
    }
    return out;
  }
  if (recurrence === "yearly") {
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      const m = startDate.slice(5, 7);
      const d = withDay(`${y}-${m}-01`, baseDay);
      if (d >= startDate && d >= from && d <= to) out.push(d);
    }
  }
  return out;
}

module.exports = {
  MONTHS, WEEKDAYS, localDate, localHM, addDays, diffDays, weekday, ym, daysInMonth, monthStart, monthEnd,
  addMonths, withDay, dayNum, monthName, fmtDay, fmtShort, weekdayName, occurrences,
};
