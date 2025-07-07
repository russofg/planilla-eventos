// Funciones para notificaciones y toasts
import { auth, db, realdb } from "./firebase.config.js";
import {
  ref,
  set,
  get,
  update,
  onValue,
  push,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Variables para Toastify
const toastDuration = 2000; // Duración estándar en ms
const toastGravity = "bottom"; // Posición: top, bottom
let toastCount = 0; // Para gestionar múltiples toasts

// Toast de éxito (verde)
export function showSuccessToast(message, duration = toastDuration) {
  createToast(message, "#10B981", duration); // Verde
}

// Toast de error (rojo)
export function showErrorToast(message, duration = toastDuration) {
  createToast(message, "#EF4444", duration); // Rojo
}

// Toast informativo (azul)
export function showInfoToast(message, duration = toastDuration) {
  createToast(message, "#3B82F6", duration); // Azul
}

// Función para mostrar toast con botón de acción
export function showToastWithAction(message, actionText, actionCallback) {
  Toastify({
    text: `
      <div class="flex items-center justify-between w-full">
        <div>${message}</div>
        <button class="ml-4 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs">${actionText}</button>
      </div>
    `,
    duration: 10000,
    close: true,
    gravity: "top",
    position: "right",
    className: "toast-message-with-action",
    escapeMarkup: false,
    style: {
      background: "#3498db",
      color: "white",
      minWidth: "300px",
    },
    onClick: function (e) {
      // Verificar si se hizo clic en el botón
      if (e.target.tagName === "BUTTON") {
        if (typeof actionCallback === "function") {
          actionCallback();
        }
      }
    },
  }).showToast();
}

// Crear el nodo HTML para toast con acción
function createActionToastNode(message, actionText, actionCallback) {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.justifyContent = "space-between";
  container.style.width = "100%";
  container.style.gap = "12px";

  const messageDiv = document.createElement("div");
  messageDiv.textContent = message;
  messageDiv.style.fontWeight = "500";
  messageDiv.style.flexGrow = "1";

  const actionButton = document.createElement("button");
  actionButton.textContent = actionText;
  actionButton.style.backgroundColor = "white";
  actionButton.style.color = "#F59E0B";
  actionButton.style.border = "none";
  actionButton.style.padding = "6px 10px";
  actionButton.style.borderRadius = "4px";
  actionButton.style.fontWeight = "bold";
  actionButton.style.cursor = "pointer";
  actionButton.style.whiteSpace = "nowrap";

  actionButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof actionCallback === "function") {
      actionCallback();
    }
    // Encontrar y cerrar el toast padre
    let parent = e.target.closest(".toastify");
    if (parent && parent._toastify) {
      parent._toastify.hideToast();
    }
  });

  container.appendChild(messageDiv);
  container.appendChild(actionButton);

  return container;
}

// Crear un toast personalizado
function createToast(message, backgroundColor, duration) {
  // Incrementar contador para offset
  toastCount++;
  const offset = (toastCount - 1) * 10; // Pequeño offset para apilar toasts

  // Crear toast con Toastify
  Toastify({
    text: message,
    duration: duration,
    gravity: toastGravity,
    position: "right",
    offset: {
      y: offset,
    },
    style: {
      background: backgroundColor,
      borderRadius: "4px",
      fontWeight: "500",
    },
    onClick: function () {
      // Cerrar toast al hacer clic
      this.hideToast();
    },
  }).showToast();

  // Decrementar contador cuando el toast desaparezca
  setTimeout(() => {
    toastCount--;
  }, duration);
}

// Toast de confirmación con botones
export function confirmToast(message) {
  return new Promise((resolve) => {
    // Crear toast con Toastify para confirmación
    const toastElement = Toastify({
      text: message,
      duration: -1, // No expira
      gravity: "bottom",
      position: "center",
      className: "confirmation-toast",
      stopOnFocus: true,
      style: {
        background: "#4B5563", // Gris oscuro
        borderRadius: "4px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        maxWidth: "300px",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
      },
      escapeMarkup: false, // Permitir HTML
      node: createConfirmationToastNode(onConfirm, onCancel),
    }).showToast();

    function onConfirm() {
      toastElement.hideToast();
      resolve(true);
    }

    function onCancel() {
      toastElement.hideToast();
      resolve(false);
    }
  });
}

// Crear el nodo HTML para el toast de confirmación
function createConfirmationToastNode(onConfirm, onCancel) {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.width = "100%";

  const buttonContainer = document.createElement("div");
  buttonContainer.style.display = "flex";
  buttonContainer.style.marginTop = "12px";
  buttonContainer.style.gap = "8px";

  const confirmButton = document.createElement("button");
  confirmButton.textContent = "Confirmar";
  confirmButton.style.backgroundColor = "#10B981";
  confirmButton.style.color = "white";
  confirmButton.style.border = "none";
  confirmButton.style.padding = "8px 12px";
  confirmButton.style.borderRadius = "4px";
  confirmButton.style.cursor = "pointer";
  confirmButton.style.flexGrow = "1";
  confirmButton.addEventListener("click", onConfirm);

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "Cancelar";
  cancelButton.style.backgroundColor = "#EF4444";
  cancelButton.style.color = "white";
  cancelButton.style.border = "none";
  cancelButton.style.padding = "8px 12px";
  cancelButton.style.borderRadius = "4px";
  cancelButton.style.cursor = "pointer";
  cancelButton.style.flexGrow = "1";
  cancelButton.addEventListener("click", onCancel);

  buttonContainer.appendChild(confirmButton);
  buttonContainer.appendChild(cancelButton);
  container.appendChild(buttonContainer);

  return container;
}

// ---- Funciones de notificaciones (sin Firebase Messaging) ----

// Mostrar notificación usando el sistema de toast o la API de Notification
export function showNotification(notification) {

  // Verificar si notification es un objeto o una combinación de título y cuerpo
  let title, body;

  if (typeof notification === "object") {
    // Es un objeto de notificación
    title = notification.title || "Nueva notificación";
    body = notification.body || "";
  } else {
    // Asumimos que son parámetros separados (para compatibilidad con código anterior)
    title = arguments[0] || "Nueva notificación";
    body = arguments[1] || "";
  }

  // Siempre mostrar el toast, independientemente del permiso de notificaciones
  showInfoToast(`${title}: ${body}`, 8000);

  // Adicionalmente, si el navegador soporta notificaciones y hay permiso, mostrar notificación nativa
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const options = {
        body: body,
        icon: "/icons/icon-192x192.png", // Ruta corregida
        badge: "/icons/icon-72x72.png", // Ruta corregida
        requireInteraction: true,
        tag: "notification-" + Date.now(), // Evitar duplicados
      };

      const notif = new Notification(title, options);

      // Agregar listener de clic
      notif.onclick = function () {
        window.focus();
        this.close();
      };

    } catch (error) {
      // Si falla la notificación nativa, asegurar que al menos el toast funcione
      showInfoToast(`${title}: ${body}`, 12000);
    }
  } else {
    //   "⚠️ No se pudo mostrar notificación nativa: Permiso no concedido"
    // );
  }
}

// Función principal para registrar el dispositivo para notificaciones
export async function registerForPushNotifications(silentMode = false) {
  try {
    //   "Iniciando registro de notificaciones",
    //   silentMode ? "(modo silencioso)" : ""
    // );

    // Comprobar si ya tenemos permiso (para evitar solicitar innecesariamente)
    let permission = Notification.permission;

    // Si no tenemos permiso y no estamos en modo silencioso, solicitarlo
    if (permission !== "granted" && permission !== "denied") {
      try {
        permission = await Notification.requestPermission();
      } catch (error) {
      }
    }

    // Si el permiso fue denegado y no estamos en modo silencioso, mostrar mensaje
    if (permission !== "granted" && !silentMode) {
      showErrorToast(
        "Permiso de notificaciones denegado. No podrás recibir notificaciones con alerta."
      );
    }

    // Continuar con el registro del dispositivo independientemente del permiso
    // (los toasts seguirán funcionando aunque no haya permiso para notificaciones nativas)
    if (auth.currentUser) {
      // Registrar dispositivo en Realtime Database
      const success = await registerDeviceInRealtimeDB();

      if (success) {
        // Configurar listener para notificaciones en tiempo real
        setupRealtimeNotificationListener(auth.currentUser.uid);

        // Mostrar mensaje de éxito solo si no estamos en modo silencioso
        if (!silentMode) {
          showSuccessToast("Notificaciones activadas exitosamente.");
        }

        return true;
      } else {
        if (!silentMode) {
          showErrorToast(
            "No se pudo registrar el dispositivo para notificaciones."
          );
        }
        return false;
      }
    } else {
      if (!silentMode) {
        showErrorToast("Debes iniciar sesión para activar notificaciones.");
      }
      return false;
    }
  } catch (error) {
    if (!silentMode) {
      showErrorToast("Error al activar notificaciones: " + error.message);
    }
    return false;
  }
}

// Registrar dispositivo en Realtime Database (sin tokens FCM)
async function registerDeviceInRealtimeDB() {
  if (!auth.currentUser) {
    return false;
  }

  const userId = auth.currentUser.uid;
  const deviceId = generateDeviceId(); // Generar ID único para este dispositivo

  try {
    // Referencia a la ubicación del usuario en Realtime Database
    const userDevicesRef = ref(realdb, `userDevices/${userId}`);

    // Verificar si ya existe un registro para este usuario
    const snapshot = await get(userDevicesRef);

    if (snapshot.exists()) {
      // El registro existe, actualizar con el nuevo dispositivo
      const userData = snapshot.val();
      const devices = userData.devices || {};

      // Usando un objeto para almacenar dispositivos: { [deviceId]: timestamp }
      devices[deviceId] = Date.now();

      await update(userDevicesRef, { devices });
    } else {
      // Crear un nuevo registro para este usuario
      await set(userDevicesRef, {
        userId,
        devices: { [deviceId]: Date.now() },
      });
    }

    // Guardar el ID del dispositivo para futuras referencias
    localStorage.setItem("deviceId", deviceId);

    return true;
  } catch (error) {
    //   "Error al registrar dispositivo en Realtime Database:",
    //   error
    // );
    return false;
  }
}

// Generar un ID único para el dispositivo
function generateDeviceId() {
  // Usar un ID existente si ya existe
  const existingId = localStorage.getItem("deviceId");
  if (existingId) {
    return existingId;
  }

  // Generar un nuevo ID único
  return (
    "device_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9)
  );
}

// Variables globales para el sistema de notificaciones
let activeNotificationListener = null; // Referencia al listener activo
let hasUnreadNotifications = false; // Estado de notificaciones no leídas
let notificationListenerConfigured = false; // Bandera para evitar configurar múltiples veces

// Función para actualizar la visibilidad del indicador de notificaciones
function updateNotificationVisibility(show) {
  const indicator = document.getElementById("notification-indicator");
  if (indicator) {
    indicator.style.display = show ? "flex" : "none";
    hasUnreadNotifications = show;
  }
}

// Función para actualizar el indicador de notificaciones (compatible con código existente)
export function updateNotificationIndicator(show = false) {
  updateNotificationVisibility(show);
}

// Configurar listener para notificaciones en tiempo real
export function setupRealtimeNotificationListener(userId) {
  if (!userId) {
    //   "Error: Se requiere un ID de usuario para configurar el listener de notificaciones"
    // );
    return;
  }

  // Muy importante: eliminar cualquier listener existente antes de crear uno nuevo
  if (activeNotificationListener) {
    activeNotificationListener();
    activeNotificationListener = null;
  }

  // Si ya se configuró un listener para este usuario, no crear otro
  if (notificationListenerConfigured) {
    return;
  }

  //   "Configurando listener de notificaciones para el usuario:",
  //   userId
  // );

  // Referencia a la ubicación de notificaciones del usuario
  const notificationsRef = ref(realdb, `notifications/${userId}`);

  // Guardar el ID del usuario para el que se configuró el listener
  localStorage.setItem("notificationListenerUserId", userId);
  notificationListenerConfigured = true;

  // Escuchar cambios en tiempo real y guardar la función de cancelación
  activeNotificationListener = onValue(
    notificationsRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const notifications = snapshot.val();
        let notificationsCount = 0;
        let lastNotification = null;
        let lastTimestamp = 0;

        // Recorrer las notificaciones para contar no leídas y encontrar la más reciente
        Object.keys(notifications).forEach((notificationId) => {
          const notification = notifications[notificationId];

          // Solo contar notificaciones no leídas
          if (!notification.read) {
            notificationsCount++;

            // Verificar si esta notificación es más reciente que las anteriores
            if (
              !lastNotification ||
              (notification.timestamp && notification.timestamp > lastTimestamp)
            ) {
              lastNotification = notification;
              lastTimestamp = notification.timestamp || 0;
            }
          }
        });

        // Actualizar el indicador visual basado en la cantidad de notificaciones no leídas
        updateNotificationIndicator(notificationsCount > 0);

        // Mostrar solo la notificación más reciente si hay alguna
        if (notificationsCount > 0 && lastNotification) {

          // Si hay más de una notificación, mostrar el conteo total
          if (notificationsCount > 1) {
            lastNotification.body = `${lastNotification.body} (${notificationsCount} notificaciones sin leer)`;
          }

          // Mostrar solo la notificación más reciente
          showNotification(lastNotification);
        }

        if (notificationsCount > 0) {
          //   `Se encontraron ${notificationsCount} notificaciones sin leer`
          // );
        }
      } else {
        // No hay notificaciones, ocultar el indicador
        updateNotificationVisibility(false);
      }
    },
    (error) => {
    }
  );

}

// Iniciar las notificaciones cuando cambia el estado de autenticación
export function initNotifications() {

  // Listener de cambio de autenticación
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      //   "Usuario autenticado, configurando notificaciones automáticamente para:",
      //   user.uid
      // );

      try {
        // Solicitar permisos automáticamente si no están concedidos
        if ("Notification" in window) {
          if (Notification.permission === "granted") {
          } else if (Notification.permission !== "denied") {
            //   "Solicitando permisos de notificación automáticamente..."
            // );
            const permission = await Notification.requestPermission();
          }
        }

        // Registrar dispositivo automáticamente
        await registerDeviceInRealtimeDB();

        // Configurar escucha de notificaciones independientemente del permiso
        // (los toasts seguirán funcionando aunque no se concedan permisos para notificaciones nativas)
        setupRealtimeNotificationListener(user.uid);

        // Verificar si hay notificaciones pendientes al iniciar sesión
        const { checkPendingNotifications } = await import(
          "./notificationService.js"
        );
        setTimeout(() => {
          checkPendingNotifications().then((result) => {
          });
        }, 2000); // Pequeño retraso para evitar sobrecarga al inicio
      } catch (error) {
        //   "Error al inicializar notificaciones automáticamente:",
        //   error
        // );
      }
    } else {
    }
  });
}
