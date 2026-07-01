const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.0-flash-lite-001';
const TIMEZONE = 'America/Argentina/Buenos_Aires';

/** Current date in Argentina, so the model can resolve "hoy"/"mañana"/etc. */
export function argentinaNow() {
  const now = new Date();
  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const weekday = new Intl.DateTimeFormat('es-AR', {
    timeZone: TIMEZONE,
    weekday: 'long',
  }).format(now);
  return { todayIso, weekday };
}

/**
 * Sends the user's free-text message to the LLM and returns a structured event.
 * The model resolves relative dates against "today" (passed in) and never
 * invents data — it flags understood=false when the name or hours are missing.
 */
export async function extractEvent(userText) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY env var is not set');
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const { todayIso, weekday } = argentinaNow();

  const system =
    `Sos un extractor de datos para una planilla de trabajo de eventos.\n` +
    `Hoy es ${todayIso} (${weekday}), zona horaria ${TIMEZONE}.\n` +
    `Del mensaje del usuario extraé UN evento y devolvé SOLO un objeto JSON con estas claves exactas:\n` +
    `- "understood": boolean — true solo si identificás nombre del evento Y hora de entrada Y hora de salida.\n` +
    `- "evento": string — nombre del evento o lugar.\n` +
    `- "fecha": string "YYYY-MM-DD" — resolvé "hoy", "mañana", "ayer" o días de la semana según la fecha de hoy.\n` +
    `- "horaEntrada": string "HH:MM" en formato 24hs.\n` +
    `- "horaSalida": string "HH:MM" en formato 24hs.\n` +
    `- "operacion": boolean — true si menciona "operación", "operacion" o "con oper".\n` +
    `- "feriado": boolean — true si menciona que es feriado.\n` +
    `Si falta el nombre o algún horario, devolvé {"understood": false}.\n` +
    `No inventes datos ni agregues texto fuera del JSON.`;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Planilla BLS Bot',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 300,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(content);
  } catch {
    // Some models wrap the JSON in markdown fences; strip and retry once.
    const cleaned = content.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}
