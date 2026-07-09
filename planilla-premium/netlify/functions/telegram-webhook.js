import admin from 'firebase-admin';
import { getDb } from './utils/firebaseAdmin.js';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  sendChatAction,
  downloadTelegramFile,
} from './utils/telegram.js';
import { interpretMessage, chatCompletion } from './utils/openrouter.js';
import { transcribeAudio } from './utils/groq.js';
import { runQuery, SUPPORTED_METRICS, unsupportedCombo } from './utils/queryEngine.js';
import { fmtMoney, formatValue } from './utils/format.js';
import { phraseQueryResult } from './utils/phrasing.js';
import { isGreeting, pickGreetingReply } from './utils/greetings.js';
import {
  getEntity,
  buildCreateRecord,
  sanitizeChanges,
  findCandidates,
  isValidPeriod,
  fmtDate,
  recordName,
} from './utils/planillaCore.js';

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

/* -------------------------------- Helpers ------------------------------- */

const PENDING_TTL_MS = 15 * 60 * 1000;

function randomId(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < length; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
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
  // Standalone small-talk short-circuit: warm static reply, no typing, no LLM.
  if (isGreeting(text)) {
    await sendMessage(chatId, pickGreetingReply(text));
    return;
  }

  await sendChatAction(chatId, 'typing');

  let intent;
  try {
    intent = await interpretMessage(text);
  } catch (err) {
    console.error('interpretMessage error:', err);
    await sendMessage(chatId, 'No pude procesar el mensaje con la IA. Probá de nuevo en un momento.');
    return;
  }

  // consultar is read-only and carries no entity — route it before the entity guard.
  if (intent?.action === 'consultar') return handleQuery(chatId, userId, intent);

  const entity = getEntity(intent);
  // 'consultar' is handled above via early return, so it is intentionally absent here.
  const known = ['crear', 'borrar', 'editar'].includes(intent?.action);
  if (!known || !entity) {
    await sendMessage(
      chatId,
      'No entendí bien 🤔. Podés cargar, editar, borrar o consultar:\n' +
        '• <b>Evento</b>: "agregá amcham hoy de 6 a 19 con operación"\n' +
        '• <b>Gasto</b>: "gasté 65 mil en comida hoy"\n' +
        '• <b>Adelanto/Bono/Aguinaldo</b>: "cargá un adelanto de 100 mil"\n' +
        '• <b>Borrar/editar</b>: "borrá el último", "cambiale el monto al gasto de comida"\n' +
        '• <b>Consultar</b>: "cuántos eventos este mes", "horas extra mes pasado vs este mes"'
    );
    return;
  }

  if (intent.action === 'crear') return handleCreate(chatId, userId, entity, intent);
  if (intent.action === 'borrar') return handleDelete(chatId, userId, entity, intent);
  return handleEdit(chatId, userId, entity, intent);
}

/* ------------------------------- Queries -------------------------------- */

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Human-readable title per metric, used in scalar/money and compare headers.
const METRIC_TITLE = {
  countEventos: 'Eventos',
  countEventosConOperacion: 'Eventos con operación',
  listEventosConOperacion: 'Eventos con operación',
  horasExtra: 'Horas extra',
  totalEventos: 'Ganancia por eventos',
  totalGastos: 'Gastos',
  totalBonos: 'Bonos',
  totalAguinaldo: 'Aguinaldo',
  totalAdelantos: 'Adelantos',
  totalFinal: 'Total final',
};

function periodLabel(period) {
  if (!period) return '';
  if (period.type === 'month') return `${MONTHS_ES[period.month - 1]} ${period.year}`;
  if (period.type === 'range') return `${period.from}–${period.to}`;
  return '';
}

// LLM phrasing for the operation list is deferred: plain bullet list only.
function phraseOperList(items) {
  return items.map((name) => `• ${name}`).join('\n');
}

function formatQueryReply(result) {
  const label = periodLabel(result.period);

  if (result.kind === 'compare') {
    const [a, b] = result.results;
    const arrow = result.delta > 0 ? '▲' : result.delta < 0 ? '▼' : '=';
    const deltaFmt = formatValue(result.unit, Math.abs(result.delta));
    return (
      `📊 ${METRIC_TITLE[result.metric] || 'Comparación'}\n` +
      `${a.label}: <b>${formatValue(result.unit, a.value)}</b> · ` +
      `${b.label}: <b>${formatValue(result.unit, b.value)}</b> (${arrow} ${deltaFmt})`
    );
  }

  if (result.kind === 'list') {
    if (!result.items.length) return `📊 ${label}\nNo tenés eventos con operación.`;
    return `📊 ${label}\nEventos con operación (${result.items.length}):\n${phraseOperList(result.items)}`;
  }

  if (result.kind === 'listDetail') {
    if (!result.items.length) return `📊 ${label}\nNo hay registros en ese período.`;
    const lines = result.items.map((r) => {
      if (result.entity === 'evento') {
        const flags = [
          r.operacion ? '⚙️Op' : null,
          r.feriado ? '🎌Fer' : null,
          r.finde ? 'finde' : null,
          r.horasExtra > 0 ? `${r.horasExtra}h extra` : null,
        ].filter(Boolean).join(' · ');
        return `📋 <b>${r.evento}</b> ${fmtDate(r.fecha)} (${r.diaSemana}) ${r.horaEntrada}–${r.horaSalida}${flags ? ' · ' + flags : ''}`;
      }
      const tipo = r.tipo ? ` (${r.tipo})` : '';
      return `💵 <b>${r.descripcion}</b>${tipo} — ${fmtDate(r.fecha)} · ${fmtMoney(r.monto)}`;
    });
    return `📊 ${label} (${result.items.length}):\n${lines.join('\n')}`;
  }

  // scalar
  if (result.unit === 'money') {
    return `📊 ${label}\n${METRIC_TITLE[result.metric] || 'Total'}: <b>${fmtMoney(result.value)}</b>`;
  }
  if (result.unit === 'hours') {
    return `📊 ${label}\nHoras extra: <b>${result.value} h</b>.`;
  }
  const opSuffix = result.metric === 'countEventosConOperacion' ? ' con operación' : '';
  return `📊 ${label}\nTuviste <b>${result.value}</b> evento(s)${opSuffix}.`;
}

async function handleQuery(chatId, userId, intent) {
  const metric = intent?.metric;
  const period = intent?.period;

  if (!SUPPORTED_METRICS.includes(metric) || !isValidPeriod(period)) {
    await sendMessage(
      chatId,
      'No entendí la consulta 🤔. Probá: <i>"cuántos eventos este mes"</i>, ' +
        '<i>"horas extra mes pasado vs este mes"</i>.'
    );
    return;
  }

  // Reject metric+period combos that would produce a wrong/meaningless number.
  const unsupportedReason = unsupportedCombo(metric, period);
  if (unsupportedReason) {
    await sendMessage(chatId, unsupportedReason);
    return;
  }

  try {
    const result = await runQuery({ db: getDb(), userId, metric, period });
    await sendMessage(
      chatId,
      await phraseQueryResult(result, () => formatQueryReply(result), { chat: chatCompletion })
    );
  } catch (err) {
    console.error('handleQuery error:', err);
    await sendMessage(chatId, 'No pude calcular esa consulta ahora. Probá de nuevo en un momento.');
  }
}

/* --------------------------------- Create ------------------------------- */

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
