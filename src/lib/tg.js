// Telegram Bot API (kutubxonasiz). Testda transport almashtiriladi.
const db = require("./db");

let transport = async (method, payload) => {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, description: "BOT_TOKEN yo'q" };
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({ ok: false, description: "JSON emas" }));
};
const setTransport = (fn) => { transport = fn; };

async function call(method, payload) {
  try {
    const res = await transport(method, payload);
    if (!res.ok) console.error(`TG ${method} xato:`, res.description);
    return res;
  } catch (e) {
    console.error(`TG ${method} fetch xato:`, e.message);
    return { ok: false, description: e.message };
  }
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function send(chatId, text, markup, log = false) {
  const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (markup) body.reply_markup = markup;
  const res = await call("sendMessage", body);
  if (log) {
    await db.query(
      "insert into notification_log (chat_id, message, status, error) values ($1,$2,$3,$4)",
      [String(chatId), text, res.ok ? "sent" : "error", res.ok ? null : res.description],
    ).catch(() => {});
  }
  return res;
}
const edit = (chatId, messageId, text, markup) =>
  call("editMessageText", {
    chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: markup || { inline_keyboard: [] },
  });
const answer = (id, text, alert = false) => call("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });

module.exports = { setTransport, call, send, edit, answer, esc };
