/**
 * Single source of number formatting for Telegram replies.
 *
 * Both the deterministic templates (formatQueryReply) and the LLM phrasing
 * validation (phrasing.js) import these helpers, so the strings the phrasing
 * layer validates byte-match what the fallback template would print.
 */

export function fmtMoney(n) {
  return `$ ${Number(n).toLocaleString('es-AR')}`;
}

export function formatValue(unit, value) {
  if (unit === 'money') return fmtMoney(value);
  if (unit === 'hours') return `${value} h`;
  return String(value);
}
