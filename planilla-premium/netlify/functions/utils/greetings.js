/**
 * Zero-token small-talk short-circuit.
 *
 * A standalone greeting/thanks/farewell is answered with a warm, static
 * Rioplatense reply WITHOUT calling the classifier LLM and WITHOUT dumping the
 * help text. Compound commands that merely start with a greeting token (>= 30
 * chars) fall through to normal classification.
 *
 * Pure and framework-free so it unit-tests in isolation.
 */

// Lowercase, strip diacritics (á→a, ñ→n), drop punctuation/emojis, collapse
// spaces. Leaves a clean token to test against the curated Sets.
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GREETINGS = new Set([
  'hola', 'holaa', 'holaaa', 'holis', 'buenas', 'buenas buenas',
  'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches',
  'buen finde', 'hey', 'ey', 'que tal', 'como va', 'como andas',
  'como estas', 'todo bien', 'dale', 'ok', 'oka', 'perfecto',
]);

const THANKS = new Set([
  'gracias', 'muchas gracias', 'mil gracias', 'gracias totales', 'de diez',
]);

const FAREWELL = new Set([
  'chau', 'chauu', 'adios', 'nos vemos', 'saludos', 'hasta luego',
]);

/** @returns {'thanks'|'farewell'|'greeting'|null} */
export function greetingCategory(text) {
  const t = normalize(text);
  if (!t) return null;
  if (THANKS.has(t)) return 'thanks';
  if (FAREWELL.has(t)) return 'farewell';
  if (GREETINGS.has(t)) return 'greeting';
  return null;
}

export function isGreeting(text) {
  return String(text || '').trim().length < 30 && greetingCategory(text) !== null;
}

const REPLIES = {
  greeting: [
    '¡Hola! ¿En qué te doy una mano?',
    '¡Buenas! Contame qué necesitás.',
    '¡Hey! ¿Qué querés cargar o consultar?',
  ],
  thanks: [
    '¡De nada! Cuando quieras.',
    '¡Un gusto! Acá estoy para lo que necesites.',
  ],
  farewell: [
    '¡Chau! Cualquier cosa me escribís.',
    '¡Nos vemos! Cuando quieras seguimos.',
  ],
};

export function pickGreetingReply(text, rng = Math.random) {
  const category = greetingCategory(text) || 'greeting';
  const pool = REPLIES[category];
  return pool[Math.floor(rng() * pool.length)];
}
