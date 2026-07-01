import admin from 'firebase-admin';
import { getDb } from './utils/firebaseAdmin.js';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  sendChatAction,
} from './utils/telegram.js';
import { extractEvent } from './utils/openrouter.js';

/**
 * Netlify Function: telegram-webhook
 *
 * Phase 0: account linking via /start <code>.
 * Phase 1: a linked user sends a natural-language message ("agregá amcham hoy
 * de 6 a 19 con operación"); the LLM extracts a structured event, the bot asks
 * for confirmation with inline buttons, and on confirm it writes to `eventos`
 * with the userId taken from the verified link (never from the message).
 *
 * Security: Telegram sends a secret token header (set via setWebhook) that must
 * match TELEGRAM_WEBHOOK_SECRET.
 */
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = event.headers['x-telegram-bot-api-secret-token'];
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let update;
  try {
    update = JSON.parse(event.body);
  } catch {
    return { statusCode: 200, body: 'ok' };
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return { statusCode: 200, body: 'ok' };
    }

    const message = update.message;
    const chatId = message?.chat?.id;
    const text = (message?.text || '').trim();
    if (!chatId) return { statusCode: 200, body: 'ok' };

    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1];
      if (!code) {
        await sendMessage(
          chatId,
          'Para vincular tu cuenta, abrí <b>Ajustes → Vincular Telegram</b> en la app y enviame el código con <code>/start CODIGO</code>.'
        );
      } else {
        await handleLink(chatId, code, message.from);
      }
      return { statusCode: 200, body: 'ok' };
    }

    // Any other text from a linked user is treated as an event to load.
    const db = getDb();
    const linkSnap = await db.collection('telegramLinks').doc(String(chatId)).get();
    if (!linkSnap.exists) {
      await sendMessage(
        chatId,
        'Tu cuenta todavía no está vinculada. Abrí <b>Ajustes → Vincular Telegram</b> en la app para conectarla.'
      );
      return { statusCode: 200, body: 'ok' };
    }

    await handleEventMessage(chatId, text, linkSnap.data().userId);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('telegram-webhook error:', err);
    const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
    if (chatId) {
      try {
        await sendMessage(chatId, 'Ocurrió un error procesando tu mensaje. Probá de nuevo en un momento.');
      } catch { /* ignore */ }
    }
    return { statusCode: 200, body: 'ok' };
  }
}

/* ------------------------------- Linking -------------------------------- */

async function handleLink(chatId, code, from) {
  const db = getDb();
  const tokenRef = db.collection('telegramLinkTokens').doc(code.toUpperCase());
  const tokenSnap = await tokenRef.get();

  if (!tokenSnap.exists) {
    await sendMessage(chatId, '❌ Código inválido. Generá uno nuevo en <b>Ajustes → Vincular Telegram</b>.');
    return;
  }

  const data = tokenSnap.data();
  if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
    await tokenRef.delete();
    await sendMessage(chatId, '❌ El código venció. Generá uno nuevo en la app.');
    return;
  }

  await db.collection('telegramLinks').doc(String(chatId)).set({
    userId: data.userId,
    telegramUsername: from?.username || null,
    telegramFirstName: from?.first_name || null,
    linkedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await tokenRef.delete();

  await sendMessage(
    chatId,
    '✅ ¡Listo! Tu cuenta quedó vinculada.\n\nAhora podés cargar eventos escribiéndome, por ejemplo:\n<i>"agregá amcham hoy de 6 a 19 con operación"</i>'
  );
}

/* ---------------------------- Event handling ---------------------------- */

const PENDING_TTL_MS = 15 * 60 * 1000;

function randomId(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < length; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function validateEvent(raw) {
  if (!raw || raw.understood === false) return null;
  const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

  if (typeof raw.evento !== 'string' || !raw.evento.trim()) return null;
  if (!isDate(raw.fecha)) return null;
  if (!isTime(raw.horaEntrada) || !isTime(raw.horaSalida)) return null;

  return {
    evento: raw.evento.trim(),
    fecha: raw.fecha,
    horaEntrada: raw.horaEntrada,
    horaSalida: raw.horaSalida,
    operacion: raw.operacion === true,
    feriado: raw.feriado === true,
  };
}

function formatConfirm(ev) {
  const [y, m, d] = ev.fecha.split('-');
  return (
    `Entendí esto:\n\n` +
    `📋 <b>${ev.evento}</b>\n` +
    `📅 ${d}/${m}/${y}\n` +
    `🕐 ${ev.horaEntrada} – ${ev.horaSalida}\n` +
    `⚙️ Operación: ${ev.operacion ? 'Sí' : 'No'}` +
    (ev.feriado ? `\n🎌 Feriado: Sí` : '') +
    `\n\n¿Lo cargo en tu planilla?`
  );
}

async function handleEventMessage(chatId, text, userId) {
  await sendChatAction(chatId, 'typing');

  let raw;
  try {
    raw = await extractEvent(text);
  } catch (err) {
    console.error('extractEvent error:', err);
    await sendMessage(chatId, 'No pude procesar el mensaje con la IA. Probá de nuevo en un momento.');
    return;
  }

  const ev = validateEvent(raw);
  if (!ev) {
    await sendMessage(
      chatId,
      'No entendí bien el evento 🤔. Probá con algo como:\n<i>"agregá amcham hoy de 6 a 19 con operación"</i>\n(nombre + hora de entrada + hora de salida)'
    );
    return;
  }

  const db = getDb();
  const id = randomId();
  await db.collection('telegramPending').doc(id).set({
    chatId: String(chatId),
    userId,
    event: ev,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });

  await sendMessage(chatId, formatConfirm(ev), {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Confirmar', callback_data: `ok:${id}` },
        { text: '❌ Cancelar', callback_data: `no:${id}` },
      ]],
    },
  });
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const [action, id] = (cb.data || '').split(':');

  await answerCallbackQuery(cb.id);
  if (!chatId || !id) return;

  const db = getDb();
  const pendingRef = db.collection('telegramPending').doc(id);
  const snap = await pendingRef.get();

  if (!snap.exists) {
    await editMessageText(chatId, messageId, '⚠️ Este pedido venció. Mandame el evento otra vez.');
    return;
  }

  const pending = snap.data();
  // The confirming chat must be the same one that created the request.
  if (String(pending.chatId) !== String(chatId)) {
    return;
  }

  if (action === 'no') {
    await pendingRef.delete();
    await editMessageText(chatId, messageId, '❌ Cancelado. No cargué nada.');
    return;
  }

  if (action === 'ok') {
    const ev = pending.event;
    await db.collection('eventos').add({
      userId: pending.userId,
      evento: ev.evento,
      fecha: ev.fecha,
      horaEntrada: ev.horaEntrada,
      horaSalida: ev.horaSalida,
      operacion: ev.operacion,
      feriado: ev.feriado,
      source: 'telegram',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await pendingRef.delete();
    await editMessageText(
      chatId,
      messageId,
      `✅ ¡Cargado! <b>${ev.evento}</b> quedó en tu planilla.`
    );
  }
}
