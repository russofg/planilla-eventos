import admin from 'firebase-admin';
import { getDb } from './utils/firebaseAdmin.js';
import { interpretMessage } from './utils/openrouter.js';
import { runQuery, SUPPORTED_METRICS, unsupportedCombo } from './utils/queryEngine.js';
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
 * Netlify Function: maria-bridge
 *
 * A JSON bridge that lets the external "Maria" assistant (the Hermes bot on
 * the VPS) drive the SAME planilla logic the Telegram bot uses — create, edit,
 * delete and query events/expenses/extras — without duplicating any domain
 * rules. It reuses interpretMessage (identical NL interpretation), the shared
 * planillaCore validators/matchers, and the queryEngine analytics.
 *
 * Differences from telegram-webhook: no Telegram formatting and no inline
 * buttons. Maria confirms conversationally, so writes use a two-step
 * `confirm` flag instead: first call returns what it understood, a second call
 * with `confirm:true` commits it. Queries are read-only and run immediately.
 *
 * Security:
 * - Bearer token must match MARIA_BRIDGE_SECRET (Maria holds the secret).
 * - The userId is resolved from the verified `telegramLinks` mapping using the
 *   caller-supplied chatId — never trusted from a free-form field — exactly the
 *   same ownership model the Telegram webhook enforces.
 *
 * Request  (POST, application/json):
 *   { "text": "anotá amcham hoy de 6 a 19 con operación",
 *     "confirm": false,            // optional, default false
 *     "chatId": "1050123460" }     // optional; falls back to MARIA_DEFAULT_CHATID
 *
 * Response: always HTTP 200 with a { status, ... } envelope Maria phrases.
 *   status values: ok | needs_confirmation | ambiguous | need_selector |
 *                  invalid | not_found | unknown | invalid_query | unsupported |
 *                  not_linked | error
 */
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { status: 'error', message: 'Method not allowed' });
  }

  const secret = process.env.MARIA_BRIDGE_SECRET;
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const provided = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!secret || provided !== secret) {
    return json(401, { status: 'error', message: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { status: 'error', message: 'Invalid JSON body' });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const confirm = body.confirm === true;
  const chatId =
    body.chatId != null ? String(body.chatId) : (process.env.MARIA_DEFAULT_CHATID || '');

  if (!text) return json(400, { status: 'error', message: 'Field "text" is required' });
  if (!chatId) return json(400, { status: 'error', message: 'chatId or MARIA_DEFAULT_CHATID required' });

  try {
    const db = getDb();

    // Resolve the owner the same way the Telegram webhook does: chatId is only
    // an index into the verified telegramLinks mapping, never the userId itself.
    const linkSnap = await db.collection('telegramLinks').doc(chatId).get();
    if (!linkSnap.exists) {
      return json(200, {
        status: 'not_linked',
        message: 'Esta cuenta de Telegram no está vinculada. Vinculala en Ajustes → Vincular Telegram.',
      });
    }
    const userId = linkSnap.data().userId;

    let intent;
    try {
      intent = await interpretMessage(text);
    } catch (err) {
      console.error('maria-bridge interpret error:', err);
      return json(502, { status: 'error', message: 'No pude interpretar el mensaje con la IA.' });
    }

    const action = intent?.action;

    // Read-only path first; it carries no entity.
    if (action === 'consultar') return await handleQuery(db, userId, intent);

    const entity = getEntity(intent);
    if (!['crear', 'borrar', 'editar'].includes(action) || !entity) {
      return json(200, {
        status: 'unknown',
        message: 'No entendí si es crear, borrar, editar o consultar.',
        intent,
      });
    }

    if (action === 'crear') return await handleCreate(db, userId, entity, intent, confirm);
    if (action === 'borrar') return await handleDelete(db, userId, entity, intent, confirm);
    return await handleEdit(db, userId, entity, intent, confirm);
  } catch (err) {
    console.error('maria-bridge error:', err);
    return json(200, { status: 'error', message: 'Ocurrió un error procesando el pedido.' });
  }
}

/* -------------------------------- Create -------------------------------- */

async function handleCreate(db, userId, entity, intent, confirm) {
  const record = buildCreateRecord(entity, intent);
  if (!record) {
    return json(200, {
      status: 'invalid',
      action: 'crear',
      entity: entity.label,
      message:
        entity.kind === 'evento'
          ? 'Falta el nombre o algún horario del evento.'
          : `Falta el monto o la fecha del ${entity.label.toLowerCase()}.`,
    });
  }

  if (!confirm) {
    return json(200, {
      status: 'needs_confirmation',
      action: 'crear',
      entity: entity.label,
      record,
      summary: summarizeRecord(entity, record),
    });
  }

  const ref = await db.collection(entity.collection).add({
    userId,
    ...record,
    source: 'maria',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return json(200, {
    status: 'ok',
    action: 'crear',
    entity: entity.label,
    id: ref.id,
    record,
    summary: summarizeRecord(entity, record),
  });
}

/* -------------------------------- Delete -------------------------------- */

async function handleDelete(db, userId, entity, intent, confirm) {
  const { needsSelector, candidates } = await findCandidates(db, userId, entity, intent);

  if (needsSelector) {
    return json(200, {
      status: 'need_selector',
      action: 'borrar',
      entity: entity.label,
      message: `Decime qué ${entity.label.toLowerCase()} borrar: fecha, nombre, o "el último".`,
    });
  }
  if (candidates.length === 0) {
    return json(200, { status: 'not_found', action: 'borrar', entity: entity.label });
  }
  if (candidates.length > 1) {
    return json(200, {
      status: 'ambiguous',
      action: 'borrar',
      entity: entity.label,
      candidates: candidates.slice(0, 8).map((c) => briefRecord(entity, c)),
    });
  }

  const target = candidates[0];
  if (!confirm) {
    return json(200, {
      status: 'needs_confirmation',
      action: 'borrar',
      entity: entity.label,
      target: briefRecord(entity, target),
    });
  }

  await db.collection(entity.collection).doc(target.id).delete();
  return json(200, {
    status: 'ok',
    action: 'borrar',
    entity: entity.label,
    id: target.id,
    target: briefRecord(entity, target),
  });
}

/* --------------------------------- Edit --------------------------------- */

async function handleEdit(db, userId, entity, intent, confirm) {
  const changes = sanitizeChanges(entity, intent.cambios);
  if (!changes) {
    return json(200, {
      status: 'invalid',
      action: 'editar',
      entity: entity.label,
      message: 'No entendí qué cambiar. Ej: "cambiale el monto al gasto de comida a 70 mil".',
    });
  }

  const { needsSelector, candidates } = await findCandidates(db, userId, entity, intent);
  if (needsSelector) {
    return json(200, {
      status: 'need_selector',
      action: 'editar',
      entity: entity.label,
      changes,
      message: `Decime cuál ${entity.label.toLowerCase()} editar: fecha, nombre, o "el último".`,
    });
  }
  if (candidates.length === 0) {
    return json(200, { status: 'not_found', action: 'editar', entity: entity.label });
  }
  if (candidates.length > 1) {
    return json(200, {
      status: 'ambiguous',
      action: 'editar',
      entity: entity.label,
      changes,
      candidates: candidates.slice(0, 8).map((c) => briefRecord(entity, c)),
    });
  }

  const target = candidates[0];
  if (!confirm) {
    return json(200, {
      status: 'needs_confirmation',
      action: 'editar',
      entity: entity.label,
      target: briefRecord(entity, target),
      changes,
    });
  }

  await db.collection(entity.collection).doc(target.id).update({
    ...changes,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return json(200, {
    status: 'ok',
    action: 'editar',
    entity: entity.label,
    id: target.id,
    changes,
  });
}

/* --------------------------------- Query -------------------------------- */

async function handleQuery(db, userId, intent) {
  const metric = intent?.metric;
  const period = intent?.period;

  if (!SUPPORTED_METRICS.includes(metric) || !isValidPeriod(period)) {
    return json(200, {
      status: 'invalid_query',
      message: 'No entendí la consulta. Ej: "cuántos eventos este mes", "horas extra mes pasado vs este mes".',
    });
  }

  const reason = unsupportedCombo(metric, period);
  if (reason) {
    return json(200, { status: 'unsupported', message: reason });
  }

  const result = await runQuery({ db, userId, metric, period });
  return json(200, { status: 'ok', action: 'consultar', result });
}

/* -------------------------------- Helpers ------------------------------- */

function summarizeRecord(entity, r) {
  if (entity.kind === 'evento') {
    return (
      `${r.evento} · ${fmtDate(r.fecha)} · ${r.horaEntrada}-${r.horaSalida}` +
      `${r.operacion ? ' · con operación' : ''}${r.feriado ? ' · feriado' : ''}`
    );
  }
  return `${entity.label}: ${r.descripcion} · ${fmtDate(r.fecha)} · $${r.monto}`;
}

function briefRecord(entity, r) {
  const base = { id: r.id, fecha: r.fecha, nombre: recordName(entity, r) };
  if (entity.kind === 'evento') {
    return { ...base, horaEntrada: r.horaEntrada, horaSalida: r.horaSalida, operacion: !!r.operacion };
  }
  return { ...base, monto: r.monto };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
