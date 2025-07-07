// Service Worker para la Calculadora de Horas Extras
// Versión del caché para permitir actualizaciones
const CACHE_VERSION = "v1.6.0-fix-pagination"; // Incrementada la versión para los arreglos de paginación
const CACHE_NAME = `planilla-app-${CACHE_VERSION}`;
const DYNAMIC_CACHE_NAME = `dynamic-${CACHE_VERSION}`;
const API_CACHE_NAME = `api-${CACHE_VERSION}`;

// Lista de archivos básicos que queremos tener en caché para el funcionamiento offline
const filesToCache = [
  "/", // raíz para navegación
  "index.html",
  "login.html",
  "offline.html",
  "estilos.css",
  "output.css",
  "main.js",
  "ui.js",
  "firestoreService.js",
  "authService.js",
  "firebase.config.js",
  "calculations.js",
  "notifications.js",
  "offlineService.js",
  "syncService.js",
  "pwaService.js",
  "themeService.js",
  "config.js",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
];

// Recursos adicionales para el modo offline
const offlineResources = [
  "./offline.html",
  "./output.css",
  "./icons/icon-192x192.png",
];

// Límite para la caché dinámica (en entradas)
const DYNAMIC_CACHE_LIMIT = 50;

// Evento de instalación: pre-cachear recursos críticos (mejorado con manejo de errores individual)
self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        const cachePromises = filesToCache.map(async (file) => {
          try {
            const response = await fetch(file, { cache: "no-cache" });
            if (!response.ok) {
              throw new Error(`Error al traer ${file}: ${response.statusText}`);
            }
            await cache.put(file, response);
          } catch (error) {
            // Error al cachear archivo
          }
        });
        await Promise.all(cachePromises);
      })
      .catch((error) => {
        // Error grave en instalación
      })
  );
});
// Evento de activación: limpiar cachés antiguas
self.addEventListener("activate", (event) => {
  // Lista de cachés que queremos mantener (todas las actuales)
  const cacheWhitelist = [CACHE_NAME, DYNAMIC_CACHE_NAME, API_CACHE_NAME];

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Notificar a los clientes sobre la actualización
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: "SW_UPDATED",
              version: CACHE_VERSION,
            });
          });
        });

        // Reclamar el control de las páginas clientes inmediatamente
        return self.clients.claim();
      })
  );
});

// Función para limitar el tamaño de la caché dinámica
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length > maxItems) {
    // Eliminar los elementos más antiguos (principio de la lista)
    for (let i = 0; i < keys.length - maxItems; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// Estrategia de caché mejorada
self.addEventListener("fetch", (event) => {
  // FETCH PARA NAVEGACIÓN: intentar red, fallback a index.html y luego offline.html
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const resClone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, resClone));
          return response;
        })
        .catch(() => {
          return caches.match("/").then((root) => {
            if (root) {
              return root;
            }
            return caches.match("index.html").then((indexPage) => {
              if (indexPage) {
                return indexPage;
              }
              return caches.match("offline.html");
            });
          });
        })
    );
    return;
  }

  const url = new URL(event.request.url);

  // No interceptar peticiones a websockets, extensiones o análisis
  if (
    url.protocol === "chrome-extension:" ||
    url.protocol === "moz-extension:" ||
    url.protocol === "safari-extension:" ||
    url.hostname.includes("analytics") ||
    url.hostname.includes("doubleclick") ||
    url.pathname.startsWith("/__")
  ) {
    return;
  }

  // Obtener la información de la solicitud
  const requestMethod = event.request.method;

  // No manejar métodos que no sean GET (POST, PUT, DELETE)
  if (requestMethod !== "GET") {
    return;
  }

  // Para peticiones a Firebase o APIs, usar network-first con fallback a caché
  if (
    event.request.url.includes("firestore.googleapis.com") ||
    event.request.url.includes("googleapis.com") ||
    event.request.url.includes("firebaseio.com") ||
    event.request.url.includes("api")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clonar la respuesta para poder guardarla en caché
          const clonedResponse = response.clone();

          // Guardar en caché de datos API si la respuesta es válida
          if (clonedResponse.ok) {
            caches.open(API_CACHE_NAME).then((cache) => {
              cache.put(event.request, clonedResponse);

              // Limitar el tamaño de esta caché
              trimCache(API_CACHE_NAME, DYNAMIC_CACHE_LIMIT * 3);
            });
          }

          return response;
        })
        .catch((error) => {
          // Si falla la red, intentar obtener de caché
          return caches.match(event.request).then((cacheResponse) => {
            if (cacheResponse) {
              return cacheResponse;
            }

            // Si tampoco está en caché y es una petición de datos, devolver un formato JSON que indique
            // que estamos en modo offline pero que podemos seguir usando la app
            return new Response(
              JSON.stringify({
                error: true,
                offline: true,
                message:
                  "Sin conexión a internet. Usando datos guardados localmente.",
                timestamp: Date.now(),
              }),
              {
                headers: { "Content-Type": "application/json" },
                status: 200, // Usamos 200 en lugar de 503 para evitar errores en la aplicación
              }
            );
          });
        })
    );
    return;
  }

  // Para recursos estáticos, usar cache-first
  if (
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".ttf")
  ) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          // Recurso encontrado en caché
          return response;
        }

        // Si no está en caché, intentar descargarlo y guardarlo
        return fetch(event.request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            // Clonar para guardar en caché
            const responseToCache = networkResponse.clone();

            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);

              // Limitar el tamaño de la caché dinámica
              trimCache(DYNAMIC_CACHE_NAME, DYNAMIC_CACHE_LIMIT);
            });

            return networkResponse;
          })
          .catch(() => {
            // Para imágenes, intentar ofrecer un placeholder si no hay red ni caché
            if (
              url.pathname.endsWith(".png") ||
              url.pathname.endsWith(".jpg") ||
              url.pathname.endsWith(".webp") ||
              url.pathname.endsWith(".svg")
            ) {
              return caches.match("/icons/icon-192x192.png");
            }

            // Para otros recursos estáticos, simplemente fallar
            return new Response("Resource not found", { status: 404 });
          });
      })
    );
    return;
  }

  // Para cualquier otra solicitud, usar strategy stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Incluso si hay una versión en caché, intentar actualizar en segundo plano
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            // Actualizar la caché con la nueva respuesta
            const responseToCache = networkResponse.clone();
            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);

              // Limitar el tamaño
              trimCache(DYNAMIC_CACHE_NAME, DYNAMIC_CACHE_LIMIT);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Error de red, no hacer nada y usar la versión en caché
        });

      // Devolver la versión en caché o esperar la respuesta de la red
      return cachedResponse || fetchPromise;
    })
  );
});

// Evento para sincronizar datos cuando vuelve la conexión
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-eventos" || event.tag === "sync-data") {
    event.waitUntil(sincronizarDatos());
  }
});

// Función para sincronizar datos pendientes
async function sincronizarDatos() {
  try {
    // Solicitar a la página principal que realice la sincronización
    const clients = await self.clients.matchAll({ type: "window" });

    if (clients && clients.length > 0) {
      // Enviar mensaje a todos los clientes abiertos
      clients.forEach((client) => {
        client.postMessage({
          type: "SYNC_DATA",
          timestamp: Date.now(),
        });
      });

      // Notificar al usuario solo si tiene permisos
      const permission = await self.registration.pushManager.permissionState({
        userVisibleOnly: true,
      });

      if (permission === "granted") {
        self.registration.showNotification("Sincronizando datos", {
          body: "Sincronizando datos pendientes con el servidor",
          icon: "/icons/icon-192x192.png",
          tag: "sync",
          requireInteraction: false,
        });
      }
    }
  } catch (error) {
    // Error al sincronizar
  }
}

// Escuchar mensajes de los clientes
self.addEventListener("message", (event) => {
  // Mensajes de los clientes (páginas)
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Solicitud explícita de sincronización
  if (event.data && event.data.type === "REQUEST_SYNC") {
    // Registrar una sincronización si es posible
    if ("SyncManager" in self) {
      self.registration.sync
        .register("sync-data")
        .then(() => {})
        .catch((err) => {
          // Si no se puede registrar, intentar sincronizar directamente
          sincronizarDatos();
        });
    } else {
      // Si Sync API no es soportada, hacer sincronización directa
      sincronizarDatos();
    }
  }

  // Mensaje de confirmación de sincronización exitosa
  if (event.data && event.data.type === "SYNC_COMPLETED") {
    // Solo mostrar notificación si hay elementos sincronizados
    if (event.data.count && event.data.count > 0) {
      self.registration.showNotification("Sincronización completada", {
        body: `Se sincronizaron ${event.data.count} elementos pendientes`,
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-72x72.png",
        data: event.data || {},
        tag: "sync-complete",
        requireInteraction: false,
      });
    }
  }

  // Mensaje para actualizar caché de un recurso específico
  if (event.data && event.data.type === "UPDATE_CACHE") {
    const url = event.data.url;
    if (url) {
      caches.open(event.data.cacheName || CACHE_NAME).then((cache) => {
        fetch(url).then((response) => {
          cache.put(url, response);
        });
      });
    }
  }
});

// Evento push para notificaciones
self.addEventListener("push", function (event) {
  let notificationData = {};

  try {
    if (event.data) {
      notificationData = event.data.json();
    }
  } catch (e) {
    notificationData = {
      title: "Nueva notificación",
      body: event.data ? event.data.text() : "Sin contenido",
    };
  }

  const title = notificationData.title || "Planilla de eventos";
  const options = {
    body: notificationData.body || "Tienes una nueva notificación",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-72x72.png",
    data: notificationData.data || {},
    tag: notificationData.tag || "default",
    requireInteraction: notificationData.requireInteraction || false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Evento para cuando el usuario hace clic en una notificación
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  let url = "/";

  // Si hay datos personalizados en la notificación
  if (event.notification.data && event.notification.data.url) {
    url = event.notification.data.url;
  } else if (event.notification.tag === "sync-complete") {
    url = "/index.html?synced=true";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(function (windowClients) {
      // Si ya hay una ventana abierta, enfocarla y navegar a la URL
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ("focus" in client && "navigate" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }

      // Si no hay ventanas abiertas, abrir una nueva
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
