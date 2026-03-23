import { getAccessTicket } from './utils/wsaa.js';
import { getUltimoComprobante } from './utils/wsfe.js';
import { getCreds } from './utils/certs.js';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'planilla-evento',
  });
}

/**
 * Netlify Function: ultimo-comprobante
 * Consulta el último número de comprobante autorizado
 */
export async function handler(event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // 1. VERIFICACIÓN DE SEGURIDAD CRÍTICA
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Unauthorized: Missing or invalid Bearer token' })
    };
  }

  let idToken, decodedToken;
  try {
    idToken = authHeader.split('Bearer ')[1];
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Forbidden: Invalid Firebase token' })
    };
  }

  try {
    const { cert, key, cuit, isProduction } = getCreds();
    const ptoVta = parseInt(process.env.ARCA_PTO_VENTA || '4', 10);

    // 1. Autenticarse
    const { token, sign } = await getAccessTicket(cert, key, isProduction, idToken);

    // 2. Consultar último comprobante (Factura C = tipo 11)
    const ultimoNro = await getUltimoComprobante(token, sign, cuit, ptoVta, 11, isProduction);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: {
          ultimoComprobante: ultimoNro,
          proximoComprobante: ultimoNro + 1,
          puntoDeVenta: ptoVta
        }
      })
    };

  } catch (error) {
    console.error('Error en ultimo-comprobante:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Error al consultar último comprobante'
      })
    };
  }
}
