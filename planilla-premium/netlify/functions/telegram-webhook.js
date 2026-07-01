import admin from 'firebase-admin';
import { getDb } from './utils/firebaseAdmin.js';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  sendChatAction,
  downloadTelegramFile,
} from './utils/telegram.js';
import { interpretMessage } from './utils/openrouter.js';
import { transcribeAudio } from './utils/groq.js';

/**
 * Netlify Function: telegram-webhook
 *
 * Phase 0: account linking via /start <code>.
 * Phase 1+: a linked user writes in natural language; an LLM classifies the
 * intent (crear / borrar / editar) and extracts the fields. Create, delete and
 * edit all go through an inline-button confirmation before touching Firestore,
 * and delete/edit disambiguate when several events match.
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
    const userId = linkSnap.data().userId;

    // Voice notes (and uploaded audio) go through transcription first.
    const voice = message.voice || message.audio;
    if (voice) {
      await handleVoice(chatId, voice, userId);
      return { statusCode: 200, body: 'ok' };
    }

    if (!text) return { statusCode: 200, body: 'ok' };
    await handleUserText(chatId, text, userId);
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
      'Podés:\n' +
      '• <b>Cargar</b>: <i>"agregá amcham hoy de 6 a 19 con operación"</i>\n' +
      '• <b>Editar</b>: <i>"al amcham del 1 cambiale la salida a las 21"</i>\n' +
      '• <b>Borrar</b>: <i>"borrá el último"</i>'
  );
}

/* -------------------------------- Voice --------------------------------- */

async function handleVoice(chatId, voice, userId) {
  await sendChatAction(chatId, 'typing');

  let transcript;
  try {
    const buffer = await downloadTelegramFile(voice.file_id);
    transcript = await transcribeAudio(buffer);
  } catch (err) {
    console.error('voice transcription error:', err);
    await sendMessage(chatId, 'No pude transcribir el audio 😕. Probá de nuevo o escribime el evento por texto.');
    return;
  }

  if (!transcript) {
    await sendMessage(chatId, 'No se entendió el audio 🤔. Probá de nuevo hablando claro.');
    return;
  }

  // Echo the transcript so a mis-hearing is visible before anything is applied.
  await sendMessage(chatId, `🎤 Escuché: <i>"${transcript}"</i>`);
  await handleUserText(chatId, transcript, userId);
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
      return handleEdit(chatId, userId, intent);
    default:
      await sendMessage(
        chatId,
        'No entendí bien 🤔. Podés:\n' +
          '• <b>Cargar</b>: "agregá amcham hoy de 6 a 19 con operación"\n' +
          '• <b>Editar</b>: "al amcham del 1 cambiale la salida a las 21"\n' +
          '• <b>Borrar</b>: "borrá el último"'
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

function fmtDate(iso) {
  const [y, m, d] = (iso || '').split('-');
  return y ? `${d}/${m}/${y}` : iso;
}

function formatEventLine(e) {
  return `📋 <b>${e.evento}</b> — ${fmtDate(e.fecha)} · ${e.horaEntrada}–${e.horaSalida}${e.operacion ? ' · ⚙️ Op.' : ''}`;
}

/**
 * Finds the user's events that match the identification fields of the intent.
 * Filters locally (no composite index). Shared by delete and edit.
 * Returns { needsSelector } when the message gives nothing to match on.
 */
async function findCandidates(db, userId, intent) {
  const fecha = isDate(intent.fecha) ? intent.fecha : null;
  const nameFilter = typeof intent.evento === 'string' ? intent.evento.trim().toLowerCase() : '';
  const horaFilter = isTime(intent.horaEntrada) ? intent.horaEntrada : null;
  const reciente = intent.referencia === 'reciente' || intent.referencia === 'ultimo';

  if (!fecha && !nameFilter && !reciente) return { needsSelector: true, candidates: [] };

  const snap = await db.collection('eventos').where('userId', '==', userId).get();
  let candidates = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  if (fecha) candidates = candidates.filter((e) => e.fecha === fecha);
  if (nameFilter) candidates = candidates.filter((e) => (e.evento || '').toLowerCase().includes(nameFilter));
  if (horaFilter) candidates = candidates.filter((e) => e.horaEntrada === horaFilter);

  // "el último" / "el de recién": narrow to the most recently created event.
  if (reciente) {
    candidates.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    candidates = candidates.slice(0, 1);
  }

  return { needsSelector: false, candidates };
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

  await sendMessage(
    chatId,
    `Entendí esto:\n\n📋 <b>${ev.evento}</b>\n📅 ${fmtDate(ev.fecha)}\n🕐 ${ev.horaEntrada} – ${ev.horaSalida}\n` +
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
  const { needsSelector, candidates } = await findCandidates(db, userId, intent);

  if (needsSelector) {
    await sendMessage(
      chatId,
      'Decime qué evento borrar con la fecha, el nombre, o pedime "el último", ej: ' +
        '<i>"borrá el amcham del 1 de julio"</i> o <i>"borrá el último"</i>.'
    );
    return;
  }
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

/* ---------------------------------- Edit -------------------------------- */

const CHANGE_LABELS = {
  evento: 'Nombre',
  fecha: 'Fecha',
  horaEntrada: 'Entrada',
  horaSalida: 'Salida',
  operacion: 'Operación',
  feriado: 'Feriado',
};

/** Keeps only valid, provided change fields (protects against bad LLM output). */
function sanitizeChanges(cambios) {
  if (!cambios || typeof cambios !== 'object') return null;
  const update = {};
  if (typeof cambios.evento === 'string' && cambios.evento.trim()) update.evento = cambios.evento.trim();
  if (isDate(cambios.fecha)) update.fecha = cambios.fecha;
  if (isTime(cambios.horaEntrada)) update.horaEntrada = cambios.horaEntrada;
  if (isTime(cambios.horaSalida)) update.horaSalida = cambios.horaSalida;
  if (typeof cambios.operacion === 'boolean') update.operacion = cambios.operacion;
  if (typeof cambios.feriado === 'boolean') update.feriado = cambios.feriado;
  return Object.keys(update).length ? update : null;
}

function formatChanges(update) {
  return Object.entries(update)
    .map(([k, v]) => {
      let val = v;
      if (k === 'operacion' || k === 'feriado') val = v ? 'Sí' : 'No';
      else if (k === 'fecha') val = fmtDate(v);
      return `• ${CHANGE_LABELS[k] || k}: <b>${val}</b>`;
    })
    .join('\n');
}

async function handleEdit(chatId, userId, intent) {
  const db = getDb();

  const update = sanitizeChanges(intent.cambios);
  if (!update) {
    await sendMessage(
      chatId,
      'No entendí qué querés cambiar 🤔. Ej: <i>"al amcham del 1 cambiale la salida a las 21"</i>.'
    );
    return;
  }

  const { needsSelector, candidates } = await findCandidates(db, userId, intent);
  if (needsSelector) {
    await sendMessage(
      chatId,
      'Decime cuál evento editar (fecha, nombre o "el último"). Ej: ' +
        '<i>"al amcham del 1 cambiale la salida a las 21"</i>.'
    );
    return;
  }
  if (candidates.length === 0) {
    await sendMessage(chatId, 'No encontré ningún evento con esos datos. Revisá la fecha o el nombre.');
    return;
  }

  const pid = randomId();
  await db.collection('telegramPending').doc(pid).set({
    chatId: String(chatId),
    userId,
    action: 'edit',
    candidateIds: candidates.map((c) => c.id),
    changes: update,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });

  const changeText = formatChanges(update);

  if (candidates.length === 1) {
    const e = candidates[0];
    await sendMessage(
      chatId,
      `Voy a cambiar:\n\n${formatEventLine(e)}\n\n<b>Cambios:</b>\n${changeText}\n\n¿Guardo?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✏️ Guardar', callback_data: `edit:${pid}:${e.id}` },
            { text: '❌ Cancelar', callback_data: `no:${pid}` },
          ]],
        },
      }
    );
    return;
  }

  const buttons = candidates.slice(0, 8).map((e) => [
    { text: `✏️ ${e.evento} ${e.horaEntrada}–${e.horaSalida}`, callback_data: `edit:${pid}:${e.id}` },
  ]);
  buttons.push([{ text: '❌ Cancelar', callback_data: `no:${pid}` }]);

  await sendMessage(
    chatId,
    `Cambios a aplicar:\n${changeText}\n\n¿A cuál evento?`,
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

  // Cancel (works for any pending request).
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

  // Confirm delete or edit of a specific event.
  if (action === 'del' || action === 'edit') {
    const [, pid, eventId] = parts;
    if (!pid || !eventId) return;

    const ref = db.collection('telegramPending').doc(pid);
    const snap = await ref.get();
    if (!snap.exists) {
      await editMessageText(chatId, messageId, '⚠️ Este pedido venció. Pedilo otra vez.');
      return;
    }
    const pending = snap.data();
    if (String(pending.chatId) !== String(chatId)) return;

    // The event must be one we offered (no arbitrary ids from tampered data).
    if (!Array.isArray(pending.candidateIds) || !pending.candidateIds.includes(eventId)) {
      await editMessageText(chatId, messageId, '⚠️ No pude identificar ese evento. Probá de nuevo.');
      return;
    }

    const evRef = db.collection('eventos').doc(eventId);
    const evSnap = await evRef.get();
    // Defense in depth: the event must belong to the linked user.
    if (evSnap.exists && evSnap.data().userId !== pending.userId) {
      await editMessageText(chatId, messageId, '⚠️ No puedo tocar ese evento.');
      return;
    }
    const name = evSnap.exists ? evSnap.data().evento || 'evento' : 'evento';

    if (action === 'del') {
      await evRef.delete();
      await ref.delete();
      await editMessageText(chatId, messageId, `🗑 Borré <b>${name}</b> de tu planilla.`);
      return;
    }

    // action === 'edit'
    const changes = pending.changes || {};
    await evRef.update({
      ...changes,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.delete();
    await editMessageText(chatId, messageId, `✏️ Actualicé <b>${changes.evento || name}</b> en tu planilla.`);
  }
}
