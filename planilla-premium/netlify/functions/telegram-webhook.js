import admin from 'firebase-admin';
import { getDb } from './utils/firebaseAdmin.js';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  sendChatAction,
} from './utils/telegram.js';
import { interpretMessage } from './utils/openrouter.js';

/**
 * Netlify Function: telegram-webhook
 *
 * Phase 0: account linking via /start <code>.
 * Phase 1+: a linked user writes in natural language; an LLM classifies the
 * intent (crear / borrar / editar) and extracts the fields. Creating and
 * deleting both go through an inline-button confirmation before touching
 * Firestore, and deletion disambiguates when several events match.
 *
 * Security: the userId always comes from the verified telegramLinks mapping,
 * never from the message. Telegram's secret-token header must match.
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

    const db = getDb();
    const linkSnap = await db.collection('telegramLinks').doc(String(chatId)).get();
    if (!linkSnap.exists) {
      await sendMessage(
        chatId,
        'Tu cuenta todavía no está vinculada. Abrí <b>Ajustes → Vincular Telegram</b> en la app para conectarla.'
      );
      return { statusCode: 200, body: 'ok' };
    }

    await handleUserText(chatId, text, linkSnap.data().userId);
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
    '✅ ¡Listo! Tu cuenta quedó vinculada.\n\n' +
      'Podés cargar eventos: <i>"agregá amcham hoy de 6 a 19 con operación"</i>\n' +
      'O borrarlos: <i>"borrá el amcham del 1 de julio"</i>'
  );
}

/* ---------------------------- Intent routing ---------------------------- */

async function handleUserText(chatId, text, userId) {
  await sendChatAction(chatId, 'typing');

  let intent;
  try {
    intent = await interpretMessage(text);
  } catch (err) {
    console.error('interpretMessage error:', err);
    await sendMessage(chatId, 'No pude procesar el mensaje con la IA. Probá de nuevo en un momento.');
    return;
  }

  switch (intent?.action) {
    case 'crear':
      return handleCreate(chatId, userId, intent);
    case 'borrar':
      return handleDelete(chatId, userId, intent);
    case 'editar':
      await sendMessage(
        chatId,
        '✏️ Editar todavía no está disponible (viene pronto). Por ahora podés borrar el evento y cargarlo de nuevo.'
      );
      return;
    default:
      await sendMessage(
        chatId,
        'No entendí bien 🤔. Podés:\n' +
          '• <b>Cargar</b>: "agregá amcham hoy de 6 a 19 con operación"\n' +
          '• <b>Borrar</b>: "borrá el amcham del 1 de julio"'
      );
  }
}

/* -------------------------------- Helpers ------------------------------- */

const PENDING_TTL_MS = 15 * 60 * 1000;

function randomId(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < length; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

function formatEventLine(e) {
  const [y, m, d] = (e.fecha || '').split('-');
  const fecha = y ? `${d}/${m}/${y}` : e.fecha;
  return `📋 <b>${e.evento}</b> — ${fecha} · ${e.horaEntrada}–${e.horaSalida}${e.operacion ? ' · ⚙️ Op.' : ''}`;
}

/* --------------------------------- Create ------------------------------- */

function validateNewEvent(raw) {
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

async function handleCreate(chatId, userId, intent) {
  const ev = validateNewEvent(intent);
  if (!ev) {
    await sendMessage(
      chatId,
      'No entendí bien el evento 🤔. Probá con algo como:\n' +
        '<i>"agregá amcham hoy de 6 a 19 con operación"</i>\n(nombre + hora de entrada + hora de salida)'
    );
    return;
  }

  const db = getDb();
  const id = randomId();
  await db.collection('telegramPending').doc(id).set({
    chatId: String(chatId),
    userId,
    action: 'create',
    event: ev,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });

  const [y, m, d] = ev.fecha.split('-');
  await sendMessage(
    chatId,
    `Entendí esto:\n\n📋 <b>${ev.evento}</b>\n📅 ${d}/${m}/${y}\n🕐 ${ev.horaEntrada} – ${ev.horaSalida}\n` +
      `⚙️ Operación: ${ev.operacion ? 'Sí' : 'No'}${ev.feriado ? '\n🎌 Feriado: Sí' : ''}\n\n¿Lo cargo en tu planilla?`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirmar', callback_data: `ok:${id}` },
          { text: '❌ Cancelar', callback_data: `no:${id}` },
        ]],
      },
    }
  );
}

/* --------------------------------- Delete ------------------------------- */

async function handleDelete(chatId, userId, intent) {
  const db = getDb();

  const fecha = isDate(intent.fecha) ? intent.fecha : null;
  const nameFilter = typeof intent.evento === 'string' ? intent.evento.trim().toLowerCase() : '';
  const horaFilter = isTime(intent.horaEntrada) ? intent.horaEntrada : null;

  if (!fecha && !nameFilter) {
    await sendMessage(
      chatId,
      'Decime qué evento borrar con la fecha o el nombre, ej: <i>"borrá el amcham del 1 de julio"</i>.'
    );
    return;
  }

  // Fetch the user's events and filter locally (no composite index needed).
  const snap = await db.collection('eventos').where('userId', '==', userId).get();
  let candidates = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  if (fecha) candidates = candidates.filter((e) => e.fecha === fecha);
  if (nameFilter) candidates = candidates.filter((e) => (e.evento || '').toLowerCase().includes(nameFilter));
  if (horaFilter) candidates = candidates.filter((e) => e.horaEntrada === horaFilter);

  if (candidates.length === 0) {
    await sendMessage(chatId, 'No encontré ningún evento con esos datos. Revisá la fecha o el nombre.');
    return;
  }

  const pid = randomId();
  await db.collection('telegramPending').doc(pid).set({
    chatId: String(chatId),
    userId,
    action: 'delete',
    candidateIds: candidates.map((c) => c.id),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });

  if (candidates.length === 1) {
    const e = candidates[0];
    await sendMessage(chatId, `¿Borro este evento?\n\n${formatEventLine(e)}`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🗑 Borrar', callback_data: `del:${pid}:${e.id}` },
          { text: '❌ Cancelar', callback_data: `no:${pid}` },
        ]],
      },
    });
    return;
  }

  // Several matches — let the user pick exactly which one.
  const buttons = candidates.slice(0, 8).map((e) => [
    { text: `🗑 ${e.evento} ${e.horaEntrada}–${e.horaSalida}`, callback_data: `del:${pid}:${e.id}` },
  ]);
  buttons.push([{ text: '❌ Cancelar', callback_data: `no:${pid}` }]);

  await sendMessage(
    chatId,
    `Encontré ${candidates.length} eventos que coinciden. ¿Cuál querés borrar?`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

/* ------------------------------- Callbacks ------------------------------ */

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const parts = (cb.data || '').split(':');
  const action = parts[0];

  await answerCallbackQuery(cb.id);
  if (!chatId) return;

  const db = getDb();

  // Cancel (works for both create and delete pending requests).
  if (action === 'no') {
    const pid = parts[1];
    if (pid) await db.collection('telegramPending').doc(pid).delete().catch(() => {});
    await editMessageText(chatId, messageId, '❌ Cancelado. No toqué nada.');
    return;
  }

  // Confirm create.
  if (action === 'ok') {
    const pid = parts[1];
    if (!pid) return;
    const ref = db.collection('telegramPending').doc(pid);
    const snap = await ref.get();
    if (!snap.exists) {
      await editMessageText(chatId, messageId, '⚠️ Este pedido venció. Mandame el evento otra vez.');
      return;
    }
    const pending = snap.data();
    if (String(pending.chatId) !== String(chatId)) return;

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
    await ref.delete();
    await editMessageText(chatId, messageId, `✅ ¡Cargado! <b>${ev.evento}</b> quedó en tu planilla.`);
    return;
  }

  // Confirm delete of a specific event.
  if (action === 'del') {
    const [, pid, eventId] = parts;
    if (!pid || !eventId) return;

    const ref = db.collection('telegramPending').doc(pid);
    const snap = await ref.get();
    if (!snap.exists) {
      await editMessageText(chatId, messageId, '⚠️ Este pedido venció. Pedí el borrado otra vez.');
      return;
    }
    const pending = snap.data();
    if (String(pending.chatId) !== String(chatId)) return;

    // The event must be one of the candidates we offered (no arbitrary deletes).
    if (!Array.isArray(pending.candidateIds) || !pending.candidateIds.includes(eventId)) {
      await editMessageText(chatId, messageId, '⚠️ No pude identificar ese evento. Probá de nuevo.');
      return;
    }

    const evRef = db.collection('eventos').doc(eventId);
    const evSnap = await evRef.get();
    // Defense in depth: the event must belong to the linked user.
    if (evSnap.exists && evSnap.data().userId !== pending.userId) {
      await editMessageText(chatId, messageId, '⚠️ No puedo borrar ese evento.');
      return;
    }
    const name = evSnap.exists ? evSnap.data().evento || 'evento' : 'evento';

    await evRef.delete();
    await ref.delete();
    await editMessageText(chatId, messageId, `🗑 Borré <b>${name}</b> de tu planilla.`);
  }
}
