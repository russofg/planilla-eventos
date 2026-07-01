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
 * A linked user writes or speaks in natural language; an LLM classifies the
 * action (crear/borrar/editar) and the entity (evento/gasto/bono/aguinaldo/
 * adelanto). Every write goes through an inline-button confirmation, and
 * delete/edit disambiguate when several records match.
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
      'Podés cargar, editar o borrar por texto o por voz:\n' +
      '• <i>"agregá amcham hoy de 6 a 19 con operación"</i>\n' +
      '• <i>"gasté 65 mil en comida hoy"</i>\n' +
      '• <i>"cargá un adelanto de 100 mil"</i>\n' +
      '• <i>"borrá el último"</i>'
  );
}

/* ------------------------------- Entities ------------------------------- */

/**
 * Each supported entity maps a natural-language "thing" to a Firestore
 * collection and its field shape. "evento" carries schedules; the money
 * entities (gasto/bono/aguinaldo/adelanto) share descripcion+fecha+monto,
 * with the extras ones pinned to a `tipo`.
 */
const ENTITIES = {
  evento: { collection: 'eventos', label: 'Evento', kind: 'evento', nameField: 'evento' },
  gasto: { collection: 'gastos', label: 'Gasto', kind: 'money', nameField: 'descripcion' },
  bono: { collection: 'extras', label: 'Bono', kind: 'money', nameField: 'descripcion', tipo: 'bono' },
  aguinaldo: { collection: 'extras', label: 'Aguinaldo', kind: 'money', nameField: 'descripcion', tipo: 'aguinaldo' },
  adelanto: { collection: 'extras', label: 'Adelanto', kind: 'money', nameField: 'descripcion', tipo: 'adelanto' },
};

function getEntity(intent) {
  return ENTITIES[intent?.entidad] || null;
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

function fmtMoney(n) {
  return `$ ${Number(n).toLocaleString('es-AR')}`;
}

function recordName(entity, r) {
  return r[entity.nameField] || r.evento || r.descripcion || 'registro';
}

function formatRecordLine(entity, r) {
  if (entity.kind === 'evento') {
    return `📋 <b>${r.evento}</b> — ${fmtDate(r.fecha)} · ${r.horaEntrada}–${r.horaSalida}${r.operacion ? ' · ⚙️ Op.' : ''}`;
  }
  return `💵 <b>${r.descripcion}</b> — ${fmtDate(r.fecha)} · ${fmtMoney(r.monto)}`;
}

/* --------------------------------- Voice -------------------------------- */

async function handleVoice(chatId, voice, userId) {
  await sendChatAction(chatId, 'typing');

  let transcript;
  try {
    const buffer = await downloadTelegramFile(voice.file_id);
    transcript = await transcribeAudio(buffer);
  } catch (err) {
    console.error('voice transcription error:', err);
    await sendMessage(chatId, 'No pude transcribir el audio 😕. Probá de nuevo o escribime por texto.');
    return;
  }

  if (!transcript) {
    await sendMessage(chatId, 'No se entendió el audio 🤔. Probá de nuevo hablando claro.');
    return;
  }

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

  const entity = getEntity(intent);
  const known = ['crear', 'borrar', 'editar'].includes(intent?.action);
  if (!known || !entity) {
    await sendMessage(
      chatId,
      'No entendí bien 🤔. Podés cargar, editar o borrar:\n' +
        '• <b>Evento</b>: "agregá amcham hoy de 6 a 19 con operación"\n' +
        '• <b>Gasto</b>: "gasté 65 mil en comida hoy"\n' +
        '• <b>Adelanto/Bono/Aguinaldo</b>: "cargá un adelanto de 100 mil"\n' +
        '• <b>Borrar/editar</b>: "borrá el último", "cambiale el monto al gasto de comida"'
    );
    return;
  }

  if (intent.action === 'crear') return handleCreate(chatId, userId, entity, intent);
  if (intent.action === 'borrar') return handleDelete(chatId, userId, entity, intent);
  return handleEdit(chatId, userId, entity, intent);
}

/* -------------------------- Candidate matching -------------------------- */

async function findCandidates(db, userId, entity, intent) {
  const rawName = intent[entity.nameField] ?? intent.descripcion ?? intent.evento;
  const nameFilter = typeof rawName === 'string' ? rawName.trim().toLowerCase() : '';
  const fecha = isDate(intent.fecha) ? intent.fecha : null;
  const reciente = intent.referencia === 'reciente' || intent.referencia === 'ultimo';

  if (!fecha && !nameFilter && !reciente) return { needsSelector: true, candidates: [] };

  const snap = await db.collection(entity.collection).where('userId', '==', userId).get();
  let candidates = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  // For the extras collection, keep only the requested tipo (bono/aguinaldo/adelanto).
  if (entity.tipo) candidates = candidates.filter((e) => e.tipo === entity.tipo);
  if (fecha) candidates = candidates.filter((e) => e.fecha === fecha);
  if (nameFilter) {
    candidates = candidates.filter((e) =>
      (e[entity.nameField] || '').toLowerCase().includes(nameFilter)
    );
  }
  if (reciente) {
    candidates.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    candidates = candidates.slice(0, 1);
  } else {
    // Most recent first, so the disambiguation buttons show the likely ones.
    candidates.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }

  return { needsSelector: false, candidates };
}

/* --------------------------------- Create ------------------------------- */

function buildCreateRecord(entity, intent) {
  if (entity.kind === 'evento') {
    if (typeof intent.evento !== 'string' || !intent.evento.trim()) return null;
    if (!isDate(intent.fecha)) return null;
    if (!isTime(intent.horaEntrada) || !isTime(intent.horaSalida)) return null;
    return {
      evento: intent.evento.trim(),
      fecha: intent.fecha,
      horaEntrada: intent.horaEntrada,
      horaSalida: intent.horaSalida,
      operacion: intent.operacion === true,
      feriado: intent.feriado === true,
    };
  }

  // Money entities: descripcion + fecha + monto (> 0).
  const monto = Number(intent.monto);
  if (!isDate(intent.fecha) || !(monto > 0)) return null;
  const descripcion =
    typeof intent.descripcion === 'string' && intent.descripcion.trim()
      ? intent.descripcion.trim()
      : entity.label;
  const record = { descripcion, fecha: intent.fecha, monto };
  if (entity.tipo) record.tipo = entity.tipo;
  return record;
}

async function handleCreate(chatId, userId, entity, intent) {
  const record = buildCreateRecord(entity, intent);
  if (!record) {
    const hint =
      entity.kind === 'evento'
        ? '<i>"agregá amcham hoy de 6 a 19 con operación"</i> (nombre + horarios)'
        : `<i>"cargá ${entity.label.toLowerCase()} de 50 mil hoy"</i> (monto + fecha)`;
    await sendMessage(chatId, `No entendí bien el ${entity.label.toLowerCase()} 🤔. Probá: ${hint}`);
    return;
  }

  const db = getDb();
  const pid = randomId();
  await db.collection('telegramPending').doc(pid).set({
    chatId: String(chatId),
    userId,
    action: 'create',
    collection: entity.collection,
    record,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });

  let body;
  if (entity.kind === 'evento') {
    body =
      `Entendí esto:\n\n📋 <b>${record.evento}</b>\n📅 ${fmtDate(record.fecha)}\n` +
      `🕐 ${record.horaEntrada} – ${record.horaSalida}\n⚙️ Operación: ${record.operacion ? 'Sí' : 'No'}` +
      `${record.feriado ? '\n🎌 Feriado: Sí' : ''}\n\n¿Lo cargo en tu planilla?`;
  } else {
    body =
      `Entendí esto:\n\n💵 <b>${entity.label}</b>: ${record.descripcion}\n📅 ${fmtDate(record.fecha)}\n` +
      `💰 ${fmtMoney(record.monto)}\n\n¿Lo cargo en tu planilla?`;
  }

  await sendMessage(chatId, body, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Confirmar', callback_data: `ok:${pid}` },
        { text: '❌ Cancelar', callback_data: `no:${pid}` },
      ]],
    },
  });
}

/* --------------------------------- Delete ------------------------------- */

async function handleDelete(chatId, userId, entity, intent) {
  const db = getDb();
  const { needsSelector, candidates } = await findCandidates(db, userId, entity, intent);

  if (needsSelector) {
    await sendMessage(
      chatId,
      `Decime qué ${entity.label.toLowerCase()} borrar con la fecha, el nombre, o pedime "el último".`
    );
    return;
  }
  if (candidates.length === 0) {
    await sendMessage(chatId, 'No encontré ningún registro con esos datos. Revisá la fecha o el nombre.');
    return;
  }

  const pid = randomId();
  await db.collection('telegramPending').doc(pid).set({
    chatId: String(chatId),
    userId,
    action: 'delete',
    collection: entity.collection,
    candidateIds: candidates.map((c) => c.id),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });

  if (candidates.length === 1) {
    await sendMessage(chatId, `¿Borro esto?\n\n${formatRecordLine(entity, candidates[0])}`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🗑 Borrar', callback_data: `del:${pid}:${candidates[0].id}` },
          { text: '❌ Cancelar', callback_data: `no:${pid}` },
        ]],
      },
    });
    return;
  }

  const buttons = candidates.slice(0, 8).map((e) => [
    { text: `🗑 ${recordName(entity, e)} ${fmtDate(e.fecha)}`, callback_data: `del:${pid}:${e.id}` },
  ]);
  buttons.push([{ text: '❌ Cancelar', callback_data: `no:${pid}` }]);

  const extra = candidates.length > 8 ? ' Te muestro los 8 más recientes; afiná con la fecha si no aparece.' : '';
  await sendMessage(chatId, `Encontré ${candidates.length} que coinciden.${extra} ¿Cuál borro?`, {
    reply_markup: { inline_keyboard: buttons },
  });
}

/* ---------------------------------- Edit -------------------------------- */

const CHANGE_LABELS = {
  evento: 'Nombre',
  descripcion: 'Descripción',
  fecha: 'Fecha',
  monto: 'Monto',
  horaEntrada: 'Entrada',
  horaSalida: 'Salida',
  operacion: 'Operación',
  feriado: 'Feriado',
};

function sanitizeChanges(entity, cambios) {
  if (!cambios || typeof cambios !== 'object') return null;
  const update = {};
  if (entity.kind === 'evento') {
    if (typeof cambios.evento === 'string' && cambios.evento.trim()) update.evento = cambios.evento.trim();
    if (isTime(cambios.horaEntrada)) update.horaEntrada = cambios.horaEntrada;
    if (isTime(cambios.horaSalida)) update.horaSalida = cambios.horaSalida;
    if (typeof cambios.operacion === 'boolean') update.operacion = cambios.operacion;
    if (typeof cambios.feriado === 'boolean') update.feriado = cambios.feriado;
  } else {
    if (typeof cambios.descripcion === 'string' && cambios.descripcion.trim()) {
      update.descripcion = cambios.descripcion.trim();
    }
    if (Number(cambios.monto) > 0) update.monto = Number(cambios.monto);
  }
  if (isDate(cambios.fecha)) update.fecha = cambios.fecha;
  return Object.keys(update).length ? update : null;
}

function formatChanges(update) {
  return Object.entries(update)
    .map(([k, v]) => {
      let val = v;
      if (k === 'operacion' || k === 'feriado') val = v ? 'Sí' : 'No';
      else if (k === 'fecha') val = fmtDate(v);
      else if (k === 'monto') val = fmtMoney(v);
      return `• ${CHANGE_LABELS[k] || k}: <b>${val}</b>`;
    })
    .join('\n');
}

async function handleEdit(chatId, userId, entity, intent) {
  const db = getDb();

  const update = sanitizeChanges(entity, intent.cambios);
  if (!update) {
    await sendMessage(chatId, 'No entendí qué querés cambiar 🤔. Ej: <i>"cambiale el monto al gasto de comida a 70 mil"</i>.');
    return;
  }

  const { needsSelector, candidates } = await findCandidates(db, userId, entity, intent);
  if (needsSelector) {
    await sendMessage(chatId, `Decime cuál ${entity.label.toLowerCase()} editar (fecha, nombre o "el último").`);
    return;
  }
  if (candidates.length === 0) {
    await sendMessage(chatId, 'No encontré ningún registro con esos datos. Revisá la fecha o el nombre.');
    return;
  }

  const pid = randomId();
  await db.collection('telegramPending').doc(pid).set({
    chatId: String(chatId),
    userId,
    action: 'edit',
    collection: entity.collection,
    candidateIds: candidates.map((c) => c.id),
    changes: update,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });

  const changeText = formatChanges(update);

  if (candidates.length === 1) {
    await sendMessage(
      chatId,
      `Voy a cambiar:\n\n${formatRecordLine(entity, candidates[0])}\n\n<b>Cambios:</b>\n${changeText}\n\n¿Guardo?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✏️ Guardar', callback_data: `edit:${pid}:${candidates[0].id}` },
            { text: '❌ Cancelar', callback_data: `no:${pid}` },
          ]],
        },
      }
    );
    return;
  }

  const buttons = candidates.slice(0, 8).map((e) => [
    { text: `✏️ ${recordName(entity, e)} ${fmtDate(e.fecha)}`, callback_data: `edit:${pid}:${e.id}` },
  ]);
  buttons.push([{ text: '❌ Cancelar', callback_data: `no:${pid}` }]);

  const extra = candidates.length > 8 ? '\nTe muestro los 8 más recientes; afiná con la fecha si no aparece.' : '';
  await sendMessage(chatId, `Cambios a aplicar:\n${changeText}${extra}\n\n¿A cuál?`, {
    reply_markup: { inline_keyboard: buttons },
  });
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

  if (action === 'no') {
    const pid = parts[1];
    if (pid) await db.collection('telegramPending').doc(pid).delete().catch(() => {});
    await editMessageText(chatId, messageId, '❌ Cancelado. No toqué nada.');
    return;
  }

  if (action === 'ok') {
    const pid = parts[1];
    if (!pid) return;
    const ref = db.collection('telegramPending').doc(pid);
    const snap = await ref.get();
    if (!snap.exists) {
      await editMessageText(chatId, messageId, '⚠️ Este pedido venció. Mandámelo otra vez.');
      return;
    }
    const pending = snap.data();
    if (String(pending.chatId) !== String(chatId)) return;

    await db.collection(pending.collection).add({
      userId: pending.userId,
      ...pending.record,
      source: 'telegram',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.delete();
    const name = pending.record.evento || pending.record.descripcion || 'registro';
    await editMessageText(chatId, messageId, `✅ ¡Cargado! <b>${name}</b> quedó en tu planilla.`);
    return;
  }

  if (action === 'del' || action === 'edit') {
    const [, pid, recordId] = parts;
    if (!pid || !recordId) return;

    const ref = db.collection('telegramPending').doc(pid);
    const snap = await ref.get();
    if (!snap.exists) {
      await editMessageText(chatId, messageId, '⚠️ Este pedido venció. Pedilo otra vez.');
      return;
    }
    const pending = snap.data();
    if (String(pending.chatId) !== String(chatId)) return;

    // Must be one of the records we offered (no arbitrary ids from tampered data).
    if (!Array.isArray(pending.candidateIds) || !pending.candidateIds.includes(recordId)) {
      await editMessageText(chatId, messageId, '⚠️ No pude identificar ese registro. Probá de nuevo.');
      return;
    }

    const recRef = db.collection(pending.collection).doc(recordId);
    const recSnap = await recRef.get();
    // Defense in depth: the record must belong to the linked user.
    if (recSnap.exists && recSnap.data().userId !== pending.userId) {
      await editMessageText(chatId, messageId, '⚠️ No puedo tocar ese registro.');
      return;
    }
    const name = recSnap.exists ? recSnap.data().evento || recSnap.data().descripcion || 'registro' : 'registro';

    if (action === 'del') {
      await recRef.delete();
      await ref.delete();
      await editMessageText(chatId, messageId, `🗑 Borré <b>${name}</b> de tu planilla.`);
      return;
    }

    const changes = pending.changes || {};
    await recRef.update({ ...changes, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await ref.delete();
    await editMessageText(chatId, messageId, `✏️ Actualicé <b>${changes.evento || changes.descripcion || name}</b> en tu planilla.`);
  }
}
