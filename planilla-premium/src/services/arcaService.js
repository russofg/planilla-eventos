/**
 * ARCA Service — Calls Netlify Functions for AFIP billing
 */

const FUNCTIONS_BASE = '/.netlify/functions';

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
  fechaVtoPago,
  condicionIvaReceptor
}) {
  const response = await fetch(`${FUNCTIONS_BASE}/crear-factura`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      importeTotal,
      docTipo,
      docNro,
      concepto,
      ptoVta,
      fechaDesde,
      fechaHasta,
      fechaVtoPago,
      condicionIvaReceptor
    })
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Error desconocido al crear factura');
  }

  return data.data;
}

/**
 * Consulta el último comprobante autorizado
 * @returns {Promise<object>} { ultimoComprobante, proximoComprobante, puntoDeVenta }
 */
export async function getUltimoComprobante() {
  const response = await fetch(`${FUNCTIONS_BASE}/ultimo-comprobante`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Error al consultar último comprobante');
  }

  return data.data;
}
