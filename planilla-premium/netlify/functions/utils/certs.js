import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
 * Fallback a variables de entorno para desarrollo local puro.
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
      throw new Error('No se definió ARCA_PASSPHRASE en el entorno');
    }
    
    // Ruta compatible con AWS Lambda y dev local
    const baseDir = process.env.LAMBDA_TASK_ROOT || process.cwd();
    // En local es process.cwd()/netlify/functions/utils/...
    // En AWS es /var/task/...
    const certPath = path.resolve(baseDir, 'netlify/functions/utils/cert.enc');
    const keyPath = path.resolve(baseDir, 'netlify/functions/utils/key.enc');
    
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
