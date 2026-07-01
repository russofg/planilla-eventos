import admin from 'firebase-admin';
import { getAdmin, getDb } from './utils/firebaseAdmin.js';

const CODE_TTL_MINUTES = 10;

// Unambiguous alphabet (no 0/O/1/I) so the code is easy to read and type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Netlify Function: telegram-link-code
 *
 * Called by the web app (authenticated with a Firebase ID token) to mint a
 * short-lived, single-use code the user then sends to the bot as `/start CODE`.
 * The code maps back to their uid so the webhook can bind the Telegram chat to
 * the right account. Stored server-side (admin only) — no client rules needed.
 */
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let decoded;
  try {
    const idToken = authHeader.split('Bearer ')[1];
    decoded = await getAdmin().auth().verifyIdToken(idToken);
  } catch {
    return { statusCode: 403, body: JSON.stringify({ error: 'Invalid Firebase token' }) };
  }

  try {
    const db = getDb();
    const code = generateCode();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + CODE_TTL_MINUTES * 60 * 1000
    );

    await db.collection('telegramLinkTokens').doc(code).set({
      userId: decoded.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
        expiresInMinutes: CODE_TTL_MINUTES,
      }),
    };
  } catch (err) {
    console.error('telegram-link-code error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Error generando el código' }),
    };
  }
}
