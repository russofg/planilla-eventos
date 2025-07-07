// Archivo de servicio de notificaciones simplificado (sin Firebase Messaging)
import { db, realdb } from "./firebase.config.js";
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref,
  set,
  get,
  push,
  update,
  onValue,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import { getCurrentUser, COLLECTIONS } from "./config.js";
import {
  showInfoToast,
  showErrorToast,
  showSuccessToast,
  showNotification,
  setupRealtimeNotificationListener,
  registerForPushNotifications,
  updateNotificationIndicator,
} from "./notifications.js";

// Variable para evitar notificaciones duplicadas
let lastProcessedNotificationId = null;

// Función para verificar las notificaciones almacenadas en la base de datos
export async function checkNotificationsInDatabase(userId) {
  try {
    // Imprimir la ruta exacta que estamos consultando (para depuración)
    const path = `notifications/${userId}`;

    // Verificar notificaciones en Realtime Database
    const notificationsRef = ref(realdb, path);

    const snapshot = await get(notificationsRef);

    if (!snapshot.exists()) {
      // Evitar mostrar este mensaje repetidamente
      if (!localStorage.getItem("noNotificationsShown")) {
        showInfoToast("No hay notificaciones para tu usuario");
        localStorage.setItem("noNotificationsShown", "true");

        // Limpiar esta bandera después de un tiempo
        setTimeout(() => {
          localStorage.removeItem("noNotificationsShown");
        }, 3600000); // 1 hora
      }

      // Asegurarse de que el indicador esté oculto
      updateNotificationIndicator(false);
      return { found: false, count: 0 };
    }

    // Procesar notificaciones
    const notifications = snapshot.val();

    let count = 0;
    let unreadCount = 0;
    let lastNotification = null;
    let lastTimestamp = 0;

    // Contar notificaciones y encontrar la más reciente no leída
    Object.keys(notifications).forEach((notificationId) => {
      count++;
      const notification = notifications[notificationId];
      if (!notification.read) {
        unreadCount++;

        // Verificar si esta notificación es más reciente que las anteriores
        if (
          !lastNotification ||
          (notification.timestamp && notification.timestamp > lastTimestamp)
        ) {
          lastNotification = { ...notification, id: notificationId };
          lastTimestamp = notification.timestamp || 0;
        }
      }
    });

    // Actualizar el indicador visual basado en el conteo de notificaciones no leídas
    updateNotificationIndicator(unreadCount > 0);

    if (count === 0) {
      // Evitar mostrar este mensaje repetidamente
      if (!localStorage.getItem("noNotificationsToShowShown")) {
        showInfoToast("No hay notificaciones para mostrar");
        localStorage.setItem("noNotificationsToShowShown", "true");

        // Limpiar esta bandera después de un tiempo
        setTimeout(() => {
          localStorage.removeItem("noNotificationsToShowShown");
        }, 3600000); // 1 hora
      }
      return { found: true, count: 0, unreadCount: 0 };
    }

    if (unreadCount === 0) {
      // Evitar mostrar este mensaje repetidamente
      if (!localStorage.getItem("noUnreadNotificationsShown")) {
        showInfoToast("No hay notificaciones nuevas sin leer");
        localStorage.setItem("noUnreadNotificationsShown", "true");

        // Limpiar esta bandera después de un tiempo
        setTimeout(() => {
          localStorage.removeItem("noUnreadNotificationsShown");
        }, 3600000); // 1 hora
      }
      return { found: true, count, unreadCount: 0 };
    }

    // Mostrar solo la notificación más reciente (si hay notificaciones no leídas)
    if (unreadCount > 0 && lastNotification) {
      // Comprobar si ya procesamos esta notificación
      if (lastNotification.id === lastProcessedNotificationId) {
        return { found: true, count, unreadCount, duplicate: true };
      }

      // Guardar ID de esta notificación para evitar duplicados
      lastProcessedNotificationId = lastNotification.id;

      // Si hay más de una notificación no leída, indicarlo en el mensaje
      if (unreadCount > 1) {
        lastNotification.body = `${lastNotification.body} (${unreadCount} notificaciones sin leer)`;
      }

      // Mostrar la notificación al usuario
      showNotification(lastNotification);

      // Crear un array para acumular las actualizaciones
      const updates = {};

      // Marcar todas las notificaciones como leídas
      Object.keys(notifications).forEach((notificationId) => {
        if (!notifications[notificationId].read) {
          updates[`notifications/${userId}/${notificationId}/read`] = true;
          updates[`notifications/${userId}/${notificationId}/readAt`] =
            Date.now();
        }
      });

      // Aplicar todas las actualizaciones en una sola operación
      if (Object.keys(updates).length > 0) {
        await update(ref(realdb), updates);

        // Después de marcar como leídas, actualizar el indicador a oculto
        updateNotificationIndicator(false);
      }
    }

    return { found: true, count, unreadCount };
  } catch (error) {
    console.error("Error al verificar notificaciones:", error);
    console.error("Detalles del error:", error.message, error.stack);
    showErrorToast("Error al verificar notificaciones: " + error.message);
    return { found: false, error };
  }
}

// Función para verificar manualmente si hay notificaciones pendientes
export async function checkPendingNotifications() {
  try {
    // Verificar si el usuario está autenticado
    const user = getCurrentUser();
    if (!user) {
      showErrorToast("Debes iniciar sesión para verificar notificaciones");
      return false;
    }

    showInfoToast("Verificando notificaciones pendientes...");

    // Comprobar si hay notificaciones para este usuario
    const result = await checkNotificationsInDatabase(user.uid);

    // Reiniciar el listener de notificaciones en tiempo real
    setupRealtimeNotificationListener(user.uid);

    return result;
  } catch (error) {
    showErrorToast("Error al verificar notificaciones: " + error.message);
    return false;
  }
}

// Función para enviar una notificación de prueba
export async function sendTestNotification(userId) {
  try {
    if (!userId) {
      showErrorToast(
        "Necesitas iniciar sesión para enviar una notificación de prueba"
      );
      return false;
    }

    // Referencia a la ubicación de notificaciones del usuario
    const notificationsRef = ref(realdb, `notifications/${userId}`);
    // Generar un ID único para la notificación
    const newNotificationRef = push(notificationsRef);

    // Guardar la notificación con la estructura esperada
    await set(newNotificationRef, {
      title: "Notificación de prueba",
      body:
        "Esta es una notificación de prueba creada el " +
        new Date().toLocaleString(),
      read: false,
      timestamp: Date.now(),
      type: "test",
    });

    showSuccessToast("Notificación de prueba enviada correctamente");
    return true;
  } catch (error) {
    showErrorToast("Error al enviar notificación de prueba: " + error.message);
    return false;
  }
}

// Función de diagnóstico para mostrar el estado completo de las notificaciones
export async function printNotificationDebugInfo() {
  try {
    const user = getCurrentUser();
    if (!user) {
      return;
    }

    // Imprimir información de permisos

    // Verificar dispositivo registrado
    const deviceId = localStorage.getItem("deviceId");

    // Verificar registro en Realtime Database
    const userDevicesRef = ref(realdb, `userDevices/${user.uid}`);
    const devicesSnapshot = await get(userDevicesRef);

    if (devicesSnapshot.exists()) {
    } else {
    }

    // Verificar notificaciones
    const notificationsRef = ref(realdb, `notifications/${user.uid}`);
    const notificationsSnapshot = await get(notificationsRef);

    if (notificationsSnapshot.exists()) {
      const notificaciones = notificationsSnapshot.val();

      // Contar notificaciones no leídas
      let noLeidas = 0;
      Object.values(notificaciones).forEach((n) => {
        if (!n.read) noLeidas++;
      });
    } else {
    }

    return true;
  } catch (error) {
    return false;
  }
}

// Función para reiniciar el estado de notificaciones del usuario
export async function resetNotificationStatus() {
  try {
    const user = getCurrentUser();
    if (!user) {
      showErrorToast("Debes iniciar sesión para reiniciar notificaciones");
      return false;
    }

    showInfoToast("Reiniciando estado de notificaciones...");

    // 1. Verificar si hay notificaciones existentes
    const notificationsRef = ref(realdb, `notifications/${user.uid}`);
    const snapshot = await get(notificationsRef);

    if (snapshot.exists()) {
      // Actualizar todas las notificaciones existentes para marcarlas como no leídas
      const updates = {};

      Object.keys(snapshot.val()).forEach((notificationId) => {
        updates[`notifications/${user.uid}/${notificationId}/read`] = false;
      });

      // Aplicar las actualizaciones en batch
      if (Object.keys(updates).length > 0) {
        await update(ref(realdb), updates);
        showSuccessToast(
          `Se reiniciaron ${Object.keys(updates).length} notificaciones`
        );
      }
    } else {
      // Si no hay notificaciones, crear una notificación de prueba
      await sendTestNotification(user.uid);
    }

    // Reiniciar el listener
    setupRealtimeNotificationListener(user.uid);

    return true;
  } catch (error) {
    showErrorToast("Error al reiniciar notificaciones: " + error.message);
    return false;
  }
}

// Inicialización de notificaciones
export function initNotifications() {
  console.log(
    "Inicializando sistema de notificaciones desde notificationService..."
  );

  // Ya no configuramos el listener aquí para evitar duplicados
  // Ahora la configuración del listener se maneja exclusivamente desde notifications.js
  console.log(
    "El listener de notificaciones se configurará desde el módulo principal"
  );
}
