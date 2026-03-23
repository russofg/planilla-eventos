import { getAccessTicket } from './utils/wsaa.js';
import { getUltimoComprobante } from './utils/wsfe.js';
import { getCreds } from './utils/certs.js';

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

  try {
    const { cert, key, cuit, isProduction } = getCreds();
    const ptoVta = parseInt(process.env.ARCA_PTO_VENTA || '4', 10);

    // 1. Autenticarse
    const { token, sign } = await getAccessTicket(cert, key, isProduction);

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
