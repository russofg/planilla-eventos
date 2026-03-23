// WSFE v1 URLs
const WSFE_URLS = {
  homo: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
};

/**
 * Helper genérico para llamadas SOAP al WSFE
 */
async function callWSFE(soapAction, soapBody, isProduction = false) {
  const url = isProduction ? WSFE_URLS.prod : WSFE_URLS.homo;

  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Header/>
  <soap:Body>
    ${soapBody}
  </soap:Body>
</soap:Envelope>`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `http://ar.gov.afip.dif.FEV1/${soapAction}`
    },
    body: soapEnvelope
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WSFE HTTP error ${response.status}: ${errorText}`);
  }

  return await response.text();
}

/**
 * Obtiene el último número de comprobante autorizado
 * @param {string} token
 * @param {string} sign
 * @param {string} cuit - CUIT del emisor (sin guiones)
 * @param {number} ptoVta - Punto de venta
 * @param {number} cbteTipo - Tipo de comprobante (11 = Factura C)
 * @param {boolean} isProduction
 * @returns {number} Último número de comprobante
 */
export async function getUltimoComprobante(token, sign, cuit, ptoVta, cbteTipo = 11, isProduction = false) {
  const soapBody = `
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>`;

  const responseText = await callWSFE('FECompUltimoAutorizado', soapBody, isProduction);

  const nroMatch = responseText.match(/<CbteNro>(\d+)<\/CbteNro>/);
  if (!nroMatch) {
    // Buscar errores
    const errMatch = responseText.match(/<Msg>([\s\S]*?)<\/Msg>/);
    throw new Error('WSFE FECompUltimoAutorizado error: ' + (errMatch ? errMatch[1] : responseText.substring(0, 500)));
  }

  return parseInt(nroMatch[1], 10);
}

/**
 * Solicita CAE para una Factura C
 * @param {object} params
 * @returns {{ cae, caeVto, cbteDesde, resultado, observaciones }}
 */
export async function crearFacturaC({
  token,
  sign,
  cuit,
  ptoVta,
  cbteDesde,
  concepto = 2,          // 2 = Servicios
  docTipo = 99,          // 99 = Consumidor Final, 80 = CUIT
  docNro = '0',
  importeTotal,
  fechaDesde = null,     
  fechaHasta = null,     
  fechaVtoPago = null,   
  condicionIvaReceptorId = 5, // RG 5616: Obligatorio (5 = Consumidor Final)
  isProduction = false
}) {
  // Fecha del comprobante: hoy en formato YYYYMMDD
  const now = new Date();
  const cbteDate = now.toISOString().slice(0, 10).replace(/-/g, '');

  // Si no se pasan, usar el primer y último día del mes anterior
  if (!fechaDesde) {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    fechaDesde = firstDay.toISOString().slice(0, 10).replace(/-/g, '');
  }
  if (!fechaHasta) {
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    fechaHasta = lastDay.toISOString().slice(0, 10).replace(/-/g, '');
  }
  if (!fechaVtoPago) {
    // Vencimiento de pago: 15 días desde hoy
    const vto = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    fechaVtoPago = vto.toISOString().slice(0, 10).replace(/-/g, '');
  }

  const soapBody = `
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVta}</ar:PtoVta>
          <ar:CbteTipo>11</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${concepto}</ar:Concepto>
            <ar:DocTipo>${docTipo}</ar:DocTipo>
            <ar:DocNro>${docNro}</ar:DocNro>
            <ar:CbteDesde>${cbteDesde}</ar:CbteDesde>
            <ar:CbteHasta>${cbteDesde}</ar:CbteHasta>
            <ar:CbteFch>${cbteDate}</ar:CbteFch>
            <ar:ImpTotal>${importeTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0</ar:ImpTotConc>
            <ar:ImpNeto>${importeTotal.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0</ar:ImpOpEx>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:ImpIVA>0</ar:ImpIVA>
            <ar:FchServDesde>${fechaDesde}</ar:FchServDesde>
            <ar:FchServHasta>${fechaHasta}</ar:FchServHasta>
            <ar:FchVtoPago>${fechaVtoPago}</ar:FchVtoPago>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>${condicionIvaReceptorId}</ar:CondicionIVAReceptorId>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>`;

  const responseText = await callWSFE('FECAESolicitar', soapBody, isProduction);

  // Parsear respuesta
  const resultadoMatch = responseText.match(/<Resultado>(\w+)<\/Resultado>/);
  const caeMatch = responseText.match(/<CAE>(\d+)<\/CAE>/);
  const caeVtoMatch = responseText.match(/<CAEFchVto>(\d+)<\/CAEFchVto>/);
  const cbteDesdeMatch = responseText.match(/<CbteDesde>(\d+)<\/CbteDesde>/);

  // Buscar observaciones/errores
  let observaciones = '';
  const obsMatch = responseText.match(/<Obs>([\s\S]*?)<\/Obs>/);
  if (obsMatch) {
    const msgMatch = obsMatch[1].match(/<Msg>([\s\S]*?)<\/Msg>/);
    observaciones = msgMatch ? msgMatch[1] : obsMatch[1];
  }

  // Buscar errores en la respuesta
  const errMatch = responseText.match(/<Errors>([\s\S]*?)<\/Errors>/);
  let errores = '';
  if (errMatch) {
    const errMsgMatch = errMatch[1].match(/<Msg>([\s\S]*?)<\/Msg>/);
    errores = errMsgMatch ? errMsgMatch[1] : errMatch[1];
  }

  const resultado = resultadoMatch ? resultadoMatch[1] : 'R';

  if (resultado === 'R') {
    throw new Error(`Factura rechazada: ${errores || observaciones || 'Error desconocido'}. Response: ${responseText.substring(0, 800)}`);
  }

  return {
    resultado,
    cae: caeMatch ? caeMatch[1] : null,
    caeVto: caeVtoMatch ? caeVtoMatch[1] : null,
    cbteDesde: cbteDesdeMatch ? parseInt(cbteDesdeMatch[1], 10) : cbteDesde,
    observaciones,
    rawResponse: responseText.substring(0, 1000)
  };
}
