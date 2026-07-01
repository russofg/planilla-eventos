import admin from 'firebase-admin';
import { getDb } from './utils/firebaseAdmin.js';
import { sendMessage } from './utils/telegram.js';

/**
 * Netlify Function: telegram-webhook
 *
 * Receives updates from the Telegram Bot API. Phase 0 handles account linking:
 * a user runs `/start <code>` (code generated in the app) and we map their
 * Telegram chat to their Firebase user in the `telegramLinks` collection.
 *
 * Security: Telegram is configured (via setWebhook) to send a secret token in
 * the X-Telegram-Bot-Api-Secret-Token header; we reject anything that doesn't
 * match TELEGRAM_WEBHOOK_SECRET, so the endpoint can't be driven by outsiders.
 */
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = event.headers['x-telegram-bot-api-secret-token'];
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let update;
  try {
    update = JSON.parse(event.body);
  } catch {
    // Acknowledge malformed payloads so Telegram doesn't keep retrying.
    return { statusCode: 200, body: 'ok' };
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = (message?.text || '').trim();

  // Always ack with 200 so Telegram doesn't retry; do the work guarded.
  try {
    if (!chatId) return { statusCode: 200, body: 'ok' };

    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1];
      if (!code) {
        await sendMessage(
          chatId,
          'Para vincular tu cuenta, abrí <b>Ajustes → Vincular Telegram</b> en la app y enviame el código con <code>/start CODIGO</code>.'
        );
        return { statusCode: 200, body: 'ok' };
      }
      await handleLink(chatId, code, message.from);
      return { statusCode: 200, body: 'ok' };
    }

    // Any other message in Phase 0.
    const db = getDb();
    const linkSnap = await db.collection('telegramLinks').doc(String(chatId)).get();
    if (!linkSnap.exists) {
      await sendMessage(
        chatId,
        'Tu cuenta todavía no está vinculada. Abrí <b>Ajustes → Vincular Telegram</b> en la app para conectarla.'
      );
    } else {
      await sendMessage(chatId, '✅ Tu cuenta está vinculada. Muy pronto vas a poder cargar eventos por acá.');
    }
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('telegram-webhook error:', err);
    if (chatId) {
      try {
        await sendMessage(chatId, 'Ocurrió un error procesando tu mensaje. Probá de nuevo en un momento.');
      } catch { /* ignore */ }
    }
    // Ack anyway to avoid Telegram retry storms.
    return { statusCode: 200, body: 'ok' };
  }
}

async function handleLink(chatId, code, from) {
  const db = getDb();
  const tokenRef = db.collection('telegramLinkTokens').doc(code.toUpperCase());
  const tokenSnap = await tokenRef.get();

  if (!tokenSnap.exists) {
    await sendMessage(chatId, '❌ Código inválido. Generá uno nuevo en <b>Ajustes → Vincular Telegram</b>.');
    return;
  }

  const data = tokenSnap.data();
  if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
    await tokenRef.delete();
    await sendMessage(chatId, '❌ El código venció. Generá uno nuevo en la app.');
    return;
  }

  // Bind this Telegram chat to the Firebase user. The chatId is the doc id so a
  // chat can only ever be linked to one account, and re-linking overwrites it.
  await db.collection('telegramLinks').doc(String(chatId)).set({
    userId: data.userId,
    telegramUsername: from?.username || null,
    telegramFirstName: from?.first_name || null,
    linkedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await tokenRef.delete();

  await sendMessage(chatId, '✅ ¡Listo! Tu cuenta quedó vinculada. Pronto vas a poder cargar eventos por acá.');
}
