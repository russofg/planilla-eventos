/**
 * Shared, transport-agnostic core for the planilla assistants.
 *
 * The Telegram webhook (telegram-webhook.js) and the Maria bridge
 * (maria-bridge.js) both interpret a message into an "intent" and then act on
 * it. Everything here is pure domain logic — entity mapping, record building,
 * change sanitizing, candidate matching, and period validation — with NO
 * transport concerns (no Telegram formatting, no HTTP shaping). Keeping it in
 * one place means the two entry points can never drift apart.
 */

export const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

export function fmtDate(iso) {
  const [y, m, d] = (iso || '').split('-');
  return y ? `${d}/${m}/${y}` : iso;
}

/* ------------------------------- Entities ------------------------------- */

/**
 * Each supported entity maps a natural-language "thing" to a Firestore
 * collection and its field shape. "evento" carries schedules; the money
 * entities (gasto/bono/aguinaldo/adelanto) share descripcion+fecha+monto,
 * with the extras ones pinned to a `tipo`.
 */
export const ENTITIES = {
  evento: { collection: 'eventos', label: 'Evento', kind: 'evento', nameField: 'evento' },
  gasto: { collection: 'gastos', label: 'Gasto', kind: 'money', nameField: 'descripcion' },
  bono: { collection: 'extras', label: 'Bono', kind: 'money', nameField: 'descripcion', tipo: 'bono' },
  aguinaldo: { collection: 'extras', label: 'Aguinaldo', kind: 'money', nameField: 'descripcion', tipo: 'aguinaldo' },
  adelanto: { collection: 'extras', label: 'Adelanto', kind: 'money', nameField: 'descripcion', tipo: 'adelanto' },
};

export function getEntity(intent) {
  return ENTITIES[intent?.entidad] || null;
}

export function recordName(entity, r) {
  return r[entity.nameField] || r.evento || r.descripcion || 'registro';
}

/* --------------------------------- Create ------------------------------- */

export function buildCreateRecord(entity, intent) {
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

/* ---------------------------------- Edit -------------------------------- */

export function sanitizeChanges(entity, cambios) {
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

/* -------------------------- Candidate matching -------------------------- */

export async function findCandidates(db, userId, entity, intent) {
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
    // Most recent first, so the disambiguation shows the likely ones.
    candidates.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }

  return { needsSelector: false, candidates };
}

/* ---------------------------- Period validation ------------------------- */

const PERIOD_TYPES = ['month', 'range', 'compare'];

// Validates a single (month|range) sub-period. Rejects malformed shapes that
// would otherwise produce "undefined <year>" labels or a TypeError downstream.
export function isValidSinglePeriod(period) {
  if (!period || typeof period !== 'object') return false;
  if (period.type === 'month') {
    return (
      Number.isInteger(period.month) &&
      period.month >= 1 &&
      period.month <= 12 &&
      Number.isInteger(period.year)
    );
  }
  if (period.type === 'range') {
    // Require well-formed YYYY-MM-DD bounds in order (from <= to); malformed
    // ranges fall through to the friendly hint instead of computing garbage.
    return isDate(period.from) && isDate(period.to) && period.from <= period.to;
  }
  return false;
}

export function isValidPeriod(period) {
  if (!period || typeof period !== 'object') return false;
  if (!PERIOD_TYPES.includes(period.type)) return false;
  if (period.type === 'compare') {
    // Exactly two sub-periods, each a valid month|range (nested compare not allowed).
    return (
      Array.isArray(period.periods) &&
      period.periods.length === 2 &&
      period.periods.every(isValidSinglePeriod)
    );
  }
  return isValidSinglePeriod(period);
}
