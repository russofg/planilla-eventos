import { getDb } from './utils/firebaseAdmin.js';
import { loadData, filterByPeriod } from './utils/queryEngine.js';
import { argentinaNow } from './utils/openrouter.js';
import { sumGastos, sumExtras, calcTotalFinal } from '../../src/utils/totals.js';
import { buildPlanillaPdfDoc } from '../../src/utils/generatePdf.js';

/**
 * Netlify Function: planilla-pdf
 *
 * Generates the SAME monthly report PDF the app produces client-side, but on
 * the server, so the Maria assistant can fetch it and email it. Reuses the
 * exact building blocks: queryEngine.loadData for the user's data, totals.js
 * for the summary figures, and generatePdf.js's buildPlanillaPdfDoc for layout.
 *
 * Auth + ownership mirror maria-bridge: Bearer MARIA_BRIDGE_SECRET, and the
 * userId is resolved from the verified telegramLinks mapping (never trusted
 * from the request body).
 *
 * Request (POST, application/json):
 *   { "month": 6, "year": 2026, "chatId": "1050123460" }
 * month/year are optional; when omitted the current Argentina month is used.
 *
 * Response: { status:"ok", filename, pdfBase64, period:{month,year} }
 * or { status:"error"|"not_linked", message }.
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

  const chatId =
    body.chatId != null ? String(body.chatId) : (process.env.MARIA_DEFAULT_CHATID || '');
  if (!chatId) return json(400, { status: 'error', message: 'chatId or MARIA_DEFAULT_CHATID required' });

  // Resolve the period: explicit month/year, else current Argentina month.
  const { todayIso } = argentinaNow();
  const [curYear, curMonth] = todayIso.split('-').map((n) => parseInt(n, 10));
  const month = Number.isInteger(body.month) ? body.month : curMonth;
  const year = Number.isInteger(body.year) ? body.year : curYear;
  if (month < 1 || month > 12 || year < 2000 || year > 2100) {
    return json(400, { status: 'error', message: 'Invalid month/year' });
  }

  try {
    const db = getDb();

    const linkSnap = await db.collection('telegramLinks').doc(chatId).get();
    if (!linkSnap.exists) {
      return json(200, {
        status: 'not_linked',
        message: 'Esta cuenta de Telegram no está vinculada.',
      });
    }
    const userId = linkSnap.data().userId;

    const data = await loadData(db, userId);
    const period = { type: 'month', month, year };

    const fEvents = filterByPeriod(data.events, period);
    const fExpenses = filterByPeriod(data.expenses, period);
    const fExtras = filterByPeriod(data.extras, period);

    const extrasTotals = sumExtras(fExtras);
    const monthTotalExpenses = sumGastos(fExpenses);
    const monthTotalFinal = calcTotalFinal({
      sueldoFijo: data.sueldoFijo,
      events: fEvents,
      expenses: fExpenses,
      extras: fExtras,
      tarifas: data.tarifas,
    });

    // Best-effort: show the user's email in the header if we have it.
    let userEmail = '';
    try {
      const userSnap = await db.collection('users').doc(userId).get();
      if (userSnap.exists) userEmail = userSnap.data().email || userSnap.data().correo || '';
    } catch { /* header falls back to "Tú" */ }

    const { doc, filename } = buildPlanillaPdfDoc({
      events: fEvents,
      expenses: fExpenses,
      sueldoFijo: data.sueldoFijo,
      monthTotalExpenses,
      monthTotalBonos: extrasTotals.bonos,
      monthTotalAguinaldo: extrasTotals.aguinaldo,
      monthTotalAdelantos: extrasTotals.adelantos,
      monthTotalFinal,
      filterMonth: String(month - 1), // generatePdf expects a 0-indexed month string
      filterYear: String(year),
      userEmail,
      tarifasGlobales: data.tarifas,
    });

    const pdfBase64 = Buffer.from(doc.output('arraybuffer')).toString('base64');

    return json(200, { status: 'ok', filename, pdfBase64, period: { month, year } });
  } catch (err) {
    console.error('planilla-pdf error:', err);
    return json(200, { status: 'error', message: 'No pude generar el PDF ahora.' });
  }
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
