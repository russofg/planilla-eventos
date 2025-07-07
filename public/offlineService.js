// Servicio para manejar operaciones offline
import {
  showInfoToast,
  showSuccessToast,
  showErrorToast,
} from "./notifications.js";
import { getCurrentUser } from "./config.js";

// Nombres de los almacenes en IndexedDB
const DB_NAME = "offlineAppDB";
const DB_VERSION = 3; // Incrementamos la versión para forzar una actualización
const STORES = {
  PENDING_EVENTS: "pendingEvents",
  PENDING_EXPENSES: "pendingExpenses",
  EVENTS_CACHE: "eventsCache",
  EXPENSES_CACHE: "expensesCache",
  USER_DATA_CACHE: "userDataCache",
  CONNECTION_STATUS: "connectionStatus",
  SESSION_INFO: "sessionInfo",
};

// Estado global
let offlineMode = !navigator.onLine;
let dbInstance = null;
let dbInitInProgress = false;
let dbInitPromise = null;

// Inicializar la base de datos indexedDB
export function initOfflineDB() {
  // Si ya estamos inicializando, retorna la promesa existente
  if (dbInitInProgress && dbInitPromise) {
    return dbInitPromise;
  }

  // Si la base de datos ya está inicializada, la retornamos
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  dbInitInProgress = true;

  dbInitPromise = new Promise((resolve, reject) => {
    try {
      // Primer intento: abrir la base de datos
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error(
          "Error abriendo la base de datos offline:",
          event.target.error
        );

        // Si hay un error, intentamos borrar la base de datos y recrearla
        deleteAndRecreateDatabase()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            dbInitInProgress = false;
          });
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;

        // Guardar estado de conexión inicial
        updateConnectionStatus(navigator.onLine).catch((err) =>
          console.error("Error al actualizar estado inicial:", err)
        );

        // Configurar listeners para estado de conexión
        setupConnectionListeners();

        dbInitInProgress = false;
        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        console.log(
          `Actualizando base de datos de la versión ${event.oldVersion} a ${event.newVersion}`
        );
        const db = event.target.result;

        // Crear todos los almacenes necesarios si no existen
        createStoresIfNeeded(db);
      };
    } catch (err) {
      dbInitInProgress = false;
      reject(err);
    }
  });

  return dbInitPromise;
}

// Función para crear todos los almacenes necesarios
function createStoresIfNeeded(db) {
  // Función auxiliar para crear un almacén si no existe
  const createStore = (storeName, keyPath = "id", autoIncrement = false) => {
    if (!db.objectStoreNames.contains(storeName)) {
      db.createObjectStore(storeName, {
        keyPath: keyPath,
        autoIncrement: autoIncrement,
      });
    }
  };

  // Crear los almacenes con sus configuraciones específicas
  createStore(STORES.PENDING_EVENTS, "offlineId", true);
  createStore(STORES.PENDING_EXPENSES, "offlineId", true);
  createStore(STORES.EVENTS_CACHE, "id", false);
  createStore(STORES.EXPENSES_CACHE, "id", false);
  createStore(STORES.USER_DATA_CACHE, "key", false);
  createStore(STORES.CONNECTION_STATUS, "id", false);
  createStore(STORES.SESSION_INFO, "id", false);
}

// Función para eliminar y recrear la base de datos en caso de error
function deleteAndRecreateDatabase() {
  console.log("Eliminando y recreando base de datos debido a error");

  return new Promise((resolve, reject) => {
    // Intentar eliminar la base de datos
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

    deleteRequest.onsuccess = () => {
      console.log("Base de datos eliminada exitosamente, recreando...");

      // Recrear la base de datos
      const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

      openRequest.onerror = (event) => {
        console.error("Error recreando base de datos:", event.target.error);
        reject(event.target.error);
      };

      openRequest.onsuccess = (event) => {
        dbInstance = event.target.result;

        // Guardar estado de conexión inicial
        updateConnectionStatus(navigator.onLine).catch((err) =>
          console.error(
            "Error al actualizar estado de conexión inicial después de recrear:",
            err
          )
        );

        // Configurar listeners para estado de conexión
        setupConnectionListeners();

        resolve(dbInstance);
      };

      openRequest.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Crear todos los almacenes necesarios
        createStoresIfNeeded(db);
      };
    };

    deleteRequest.onerror = (event) => {
      console.error("Error eliminando base de datos:", event.target.error);
      reject(event.target.error);
    };
  });
}

// Configurar listeners para detectar cambios en la conexión
function setupConnectionListeners() {
  window.addEventListener("online", () => {
    offlineMode = false;
    updateConnectionStatus(true).catch((err) =>
      console.error("Error actualizando estado online:", err)
    );

    // Avisar a la aplicación que estamos online de nuevo
    document.dispatchEvent(new CustomEvent("app:online"));
  });

  window.addEventListener("offline", () => {
    offlineMode = true;
    updateConnectionStatus(false).catch((err) =>
      console.error("Error actualizando estado offline:", err)
    );

    // Avisar a la aplicación que estamos offline
    document.dispatchEvent(new CustomEvent("app:offline"));
  });
}

// Actualizar y guardar el estado de conexión
function updateConnectionStatus(isOnline) {
  return new Promise((resolve, reject) => {
    try {
      if (!dbInstance) {
        console.warn(
          "Base de datos no inicializada al actualizar estado de conexión"
        );
        return resolve(false);
      }

      // Verificar si el almacén existe antes de intentar usarlo
      if (!dbInstance.objectStoreNames.contains(STORES.CONNECTION_STATUS)) {
        console.warn(
          "Almacén CONNECTION_STATUS no encontrado, intentando reinicializar la base de datos"
        );

        // Intentar reinicializar la base de datos
        deleteAndRecreateDatabase()
          .then(() => {
            console.log(
              "Base de datos reinicializada, reintentando updateConnectionStatus"
            );
            return updateConnectionStatus(isOnline);
          })
          .then(resolve)
          .catch(reject);

        return;
      }

      const transaction = dbInstance.transaction(
        [STORES.CONNECTION_STATUS],
        "readwrite"
      );

      transaction.onabort = (error) => {
        reject(error);
      };

      const store = transaction.objectStore(STORES.CONNECTION_STATUS);

      const status = {
        id: "connectionStatus",
        isOnline: isOnline,
        lastUpdated: Date.now(),
        userAgent: navigator.userAgent,
      };

      const request = store.put(status);

      request.onerror = (error) => {
        reject(error);
      };

      transaction.oncomplete = () => {
        console.log(
          `Estado de conexión actualizado: ${isOnline ? "online" : "offline"}`
        );
        resolve(true);
      };
    } catch (err) {
      reject(err);
    }
  });
}

// Obtener el último estado de conexión guardado
export function getLastConnectionStatus() {
  return new Promise((resolve, reject) => {
    try {
      initOfflineDB()
        .then((db) => {
          // Verificar si el almacén existe antes de intentar usarlo
          if (!db.objectStoreNames.contains(STORES.CONNECTION_STATUS)) {
            console.warn(
              "Almacén CONNECTION_STATUS no encontrado al obtener estado"
            );
            // Devolver el estado actual como fallback
            resolve({
              isOnline: navigator.onLine,
              lastUpdated: Date.now(),
            });
            return;
          }

          getConnectionStatusFromDB()
            .then(resolve)
            .catch((error) => {
              // Fallback si hay error
              resolve({
                isOnline: navigator.onLine,
                lastUpdated: Date.now(),
              });
            });
        })
        .catch((error) => {
          console.error(
            "Error al inicializar DB en getLastConnectionStatus:",
            error
          );
          // Fallback si hay error
          resolve({
            isOnline: navigator.onLine,
            lastUpdated: Date.now(),
          });
        });
    } catch (err) {
      // Devolver el estado actual como fallback
      resolve({
        isOnline: navigator.onLine,
        lastUpdated: Date.now(),
      });
    }
  });
}

// Función auxiliar para obtener el estado de conexión desde IndexedDB
function getConnectionStatusFromDB() {
  return new Promise((resolve, reject) => {
    try {
      if (!dbInstance) {
        return reject(
          new Error(
            "Base de datos no inicializada en getConnectionStatusFromDB"
          )
        );
      }

      // Verificar si el almacén existe
      if (!dbInstance.objectStoreNames.contains(STORES.CONNECTION_STATUS)) {
        return reject(new Error("Almacén CONNECTION_STATUS no encontrado"));
      }

      const transaction = dbInstance.transaction(
        [STORES.CONNECTION_STATUS],
        "readonly"
      );

      transaction.onabort = (error) => {
        reject(new Error("Transacción abortada: " + error));
      };

      const store = transaction.objectStore(STORES.CONNECTION_STATUS);
      const request = store.get("connectionStatus");

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result);
        } else {
          // Si no hay registro, crear uno con el estado actual
          resolve({
            isOnline: navigator.onLine,
            lastUpdated: Date.now(),
          });
        }
      };

      request.onerror = (error) => {
        reject(error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

// Guardar información de sesión actual para uso offline
export function saveSessionInfo(userData) {
  return new Promise((resolve, reject) => {
    try {
      if (!dbInstance) {
        return resolve(false);
      }

      const transaction = dbInstance.transaction(
        [STORES.SESSION_INFO],
        "readwrite"
      );
      const store = transaction.objectStore(STORES.SESSION_INFO);

      // Filtrar información sensible y guardar solo lo necesario para modo offline
      const sessionData = {
        id: "currentSession",
        userId: userData.uid,
        email: userData.email,
        displayName: userData.displayName || userData.email.split("@")[0],
        role: userData.role || "user",
        lastLogin: Date.now(),
      };

      store.put(sessionData);

      transaction.oncomplete = () => {
        resolve(true);
      };

      transaction.onerror = (error) => {
        reject(error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

// Obtener información de sesión guardada
export function getSessionInfo() {
  return new Promise((resolve, reject) => {
    try {
      if (!dbInstance) {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onsuccess = (event) => {
          dbInstance = event.target.result;
          getSessionFromDB().then(resolve).catch(reject);
        };

        request.onerror = (error) => {
          resolve(null);
        };
      } else {
        getSessionFromDB().then(resolve).catch(reject);
      }
    } catch (err) {
      resolve(null);
    }
  });
}

// Función auxiliar para obtener la sesión desde IndexedDB
function getSessionFromDB() {
  return new Promise((resolve, reject) => {
    try {
      const transaction = dbInstance.transaction(
        [STORES.SESSION_INFO],
        "readonly"
      );
      const store = transaction.objectStore(STORES.SESSION_INFO);
      const request = store.get("currentSession");

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = (error) => {
        reject(error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

// Verificar si estamos en modo offline
export function isOfflineMode() {
  return offlineMode;
}

// Función para actualizar el estado del modo offline
export function setOfflineMode(status) {
  offlineMode = status;
  return updateConnectionStatus(!status);
}

// Función para guardar un evento pendiente mientras no hay conexión
export function saveEventOffline(eventData) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.PENDING_EVENTS], "readwrite");
      const store = transaction.objectStore(STORES.PENDING_EVENTS);

      // Asegurarnos de que tenemos un usuario actual
      const currentUser = getCurrentUser();
      if (!currentUser) {
        reject(new Error("No hay usuario autenticado"));
        return;
      }

      // Añadir marca de tiempo y datos de usuario
      const enhancedData = {
        ...eventData,
        userId: currentUser.uid, // Asegurar que se incluye el userId
        timestamp: Date.now(),
        synced: false,
      };

      const addRequest = store.add(enhancedData);

      addRequest.onsuccess = () => {
        showInfoToast(
          "Evento guardado localmente. Se sincronizará cuando vuelva la conexión."
        );
        resolve(true);
      };

      addRequest.onerror = (event) => {
        console.error(
          "Error al añadir evento a IndexedDB:",
          event.target.error
        );
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Función para guardar un gasto pendiente mientras no hay conexión
export function saveExpenseOffline(expenseData) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(
        [STORES.PENDING_EXPENSES],
        "readwrite"
      );
      const store = transaction.objectStore(STORES.PENDING_EXPENSES);

      // Asegurarnos de que tenemos un usuario actual
      const currentUser = getCurrentUser();
      if (!currentUser) {
        reject(new Error("No hay usuario autenticado"));
        return;
      }

      // Añadir marca de tiempo y datos de usuario
      const enhancedData = {
        ...expenseData,
        userId: currentUser.uid, // Asegurar que se incluye el userId
        timestamp: Date.now(),
        synced: false,
      };

      const addRequest = store.add(enhancedData);

      addRequest.onsuccess = () => {
        showInfoToast(
          "Gasto guardado localmente. Se sincronizará cuando vuelva la conexión."
        );
        resolve(true);
      };

      addRequest.onerror = (event) => {
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Función para almacenar eventos en caché local
export function cacheEvents(events) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error(
        "Error al abrir la base de datos para caché:",
        event.target.error
      );
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.EVENTS_CACHE], "readwrite");
      const store = transaction.objectStore(STORES.EVENTS_CACHE);

      // Limpiar caché anterior
      store.clear().onsuccess = () => {
        // Añadir cada evento al caché
        let count = 0;
        events.forEach((event) => {
          store.add(event).onsuccess = () => {
            count++;
            if (count === events.length) {
              resolve(true);
            }
          };
        });

        if (events.length === 0) {
          resolve(true);
        }
      };

      transaction.onerror = (event) => {
        console.error(
          "Error en transacción de caché de eventos:",
          event.target.error
        );
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Función para almacenar gastos en caché local
export function cacheExpenses(expenses) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error(
        "Error al abrir la base de datos para caché:",
        event.target.error
      );
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.EXPENSES_CACHE], "readwrite");
      const store = transaction.objectStore(STORES.EXPENSES_CACHE);

      // Limpiar caché anterior
      store.clear().onsuccess = () => {
        // Añadir cada gasto al caché
        let count = 0;
        expenses.forEach((expense) => {
          store.add(expense).onsuccess = () => {
            count++;
            if (count === expenses.length) {
              resolve(true);
            }
          };
        });

        if (expenses.length === 0) {
          resolve(true);
        }
      };

      transaction.onerror = (event) => {
        console.error(
          "Error en transacción de caché de gastos:",
          event.target.error
        );
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Función para guardar datos del usuario (preferencias, saldo, etc.)
export function cacheUserData(key, data) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.USER_DATA_CACHE], "readwrite");
      const store = transaction.objectStore(STORES.USER_DATA_CACHE);

      // Guardar datos con timestamp para saber cuándo se guardaron
      const dataWithTimestamp = {
        key,
        data,
        timestamp: Date.now(),
      };

      const putRequest = store.put(dataWithTimestamp);

      putRequest.onsuccess = () => {
        resolve(true);
      };

      putRequest.onerror = (event) => {
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Función para obtener datos del usuario
export function getUserData(key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.USER_DATA_CACHE], "readonly");
      const store = transaction.objectStore(STORES.USER_DATA_CACHE);

      const getRequest = store.get(key);

      getRequest.onsuccess = () => {
        resolve(getRequest.result ? getRequest.result.data : null);
      };

      getRequest.onerror = (event) => {
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Función para comprobar periódicamente la conexión
export function startConnectionMonitoring(interval = 30000) {
  // Comprobación inicial
  checkServerReachability();

  // Configurar comprobación periódica
  const monitorId = setInterval(() => {
    checkServerReachability();
  }, interval);

  // Guardar ID del intervalo para poder detenerlo más tarde
  window.connectionMonitorId = monitorId;

  return monitorId;
}

// Detener la supervisión de conexión
export function stopConnectionMonitoring() {
  if (window.connectionMonitorId) {
    clearInterval(window.connectionMonitorId);
    window.connectionMonitorId = null;
    return true;
  }
  return false;
}

// Comprobar si realmente podemos alcanzar el servidor
export function checkServerReachability() {
  return fetch("manifest.json", {
    // HEAD a recurso estático existente para evitar 404
    method: "HEAD",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  })
    .then((response) => {
      const online = response.ok;
      if (online !== !offlineMode) {
        // El estado real de la conexión es diferente del que teníamos registrado
        setOfflineMode(!online);

        // Notificar a la aplicación del cambio de estado real
        const eventName = online ? "app:online" : "app:offline";
        document.dispatchEvent(new CustomEvent(eventName));
      }
      return online;
    })
    .catch((error) => {
      // Si hay un error de conexión, estamos offline
      if (!offlineMode) {
        setOfflineMode(true);
        document.dispatchEvent(new CustomEvent("app:offline"));
      }
      return false;
    });
}

// Obtener todos los eventos en caché
export function getCachedEvents() {
  return new Promise((resolve, reject) => {
    try {
      if (!dbInstance) {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onsuccess = (event) => {
          dbInstance = event.target.result;
          getEventsFromCache().then(resolve).catch(reject);
        };

        request.onerror = (error) => {
          resolve([]);
        };
      } else {
        getEventsFromCache().then(resolve).catch(reject);
      }
    } catch (err) {
      resolve([]);
    }
  });
}

// Función auxiliar para obtener eventos desde el caché
export function getEventsFromCache() {
  return new Promise((resolve, reject) => {
    try {
      const transaction = dbInstance.transaction(
        [STORES.EVENTS_CACHE],
        "readonly"
      );
      const store = transaction.objectStore(STORES.EVENTS_CACHE);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = (error) => {
        reject(error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

// Obtener todos los gastos en caché
export function getCachedExpenses() {
  return new Promise((resolve, reject) => {
    try {
      if (!dbInstance) {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onsuccess = (event) => {
          dbInstance = event.target.result;
          getExpensesFromCache().then(resolve).catch(reject);
        };

        request.onerror = (error) => {
          resolve([]);
        };
      } else {
        getExpensesFromCache().then(resolve).catch(reject);
      }
    } catch (err) {
      resolve([]);
    }
  });
}

// Función auxiliar para obtener gastos desde el caché
export function getExpensesFromCache() {
  return new Promise((resolve, reject) => {
    try {
      const transaction = dbInstance.transaction(
        [STORES.EXPENSES_CACHE],
        "readonly"
      );
      const store = transaction.objectStore(STORES.EXPENSES_CACHE);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = (error) => {
        reject(error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

// Obtener eventos pendientes de sincronización
export function getPendingEvents() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.PENDING_EVENTS], "readonly");
      const store = transaction.objectStore(STORES.PENDING_EVENTS);

      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        resolve(getRequest.result || []);
      };

      getRequest.onerror = (event) => {
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Obtener gastos pendientes de sincronización
export function getPendingExpenses() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.PENDING_EXPENSES], "readonly");
      const store = transaction.objectStore(STORES.PENDING_EXPENSES);

      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        resolve(getRequest.result || []);
      };

      getRequest.onerror = (event) => {
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Limpiar evento pendiente después de sincronizarlo
export function clearPendingEvent(offlineId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error(
        "Error al limpiar evento sincronizado:",
        event.target.error
      );
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction([STORES.PENDING_EVENTS], "readwrite");
      const store = transaction.objectStore(STORES.PENDING_EVENTS);

      const deleteRequest = store.delete(offlineId);

      deleteRequest.onsuccess = () => {
        resolve(true);
      };

      deleteRequest.onerror = (event) => {
        console.error(
          "Error al eliminar evento pendiente:",
          event.target.error
        );
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Limpiar gasto pendiente después de sincronizarlo
export function clearPendingExpense(offlineId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(
        [STORES.PENDING_EXPENSES],
        "readwrite"
      );
      const store = transaction.objectStore(STORES.PENDING_EXPENSES);

      const deleteRequest = store.delete(offlineId);

      deleteRequest.onsuccess = () => {
        resolve(true);
      };

      deleteRequest.onerror = (event) => {
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };
  });
}

// Limpiar todos los datos en caché (útil al cerrar sesión)
export function clearAllCacheData() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error(
        "Error al abrir DB para limpiar caché:",
        event.target.error
      );
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const stores = [
        STORES.EVENTS_CACHE,
        STORES.EXPENSES_CACHE,
        STORES.USER_DATA_CACHE,
        STORES.SESSION_INFO,
      ];

      let completedStores = 0;

      stores.forEach((storeName) => {
        try {
          const transaction = db.transaction([storeName], "readwrite");
          const store = transaction.objectStore(storeName);

          store.clear().onsuccess = () => {
            completedStores++;

            if (completedStores === stores.length) {
              resolve(true);
            }
          };

          transaction.onerror = (error) => {
            reject(error);
          };
        } catch (err) {
          reject(err);
        }
      });
    };
  });
}

// Nueva función para verificar la calidad de la conexión
export function checkConnectionQuality() {
  return new Promise((resolve) => {
    // Verificar si el navegador está online
    if (!navigator.onLine) {
      resolve({ online: false, quality: "offline", latency: Infinity });
      return;
    }

    // Verificar latencia para determinar calidad
    const start = Date.now();

    // Usar un ping pequeño para probar la conexión
    fetch("manifest.json", {
      // HEAD a recurso estático existente para evitar 404
      method: "HEAD",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
      .then(() => {
        const latency = Date.now() - start;
        let quality;

        if (latency < 100) quality = "excellent";
        else if (latency < 300) quality = "good";
        else if (latency < 600) quality = "fair";
        else quality = "poor";

        resolve({ online: true, quality, latency });
      })
      .catch(() => {
        // Si hay error en el fetch, posiblemente hay conexión pero no al servidor
        resolve({
          online: navigator.onLine,
          quality: "limited",
          latency: Date.now() - start,
        });
      });
  });
}

// Función para precargar datos críticos en cache cuando hay buena conexión
export function precacheEssentialData() {
  return new Promise(async (resolve, reject) => {
    try {
      if (!navigator.onLine) {
        return resolve(false);
      }

      // Verificar calidad de conexión
      const connectionStatus = await checkConnectionQuality();
      if (
        connectionStatus.quality === "poor" ||
        connectionStatus.quality === "limited"
      ) {
        // Solo precargar datos esenciales
        // Implementar aquí la lógica para datos mínimos
        return resolve(false);
      }

      // Implementar lógica para precargar datos según la sesión actual
      const sessionInfo = await getSessionInfo();
      if (!sessionInfo) {
        return resolve(false);
      }

      // Aquí se implementaría la lógica para precargar datos específicos según el rol de usuario

      // Marcar timestamp de última precarga
      await cacheUserData("lastPrecacheTime", Date.now());

      resolve(true);
    } catch (error) {
      reject(error);
    }
  });
}

// Función para optimizar el uso de recursos en modo offline
export function optimizeOfflineResources() {
  if (!isOfflineMode()) return Promise.resolve(false);

  return new Promise(async (resolve) => {
    try {
      // Comprobar espacio disponible en dispositivo
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const percentUsed = (estimate.usage / estimate.quota) * 100;

        // Si el almacenamiento está por encima del 80%, limpiar caché menos esencial
        if (percentUsed > 80) {
          console.warn(
            "Almacenamiento crítico, limpiando recursos no esenciales"
          );
          // Implementar lógica para liberar espacio
        }
      }

      // Notificar al usuario que está en modo optimizado
      const offlineModeStart =
        (await getUserData("offlineModeStartTime")) || Date.now();
      if (Date.now() - offlineModeStart > 3600000) {
        // Más de 1 hora offline
        showInfoToast("Modo offline optimizado activado para ahorrar recursos");
      }

      resolve(true);
    } catch (error) {
      resolve(false);
    }
  });
}

// Función para detectar cambios rápidos de conexión (inestabilidad)
export function detectConnectionInstability() {
  return new Promise(async (resolve) => {
    try {
      // Obtener historial de cambios de conexión
      const db = await getOfflineDB();
      const history = (await getUserData("connectionSwitchHistory")) || [];

      // Añadir estado actual
      history.push({
        timestamp: Date.now(),
        online: navigator.onLine,
      });

      // Mantener solo últimos 10 estados
      if (history.length > 10) {
        history.shift();
      }

      // Guardar historial actualizado
      await cacheUserData("connectionSwitchHistory", history);

      // Calcular cambios en los últimos 5 minutos
      const fiveMinutesAgo = Date.now() - 300000;
      const recentChanges = history.filter(
        (entry) => entry.timestamp > fiveMinutesAgo
      ).length;

      const isUnstable = recentChanges >= 4; // 4 o más cambios en 5 minutos indica inestabilidad

      if (isUnstable) {
        showInfoToast(
          "Conexión inestable detectada. Se han activado optimizaciones."
        );

        // Activar modo conservador para evitar pérdida de datos
        await cacheUserData("conservativeMode", true);
      }

      resolve(isUnstable);
    } catch (error) {
      resolve(false);
    }
  });
}

// Función auxiliar para obtener instancia de DB
function getOfflineDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

// Inicializar la base de datos al cargar la página
window.addEventListener("load", () => {
  initOfflineDB();
});

// Función para determinar si hay elementos pendientes de sincronización
export async function hasPendingItems() {
  const pendingEvents = await getPendingEvents();
  const pendingExpenses = await getPendingExpenses();
  return pendingEvents.length > 0 || pendingExpenses.length > 0;
}
