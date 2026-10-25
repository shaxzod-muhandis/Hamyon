// Oddiy SVG grafiklar (TZ 0, 4.2, 4.3, 11.1): interaktiv, matnli xulosa bilan birga ishlatiladi.
import { h, short, group, fmtDay, fmtShort, addDays, daysInMonth, monthName, MINUS } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
}
const line = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

// Konteyner kengligiga qarab qayta chizadigan wrapper
export function responsive(container, draw) {
  let w = 0;
  const run = () => {
    const nw = Math.round(container.clientWidth);
    if (!nw || nw === w) return;
    w = nw;
    draw(nw);
  };
  const ro = new ResizeObserver(run);
  ro.observe(container);
  requestAnimationFrame(run);
  return () => ro.disconnect();
}

function tooltip(wrap) {
  const t = h("div", { class: "tip", hidden: true });
  wrap.append(t);
  return {
    show(x, y, lines) {
      t.hidden = false;
      t.replaceChildren(...lines.map((l, i) => h("div", { style: i ? { opacity: ".8", fontWeight: 700 } : null }, l)));
      const tw = t.offsetWidth;
      t.style.left = Math.max(0, Math.min(wrap.clientWidth - tw, x - tw / 2)) + "px";
      t.style.top = Math.max(0, y - t.offsetHeight - 12) + "px";
    },
    hide() { t.hidden = true; },
  };
}

// ── Xarajat sur'ati (Dashboard C) ──────────────────────
// data: { cur: [jamlanma], prev: [jamlanma], projection, limit, monthStart: 'YYYY-MM-01', today }
export function paceChart(wrap, data, { onDay, label }) {
  const dim = daysInMonth(data.monthStart);
  const n = data.cur.length;
  const max = (Math.max(data.limit || 0, data.prev.at(-1) || 0, data.projection || 0, data.cur.at(-1) || 0) || 1) * 1.1;
  const tip = tooltip(wrap);
  let sel = -1;
  return responsive(wrap, (W) => {
    const H = 210, pl = 6, pr = 6, pt = 14, pb = 26;
    const iw = W - pl - pr, ih = H - pt - pb;
    const X = (d) => pl + ((d - 1) / (dim - 1)) * iw;
    const Y = (v) => pt + ih * (1 - v / max);
    const curPts = data.cur.map((v, i) => [X(i + 1), Y(v)]);
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": label });
    svg.append(s("line", { x1: pl, x2: W - pr, y1: Y(0), y2: Y(0), stroke: "var(--line)" }));
    if (data.limit) {
      svg.append(s("line", { x1: pl, x2: W - pr, y1: Y(data.limit), y2: Y(data.limit), stroke: "var(--amber)", "stroke-width": 2, "stroke-dasharray": "6 5" }));
      svg.append(s("text", { x: W - pr, y: Y(data.limit) - 6, "text-anchor": "end", style: "fill:var(--amber-ink)" }, `limit ${short(data.limit)}`));
    }
    const prevPts = data.prev.slice(0, dim).map((v, i) => [X(i + 1), Y(v)]);
    if (prevPts.length) svg.append(s("path", { d: line(prevPts), fill: "none", stroke: "var(--ink3)", "stroke-width": 2, "stroke-dasharray": "5 4" }));
    if (n) {
      svg.append(s("path", { d: `${line(curPts)} L${curPts.at(-1)[0]},${Y(0)} L${curPts[0][0]},${Y(0)} Z`, fill: "var(--blue-soft)" }));
      if (data.projection != null && n < dim)
        svg.append(s("path", { d: line([curPts.at(-1), [X(dim), Y(data.projection)]]), fill: "none", stroke: "var(--blue)", "stroke-width": 2.5, "stroke-dasharray": "2 5", "stroke-linecap": "round" }));
      svg.append(s("path", { d: line(curPts), fill: "none", stroke: "var(--blue)", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      svg.append(s("circle", { cx: curPts.at(-1)[0], cy: curPts.at(-1)[1], r: 7, fill: "var(--blue)", stroke: "var(--panel)", "stroke-width": 3 }));
    }
    const mm = monthName(data.monthStart);
    [[1, "start", `1-${mm.slice(0, 3)}`], [8, "middle", "8"], [15, "middle", "15"], [22, "middle", "22"], [dim, "end", `${dim}-${mm.slice(0, 3)}`]].forEach(([d, a, t]) =>
      svg.append(s("text", { x: X(d), y: H - 6, "text-anchor": a }, t)));
    const hover = s("line", { y1: pt, y2: Y(0), stroke: "var(--ink3)", "stroke-width": 1, visibility: "hidden" });
    svg.append(hover);
    const day = (e) => {
      const r = svg.getBoundingClientRect();
      return Math.max(1, Math.min(n || 1, Math.round(((e.clientX - r.left - pl) / iw) * (dim - 1)) + 1));
    };
    const showDay = (d) => {
      if (!n) return;
      const date = addDays(data.monthStart, d - 1);
      const spent = data.cur[d - 1] - (data.cur[d - 2] || 0);
      hover.setAttribute("x1", X(d)); hover.setAttribute("x2", X(d)); hover.setAttribute("visibility", "visible");
      tip.show(X(d), Y(data.cur[d - 1]), [fmtDay(date), `Shu kun: ${MINUS}${group(spent)}`, `Jami: ${MINUS}${group(data.cur[d - 1])}`]);
    };
    svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && n) { sel = day(e); showDay(sel); } });
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { tip.hide(); hover.setAttribute("visibility", "hidden"); } });
    svg.addEventListener("click", (e) => {
      if (!n) return;
      const d = day(e);
      if (sel === d) onDay?.(addDays(data.monthStart, d - 1));
      else { sel = d; showDay(d); }
    });
    wrap.querySelector("svg")?.remove();
    wrap.prepend(svg);
  });
}

// ── Prognoz grafigi (Dashboard F) ──────────────────────
// data: { points: [{date, balance}], threshold, min: {balance, date, below} }
export function forecastChart(wrap, data, { label }) {
  const pts = data.points;
  const lo = Math.min(...pts.map((p) => p.balance), data.threshold, 0);
  const hi = (Math.max(...pts.map((p) => p.balance), data.threshold) || 1) * 1.08;
  const tip = tooltip(wrap);
  return responsive(wrap, (W) => {
    const H = 200, pl = 6, pr = 6, pt = 18, pb = 26;
    const iw = W - pl - pr, ih = H - pt - pb;
    const X = (i) => pl + (i / Math.max(1, pts.length - 1)) * iw;
    const Y = (v) => pt + ih * (1 - (v - lo) / (hi - lo || 1));
    const P = pts.map((p, i) => [X(i), Y(p.balance)]);
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": label });
    svg.append(s("line", { x1: pl, x2: W - pr, y1: Y(0), y2: Y(0), stroke: "var(--line)" }));
    svg.append(s("path", { d: `${line(P)} L${P.at(-1)[0]},${Y(Math.max(lo, 0))} L${P[0][0]},${Y(Math.max(lo, 0))} Z`, fill: "var(--blue-soft)" }));
    svg.append(s("line", { x1: pl, x2: W - pr, y1: Y(data.threshold), y2: Y(data.threshold), stroke: "var(--red)", "stroke-width": 2, "stroke-dasharray": "6 5" }));
    svg.append(s("text", { x: W - pr, y: Y(data.threshold) - 6, "text-anchor": "end", style: "fill:var(--red-ink)" }, `xavfsiz chegara ${short(data.threshold)}`));
    svg.append(s("path", { d: line(P), fill: "none", stroke: "var(--blue)", "stroke-width": 2.5, "stroke-linejoin": "round" }));
    const mi = pts.findIndex((p) => p.date === data.min.date);
    if (mi >= 0) svg.append(s("circle", { cx: P[mi][0], cy: P[mi][1], r: 6, fill: data.min.below ? "var(--red)" : "var(--amber)", stroke: "var(--panel)", "stroke-width": 3 }));
    const idx = (date) => pts.findIndex((p) => p.date === date);
    const nm = pts.find((p) => p.date.endsWith("-01") && p.date !== pts[0].date)?.date;
    const labels = [[0, "start", fmtShort(pts[0].date)]];
    if (nm) { labels.push([idx(nm), "middle", fmtShort(nm)]); const m15 = nm.slice(0, 8) + "15"; if (idx(m15) > 0) labels.push([idx(m15), "middle", fmtShort(m15)]); }
    labels.push([pts.length - 1, "end", fmtShort(pts.at(-1).date)]);
    labels.forEach(([i, a, t]) => svg.append(s("text", { x: X(i), y: H - 6, "text-anchor": a }, t)));
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left - pl) / iw) * (pts.length - 1))));
      tip.show(X(i), Y(pts[i].balance), [fmtDay(pts[i].date), `Qoldiq: ${group(pts[i].balance).replace(/^/, pts[i].balance < 0 ? MINUS : "")}`]);
    });
    svg.addEventListener("pointerleave", () => tip.hide());
    wrap.querySelector("svg")?.remove();
    wrap.prepend(svg);
  });
}

// ── Oylik daromad/xarajat ustunlari (Tahlil 11.1) ──────
export function barsChart(wrap, rows, { currentMonth, onMonth, label }) {
  const max = (Math.max(...rows.flatMap((r) => [r.income, r.expense])) || 1) * 1.1;
  const tip = tooltip(wrap);
  return responsive(wrap, (W) => {
    const H = 230, pl = 4, pr = 4, pt = 10, pb = 28;
    const iw = W - pl - pr, ih = H - pt - pb;
    const slot = iw / rows.length, bw = Math.min(26, slot / 3);
    const Y = (v) => pt + ih * (1 - v / max);
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": label });
    svg.append(s("line", { x1: pl, x2: W - pr, y1: Y(0), y2: Y(0), stroke: "var(--line)" }));
    rows.forEach((r, i) => {
      const cx = pl + slot * i + slot / 2;
      const cur = r.month === currentMonth;
      const g = s("g", { opacity: cur ? 1 : 0.45, style: "cursor:pointer" });
      g.append(s("rect", { x: cx - bw - 2, y: Y(r.income), width: bw, height: Math.max(1, Y(0) - Y(r.income)), rx: 4, fill: "var(--green)" }));
      g.append(s("rect", { x: cx + 2, y: Y(r.expense), width: bw, height: Math.max(1, Y(0) - Y(r.expense)), rx: 4, fill: "var(--blue)" }));
      g.append(s("rect", { x: cx - slot / 2, y: 0, width: slot, height: H, fill: "transparent" }));
      g.addEventListener("pointerenter", () => tip.show(cx, Y(Math.max(r.income, r.expense)), [`${monthName(r.month + "-01")} ${r.month.slice(0, 4)}`, `Daromad +${group(r.income)}`, `Xarajat ${MINUS}${group(r.expense)}`]));
      g.addEventListener("pointerleave", () => tip.hide());
      g.addEventListener("click", () => onMonth?.(r.month));
      svg.append(g);
      svg.append(s("text", { x: cx, y: H - 8, "text-anchor": "middle", style: cur ? "font-weight:900;fill:var(--ink)" : "" }, monthName(r.month + "-01").slice(0, 3)));
    });
    wrap.querySelector("svg")?.remove();
    wrap.prepend(svg);
  });
}
