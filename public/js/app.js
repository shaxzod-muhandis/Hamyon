// Hamyon: SPA karkasi — marshrutlash, yon/pastki menyu, mavzu, Telegram integratsiyasi, offline holat.
import { h, clear, icon, cap, fmtDay, weekdayName, monthName, toast, skel, errorBox, openModal } from "./ui.js";
import { get, auth, onNet, net, ApiError } from "./api.js";
import { openTxForm } from "./txform.js";

export const store = { meta: null, today: null, badges: { debts: 0, budget: 0 } };
const tg = window.Telegram?.WebApp;
const inTelegram = !!tg?.initData;

const PAGES = [
  { path: "/", key: "dashboard", name: "Asosiy", ico: "home", mod: "dashboard" },
  { path: "/transactions", key: "transactions", name: "Kirim va chiqim", short: "Operatsiya", ico: "swap", mod: "transactions" },
  { path: "/accounts", key: "accounts", name: "Hisoblar", ico: "wallet", mod: "accounts" },
  { path: "/debts", key: "debts", name: "Qarzlar", ico: "repeat", mod: "debts", badge: "debts" },
  { path: "/budget", key: "budget", name: "Budjet", ico: "pie", mod: "budget", badge: "budget" },
  { path: "/plan", key: "plan", name: "Reja va prognoz", short: "Reja", ico: "trend", mod: "plan" },
  { path: "/analytics", key: "analytics", name: "Tahlil", ico: "bars", mod: "analytics", group: true },
  { path: "/reminders", key: "reminders", name: "Eslatmalar", ico: "bell", mod: "reminders" },
  { path: "/settings", key: "settings", name: "Sozlamalar", ico: "sliders", mod: "settings" },
];

// ── Mavzu (TZ 1.2, 13) ─────────────────────────────────
export function applyTheme(pref) {
  const root = document.documentElement;
  let t = pref;
  if (pref === "system") t = tg?.colorScheme === "dark" ? "dark" : null;
  if (t) root.setAttribute("data-theme", t); else root.removeAttribute("data-theme");
}
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark" || (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);

// ── Kirish ekrani (brauzer) ────────────────────────────
async function showLogin(msg) {
  const root = document.getElementById("root");
  const cfg = await get("/config").catch(() => ({}));
  const box = h("div", { class: "box" },
    h("div", { class: "lg" }, "HM"), h("h1", { style: { fontSize: "26px", fontWeight: 900 } }, "Hamyon"),
    h("p", { class: "muted" }, "Shaxsiy moliyangiz bir joyda"),
    msg ? h("div", { class: "msgbox red" }, msg) : null);
  const slot = h("div", { style: { minHeight: "48px" } });
  box.append(slot);
  if (cfg.bot_username) {
    window.onTelegramAuth = async (user) => {
      try {
        const r = await fetch("/api/auth/widget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) });
        const d = await r.json();
        if (!r.ok) return showLogin(d.error || "Kirish tasdiqlanmadi");
        auth.set(d.token);
        location.reload();
      } catch { showLogin("Internet bilan aloqa yo‘q"); }
    };
    const sc = document.createElement("script");
    sc.async = true; sc.src = "https://telegram.org/js/telegram-widget.js?22";
    sc.dataset.telegramLogin = cfg.bot_username; sc.dataset.size = "large"; sc.dataset.radius = "12";
    sc.dataset.onauth = "onTelegramAuth(user)"; sc.dataset.requestAccess = "write";
    slot.append(sc);
  } else {
    slot.append(h("a", { class: "btn pri lg", href: "https://t.me/" }, icon("send"), "Telegram orqali kirish"));
  }
  box.append(h("p", { class: "hint" }, "Avval botda /start bosgan bo‘lishingiz kerak."));
  clear(root).append(h("div", { class: "login" }, box));
}

// ── Karkas ─────────────────────────────────────────────
let current = { path: null, page: null };
let pageEl, headEl, navEls = {}, offlineEl;
const mods = {};
const loadMod = async (name) => (mods[name] ||= (await import(`./pages/${name}.js`)).default);

function navLink(p, cls, label) {
  const a = h("a", { href: p.path, class: cls, "data-link": true, "aria-label": p.name }, icon(p.ico), label ?? p.name);
  if (p.badge) a.append(h("span", { class: "badge", hidden: true, "data-badge": p.badge }));
  return a;
}

function buildShell() {
  const root = clear(document.getElementById("root"));
  const side = h("aside", { class: "side" },
    h("div", { class: "logo" }, h("b", null, "HM"), h("div", null, h("strong", null, "Hamyon"), h("small", null, "Shaxsiy moliya"))),
    ...PAGES.slice(0, 6).map((p) => navLink(p, "nl")),
    h("div", { class: "grp" }, "Tahlil va sozlamalar"),
    ...PAGES.slice(6).map((p) => navLink(p, "nl")),
    h("div", { class: "me" }, h("div", { class: "av" }, (store.meta.user.first_name || "H")[0].toUpperCase()),
      h("div", null, h("b", null, store.meta.user.first_name || "Foydalanuvchi"), h("small", null, "Telegram orqali kirgan"))));
  headEl = h("div", { class: "topbar" });
  offlineEl = h("div", { class: "offline", hidden: true });
  pageEl = h("div", { id: "page", class: "stack" });
  const main = h("main", { class: "main", id: "main" }, h("div", { class: "content" }, offlineEl, headEl, pageEl));
  const bnav = h("nav", { class: "bnav", "aria-label": "Asosiy menyu" },
    navLink(PAGES[0], "nb", "Asosiy"),
    navLink(PAGES[1], "nb", "Operatsiya"),
    h("button", { class: "nb fab", "aria-label": "Yangi operatsiya", onClick: () => newTx() }, h("span", null, icon("plus")), h("small", { style: { marginTop: "26px" } }, "")),
    navLink(PAGES[5], "nb", "Reja"),
    h("button", { class: "nb", "data-menu": true, onClick: openMenu }, icon("menu"), "Menyu"));
  root.append(h("div", { class: "app" }, side, main), bnav);
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (a && a.origin === location.origin) { e.preventDefault(); closeMenu(); navigate(a.getAttribute("href")); }
  });
  onNet(updateOffline);
}

let menuApi;
const closeMenu = () => menuApi?.close();
function openMenu() {
  menuApi = openModal((m, api) => {
    m.append(h("div", { class: "mh" }, h("h2", null, "Menyu"), h("button", { class: "iconbtn", "aria-label": "Yopish", onClick: () => api.close() }, icon("x"))),
      h("div", { class: "list" }, ...PAGES.map((p) => {
        const a = h("a", { href: p.path, class: "li", "data-link": true }, icon(p.ico), h("div", { class: "t" }, h("b", null, p.name)), icon("chev"));
        const n = p.badge && store.badges[p.badge];
        if (n) a.insertBefore(h("span", { class: "badge" }, n), a.lastChild);
        return a;
      })));
  });
}

function updateOffline(since) {
  if (!since) { offlineEl.hidden = true; return; }
  const t = since.toLocaleTimeString("uz", { hour: "2-digit", minute: "2-digit" });
  clear(offlineEl).append(h("span", null, `Internet bilan aloqa yo‘q. Ko‘rsatilgan ma’lumotlar ${t} holatiga.`),
    h("button", { class: "btn", onClick: () => reload() }, "Qayta urinish"));
  offlineEl.hidden = false;
}

function paintNav() {
  const path = current.path;
  document.querySelectorAll(".side a.nl, .bnav a.nb").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === path));
  const mainOnes = ["/", "/transactions", "/plan"];
  document.querySelector(".bnav [data-menu]")?.classList.toggle("on", !mainOnes.includes(path));
  document.querySelectorAll("[data-badge]").forEach((b) => { const n = store.badges[b.dataset.badge]; b.textContent = n; b.hidden = !n; });
}

export async function loadBadges() {
  try { store.badges = await get("/badges"); paintNav(); } catch {}
}
export async function loadMeta() {
  store.meta = await get("/meta");
  store.today = store.meta.today;
  applyTheme(store.meta.user.theme);
  return store.meta;
}

// ── Marshrutlash ───────────────────────────────────────
export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) { reload(); return; }
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  render(true);
}
const cache = new Map();
export async function cached(path) {
  try { const d = await get(path); cache.set(path, d); return d; }
  catch (e) { if (e.status === 0 && cache.has(path)) return cache.get(path); throw e; }
}

let renderToken = 0;
async function render(resetScroll = true, silent = false) {
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const meta = PAGES.find((p) => p.path === path) || PAGES[0];
  const token = ++renderToken;
  current = { path: meta.path, page: meta };
  paintNav();
  document.title = `${meta.name} — Hamyon`;
  if (tg?.BackButton) { meta.path === "/" ? tg.BackButton.hide() : tg.BackButton.show(); }
  if (resetScroll) document.getElementById("main")?.scrollTo(0, 0);
  const mod = await loadMod(meta.mod);
  const ctx = {
    query: url.searchParams, silent, today: store.today, reload: () => reload(), cached,
    setHead(title, sub) { headEl.replaceChildren(...headTitle(title, sub)); },
  };
  headEl.replaceChildren(...headTitle(meta.name, mod.sub?.(store) || ""));
  if (!silent) pageEl.replaceChildren(skel(140), skel(220));
  try {
    const out = await mod.render(ctx);
    if (token !== renderToken) return;
    pageEl.replaceChildren(...[].concat(out).filter(Boolean));
    mod.after?.(pageEl, ctx);
  } catch (e) {
    if (token !== renderToken) return;
    if (e.status === 401) return;
    if (!silent) pageEl.replaceChildren(h("div", { class: "panel" }, errorBox(() => reload())));
    console.error(e);
  }
  loadBadges();
}
function headTitle(title, sub) {
  return [
    h("div", { class: "ttl" }, h("h1", null, title), sub ? h("div", { class: "sub" }, sub) : null),
    h("button", { class: "iconbtn", "aria-label": "Yorug‘ yoki qorong‘i rejim", onClick: toggleTheme }, icon(isDark() ? "sun" : "moon")),
    h("button", { class: "btn pri desk-only", onClick: () => newTx() }, icon("plus"), "Operatsiya"),
  ];
}
async function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  applyTheme(next);
  store.meta.user.theme = next;
  const btn = headEl.querySelector(".iconbtn");
  if (btn) btn.replaceChildren(icon(next === "dark" ? "sun" : "moon"));
  fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: auth.header() }, body: JSON.stringify({ theme: next }) }).catch(() => {});
}
export function reload() { return render(false, false); }
export const refreshSilently = () => {
  if (document.querySelector(".scrim") || pageEl.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  return render(false, true);
};

export function newTx(opts = {}) {
  openTxForm({ ...opts, store, onSaved: async () => { await loadMeta(); refreshSilently(); loadBadges(); } });
}

// ── Boshlanish ─────────────────────────────────────────
async function boot() {
  if (tg) {
    tg.ready(); tg.expand?.();
    const setSafe = () => document.documentElement.style.setProperty("--tg-safe-bottom", (tg.safeAreaInset?.bottom || 0) + "px");
    setSafe(); tg.onEvent?.("safeAreaChanged", setSafe);
    tg.BackButton?.onClick(() => history.back());
  }
  window.addEventListener("hamyon:unauth", () => { if (!inTelegram) { auth.clear(); showLogin("Sessiya tugagan. Qayta kiring."); } });
  if (!auth.header()) return showLogin();
  try {
    await loadMeta();
  } catch (e) {
    if (e.status === 403) return showLogin(e.message);
    if (e.status === 401) return inTelegram ? document.getElementById("root").replaceChildren(h("div", { class: "login" }, h("div", { class: "msgbox red" }, "Telegram orqali tasdiqlanmadi. Ilovani bot ichidan qayta oching."))) : showLogin();
    return document.getElementById("root").replaceChildren(h("div", { class: "login" }, errorBox(() => location.reload())));
  }
  buildShell();
  window.addEventListener("popstate", () => render(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSilently(); });
  setInterval(() => { if (!document.hidden) refreshSilently(); }, 60000);
  await render(true);
}
boot();
