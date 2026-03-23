const fs = require('fs');
const path = require('path');

console.log("Generando archivos de certificados ARCA desde variables de entorno...");

const certPath = path.resolve(__dirname, 'netlify/functions/utils/cert.pem');
const keyPath = path.resolve(__dirname, 'netlify/functions/utils/key.pem');

// Opcional: Crear directorio si no existe (ya existe utils)
// fs.mkdirSync(path.dirname(certPath), { recursive: true });

if (process.env.ARCA_CERT) {
  // Asegurar que los saltos de línea literales \n se conviertan a saltos reales si vienen como string plano
  const certContent = process.env.ARCA_CERT.replace(/\\n/g, '\n');
  fs.writeFileSync(certPath, certContent, 'utf8');
  console.log("cert.pem generado ✅");
} else {
  console.warn("⚠️ ARCA_CERT no definido en el entorno de build.");
}

if (process.env.ARCA_KEY) {
  const keyContent = process.env.ARCA_KEY.replace(/\\n/g, '\n');
  fs.writeFileSync(keyPath, keyContent, 'utf8');
  console.log("key.pem generado ✅");
} else {
  console.warn("⚠️ ARCA_KEY no definido en el entorno de build.");
}
