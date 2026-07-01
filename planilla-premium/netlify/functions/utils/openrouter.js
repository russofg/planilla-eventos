const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
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
 * Interprets a free-text message: first classifies the intent (create / delete
 * / edit), then extracts the fields relevant to that intent. Relative dates are
 * resolved against today's Argentina date. The model never invents data.
 *
 * Returns an object like:
 *   { action: "crear", evento, fecha, horaEntrada, horaSalida, operacion, feriado }
 *   { action: "borrar", evento?, fecha?, horaEntrada? }
 *   { action: "editar", ... }   (identification fields; handled later)
 *   { action: "desconocido" }
 */
export async function interpretMessage(userText) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY env var is not set');
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const { todayIso, weekday } = argentinaNow();

  const system =
    `Sos el asistente de una planilla de trabajo de eventos.\n` +
    `Hoy es ${todayIso} (${weekday}), zona horaria ${TIMEZONE}.\n` +
    `Interpretá el mensaje del usuario (lenguaje coloquial argentino) y devolvé SOLO un objeto JSON.\n\n` +
    `Primero decidí "action":\n` +
    `- "crear": quiere agregar/cargar un evento nuevo.\n` +
    `- "borrar": quiere eliminar/borrar un evento existente.\n` +
    `- "editar": quiere modificar/cambiar un evento existente.\n` +
    `- "desconocido": no queda claro o falta información.\n\n` +
    `Si action = "crear", agregá:\n` +
    `- "evento": string (nombre o lugar del evento)\n` +
    `- "fecha": "YYYY-MM-DD" (resolvé "hoy", "mañana", "ayer" o días de la semana)\n` +
    `- "horaEntrada": "HH:MM" 24hs\n` +
    `- "horaSalida": "HH:MM" 24hs\n` +
    `- "operacion": boolean (true si menciona operación)\n` +
    `- "feriado": boolean\n` +
    `Si para crear falta el nombre o algún horario, usá action "desconocido".\n\n` +
    `Si action = "borrar" o "editar", agregá los datos que sirvan para identificar el evento ` +
    `(al menos uno de estos, todos opcionales):\n` +
    `- "evento": string (nombre o parte del nombre)\n` +
    `- "fecha": "YYYY-MM-DD"\n` +
    `- "horaEntrada": "HH:MM"\n` +
    `- "referencia": "reciente" si el usuario se refiere al último evento cargado sin nombrarlo ` +
    `("el de recién", "el último", "el que acabo de cargar").\n\n` +
    `No inventes datos. Respondé SOLO el JSON, sin texto extra.`;

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
    const cleaned = content.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}
