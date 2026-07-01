import admin from 'firebase-admin';

/**
 * Initializes the Firebase Admin SDK with a real service account so the
 * serverless functions can READ and WRITE Firestore on behalf of the backend
 * (the existing functions only verify tokens, which does not need credentials).
 *
 * The service account JSON must be stored as the FIREBASE_SERVICE_ACCOUNT
 * environment variable in Netlify (never committed to the repo).
 */
export function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin;
}

export function getDb() {
  return getAdmin().firestore();
}
