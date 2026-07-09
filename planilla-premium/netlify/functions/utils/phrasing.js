/**
 * Optional LLM restyle of query replies, gated by a hard number-presence check.
 *
 * The engine computes and formats every number; the LLM may only reorder/wrap
 * prose. Any output missing a required exact substring — or any thrown error —
 * is discarded in favour of the deterministic template (`fallbackFn`). The LLM
 * is architecturally incapable of surfacing a number the engine did not compute.
 *
 * The LLM caller is dependency-injected (`deps.chat`) so this module unit-tests
 * without live network.
 */

import { formatValue } from './format.js';

// Context-only label map (mirrors METRIC_TITLE); a miss is graceful because the
// value is validated separately and a wrong label never reaches the number gate.
const METRIC_LABEL = {
  countEventos: 'cantidad de eventos',
  countEventosConOperacion: 'cantidad de eventos con operación',
  listEventosConOperacion: 'eventos con operación',
  horasExtra: 'horas extra',
  totalEventos: 'ganancia por eventos',
  totalGastos: 'gastos',
  totalBonos: 'bonos',
  totalAguinaldo: 'aguinaldo',
  totalAdelantos: 'adelantos',
  totalFinal: 'total final',
};

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function metricLabel(metric) {
  return METRIC_LABEL[metric] || 'el dato';
}

function periodText(period) {
  if (!period) return '';
  if (period.type === 'month') return `${MONTHS_ES[period.month - 1]} ${period.year}`;
  if (period.type === 'range') return `${period.from} a ${period.to}`;
  return '';
}

/**
 * Exact formatted substrings that MUST appear in the LLM output, or `null` to
 * signal "skip phrasing" (list results keep their deterministic bullet list).
 * @returns {string[]|null}
 */
export function requiredNumbers(result) {
  if (!result || result.kind === 'list') return null;
  if (result.kind === 'compare') {
    const [a, b] = result.results;
    return [formatValue(result.unit, a.value), formatValue(result.unit, b.value)];
  }
  // scalar
  return [formatValue(result.unit, result.value)];
}

/** Builds the Rioplatense one-sentence restyle prompt. */
export function buildPhrasingPrompt(result) {
  const system =
    'Sos el asistente de una planilla de trabajo; hablás en español rioplatense, ' +
    'cálido y directo. Te paso un RESULTADO YA CALCULADO. Reescribilo como UNA sola ' +
    'oración natural. Reglas: usá EXACTAMENTE los valores que te doy (no los cambies, ' +
    'no los redondees, no agregues otros números), no inventes datos, una sola oración, ' +
    "sin emojis, sin viñetas, sin encabezados, sin la palabra 'evento(s)', sin HTML ni " +
    'Markdown. Respondé SOLO la oración.';

  let user;
  if (result.kind === 'compare') {
    const [a, b] = result.results;
    const direccion = result.delta > 0 ? 'subió' : result.delta < 0 ? 'bajó' : 'igual';
    user = JSON.stringify({
      metrica: metricLabel(result.metric),
      a: { periodo: a.label, valor: formatValue(result.unit, a.value) },
      b: { periodo: b.label, valor: formatValue(result.unit, b.value) },
      direccion,
    });
  } else {
    user = JSON.stringify({
      metrica: metricLabel(result.metric),
      periodo: periodText(result.period),
      valor: formatValue(result.unit, result.value),
    });
  }

  return { system, user };
}

/**
 * Restyle a query reply via the injected LLM, gated by number validation.
 * On any miss, empty output, or thrown error → returns fallbackFn().
 *
 * @param {object} result   engine result (scalar|compare|list)
 * @param {() => string} fallbackFn  deterministic template producer
 * @param {{ chat: Function }} deps  injected OpenRouter caller
 */
export async function phraseQueryResult(result, fallbackFn, deps = {}) {
  const required = requiredNumbers(result);
  if (required === null) return fallbackFn();

  try {
    const { system, user } = buildPhrasingPrompt(result);
    const text = await deps.chat({ system, user, temperature: 0.4, maxTokens: 80, json: false });
    if (typeof text !== 'string' || !text.trim()) return fallbackFn();
    if (!required.every((s) => text.includes(s))) return fallbackFn();
    return text.trim();
  } catch {
    return fallbackFn();
  }
}
