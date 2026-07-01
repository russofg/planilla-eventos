const TELEGRAM_API = 'https://api.telegram.org';

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN env var is not set');
  return token;
}

/**
 * Sends a text message back to a Telegram chat.
 * Uses HTML parse mode so we can bold/format the confirmation replies.
 */
export async function sendMessage(chatId, text, extra = {}) {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  return res.json();
}
