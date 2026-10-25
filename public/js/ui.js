// Umumiy yordamchilar: DOM, formatlash (TZ 1.6, 1.7), ikonkalar, toast, modal.
const NB = " ";
export const MINUS = "−";

// ── DOM ────────────────────────────────────────────────
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { el.replaceChildren(); return el; };

// ── Formatlash ─────────────────────────────────────────
export const group = (n) => String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const sign = (n) => (n < 0 ? MINUS : "");
export const fmt = (n) => `${sign(n)}${group(n)}${NB}so‘m`;
export const fmtUsd = (cents) => `${sign(cents)}$${group(Math.round(Math.abs(cents) / 100))}`;
export const money = (n, cur) => (cur === "USD" ? fmtUsd(n) : fmt(n));
export function short(n) {
  const a = Math.abs(n);
  if (a >= 1e5) {
    const v = a / 1e6;
    return `${sign(n)}${Number(v.toFixed(v >= 10 ? 1 : 2)).toString().replace(".", ",")} mln`;
  }
  return `${sign(n)}${group(a)}`;
}
export const signed = (n) => `${n < 0 ? MINUS : "+"}${group(n)}`;
// Foiz o'zgarishi (TZ 1.7): { text, cls }. tone: up | down | neutral
export function change(cur, prev, tone = "up") {
  if (!prev) return cur > 0 ? { text: "yangi", cls: "" } : { text: "—", cls: "" };
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const text = p > 0 ? `▲ +${p}%` : p < 0 ? `▼ −${Math.abs(p)}%` : "0%";
  let cls = "";
  if (p !== 0 && tone !== "neutral") cls = (tone === "up") === (p > 0) ? "g" : "a";
  return { text, cls };
}
export const pill = (c) => h("span", { class: "pill " + c.cls }, c.text);

// ── Sana ───────────────────────────────────────────────
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const utc = (s) => new Date(s + "T00:00:00Z");
export const dayNum = (s) => +s.slice(8, 10);
export const monthName = (s) => MONTHS[+s.slice(5, 7) - 1];
export const fmtDay = (s) => `${dayNum(s)}-${monthName(s)}`;
export const fmtShort = (s) => `${dayNum(s)} ${monthName(s).slice(0, 3)}`;
export const weekdayName = (s) => WEEKDAYS[utc(s).getUTCDay()];
export const addDays = (s, n) => new Date(utc(s).getTime() + n * 864e5).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / 864e5);
export const daysInMonth = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).getUTCDate();
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const longDay = (s, today) => `${fmtDay(s).toUpperCase()} · ${weekdayName(s).toUpperCase()}${s === today ? " · BUGUN" : ""}`;

// ── Ikonkalar (chiziqli, Lucide uslubi) ────────────────
const PATHS = {
  home: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  swap: "M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7h15a2 2 0 0 1 2 2v2h-4a2 2 0 0 0 0 4h4",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  pie: "M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z",
  trend: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  bars: "M12 20V10M18 20V4M6 20v-4",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41",
  plus: "M12 5v14M5 12h14",
  x: "M18 6L6 18M6 6l12 12",
  chev: "M9 18l6-6-6-6",
  arrow: "M5 12h14M12 5l7 7-7 7",
  search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  cal: "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18",
  check: "M20 6L9 17l-5-5",
  menu: "M3 12h18M3 6h18M3 18h18",
  more: "M12 12h.01M19 12h.01M5 12h.01",
  back: "M21 4H8l-7 8 7 8h13zM18 9l-6 6M12 9l6 6",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  warn: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
};
export function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "ic");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", PATHS[name] || "");
  s.append(p);
  return s;
}

// ── Kategoriya belgisi ─────────────────────────────────
export function catIcon(color, letter, big = false) {
  const c = color || "#8a93a0";
  return h("div", { class: "ico", style: { background: c + "22", color: c } }, (letter || "?").slice(0, 1).toUpperCase());
}
export const transferIcon = () => h("div", { class: "ico", style: { background: "var(--chip)", color: "var(--ink2)" } }, "⇄");

// ── Toast (TZ 3.3) ─────────────────────────────────────
let toastEl, toastTimer;
export function toast(text, action) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  toastEl = h("div", { class: "toast", role: "status" }, h("span", null, text),
    action ? h("button", { onClick: () => { action.run(); toastEl?.remove(); } }, action.label) : null);
  document.body.append(toastEl);
  toastTimer = setTimeout(() => toastEl?.remove(), action ? 5000 : 2600);
}

// ── Modal (fokus tuzog'i, Esc, scrim) ──────────────────
export function openModal(build, { onClose, canClose } = {}) {
  const opener = document.activeElement;
  const scrim = h("div", { class: "scrim" });
  const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true", style: { outline: "none" } });
  scrim.append(modal);
  let closed = false;
  const api = {
    el: modal,
    close(force = true) {
      if (closed) return;
      if (!force && canClose && !canClose()) return;
      closed = true;
      scrim.remove();
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
      onClose?.();
      opener?.focus?.();
    },
  };
  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); api.close(false); }
    if (e.key === "Tab") {
      const f = [...modal.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) api.close(false); });
  document.addEventListener("keydown", onKey, true);
  document.body.style.overflow = "hidden";
  build(modal, api);
  document.body.append(scrim);
  const af = modal.querySelector("[data-autofocus]");
  if (af) af.focus({ preventScroll: true });
  else { modal.setAttribute("tabindex", "-1"); modal.focus({ preventScroll: true }); }
  return api;
}

export function confirmBox(title, text, okLabel = "Ha", danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal((m, api) => {
      m.append(
        h("div", { class: "mh" }, h("h2", null, title)),
        text ? h("p", { class: "muted" }, text) : null,
        h("div", { class: "gap8" },
          h("button", { class: "btn block", onClick: () => { finish(false); api.close(); } }, "Bekor"),
          h("button", { class: "btn block " + (danger ? "dng" : "pri"), "data-autofocus": true, onClick: () => { finish(true); api.close(); } }, okLabel)));
    }, { onClose: () => finish(false) });
  });
}

// ── Skelet / xato ──────────────────────────────────────
export const skel = (hgt = 120) => h("div", { class: "skel", style: { height: hgt + "px" } });
export function errorBox(retry) {
  return h("div", { class: "errbox" }, h("p", null, "Ma’lumotni yuklab bo‘lmadi"), h("button", { class: "btn", style: { marginTop: "10px" }, onClick: retry }, "Qayta urinish"));
}
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Raqamli maydon: faqat raqam, 12 xonagacha, bo'shliq bilan guruhlanadi
export function bindMoneyInput(input, onChange) {
  const apply = () => {
    const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 12);
    input.value = digits ? group(+digits).replace(/ /g, " ") : "";
    onChange?.(digits ? +digits : 0);
  };
  input.addEventListener("input", apply);
  return apply;
}
export const parseDigits = (s) => +(String(s).replace(/\D/g, "") || 0);
