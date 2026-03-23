import forge from 'node-forge';
import fs from 'fs';
import path from 'path';
import os from 'os';

// WSAA URLs
const WSAA_URLS = {
  homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
};

const CACHE_FILE = path.resolve(process.cwd(), '.netlify', 'afip_ticket.json');

// Cache del ticket de acceso para no pedir uno nuevo en cada request
let cachedTicket = null;

/**
 * Genera el Login Ticket Request XML
 */
function generateLoginTicketRequest(service = 'wsfe') {
  const now = new Date();
  const uniqueId = Math.floor(now.getTime() / 1000);

  // Generation time: 10 minutos atrás (compensar posible desfasaje de reloj)
  const genTime = new Date(now.getTime() - 10 * 60 * 1000);
  // Expiration time: 12 horas adelante (máximo permitido y recomendado)
  const expTime = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  // Fix timezone issue: subtract 3 hours from UTC time to get ART time, then append -03:00
  const tzOffset = 3 * 60 * 60 * 1000;
  const formatDate = (d) => new Date(d.getTime() - tzOffset).toISOString().split('.')[0] + '-03:00';

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${formatDate(genTime)}</generationTime>
    <expirationTime>${formatDate(expTime)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

/**
 * Firma el LoginTicketRequest con CMS (PKCS#7) usando cert + key
 */
function signLoginTicketRequest(ltr, certPem, keyPem) {
  // Parsear certificado y clave privada
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  // Crear el PKCS#7 signed data
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(ltr, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data
      },
      {
        type: forge.pki.oids.messageDigest
      },
      {
        type: forge.pki.oids.signingTime,
        value: new Date()
      }
    ]
  });

  p7.sign();

  // Convertir a DER y luego a base64
  const asn1 = p7.toAsn1();
  const der = forge.asn1.toDer(asn1);
  return forge.util.encode64(der.getBytes());
}

/**
 * Envia el CMS firmado al WSAA y obtiene Token + Sign
 */
async function callWSAA(cmsBase64, isProduction = false) {
  const url = isProduction ? WSAA_URLS.prod : WSAA_URLS.homo;

  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsa="http://wsaa.view.afip.gov.ar">
  <soapenv:Header/>
  <soapenv:Body>
    <wsa:loginCms>
      <wsa:in0>${cmsBase64}</wsa:in0>
    </wsa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': ''
    },
    body: soapEnvelope
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WSAA HTTP error ${response.status}: ${errorText}`);
  }

  const responseText = await response.text();

  // Extraer el loginTicketResponse del SOAP response
  const loginTicketMatch = responseText.match(/<loginTicketResponse>([\s\S]*?)<\/loginTicketResponse>/);
  if (!loginTicketMatch) {
    // Buscar si vino como CDATA o encoded
    const returnMatch = responseText.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
    if (!returnMatch) {
      throw new Error('WSAA: No se pudo parsear la respuesta. Response: ' + responseText.substring(0, 500));
    }
    // Decodificar HTML entities
    const decoded = returnMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');

    return extractTokenAndSign(decoded);
  }

  return extractTokenAndSign(loginTicketMatch[0]);
}

/**
 * Extrae Token y Sign del loginTicketResponse XML
 */
function extractTokenAndSign(xml) {
  const tokenMatch = xml.match(/<token>([\s\S]*?)<\/token>/);
  const signMatch = xml.match(/<sign>([\s\S]*?)<\/sign>/);

  if (!tokenMatch || !signMatch) {
    throw new Error('WSAA: No se encontró token o sign en la respuesta');
  }

  return {
    token: tokenMatch[1].trim(),
    sign: signMatch[1].trim()
  };
}

/**
 * Obtiene un ticket de acceso (con cache)
 * @param {string} certPem - Certificado PEM
 * @param {string} keyPem - Clave privada PEM
 * @param {boolean} isProduction - true para producción, false para homologación
 * @returns {{ token: string, sign: string }}
 */
export async function getAccessTicket(certPem, keyPem, isProduction = false) {
  // 1. Intentar memoria (rápido)
  // Margen de 5 minutos antes de considerarlo expirado
  const margin = 5 * 60 * 1000;
  if (cachedTicket && cachedTicket.expiration > Date.now() + margin) {
    return cachedTicket;
  }

  // 2. Intentar archivo en /tmp (útil para netlify dev hot-reloads y serverless cold starts)
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const fileData = fs.readFileSync(CACHE_FILE, 'utf8');
      const fileCache = JSON.parse(fileData);
      if (fileCache && fileCache.expiration > Date.now() + margin) {
        cachedTicket = fileCache;
        return cachedTicket;
      }
    }
  } catch (err) {
    console.warn("Warn: No se pudo leer el caché de ticket AFIP del disco:", err.message);
  }

  // Si llegamos acá, generar nuevo ticket.
  // AFIP por defecto emite tickets válidos por 12 horas.
  const ltr = generateLoginTicketRequest('wsfe');

  // 2. Firmar con CMS
  const cmsBase64 = signLoginTicketRequest(ltr, certPem, keyPem);

  // 3. Llamar al WSAA
  const { token, sign } = await callWSAA(cmsBase64, isProduction);

  // Cachear por 12 horas exactas (tiempo de vida del ticket en AFIP)
  const expirationTime = Date.now() + 12 * 60 * 60 * 1000;

  cachedTicket = {
    token,
    sign,
    expiration: expirationTime
  };

  // Guardar en disco para el próximo hot-reload / lambda cold start
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedTicket), 'utf8');
  } catch (err) {
    console.warn("Warn: No se pudo guardar el caché de ticket AFIP en disco:", err.message);
  }

  return { token, sign };
}
