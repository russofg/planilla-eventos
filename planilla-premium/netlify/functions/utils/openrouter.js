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
 * Minimal OpenRouter chat call used by the phrasing layer.
 *
 * Reuses the same endpoint, model resolution, and headers as interpretMessage.
 * Returns the raw assistant content string. JSON mode is opt-in via `json`.
 * interpretMessage keeps its own inline fetch untouched.
 */
export async function chatCompletion({ system, user, temperature = 0, maxTokens = 400, json = true }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY env var is not set');
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Planilla BLS Bot',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

/**
 * Interprets a free-text message: classifies the action (crear/borrar/editar)
 * and the entity (evento/gasto/bono/aguinaldo/adelanto), then extracts the
 * relevant fields. Relative dates resolve against today's Argentina date.
 */
export async function interpretMessage(userText) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY env var is not set');
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const { todayIso, weekday } = argentinaNow();

  const system =
    `Sos el asistente de una planilla de trabajo. Hoy es ${todayIso} (${weekday}), ` +
    `zona horaria ${TIMEZONE}. Interpretá el mensaje (español coloquial argentino) y devolvé SOLO un JSON.\n\n` +
    `"action": "crear" | "borrar" | "editar" | "consultar" | "desconocido".\n` +
    `"entidad": "evento" | "gasto" | "bono" | "aguinaldo" | "adelanto".\n` +
    `  - evento: un turno de trabajo (tiene horarios de entrada y salida).\n` +
    `  - gasto: dinero gastado (ej. comida, viáticos).\n` +
    `  - bono / aguinaldo / adelanto: movimientos de dinero de ese tipo.\n\n` +
    `Si action="crear" y entidad="evento", agregá:\n` +
    `- "evento": string (nombre/lugar)\n` +
    `- "fecha": "YYYY-MM-DD" (resolvé hoy/mañana/ayer/días de la semana)\n` +
    `- "horaEntrada": "HH:MM" 24hs\n` +
    `- "horaSalida": "HH:MM" 24hs\n` +
    `- "operacion": boolean\n` +
    `- "feriado": boolean\n` +
    `Si falta el nombre o algún horario → action "desconocido".\n\n` +
    `Si action="crear" y entidad es gasto/bono/aguinaldo/adelanto, agregá:\n` +
    `- "descripcion": string (si no hay, poné un nombre corto acorde, ej. "Adelanto")\n` +
    `- "fecha": "YYYY-MM-DD"\n` +
    `- "monto": number en pesos ("65 mil" = 65000, "1,5 millones"/"1.5 palo" = 1500000)\n` +
    `Si falta el monto → action "desconocido".\n\n` +
    `Si action="borrar" o "editar", agregá lo que identifique el registro (al menos uno):\n` +
    `- para eventos "evento"; para dinero "descripcion" (nombre o parte del nombre)\n` +
    `- "fecha": "YYYY-MM-DD"\n` +
    `- "referencia": "reciente" si dice "el último"/"el de recién" sin nombrarlo\n` +
    `Y si action="editar", agregá "cambios": un objeto con SOLO los campos nuevos ` +
    `(mismos nombres que en crear según la entidad: para dinero pueden ser descripcion/fecha/monto).\n\n` +
    `Las acciones de escritura (crear/borrar/editar) tienen prioridad: si el mensaje pide crear, ` +
    `borrar o editar (modifica datos), usá esa acción. Usá "consultar" SOLO para preguntas de lectura ` +
    `(cuánto/cuántos/qué/listá) que NO modifican datos.\n\n` +
    `Si action="consultar", agregá "metric" (uno de): countEventos, countEventosConOperacion, ` +
    `listEventosConOperacion, listEventos, listGastos, listExtras, horasExtra, totalEventos, ` +
    `totalGastos, totalBonos, totalAguinaldo, totalAdelantos, totalFinal.\n` +
    `  - countEventos: cantidad de eventos. countEventosConOperacion: cantidad de eventos con operación.\n` +
    `  - listEventosConOperacion: lista de eventos con operación. horasExtra: horas extra trabajadas.\n` +
    `  - listEventos: DETALLE de los eventos (nombre, fecha, horarios, operación, feriado, día). Usalo ` +
    `cuando pida "detalle", "listame/mostrame los eventos o turnos", "cuáles fueron", "qué eventos tuve ` +
    `con sus datos". listGastos: detalle de los gastos ("en qué gasté", "listame los gastos"). ` +
    `listExtras: detalle de bonos/aguinaldos/adelantos.\n` +
    `  - totalEventos: ganancia por eventos. totalGastos: gastos. totalBonos/totalAguinaldo/totalAdelantos: ` +
    `dinero de ese tipo. totalFinal: total final del período.\n` +
    `  - Distinguí: "cuántos/cuánto" → count/total (número); "cuáles/detalle/listame" → listEventos/listGastos/listExtras.\n` +
    `Y agregá "period" con una de estas formas:\n` +
    `  - {"type":"month","year":YYYY,"month":1-12} (resolvé "este mes"/"mes pasado" con la fecha de hoy)\n` +
    `  - {"type":"range","from":"YYYY-MM-DD","to":"YYYY-MM-DD"} (fechas explícitas)\n` +
    `  - {"type":"compare","periods":[<dos period month o range>]} (para "vs"/"comparar")\n` +
    `Si no se menciona período, usá el mes actual como {"type":"month"}.\n` +
    `Si el período no encaja en esas formas (ej. "últimos 3 meses", "este trimestre"), poné action "desconocido".\n\n` +
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
      max_tokens: 400,
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
