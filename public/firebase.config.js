// Configuración de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
// Importar getFirestore y otras funciones necesarias
import {
  getFirestore,
  enableIndexedDbPersistence,
  initializeFirestore,
  CACHE_SIZE_UNLIMITED,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  getDocs,
  limit,
  setDoc,
  serverTimestamp,
  updateDoc,
  deleteField,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { showSuccessToast, showErrorToast } from "./notifications.js";
import {
  getDatabase,
  ref,
  onValue,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

// Tu configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBm6uAnlw2kN5A2IdXyBKTHATVTnSJ3JAk",
  authDomain: "planilla-evento.firebaseapp.com",
  databaseURL: "https://planilla-evento-default-rtdb.firebaseio.com",
  projectId: "planilla-evento",
  storageBucket: "planilla-evento.firebasestorage.app",
  messagingSenderId: "258257856798",
  appId: "1:258257856798:web:be517c3735756f8c2c410f",
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Inicializar Firestore con caché optimizada para offline (nueva forma recomendada)
const db = initializeFirestore(app, {
  cache: {
    sizeBytes: CACHE_SIZE_UNLIMITED,
  },
});

const auth = getAuth(app);
// Habilitar persistencia de Auth en localStorage para uso offline
setPersistence(auth, browserLocalPersistence)
  .then(() => {
    // Solo mostrar la notificación si no se ha mostrado antes
    if (!localStorage.getItem("sessionOfflineNotified")) {
      showSuccessToast("Sesión mantenida offline.");
      localStorage.setItem("sessionOfflineNotified", "true");
    }
  })
  .catch((err) => {
    showErrorToast("No se pudo mantener sesión offline.");
  });
const realdb = getDatabase(app); // Inicialización de Realtime Database

// Manejar la persistencia offline de manera robusta
let persistenceEnabled = false;

// Función para inicializar la persistencia offline
async function initPersistence() {
  try {
    // La persistencia ya está habilitada mediante la configuración de caché al inicializar Firestore
    persistenceEnabled = true;

    // Avisar al usuario que la persistencia está habilitada solo si no está guardado en localStorage
    if (
      typeof showSuccessToast === "function" &&
      !localStorage.getItem("offlineModeNotified")
    ) {
      showSuccessToast(
        "Modo offline habilitado - podrás usar la app sin conexión"
      );
      // Guardar en localStorage que ya se mostró la notificación
      localStorage.setItem("offlineModeNotified", "true");
    }

    // Crear un documento en _connectionTest para que las verificaciones de conectividad funcionen
    initConnectionTestDocument();
  } catch (err) {
    // Manejar errores de persistencia
    if (err.code === "failed-precondition") {
      // Múltiples pestañas abiertas, pero la persistencia ya está configurada
      persistenceEnabled = true;
      initConnectionTestDocument();
    } else if (err.code === "unimplemented") {
      // El navegador actual no soporta persistencia
    } else {
      // Otros errores
    }
  }
}

// Función para inicializar el documento de prueba de conexión
async function initConnectionTestDocument() {
  try {
    const auth = getAuth();
    // Solo proceder si el usuario está autenticado
    if (auth.currentUser) {
      const userId = auth.currentUser.uid;
      const testDocRef = doc(db, "_connectionTest", userId);

      // Crear o actualizar documento de prueba
      await setDoc(testDocRef, {
        lastUpdated: serverTimestamp(),
        userId: userId,
        device: navigator.userAgent || "Unknown device",
        persistenceEnabled: persistenceEnabled,
      });
    } else {
      // Configurar listener para cuando el usuario se autentique
      auth.onAuthStateChanged((user) => {
        if (user) {
          // Usuario autenticado, crear documento de prueba
          const testDocRef = doc(db, "_connectionTest", user.uid);
          setDoc(testDocRef, {
            lastUpdated: serverTimestamp(),
            userId: user.uid,
            device: navigator.userAgent || "Unknown device",
            persistenceEnabled: persistenceEnabled,
          })
            .then(() => {})
            .catch(() => {});
        }
      });
    }
  } catch (error) {
    // Error al crear documento
  }
}

// Iniciar proceso de habilitación de persistencia
initPersistence();

// No usaremos Firebase Messaging, reemplazamos por un valor null
const messaging = null;

// Exportar un método para verificar si hay problemas de conexión
export function checkFirestoreConnection() {
  return new Promise((resolve) => {
    try {
      // Timeout global para toda la operación
      const globalTimeoutId = setTimeout(() => {
        resolve(false);
      }, 10000); // 10 segundos como máximo

      // Contador de verificaciones exitosas
      let successCount = 0;
      const requiredSuccesses = 1; // Solo necesitamos 1 éxito para considerar que hay conexión

      // 1. Verificar conectividad básica a internet
      const checkInternet = () => {
        return fetch("https://www.gstatic.com/generate_204", {
          mode: "no-cors",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        })
          .then(() => {
            successCount++;
            return true;
          })
          .catch(() => {
            return false;
          });
      };

      // 2. Verificar conectividad a Realtime Database a través de .info/connected
      const checkRealDb = () => {
        return new Promise((resolveDb) => {
          const timeoutDb = setTimeout(() => {
            resolveDb(false);
          }, 5000);

          try {
            const connectedRef = ref(realdb, ".info/connected");
            onValue(
              connectedRef,
              (snapshot) => {
                clearTimeout(timeoutDb);
                const connected = snapshot.val();

                if (connected) {
                  successCount++;
                  resolveDb(true);
                } else {
                  resolveDb(false);
                }
              },
              {
                onlyOnce: true,
              }
            );
          } catch (error) {
            clearTimeout(timeoutDb);
            resolveDb(false);
          }
        });
      };

      // 3. Verificar conectividad a Firestore directamente
      const checkFirestore = () => {
        return new Promise((resolveFs) => {
          const timeoutFs = setTimeout(() => {
            resolveFs(false);
          }, 5000);

          try {
            // Usar _connectionTest en lugar de _connectivity_check para que coincida con las reglas de seguridad
            const connectivityRef = collection(db, "_connectionTest");
            const q = query(connectivityRef, limit(1));

            getDocs(q)
              .then(() => {
                clearTimeout(timeoutFs);
                successCount++;
                resolveFs(true);
              })
              .catch(() => {
                clearTimeout(timeoutFs);
                resolveFs(false);
              });
          } catch (error) {
            clearTimeout(timeoutFs);
            resolveFs(false);
          }
        });
      };

      // Ejecutar las verificaciones en paralelo
      Promise.all([checkInternet(), checkRealDb(), checkFirestore()])
        .then(() => {
          clearTimeout(globalTimeoutId);

          // Si al menos una verificación tuvo éxito, consideramos que hay conexión
          if (successCount >= requiredSuccesses) {
            resolve(true);
          } else {
            resolve(false);
          }
        })
        .catch(() => {
          clearTimeout(globalTimeoutId);
          resolve(false);
        });
    } catch (error) {
      resolve(false);
    }
  });
}

// Función para verificar si la persistencia está habilitada
export function isPersistenceEnabled() {
  return persistenceEnabled;
}

// Función para verificar si un usuario es administrador
export async function isUserAdmin(uid) {
  try {
    if (!uid) {
      const currentUser = auth.currentUser;
      if (!currentUser) return false;
      uid = currentUser.uid;
    }

    const userDocRef = doc(db, "users", uid);
    const userDoc = await getDoc(userDocRef);

    return userDoc.exists() && userDoc.data().role === "admin";
  } catch (error) {
    return false;
  }
}

// Función para agregar UID de usuario al array exportedByUsers de manera segura
export async function addUserToExportedByUsers(collectionName, docId, uid) {
  try {
    if (!uid) {
      const currentUser = auth.currentUser;
      if (!currentUser) return false;
      uid = currentUser.uid;
    }

    const docRef = doc(db, collectionName, docId);

    // Intentar actualizar directamente el array 'exportedByUsers'
    // Las reglas de Firestore deben permitir esta operación específica para usuarios autenticados
    // tanto en 'eventos' (si es propietario) como en 'proximosEventos'.
    await updateDoc(docRef, {
      exportedByUsers: arrayUnion(uid),
    });
    return true;
  } catch (error) {
    // Si la actualización falla (p.ej., por reglas de seguridad), registrar el error.
    // No intentar un fallback a 'userExports' ya que las reglas actuales
    // están diseñadas para permitir la actualización directa del array.
    console.error(
      `Error al agregar usuario ${uid} a exportedByUsers en ${collectionName}/${docId}:`,
      error
    );
    // Mostrar un error al usuario podría ser útil aquí también
    // import { showErrorToast } from './notifications.js';
    // showErrorToast(`No se pudo marcar el evento ${docId} como exportado.`);
    return false;
  }
}

// Export the Firebase services
export { app, db, auth, messaging, realdb };
