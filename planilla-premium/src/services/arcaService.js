import { getAuth } from 'firebase/auth';

/**
 * ARCA Service — Calls Netlify Functions for AFIP billing
 */

const FUNCTIONS_BASE = '/.netlify/functions';

/**
 * Helper interno para obtener el token del usuario actual
 */
async function getAuthHeaders() {
  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('Usuario no autenticado. Inicia sesión para interactuar con AFIP.');
  }
  const token = await auth.currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

/**
 * Crea una Factura C via ARCA
 * @param {object} params
 * @param {number} params.importeTotal - Monto total a facturar
 * @param {number} params.docTipo - 99=Consumidor Final, 80=CUIT, 96=DNI
 * @param {string} params.docNro - Número de documento del receptor (0 para CF)
 * @param {string} params.concepto - Descripción del concepto
 * @param {number} params.ptoVta - Punto de venta (opcional, usa env var si no se pasa)
 * @param {string} params.fechaDesde - YYYYMMDD período desde
 * @param {string} params.fechaHasta - YYYYMMDD período hasta
 * @param {number} params.condicionIvaReceptor - ID de la condición de IVA del receptor (5 para CF)
 * @returns {Promise<object>} Resultado con CAE, nroComprobante, etc.
 */
export async function crearFactura({
  importeTotal,
  docTipo = 99,
  docNro = '0',
  concepto = 'Servicios',
  ptoVta,
  fechaDesde,
  fechaHasta,
  condicionIvaReceptor = 5 // Por defecto a CF
}) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${FUNCTIONS_BASE}/crear-factura`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      importeTotal,
      docTipo,
      docNro,
      concepto,
      ptoVta,
      fechaDesde,
      fechaHasta,
      condicionIvaReceptorId: condicionIvaReceptor
    })
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Error al comunicarse con AFIP');
  }
  return data.data; // { cae, caeVencimiento, nroComprobante, puntoDeVenta, resultado }
}

/**
 * Obtiene el último comprobante autorizado de Clase C (11)
 * @returns {Promise<number>} numero del comprobante
 */
export async function getUltimoComprobante() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${FUNCTIONS_BASE}/ultimo-comprobante`, {
    method: 'GET',
    headers
  });
  
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Error al obtener último comprobante');
  }
  return data.data; // { ultimoComprobante, proximoComprobante, puntoDeVenta }
}
