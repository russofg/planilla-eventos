import { getAccessTicket } from './utils/wsaa.js';
import { getUltimoComprobante, crearFacturaC } from './utils/wsfe.js';
import { getCreds } from './utils/certs.js';
import admin from 'firebase-admin';

// Inicializar Firebase Admin (solo para evaluar tokens)
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'planilla-evento',
  });
}

/**
 * Netlify Function: crear-factura
 * Emite una Factura C via ARCA WSFE
 */
export async function handler(event) {
  // Solo aceptar POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // 1. VERIFICACIÓN DE SEGURIDAD CRÍTICA (Bloquea llamadas públicas)
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
    const body = JSON.parse(event.body);
    const {
      importeTotal,
      docTipo = 99,       // 99 = Consumidor Final, 80 = CUIT
      docNro = '0',
      concepto = 'Servicios',
      ptoVta,
      fechaDesde,
      fechaHasta,
      fechaVtoPago,
      condicionIvaReceptor = 'Consumidor Final'
    } = body;

    if (!importeTotal || importeTotal <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'importeTotal es requerido y debe ser mayor a 0' })
      };
    }

    const { cert, key, cuit, isProduction } = getCreds();

    // Mapeo Condicion IVA Receptor a ID de AFIP (RG 5616)
    const mapIva = {
      'Responsable Inscripto': 1,
      'Exento': 4,
      'IVA Sujeto Exento': 4,
      'Consumidor Final': 5,
      'Monotributista': 6
    };
    const condicionIvaReceptorId = mapIva[condicionIvaReceptor] || 5;

    // Usar punto de venta del body o de env var
    const puntoVenta = ptoVta || parseInt(process.env.ARCA_PTO_VENTA || '4', 10);

    // Obtener ticket de acceso o generar uno nuevo
    const { token, sign } = await getAccessTicket(cert, key, isProduction, idToken);

    // 2. Obtener último comprobante
    const ultimoNro = await getUltimoComprobante(token, sign, cuit, puntoVenta, 11, isProduction);
    const nuevoNro = ultimoNro + 1;

    // 3. Crear la factura
    const resultado = await crearFacturaC({
      token,
      sign,
      cuit,
      ptoVta: puntoVenta,
      cbteDesde: nuevoNro,
      concepto: 2, // Servicios
      docTipo,
      docNro: docNro.toString(),
      importeTotal: parseFloat(importeTotal),
      fechaDesde,
      fechaHasta,
      fechaVtoPago,
      condicionIvaReceptorId,
      isProduction
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: {
          cae: resultado.cae,
          caeVencimiento: resultado.caeVto,
          nroComprobante: resultado.cbteDesde,
          puntoDeVenta: puntoVenta,
          importeTotal: parseFloat(importeTotal),
          resultado: resultado.resultado,
          observaciones: resultado.observaciones,
          cuit,
          conceptoDesc: concepto
        }
      })
    };

  } catch (error) {
    console.error('Error en crear-factura:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Error interno al crear la factura'
      })
    };
  }
}
