// Server bilan aloqa: Telegram initData yoki brauzer sessiyasi bilan.
let listeners = new Set();
export const net = { offlineSince: null };
export const onNet = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f(net.offlineSince));

export const auth = {
  header() {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) return "tma " + tg.initData;
    try { const t = localStorage.getItem("hamyon_token"); if (t) return "Bearer " + t; } catch {}
    return null;
  },
  set(token) { try { localStorage.setItem("hamyon_token", token); } catch {} },
  clear() { try { localStorage.removeItem("hamyon_token"); } catch {} },
};

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

export async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const a = auth.header();
  if (a) headers.Authorization = a;
  let res;
  try {
    res = await fetch("/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    if (!net.offlineSince) { net.offlineSince = new Date(); emit(); }
    throw new ApiError("offline", 0);
  }
  if (net.offlineSince) { net.offlineSince = null; emit(); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) { window.dispatchEvent(new CustomEvent("hamyon:unauth")); }
    throw new ApiError(data?.error || "Xatolik", res.status);
  }
  return data;
}
export const get = (p) => api("GET", p);
export const post = (p, b = {}) => api("POST", p, b);
export const put = (p, b = {}) => api("PUT", p, b);
export const del = (p) => api("DELETE", p);
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== "" && v != null) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };
