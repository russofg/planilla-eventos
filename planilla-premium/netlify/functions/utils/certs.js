import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * Lee y desencripta los certificados desde disco usando el passphrase.
 * Fallback a variables de entorno para desarrollo local puro si no se generó.
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
    // Intentar leer y desencriptar desde disk (método seguro para Netlify Cloud)
    if (!passphrase) {
      throw new Error('No se definió ARCA_PASSPHRASE en el entorno');
    }
    
    const certPath = path.resolve(__dirname, 'cert.enc');
    const keyPath = path.resolve(__dirname, 'key.enc');
    
    const certEnc = fs.readFileSync(certPath, 'utf8');
    const keyEnc = fs.readFileSync(keyPath, 'utf8');
    
    cert = decrypt(certEnc, passphrase);
    key = decrypt(keyEnc, passphrase);
    // console.log("Certificados desencriptados correctamente desde disco");
  } catch (err) {
    // Si falla (ej. estamos en local y ARCA_PASSPHRASE no está, o archivos no existen), 
    // caemos de vuelta a las enormes env vars directamente.
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
