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

/** Replaces the text (and buttons) of a message already sent by the bot. */
export async function editMessageText(chatId, messageId, text, extra = {}) {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  return res.json();
}

/** Acknowledges an inline-button tap so Telegram stops the loading spinner. */
export async function answerCallbackQuery(callbackQueryId, text) {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    }),
  });
  return res.json();
}

/** Shows the "typing…" indicator while the AI extraction runs. */
export async function sendChatAction(chatId, action = 'typing') {
  await fetch(`${TELEGRAM_API}/bot${botToken()}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

/** Downloads a Telegram file (e.g. a voice note) and returns it as a Buffer. */
export async function downloadTelegramFile(fileId) {
  const infoRes = await fetch(
    `${TELEGRAM_API}/bot${botToken()}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const info = await infoRes.json();
  if (!info.ok || !info.result?.file_path) {
    throw new Error('No pude obtener el archivo de Telegram');
  }
  const fileRes = await fetch(`${TELEGRAM_API}/file/bot${botToken()}/${info.result.file_path}`);
  if (!fileRes.ok) throw new Error(`Descarga de audio falló: ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}
