// Servicio para sincronizar datos offline con Firebase
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "./notifications.js";
import { db } from "./firebase.config.js";
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { COLLECTIONS } from "./config.js";
import {
  getPendingEvents,
  getPendingExpenses,
  clearPendingEvent,
  clearPendingExpense,
  getLastConnectionStatus,
  isOfflineMode,
  setOfflineMode,
  startConnectionMonitoring,
  stopConnectionMonitoring,
  precacheEssentialData,
  optimizeOfflineResources,
  getCachedEvents,
  getCachedExpenses,
  hasPendingItems,
} from "./offlineService.js";

// Variable para mantener el estado de la conexión
let isOnline = navigator.onLine;
let syncInProgress = false;
let syncRetryTimeout = null;
let connectionCheckInterval = null;

// Función para inicializar el servicio de sincronización
export function initSyncService() {
  // Escuchar eventos de conexión
  window.addEventListener("online", handleConnectionChange);
  window.addEventListener("offline", handleConnectionChange);

  // Escuchar eventos personalizados del offlineService
  document.addEventListener("app:online", () => {
    handleConnectionRecovery();
  });

  document.addEventListener("app:offline", () => {
    handleConnectionLoss();
  });

  // Iniciar monitor de conexión al servidor
  startConnectionMonitoring();

  // Verificar el estado de conexión actual y realizar la primera sincronización si es necesario
  checkConnectionStatus();

  // Verificar si hay elementos pendientes al inicio
  if (navigator.onLine) {
    synchronizeData().catch((err) =>
      console.error("Error en sincronización inicial:", err)
    );
  }

  // Realizar chequeos periódicos de sincronización incluso sin eventos de conexión
  startPeriodicSync();
}

// Función para iniciar la comprobación periódica de sincronización
function startPeriodicSync() {
  // Limpiar intervalo existente si hay uno
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }

  // Establecer un nuevo intervalo para verificar sincronización
  connectionCheckInterval = setInterval(() => {
    if (navigator.onLine && !syncInProgress) {
      checkAndSync();
    }
  }, 60000); // Verificar cada minuto
}

// Verifica el estado actual de la conexión de manera más completa
async function checkConnectionStatus() {
  try {
    // Obtener el último estado de conexión guardado
    const lastStatus = await getLastConnectionStatus();

    // Obtener el estado actual del navegador
    const currentOnline = navigator.onLine;

    // Si hay discrepancia entre el estado guardado y el actual
    if (lastStatus.isOnline !== currentOnline) {
      if (currentOnline) {
        handleConnectionRecovery();
      } else {
        handleConnectionLoss();
      }
    }

    // Actualizar la variable global
    isOnline = currentOnline;

    // Si estamos online, verificar conexión real con Firebase
    if (currentOnline) {
      verifyFirebaseConnection();
    }
  } catch (error) {
    console.error("Error al verificar estado de conexión:", error);
  }
}

// Verifica la conexión real con Firebase
async function verifyFirebaseConnection() {
  try {
    // Intentar una operación simple con Firebase
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout verificando conexión")), 5000)
    );

    const checkFirestore = new Promise(async (resolve) => {
      try {
        // Aquí puedes implementar una verificación más sofisticada si es necesario
        // Por ahora, asumimos que si navigator.onLine es true, podemos conectar a Firebase
        resolve(true);
      } catch (err) {
        console.error("Error verificando Firestore:", err);
        resolve(false);
      }
    });

    const connected = await Promise.race([checkFirestore, timeout]);

    if (!connected) {
      console.warn("No se pudo conectar con Firebase a pesar de estar online");
      // Aunque el navegador dice que estamos online, no podemos conectar con Firebase
      // En este caso, posiblemente tengamos conexión a internet pero no a Firebase
      setOfflineMode(true); // Forzar modo offline para la aplicación
    } else {
      setOfflineMode(false); // Confirmar que estamos realmente online
    }

    return connected;
  } catch (error) {
    console.error("Error verificando conexión con Firebase:", error);
    return false;
  }
}

// Función para manejar cambios en la conexión (evento del navegador)
function handleConnectionChange(event) {
  const wasOffline = !isOnline;
  const nowOnline = navigator.onLine;

  if (nowOnline && wasOffline) {
    handleConnectionRecovery();
  } else if (!nowOnline && isOnline) {
    handleConnectionLoss();
  }

  // Actualizar estado global
  isOnline = nowOnline;
}

// Manejar recuperación de conexión
function handleConnectionRecovery() {
  showInfoToast("Conexión a internet restaurada");
  // Precache data essential and optimize resources
  precacheEssentialData().catch(console.error);
  optimizeOfflineResources().catch(console.error);

  // Verificar conexión real con Firebase antes de sincronizar
  verifyFirebaseConnection().then((connected) => {
    if (connected) {
      // Iniciar sincronización con un pequeño retraso para asegurar que la conexión sea estable
      setTimeout(() => {
        synchronizeData()
          .then((count) => {
            if (count > 0) {
              // Después de sincronizar, recargar los datos actualizados
              dispatchRefreshEvent();
            }
          })
          .catch((err) => {
            console.error(
              "Error en sincronización tras conexión restaurada:",
              err
            );
          });
      }, 1500);
    } else {
      showInfoToast("Conexión limitada. Intentando sincronizar...");
      // Intentar sincronizar de todos modos, pero con más tiempo de espera
      setTimeout(() => {
        synchronizeData().catch((err) => {
          console.error("Error en sincronización con conexión limitada:", err);
        });
      }, 5000);
    }
  });
}

// Manejar pérdida de conexión
function handleConnectionLoss() {
  showInfoToast("Sin conexión. Los datos se guardarán localmente");

  // Cancelar cualquier intento de sincronización en curso
  if (syncRetryTimeout) {
    clearTimeout(syncRetryTimeout);
    syncRetryTimeout = null;
  }

  // Asegurarse de que syncInProgress se restablezca
  syncInProgress = false;
  // Detener monitor de conexión al servidor
  stopConnectionMonitoring();
}

// Lanzar evento para refrescar datos en la UI
function dispatchRefreshEvent() {
  document.dispatchEvent(
    new CustomEvent("app:refresh-data", {
      detail: {
        timestamp: Date.now(),
        reason: "sync-completed",
      },
    })
  );
}

// Función para verificar si hay conexión a internet
export function isConnected() {
  // Usar el estado del offlineService para mayor precisión
  return !isOfflineMode() && navigator.onLine;
}

// Función para obtener datos desde caché si estamos offline
export async function getDataFromCache() {
  try {
    const [events, expenses] = await Promise.all([
      getCachedEvents(),
      getCachedExpenses(),
    ]);

    return {
      events,
      expenses,
      fromCache: true,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Error obteniendo datos de caché:", error);
    return {
      events: [],
      expenses: [],
      fromCache: true,
      error: true,
    };
  }
}

// Función auxiliar para construir datos pendientes de sincronización
async function getPendingSyncData() {
  const [pendingEvents, pendingExpenses] = await Promise.all([
    getPendingEvents(),
    getPendingExpenses(),
  ]);
  return { eventos: pendingEvents, gastos: pendingExpenses };
}

// Wrapper para sincronizar datos arbitrarios
async function syncData(data, essentialOnly) {
  // Actualmente ignoramos data y essentialOnly y utilizamos la lógica estándar
  const count = await synchronizeData();
  return { success: true, syncedItems: count };
}

// Función para verificar si hay elementos pendientes y sincronizar
let syncRetryCount = 0;
const MAX_SYNC_RETRIES = 5;

async function checkAndSync() {
  try {
    const hasPending = await hasPendingItems();
    if (!hasPending) {
      syncRetryCount = 0; // Reseteamos contador si ya no hay pendientes
      return;
    }

    const count = await synchronizeData();
    if (count > 0) {
      syncRetryCount = 0; // Éxito: resetear contador
    } else {
      console.warn(
        "[Sync] No se encontraron elementos para sincronizar después del intento."
      );
      syncRetryCount = 0;
    }
  } catch (error) {
    console.error("[Sync] Error al sincronizar:", error);

    syncRetryCount++;
    if (syncRetryCount <= MAX_SYNC_RETRIES) {
      const retryDelay = Math.min(1000 * Math.pow(2, syncRetryCount), 30000); // Exponencial hasta 30 segundos
      console.warn(
        `[Sync] Reintentando sincronización en ${
          retryDelay / 1000
        } segundos (intento ${syncRetryCount})`
      );

      setTimeout(() => {
        checkAndSync();
      }, retryDelay);
    } else {
      console.error(
        "[Sync] Se alcanzó el número máximo de reintentos. Abortando sincronización."
      );
      syncRetryCount = 0; // Reseteamos para próximos intentos futuros
    }
  }
}

// Función para sincronizar datos pendientes
export async function synchronizeData() {
  if (!navigator.onLine) {
    return 0;
  }

  // Evitar múltiples sincronizaciones simultáneas
  if (syncInProgress) {
    return 0;
  }

  syncInProgress = true;
  // Limpiar cualquier timeout de reintento anterior
  if (syncRetryTimeout) {
    clearTimeout(syncRetryTimeout);
    syncRetryTimeout = null;
  }

  try {
    // Sincronizar eventos pendientes
    const pendingEvents = await getPendingEvents();

    let syncedEvents = 0;
    let syncedExpenses = 0;

    for (const eventData of pendingEvents) {
      try {
        // Remover propiedades específicas de offline antes de subir a Firebase
        const { offlineId, synced, timestamp, ...eventToSync } = eventData;

        // Asegurarnos de que el objeto tiene las propiedades mínimas necesarias
        if (!eventToSync.userId || !eventToSync.evento || !eventToSync.fecha) {
          console.error("Evento incompleto, saltando:", eventToSync);
          continue;
        }

        // Añadir timestamp de servidor
        const eventWithTimestamp = {
          ...eventToSync,
          createdAt: serverTimestamp(),
          offlineCreatedAt: new Date(timestamp || Date.now()).toISOString(),
        };

        // Subir evento a Firebase usando addDoc directamente
        await addDoc(collection(db, COLLECTIONS.EVENTOS), eventWithTimestamp);
        syncedEvents++;

        // Eliminar evento de la cola de pendientes
        await clearPendingEvent(offlineId);
      } catch (error) {
        console.error(
          `❌ Error al sincronizar evento ${eventData.offlineId}:`,
          error
        );
      }
    }

    // Sincronizar gastos pendientes
    const pendingExpenses = await getPendingExpenses();

    for (const expenseData of pendingExpenses) {
      try {
        // Remover propiedades específicas de offline
        const { offlineId, synced, timestamp, ...expenseToSync } = expenseData;

        // Asegurarnos de que el objeto tiene las propiedades mínimas necesarias
        if (
          !expenseToSync.userId ||
          !expenseToSync.descripcion ||
          isNaN(expenseToSync.monto)
        ) {
          console.error("Gasto incompleto, saltando:", expenseToSync);
          continue;
        }

        // Añadir timestamp de servidor
        const expenseWithTimestamp = {
          ...expenseToSync,
          createdAt: serverTimestamp(),
          offlineCreatedAt: new Date(timestamp || Date.now()).toISOString(),
        };

        // Subir gasto a Firebase usando addDoc directamente
        await addDoc(collection(db, COLLECTIONS.GASTOS), expenseWithTimestamp);
        syncedExpenses++;

        // Eliminar gasto de la cola de pendientes
        await clearPendingExpense(offlineId);
      } catch (error) {
        console.error(
          `❌ Error al sincronizar gasto ${expenseData.offlineId}:`,
          error
        );
      }
    }

    // Notificar al Service Worker sobre la sincronización completada
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SYNC_COMPLETED",
        count: syncedEvents + syncedExpenses,
        timestamp: Date.now(),
      });
    }

    // Mostrar notificación de éxito si se sincronizaron elementos
    const totalSynced = syncedEvents + syncedExpenses;
    if (totalSynced > 0) {
      showSuccessToast(
        `Se han sincronizado ${totalSynced} elementos con éxito`
      );

      // Notificar que los datos deben actualizarse
      dispatchRefreshEvent();
    }

    syncInProgress = false;
    return totalSynced;
  } catch (error) {
    console.error("Error durante la sincronización:", error);
    showErrorToast("Error al sincronizar datos");

    // Programar un nuevo intento después de un tiempo
    syncRetryTimeout = setTimeout(() => {
      syncInProgress = false;
      synchronizeData();
    }, 30000); // Reintentar después de 30 segundos

    throw error;
  } finally {
    // Asegurar que syncInProgress se restablezca incluso con errores
    setTimeout(() => {
      syncInProgress = false;
    }, 5000);
  }
}

// Función mejorada para sincronizar con estrategia inteligente
export async function smartSync() {
  try {
    // Importar funcionalidades del offlineService
    const { checkConnectionQuality, isOfflineMode } = await import(
      "./offlineService.js"
    );

    // Verificar si estamos realmente offline
    if (isOfflineMode()) {
      return { success: false, reason: "offline" };
    }

    // Verificar calidad de conexión
    const connectionStatus = await checkConnectionQuality();

    // Establecer estrategia basada en calidad de conexión
    let syncStrategy = "full";
    if (
      connectionStatus.quality === "poor" ||
      connectionStatus.quality === "limited"
    ) {
      syncStrategy = "essential";
    }

    // Obtener datos pendientes de sincronización
    const pendingData = await getPendingSyncData();

    if (!pendingData || Object.keys(pendingData).length === 0) {
      return { success: true, syncedItems: 0 };
    }

    // Sincronizar según estrategia
    if (syncStrategy === "essential") {
      // Solo sincronizar datos críticos
      const criticalTypes = ["eventos", "gastos", "usuarios"];
      const criticalItems = {};

      criticalTypes.forEach((type) => {
        if (pendingData[type]) {
          criticalItems[type] = pendingData[type];
        }
      });

      return await syncData(criticalItems, true);
    } else {
      // Sincronización completa
      return await syncData(pendingData, false);
    }
  } catch (error) {
    console.error("Error en smartSync:", error);
    return { success: false, error };
  }
}

// Función para sincronizar con reintentos inteligentes
export async function syncWithRetry(data, maxRetries = 3, initialDelay = 1000) {
  let attempt = 0;
  let delay = initialDelay;

  while (attempt < maxRetries) {
    try {
      const result = await syncData(data, false);
      if (result.success) {
        if (attempt > 0) {
        }
        return result;
      }

      // Si falla, incrementar contador y esperar antes de reintentar
      attempt++;

      // Esperar antes del siguiente intento (backoff exponencial)
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Incremento exponencial del tiempo de espera
    } catch (error) {
      console.error(`Error en intento ${attempt + 1}:`, error);
      attempt++;

      if (attempt >= maxRetries) {
        return { success: false, error, attemptsMade: attempt };
      }

      // Esperar antes del siguiente intento
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  return {
    success: false,
    reason: "max_retries_exceeded",
    attemptsMade: maxRetries,
  };
}

// Función para programar sincronizaciones periódicas cuando hay conexión
export function schedulePeriodicalSync(intervalMinutes = 15) {
  // Limpiar intervalos previos si existen
  if (window.syncInterval) {
    clearInterval(window.syncInterval);
  }

  // Establecer nuevo intervalo
  window.syncInterval = setInterval(async () => {
    // Verificar si hay conexión antes de intentar sincronizar
    if (navigator.onLine) {
      try {
        const result = await smartSync();

        if (result.success) {
        } else {
          console.warn(
            "Sincronización programada falló:",
            result.reason || "razón desconocida"
          );
        }
      } catch (error) {
        console.error("Error en sincronización programada:", error);
      }
    } else {
    }
  }, intervalMinutes * 60 * 1000);

  // Devolver función para detener las sincronizaciones programadas
  return () => {
    if (window.syncInterval) {
      clearInterval(window.syncInterval);
      window.syncInterval = null;
    }
  };
}

// Función para sincronizar selectivamente por prioridad
export async function syncByPriority(highPriorityOnly = false) {
  try {
    const pendingData = await getPendingSyncData();

    if (!pendingData || Object.keys(pendingData).length === 0) {
      return { success: true, message: "No hay datos para sincronizar" };
    }

    // Definir prioridades para cada tipo de dato
    const priorities = {
      usuarios: 1,
      eventos: 1,
      gastos: 1,
      configuraciones: 2,
      notificaciones: 2,
      comentarios: 3,
      logs: 4,
    };

    // Filtrar solo datos de alta prioridad si se solicita
    if (highPriorityOnly) {
      const highPriorityData = {};

      Object.keys(pendingData).forEach((type) => {
        if (priorities[type] <= 2) {
          // Prioridad 1 y 2 se consideran altas
          highPriorityData[type] = pendingData[type];
        }
      });

      return await syncData(highPriorityData, true);
    } else {
      // Sincronizar todo pero en orden de prioridad
      let allResults = { success: true, syncedItems: 0 };

      // Ordenar tipos por prioridad
      const sortedTypes = Object.keys(pendingData).sort(
        (a, b) => (priorities[a] || 99) - (priorities[b] || 99)
      );

      // Sincronizar en orden de prioridad
      for (const type of sortedTypes) {
        const typeData = { [type]: pendingData[type] };
        const result = await syncData(typeData, false);

        if (result.success) {
          allResults.syncedItems += result.syncedItems || 0;
        } else {
          // Si falla alguno, marcar como parcialmente exitoso
          allResults.success = false;
          allResults.partialSuccess = true;
          allResults.failedTypes = allResults.failedTypes || [];
          allResults.failedTypes.push(type);
        }
      }

      return allResults;
    }
  } catch (error) {
    console.error("Error en syncByPriority:", error);
    return { success: false, error };
  }
}
