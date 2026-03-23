import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar .env manual soportando multinlineas (ej: certificados PEM)
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  // Regex que busca "CLAVE=VALOR" o "CLAVE='VALOR_MULTILINEA'" o 'CLAVE="VALOR_MULTILINEA"'
  const regex = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/gm;
  let match;
  while ((match = regex.exec(envFile)) !== null) {
    let key = match[1];
    let val = match[2] || '';
    val = val.trim();
    
    // Check if it's a quoted multiline value starting with " or '
    if (val.startsWith('"') || val.startsWith("'")) {
      const quoteChar = val[0];
      const startIndex = match.index + match[0].indexOf(val) + 1;
      let endIndex = envFile.indexOf(quoteChar, startIndex);
      
      // Handle escaped quotes
      while (endIndex !== -1 && envFile[endIndex - 1] === '\\') {
          endIndex = envFile.indexOf(quoteChar, endIndex + 1);
      }
      
      if (endIndex !== -1) {
          val = envFile.substring(startIndex, endIndex);
          // Advance the regex index past this multiline value
          regex.lastIndex = endIndex + 1;
      } else {
          // Fallback if missing closing quote
          val = val.substring(1);
      }
    }
    process.env[key] = val;
  }
}

const cert = process.env.ARCA_CERT;
const key = process.env.ARCA_KEY;

if (!cert || !key) {
  console.error("Faltan ARCA_CERT o ARCA_KEY en .env");
  process.exit(1);
}

// Generar una contraseña segura aleatoria de 32 caracteres
const passphrase = crypto.randomBytes(16).toString('hex');

const algorithm = 'aes-256-cbc';

function encrypt(text, password) {
  // Generar un IV aleatorio de 16 bytes
  const iv = crypto.randomBytes(16);
  // Derivar una clave de 32 bytes a partir del password usando sha256
  const key = crypto.createHash('sha256').update(String(password)).digest('base64').substring(0, 32);
  
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  // Guardar IV + data encriptada (para poder desencriptar despues)
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

const certEnc = encrypt(cert.replace(/\\n/g, '\n'), passphrase);
const keyEnc = encrypt(key.replace(/\\n/g, '\n'), passphrase);

const utilsDir = path.resolve(__dirname, 'netlify/functions/utils');
if (!fs.existsSync(utilsDir)) {
  fs.mkdirSync(utilsDir, { recursive: true });
}

fs.writeFileSync(path.join(utilsDir, 'certData.js'), `export const certEnc = "${certEnc}";\n`, 'utf8');
fs.writeFileSync(path.join(utilsDir, 'keyData.js'), `export const keyEnc = "${keyEnc}";\n`, 'utf8');

console.log("==========================================");
console.log("✅ Certificados encriptados exitosamente!");
console.log("Se guardaron en netlify/functions/utils/certData.js y keyData.js");
console.log("==========================================");
console.log("🔑 TU NUEVA CONTRASEÑA ES:");
console.log(passphrase);
console.log("==========================================");
console.log("Guarda esta contraseña. Tendrás que agregarla a Netlify como: ARCA_PASSPHRASE");
