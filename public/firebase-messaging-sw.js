// Service Worker para manejar notificaciones push de Firebase Cloud Messaging
// Este archivo debe estar en la raíz del directorio público para funcionar correctamente

// Importar Firebase Scripts
importScripts(
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js"
);

// Configuración de Firebase (debe coincidir con la de firebase.config.js)
// NO incluir secretos aquí - sólo la configuración pública
firebase.initializeApp({
  apiKey: "AIzaSyBm6uAnlw2kN5A2IdXyBKTHATVTnSJ3JAk",
  authDomain: "planilla-evento.firebaseapp.com",
  projectId: "planilla-evento",
  storageBucket: "planilla-evento.firebasestorage.app",
  messagingSenderId: "258257856798",
  appId: "1:258257856798:web:be517c3735756f8c2c410f",
  databaseURL: "https://planilla-evento-default-rtdb.firebaseio.com", // URL de Realtime Database
});

const messaging = firebase.messaging();

// Escuchar notificaciones en segundo plano
messaging.onBackgroundMessage((payload) => {

  const notificationTitle = payload.notification.title || "Notificación";
  const notificationOptions = {
    body: payload.notification.body || "",
    icon: payload.notification.icon || "/public/icons/icon-192x192.png",
    badge: "/public/icons/icon-72x72.png",
    data: payload.data || {},
    requireInteraction: true, // Mantener visible hasta que el usuario interactúe
    tag: "notification-" + Date.now(), // Evitar duplicados
  };

  // Mostrar notificación
  return self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});

// Manejar click en la notificación
self.addEventListener("notificationclick", (event) => {

  // Cerrar la notificación
  event.notification.close();

  // Abrir o enfocar la ventana cuando se hace click en la notificación
  const urlToOpen = event.notification.data?.url || "/";

  // Intentar abrir la ventana de la aplicación o crear una nueva
  const promiseChain = clients
    .matchAll({
      type: "window",
      includeUncontrolled: true,
    })
    .then((windowClients) => {
      // Buscar si ya hay una ventana abierta para enfocarla
      let existingClient = null;
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && "focus" in client) {
          existingClient = client;
          break;
        }
      }

      // Si hay una ventana abierta, enfocarla
      if (existingClient) {
        return existingClient.focus();
      }

      // Si no hay ventana abierta, abrir una nueva
      return clients.openWindow(urlToOpen);
    });

  event.waitUntil(promiseChain);
});

// Actualización del Service Worker
self.addEventListener("install", (event) => {
  // Forzar la activación inmediata
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Tomar el control de las páginas inmediatamente
  event.waitUntil(clients.claim());
});
