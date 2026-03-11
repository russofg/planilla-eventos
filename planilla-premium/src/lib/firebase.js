import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore, initializeFirestore, CACHE_SIZE_UNLIMITED } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBm6uAnlw2kN5A2IdXyBKTHATVTnSJ3JAk",
  authDomain: "planilla-evento.firebaseapp.com",
  databaseURL: "https://planilla-evento-default-rtdb.firebaseio.com",
  projectId: "planilla-evento",
  storageBucket: "planilla-evento.firebasestorage.app",
  messagingSenderId: "258257856798",
  appId: "1:258257856798:web:be517c3735756f8c2c410f"
};

export const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  cache: {
    sizeBytes: CACHE_SIZE_UNLIMITED,
  },
});

export const auth = getAuth(app);

// Enable offline persistence
setPersistence(auth, browserLocalPersistence).catch(console.error);

export const realDb = getDatabase(app);

export default { app, db, auth, realDb };
