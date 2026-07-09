import {
  calcularPagoEvento,
  DEFAULT_TARIFA_FIN,
  DEFAULT_TARIFA_FIN_FIJO,
  DEFAULT_TARIFA_HORA_EXTRA,
  DEFAULT_TARIFA_OPERACION,
} from '../../../src/utils/calculations.js';
import { sumEventos, sumGastos, sumExtras, calcTotalFinal } from '../../../src/utils/totals.js';

/**
 * Read-only analytics engine for the Telegram "consultar" action.
 *
 * The LLM never computes numbers: it emits `{ action:'consultar', metric, period }`
 * and this module loads the user's Firestore data, filters by period the same way
 * the Dashboard does, and delegates every figure to the existing engine
 * (calcularPagoEvento + totals.js). No arithmetic is reinvented here.
 */

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Whole-doc fallback when `config/tarifas` is missing, matching the engine defaults.
const DEFAULT_TARIFAS = {
  tarifaFin: DEFAULT_TARIFA_FIN,
  tarifaFinFijo: DEFAULT_TARIFA_FIN_FIJO,
  tarifaHoraExtra: DEFAULT_TARIFA_HORA_EXTRA,
  tarifaOperacion: DEFAULT_TARIFA_OPERACION,
};

// metric → result shape metadata. `list`/`listDetail` metrics have no unit.
const METRIC_META = {
  countEventos: { kind: 'scalar', unit: 'count' },
  countEventosConOperacion: { kind: 'scalar', unit: 'count' },
  listEventosConOperacion: { kind: 'list' },
  // Detailed per-record listings (name, dates, hours, flags) for a period.
  listEventos: { kind: 'listDetail', entity: 'evento' },
  listGastos: { kind: 'listDetail', entity: 'gasto' },
  listExtras: { kind: 'listDetail', entity: 'extra' },
  horasExtra: { kind: 'scalar', unit: 'hours' },
  totalEventos: { kind: 'scalar', unit: 'money' },
  totalGastos: { kind: 'scalar', unit: 'money' },
  totalBonos: { kind: 'scalar', unit: 'money' },
  totalAguinaldo: { kind: 'scalar', unit: 'money' },
  totalAdelantos: { kind: 'scalar', unit: 'money' },
  totalFinal: { kind: 'scalar', unit: 'money' },
};

// A list metric can never be compared (no scalar semantics), so any of these
// inside a compare period is rejected upstream by unsupportedCombo().
const LIST_METRICS = ['listEventosConOperacion', 'listEventos', 'listGastos', 'listExtras'];

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const SUPPORTED_METRICS = Object.keys(METRIC_META);

// Friendly rejection for a `totalFinal` asked over a multi-calendar-month range:
// sueldoFijo is monthly and would be counted only once, undercounting salary.
const TOTAL_FINAL_RANGE_MSG =
  'El total final se calcula por mes (el sueldo fijo es mensual). Pedímelo por un mes puntual o comparando mes contra mes 🙂';

// Friendly rejection for comparing lists (no scalar semantics for a list metric).
const LIST_COMPARE_MSG =
  'No puedo comparar listas de eventos. Preguntame por un período (ej. "qué eventos tuve operación en julio") 🙂';

/** True when two 'YYYY-MM-DD' dates fall in the same calendar month (YYYY-MM). */
function sameCalendarMonth(from, to) {
  return typeof from === 'string' && typeof to === 'string' && from.slice(0, 7) === to.slice(0, 7);
}

/** A range that spans more than one calendar month. */
function isMultiMonthRange(period) {
  return !!period && period.type === 'range' && !sameCalendarMonth(period.from, period.to);
}

/**
 * Support gate for metric+period combinations that would produce a WRONG or
 * meaningless number. Returns a friendly reason string when unsupported, else null.
 *
 * - `totalFinal` over a range spanning >1 calendar month (or a compare whose
 *   sub-period is such a range): sueldoFijo is monthly and would be counted only
 *   once, undercounting salary. REJECTED rather than computed (never a wrong number).
 * - `listEventosConOperacion` inside a compare: reaches no scalar case downstream
 *   and lists cannot be compared. REJECTED with guidance.
 */
export function unsupportedCombo(metric, period) {
  if (!period || typeof period !== 'object') return null;

  if (LIST_METRICS.includes(metric) && period.type === 'compare') {
    return LIST_COMPARE_MSG;
  }

  if (metric === 'totalFinal') {
    if (isMultiMonthRange(period)) return TOTAL_FINAL_RANGE_MSG;
    if (
      period.type === 'compare' &&
      Array.isArray(period.periods) &&
      period.periods.some(isMultiMonthRange)
    ) {
      return TOTAL_FINAL_RANGE_MSG;
    }
  }

  return null;
}

/** Human label for a single (month|range) period. Used in compare results. */
function periodLabel(period) {
  if (!period) return '';
  if (period.type === 'month') return `${MONTHS_ES[period.month - 1]} ${period.year}`;
  if (period.type === 'range') return `${period.from}–${period.to}`;
  return '';
}

/**
 * Keeps only the rows inside `period`. Matches the Dashboard exactly:
 * a row's fecha is anchored at local noon (`fecha+'T12:00:00'`) to avoid any
 * timezone off-by-one, then compared by month/year. Range uses ISO string
 * comparison. `compare` periods are NOT filtered here (runQuery/computeMetric
 * runs each sub-period through this function individually).
 */
export function filterByPeriod(rows, period) {
  if (!Array.isArray(rows)) return [];
  // A null/undefined/non-object period must NOT leak the full history — return
  // nothing, consistent with the unknown-type fallback below (leak-guard contract).
  if (!period || typeof period !== 'object') return [];

  if (period.type === 'month') {
    return rows.filter((row) => {
      if (!row.fecha) return false;
      const d = new Date(`${row.fecha}T12:00:00`);
      return d.getMonth() + 1 === period.month && d.getFullYear() === period.year;
    });
  }

  if (period.type === 'range') {
    return rows.filter((row) => row.fecha && row.fecha >= period.from && row.fecha <= period.to);
  }

  // Unknown/malformed period type: return NOTHING, never the whole history.
  // Silently computing over all rows and presenting it as a period value would
  // violate the bot's core contract ("never show wrong numbers").
  return [];
}

/** Filters all three collections for a single (month|range) period. */
function filteredData(period, data) {
  return {
    fEvents: filterByPeriod(data.events || [], period),
    fExpenses: filterByPeriod(data.expenses || [], period),
    fExtras: filterByPeriod(data.extras || [], period),
  };
}

/** Computes a single scalar metric value for one (month|range) period. */
function scalarValue(metric, period, data) {
  const { fEvents, fExpenses, fExtras } = filteredData(period, data);
  const tarifas = data.tarifas || DEFAULT_TARIFAS;

  switch (metric) {
    case 'countEventos':
      return fEvents.length;
    case 'countEventosConOperacion':
      return fEvents.filter((e) => e.operacion === true).length;
    case 'horasExtra':
      return fEvents.reduce(
        (acc, e) => acc + calcularPagoEvento(e.fecha, e.horaEntrada, e.horaSalida, e.operacion, e.feriado, tarifas).horasExtra,
        0
      );
    case 'totalEventos':
      return sumEventos(fEvents, tarifas);
    case 'totalGastos':
      return sumGastos(fExpenses);
    case 'totalBonos':
      return sumExtras(fExtras).bonos;
    case 'totalAguinaldo':
      return sumExtras(fExtras).aguinaldo;
    case 'totalAdelantos':
      return sumExtras(fExtras).adelantos;
    case 'totalFinal':
      // sueldoFijo is applied once per sub-period: correct for a single calendar
      // month and for a month-vs-month compare. A `range` is exposed to the LLM
      // (openrouter.js), so a multi-calendar-month range would count sueldoFijo
      // only once and undercount salary — that combo is REJECTED upstream by
      // unsupportedCombo() (Fix 1) and never reaches this computation.
      return calcTotalFinal({
        sueldoFijo: data.sueldoFijo || 0,
        events: fEvents,
        expenses: fExpenses,
        extras: fExtras,
        tarifas,
      });
    default:
      throw new Error(`Unsupported metric: ${metric}`);
  }
}

/** Computes the list metric (evento names with operacion), sorted by fecha desc. */
function listItems(period, data) {
  const { fEvents } = filteredData(period, data);
  return fEvents
    .filter((e) => e.operacion === true)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    .map((e) => e.evento);
}

/** Full detail for one evento: schedule, flags, computed overtime, weekday. */
function eventoDetalle(e, tarifas) {
  const dow = new Date(`${e.fecha}T12:00:00`).getDay();
  return {
    evento: e.evento,
    fecha: e.fecha,
    horaEntrada: e.horaEntrada,
    horaSalida: e.horaSalida,
    operacion: e.operacion === true,
    feriado: e.feriado === true,
    horasExtra: calcularPagoEvento(e.fecha, e.horaEntrada, e.horaSalida, e.operacion, e.feriado, tarifas).horasExtra,
    diaSemana: DIAS_SEMANA[dow],
    finde: dow === 0 || dow === 6,
  };
}

/**
 * Computes a detailed per-record listing for a (month|range) period, newest
 * first. Events carry full schedule + flags + computed horasExtra + weekday;
 * money records carry descripcion/fecha/monto (extras also tipo).
 */
function detailItems(metric, period, data) {
  const { fEvents, fExpenses, fExtras } = filteredData(period, data);
  const byFechaDesc = (a, b) => (b.fecha || '').localeCompare(a.fecha || '');
  const tarifas = data.tarifas || DEFAULT_TARIFAS;

  if (metric === 'listEventos') {
    return [...fEvents].sort(byFechaDesc).map((e) => eventoDetalle(e, tarifas));
  }
  if (metric === 'listGastos') {
    return [...fExpenses].sort(byFechaDesc).map((g) => ({
      descripcion: g.descripcion,
      fecha: g.fecha,
      monto: g.monto,
    }));
  }
  // listExtras
  return [...fExtras].sort(byFechaDesc).map((x) => ({
    descripcion: x.descripcion,
    fecha: x.fecha,
    monto: x.monto,
    tipo: x.tipo,
  }));
}

/**
 * Pure computation core (no Firestore). Dispatches the metric over pre-loaded
 * data. `compare` periods run the scalar metric once per sub-period and return
 * both values plus a signed delta (last - first).
 */
export function computeMetric({ metric, period, data }) {
  const meta = METRIC_META[metric];
  if (!meta) throw new Error(`Unsupported metric: ${metric}`);

  if (period && period.type === 'compare') {
    const subs = Array.isArray(period.periods) ? period.periods : [];
    const results = subs.map((p) => ({ label: periodLabel(p), value: scalarValue(metric, p, data) }));
    const delta = results.length ? results[results.length - 1].value - results[0].value : 0;
    return { metric, period, kind: 'compare', unit: meta.unit, results, delta };
  }

  if (meta.kind === 'list') {
    return { metric, period, kind: 'list', items: listItems(period, data) };
  }

  if (meta.kind === 'listDetail') {
    return { metric, period, kind: 'listDetail', entity: meta.entity, items: detailItems(metric, period, data) };
  }

  return { metric, period, kind: 'scalar', unit: meta.unit, value: scalarValue(metric, period, data) };
}

/**
 * Loads the five per-user data sources from Firestore in parallel.
 * tarifas is the GLOBAL `config/tarifas` doc (fallback to engine defaults if
 * absent); sueldoFijo comes from `userPrefs/{userId}`.
 */
export async function loadData(db, userId) {
  const [evSnap, gaSnap, exSnap, tarSnap, prefSnap] = await Promise.all([
    db.collection('eventos').where('userId', '==', userId).get(),
    db.collection('gastos').where('userId', '==', userId).get(),
    db.collection('extras').where('userId', '==', userId).get(),
    db.doc('config/tarifas').get(),
    db.doc(`userPrefs/${userId}`).get(),
  ]);

  const events = evSnap.docs.map((d) => d.data());
  const expenses = gaSnap.docs.map((d) => d.data());
  const extras = exSnap.docs.map((d) => d.data());
  const tarifas = tarSnap.exists ? tarSnap.data() : DEFAULT_TARIFAS;
  const sueldoFijo = prefSnap.exists ? prefSnap.data().sueldoFijo || 0 : 0;

  return { events, expenses, extras, tarifas, sueldoFijo };
}

/**
 * Read-only entry point: loads the user's data and computes the metric.
 * Never writes to Firestore.
 */
export async function runQuery({ db, userId, metric, period }) {
  const data = await loadData(db, userId);
  return computeMetric({ metric, period, data });
}
