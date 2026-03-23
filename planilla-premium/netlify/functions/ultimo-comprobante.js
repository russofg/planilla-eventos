import { getAccessTicket } from './utils/wsaa.js';
import { getUltimoComprobante } from './utils/wsfe.js';

import fs from 'fs';
import path from 'path';

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
    const cuit = process.env.ARCA_CUIT;
    const isProduction = process.env.ARCA_PRODUCTION === 'true';
    const ptoVta = parseInt(process.env.ARCA_PTO_VENTA || '4', 10);

    if (!cuit) {
      throw new Error('Falta variable de entorno ARCA_CUIT');
    }

    let cert, key;
    try {
      const certPath = path.resolve(__dirname, 'utils/cert.pem');
      const keyPath = path.resolve(__dirname, 'utils/key.pem');
      cert = fs.readFileSync(certPath, 'utf8');
      key = fs.readFileSync(keyPath, 'utf8');
    } catch (err) {
      cert = process.env.ARCA_CERT;
      key = process.env.ARCA_KEY;
      if (!cert || !key) {
        throw new Error('Faltan certificados generados o ARCA_CERT/ARCA_KEY: ' + err.message);
      }
    }

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
