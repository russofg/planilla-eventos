import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar .env manual para no depender del modulo dotenv en node puro
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let key = match[1].trim();
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  });
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
