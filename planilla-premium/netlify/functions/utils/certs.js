import crypto from 'crypto';
import { certEnc } from './certData.js';
import { keyEnc } from './keyData.js';

function decrypt(text, password) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const key = crypto.createHash('sha256').update(String(password)).digest('base64').substring(0, 32);
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

/**
 * Función que desencripta certificados mapeados estáticamente desde JS modules.
 * Esto garantiza que ESBuild de Netlify los incluya sin perderse en el file system.
 */
export function getCreds() {
  const cuit = process.env.ARCA_CUIT;
  const isProduction = process.env.ARCA_PRODUCTION === 'true';
  const passphrase = process.env.ARCA_PASSPHRASE;

  if (!cuit) {
    throw new Error('Falta variable de entorno ARCA_CUIT');
  }

  let cert, key;

  try {
    if (!passphrase) {
      throw new Error('No se definió ARCA_PASSPHRASE en el entorno. Imposible desencriptar certificados estáticos.');
    }
    
    cert = decrypt(certEnc, passphrase);
    key = decrypt(keyEnc, passphrase);
  } catch (err) {
    cert = process.env.ARCA_CERT;
    key = process.env.ARCA_KEY;
    
    if (!cert || !key) {
      throw new Error('Faltan certificados generados o ARCA_CERT/ARCA_KEY en entorno crudo. Error lectura segura: ' + err.message);
    }
    // Aseguramos saltos de línea reales si llegaron escaped
    cert = cert.replace(/\\n/g, '\n');
    key = key.replace(/\\n/g, '\n');
  }

  return { cert, key, cuit, isProduction };
}
