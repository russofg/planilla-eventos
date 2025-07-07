// Import services and config
import {
  setupAuthListener,
  signOut as logoutUser,
} from "./authService.js?v=20250623-fix-cache";
// Import specific functions needed for event listeners
import {
  addEvent,
  addGasto,
  saveSueldoFijo,
} from "./firestoreService.js?v=20250623-fix-cache";
import {
  applyFilters,
  clearFilters,
  recalcTotalFinal,
  initializeUI,
  loadUserData,
  renderEvents,
  renderGastos,
} from "./ui.js?v=20250623-fix-cache";
import { initializeTheme, toggleTheme } from "./themeService.js";
import { exportToPDF } from "./pdfGenerator.js";
import {
  initSyncService,
  isConnected,
  synchronizeData,
} from "./syncService.js";
import { initPwaService } from "./pwaService.js";
import {
  initOfflineDB,
  hasPendingItems,
  getEventsFromCache,
  getExpensesFromCache,
} from "./offlineService.js";
import {
  checkNotificationsInDatabase,
  sendTestNotification,
  initNotifications,
  checkPendingNotifications,
  printNotificationDebugInfo,
  resetNotificationStatus,
} from "./notificationService.js";
import {
  showErrorToast,
  showSuccessToast,
  showInfoToast,
  showToastWithAction,
  registerForPushNotifications,
  showNotification,
  setupRealtimeNotificationListener,
} from "./notifications.js";
import { getCurrentUser } from "./config.js";
import { checkFirestoreConnection, db, realdb } from "./firebase.config.js";
// Importar solo la función de inicialización de Google Calendar Service
import { initGoogleCalendarService } from "./googleCalendarService.js";
// Importamos las funciones necesarias de Firestore y Realtime DB
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref,
  set,
  get,
  update,
  onValue,
  push,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

// Variable para controlar los reintentos
let connectionRetryCount = 0;
const MAX_RETRIES = 5;
let connectionCheckInterval = null;

// Configuración para reportes (CSV/Excel)
let reportConfig = {
  eventFields: [0, 1, 2, 3, 4, 5, 6, 7], // Por defecto incluir todos los campos
  expenseFields: [0, 1], // Por defecto incluir todos los campos
};

// --- Inicialización Principal ---
document.addEventListener("DOMContentLoaded", async () => {
  // Mostrar el contenedor principal de la aplicación
  const appContainer = document.getElementById("app");
  if (appContainer) {
    appContainer.style.display = "block";
  }

  // Inicializar tema y UI
  initializeTheme();
  initializeUI();

  // Inicializar el servicio de Google Calendar - Nuevo sistema de delegación de eventos
  initGoogleCalendarService();

  // Autenticación y carga de datos (solo online)
  setupAuthListener((user) => {
    if (user) {
      setupEventListeners();
      loadUserData(user.uid);

      // Verificar si el usuario es administrador y mostrar botón si es necesario
      checkIfUserIsAdmin(user.uid);

      // Activar notificaciones automáticamente cuando el usuario inicie sesión
      setTimeout(() => {
        // Revisar y mostrar notificaciones existentes inmediatamente
        const currentUser = getCurrentUser();
        if (currentUser) {
          const notificationsRef = ref(
            realdb,
            `notifications/${currentUser.uid}`
          );
          get(notificationsRef)
            .then((snapshot) => {
              if (snapshot.exists()) {
                const notifications = snapshot.val();
                let unreadCount = 0;

                // Procesar notificaciones
                Object.keys(notifications).forEach((notificationId) => {
                  if (!notifications[notificationId].read) {
                    unreadCount++;
                    // Mostrar la notificación al usuario
                    showNotification(notifications[notificationId]);
                  }
                });

                // Actualizar el indicador visual
                document.getElementById(
                  "notification-indicator"
                ).style.display = unreadCount > 0 ? "flex" : "none";
              } else {
                // No hay notificaciones, ocultar el indicador
                document.getElementById(
                  "notification-indicator"
                ).style.display = "none";
              }
            })
            .catch((error) => {
              console.error("Error al verificar notificaciones:", error);
            });

          // Configurar listener para nuevas notificaciones
          setupRealtimeNotificationListener(currentUser.uid);
        }
      }, 1000);
    } else {
      window.location.href = "login.html";
    }
  });

  // Initialize PWA installation prompt logic
  initPwaService();

  // Inicializar base de datos offline
  initOfflineDB()
    .then(() => {})
    .catch(() => {});

  // Registrar Service Worker para modo offline
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .then((reg) => {})
        .catch(() => {});
    });
  }

  // Inicializar servicio de sincronización
  initSyncService();

  setupDebugListeners();

  // Set today's date as default for event and expense forms
  const today = new Date().toISOString().split("T")[0];
  const fechaOperacionInput = document.getElementById("fecha-operacion");
  const fechaGastoInput = document.getElementById("fecha-gasto");

  if (fechaOperacionInput && !fechaOperacionInput.value) {
    fechaOperacionInput.value = today;
  }

  if (fechaGastoInput && !fechaGastoInput.value) {
    fechaGastoInput.value = today;
  }
});

// Función para manejar problemas de conexión
function handleConnectionIssue(retry = false) {
  const message = retry
    ? "Continuamos con problemas de conexión. Usando datos locales."
    : "Detectamos problemas de conexión. Usando datos guardados localmente.";

  showToastWithAction(message, "Reintentar", () => {
    checkFirestoreConnection().then((connected) => {
      if (connected) {
        showSuccessToast("Conexión restaurada correctamente");
        const user = getCurrentUser();
        if (user) {
          loadUserDataSafely(user.uid, true);
        }
      } else {
        handleConnectionIssue(true);
      }
    });
  });
}

// Función para cargar datos de usuario de manera segura
async function loadUserDataSafely(userId, forceReload = false) {
  try {
    // Si se solicita recargar o si es la primera carga
    if (forceReload || connectionRetryCount === 0) {
      const loadPromise = loadUserData(userId);

      // Mostrar spinner solo en la primera carga
      const spinnerElement = document.getElementById("loading-spinner");
      if (spinnerElement && connectionRetryCount === 0) {
        spinnerElement.classList.remove("hidden");

        loadPromise.finally(() => {
          spinnerElement.classList.add("hidden");
        });
      }

      await loadPromise;
    }
  } catch (error) {
    // Aumentar contador de reintentos
    connectionRetryCount++;

    if (connectionRetryCount < MAX_RETRIES) {
      // Reintento con tiempo exponencial de espera
      setTimeout(() => {
        loadUserDataSafely(userId, true);
      }, Math.min(1000 * Math.pow(2, connectionRetryCount), 30000)); // Máximo 30 segundos
    } else {
      showErrorToast(
        "No se pudieron cargar los datos. Verificando datos locales..."
      );

      // Intentar cargar desde caché local
      try {
        const cachedEvents = await getEventsFromCache();
        const cachedExpenses = await getExpensesFromCache();

        if (cachedEvents.length > 0 || cachedExpenses.length > 0) {
          // Actualizar UI con datos en caché
          updateUIWithCachedData(cachedEvents, cachedExpenses);
          showInfoToast("Mostrando datos guardados localmente");
        } else {
          showErrorToast("No hay datos disponibles localmente");
        }
      } catch (cacheError) {
        showErrorToast("No se pudieron cargar datos locales");
      }
    }
  }
}

// Función para actualizar UI con datos en caché
function updateUIWithCachedData(cachedEvents, cachedExpenses) {
  // Actualizar tabla de eventos
  if (cachedEvents && cachedEvents.length > 0) {
    const eventsContainer = document.getElementById("eventos-body");
    if (eventsContainer) {
      renderEvents(cachedEvents, {
        hasNextPage: false,
        hasPrevPage: false,
      });
    }
  }

  // Actualizar tabla de gastos
  if (cachedExpenses && cachedExpenses.length > 0) {
    const expensesContainer = document.getElementById("gastos-body");
    if (expensesContainer) {
      renderGastos(cachedExpenses, {
        hasNextPage: false,
        hasPrevPage: false,
      });
    }
  }

  // Recalcular totales
  recalcTotalFinal();
}

// Función para configurar event listeners de depuración
function setupDebugListeners() {
  const openConfigDebug = document.getElementById("open-report-config");
  if (openConfigDebug)
    openConfigDebug.addEventListener("click", () => {
      document.getElementById("report-config-modal").classList.remove("hidden");
    });
  const closeConfigDebug = document.getElementById("close-report-config");
  if (closeConfigDebug)
    closeConfigDebug.addEventListener("click", () => {
      document.getElementById("report-config-modal").classList.add("hidden");
    });
}

// Function to setup event listeners for the main application elements
// This is called by authService AFTER the user is authenticated
export function setupEventListeners() {
  // Configurar event listeners

  // Forms
  const addEventForm = document.getElementById("form-operaciones");
  const addGastoForm = document.getElementById("add-gasto-form");

  if (addEventForm) {
    addEventForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addEvent(e.target); // Pass the form element
    });
  } else {
    console.warn("No se encontró el formulario de eventos");
  }

  if (addGastoForm) {
    addGastoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addGasto(e.target); // Pass the form element
    });
  } else {
    console.warn("No se encontró el formulario de gastos");
  }

  // Buttons
  const saveSueldoButton = document.getElementById("save-sueldo-button");
  const logoutButton = document.getElementById("logout-button");
  const exportButton = document.getElementById("export-pdf-button");
  const notificationsDropdownBtn = document.getElementById(
    "notifications-dropdown-btn"
  );
  const notificationsDropdown = document.getElementById(
    "notifications-dropdown"
  );
  const enableNotificationsButton = document.getElementById(
    "enable-notifications"
  );
  const checkNotificationsButton = document.getElementById(
    "check-notifications"
  );
  const testNotificationButton = document.getElementById("test-notification");
  const resetNotificationsButton = document.getElementById(
    "reset-notifications"
  );
  const themeToggle = document.getElementById("theme-toggle");
  const limpiarFiltrosBtn = document.getElementById("limpiar-filtros-eventos");
  const exportCsvBtn = document.getElementById("export-csv-button");
  const exportExcelBtn = document.getElementById("export-excel-button");
  const openConfigBtn = document.getElementById("open-report-config");
  const closeConfigBtn = document.getElementById("close-report-config");
  const reportConfigForm = document.getElementById("report-config-form");
  // Botón de sincronización manual
  const syncManualBtn = document.getElementById("sync-manual-button");

  if (saveSueldoButton) {
    saveSueldoButton.addEventListener("click", saveSueldoFijo);
  }
  if (logoutButton) {
    logoutButton.addEventListener("click", logoutUser);
  }
  if (exportButton) {
    exportButton.addEventListener("click", exportToPDF);
  }
  // Sincronización manual
  if (syncManualBtn) {
    syncManualBtn.addEventListener("click", async () => {
      if (!navigator.onLine) {
        showErrorToast("No hay conexión a internet. Intenta más tarde.");
        return;
      }

      try {
        showInfoToast("Verificando sincronización...");
        const hasPending = await hasPendingItems();

        if (hasPending) {
          showInfoToast("Sincronizando datos pendientes...");
          const count = await synchronizeData();
          if (count > 0) {
            showSuccessToast(`Se sincronizaron ${count} elementos pendientes`);
          } else {
            showInfoToast("No se encontraron elementos para sincronizar");
          }
        } else {
          showInfoToast("No hay elementos pendientes para sincronizar");
        }
      } catch (error) {
        showErrorToast("Error en la sincronización manual");
      }
    });
  }

  // Export CSV, Excel and Report Config
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      exportToCSV();
    });
  }
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener("click", () => {
      exportToExcel();
    });
  }
  if (openConfigBtn) {
    openConfigBtn.addEventListener("click", () => {
      document.getElementById("report-config-modal").classList.remove("hidden");
    });
  }
  if (closeConfigBtn) {
    closeConfigBtn.addEventListener("click", () => {
      document.getElementById("report-config-modal").classList.add("hidden");
    });
  }
  if (reportConfigForm) {
    reportConfigForm.addEventListener("submit", (e) => {
      applyReportConfig(e);
    });
  }

  // Manejo del menú desplegable de notificaciones
  if (notificationsDropdownBtn && notificationsDropdown) {
    notificationsDropdownBtn.addEventListener("click", () => {
      notificationsDropdown.classList.toggle("hidden");
    });

    // Cerrar el menú al hacer clic fuera de él
    document.addEventListener("click", (event) => {
      if (
        !notificationsDropdownBtn.contains(event.target) &&
        !notificationsDropdown.contains(event.target)
      ) {
        notificationsDropdown.classList.add("hidden");
      }
    });
  }

  // Botones de notificaciones
  if (enableNotificationsButton) {
    enableNotificationsButton.addEventListener("click", async () => {
      try {
        notificationsDropdown.classList.add("hidden"); // Cerrar el menú
        await registerForPushNotifications();
      } catch (error) {
        showErrorToast("No se pudieron activar las notificaciones.");
      }
    });
  }

  if (checkNotificationsButton) {
    checkNotificationsButton.addEventListener("click", async () => {
      try {
        notificationsDropdown.classList.add("hidden"); // Cerrar el menú

        // Usar la nueva función checkPendingNotifications para diagnóstico completo
        const result = await checkPendingNotifications();

        // Imprimir información de diagnóstico detallada en la consola (para debugging)
        printNotificationDebugInfo();

        if (!result || (result.found && result.unreadCount === 0)) {
          showInfoToast("No hay notificaciones nuevas pendientes");
        }
      } catch (error) {
        showErrorToast("Error al verificar notificaciones: " + error.message);
      }
    });
  }

  if (testNotificationButton) {
    testNotificationButton.addEventListener("click", async () => {
      try {
        const currentUser = getCurrentUser();
        if (!currentUser) {
          showErrorToast(
            "Debes iniciar sesión para enviar una notificación de prueba."
          );
          return;
        }
        notificationsDropdown.classList.add("hidden"); // Cerrar el menú
        await sendTestNotification(currentUser.uid);
      } catch (error) {
        showErrorToast("Error al enviar notificación de prueba.");
      }
    });
  }

  if (resetNotificationsButton) {
    resetNotificationsButton.addEventListener("click", async () => {
      try {
        const currentUser = getCurrentUser();
        if (!currentUser) {
          showErrorToast("Debes iniciar sesión para reiniciar notificaciones");
          return;
        }
        notificationsDropdown.classList.add("hidden"); // Cerrar el menú

        // Llamar directamente a la función resetNotificationStatus
        await resetNotificationStatus();

        // Después de reiniciar, verificar si hay notificaciones
        await checkPendingNotifications();
      } catch (error) {
        console.error("Error al reiniciar notificaciones:", error);
        showErrorToast("Error al reiniciar notificaciones: " + error.message);
      }
    });
  }

  if (themeToggle) {
    // Use the dedicated function from ui.js
    themeToggle.addEventListener("click", toggleTheme);
  }

  // Los filtros se configuran en ui.js mediante setupFilterEventListeners()
  // Solo configuramos el botón de limpiar filtros aquí
  if (limpiarFiltrosBtn) {
    limpiarFiltrosBtn.addEventListener("click", () => {
      // Limpiar filtros cuando se hace clic en el botón
      clearFilters();
    });
  }

  // Input listeners
  const sueldoFijoInput = document.getElementById("sueldo-fijo");
  if (sueldoFijoInput) {
    sueldoFijoInput.addEventListener("input", recalcTotalFinal);
    sueldoFijoInput.addEventListener("change", recalcTotalFinal);
  }

  // Listener para errores de conexión
  window.addEventListener("online", async () => {
    const connected = await checkFirestoreConnection();
    if (connected) {
      showSuccessToast("Conexión restaurada. Sincronizando...");
      try {
        const count = await synchronizeData();
        if (count > 0) {
          showSuccessToast(`Se sincronizaron ${count} elementos pendientes`);
        }
      } catch (error) {
        // Error al sincronizar
      }
    }
  });

  window.addEventListener("offline", () => {
    showInfoToast(
      "Sin conexión a internet. Los cambios se guardarán localmente."
    );
  });
}

// Función para verificar si el usuario es administrador y mostrar/ocultar el botón correspondiente
async function checkIfUserIsAdmin(userId) {
  try {
    // Usar las funciones importadas de Firestore en lugar de métodos en la instancia db
    const userDocRef = doc(db, "users", userId);
    const userDocSnap = await getDoc(userDocRef);

    // Obtener el botón de acceso al panel admin
    const adminButton = document.getElementById("admin-page-button");

    if (userDocSnap.exists() && userDocSnap.data().role === "admin") {
      // Si el usuario es admin, mostrar el botón
      if (adminButton) {
        adminButton.classList.remove("hidden");

        // Añadir el event listener para navegar a la página de admin
        adminButton.addEventListener("click", () => {
          window.location.href = "admin.html";
        });
      }
    } else {
      // Si no es admin, ocultar el botón
      if (adminButton) {
        adminButton.classList.add("hidden");
      }
    }
  } catch (error) {
    console.error("Error al verificar rol de administrador:", error);
    // En caso de error, asegurarse de que el botón esté oculto
    const adminButton = document.getElementById("admin-page-button");
    if (adminButton) {
      adminButton.classList.add("hidden");
    }
  }
}

// Function to apply report configuration
function applyReportConfig(e) {
  e.preventDefault();
  const eventChecks = Array.from(
    document.querySelectorAll('input[name="event-field"]:checked')
  );
  const expenseChecks = Array.from(
    document.querySelectorAll('input[name="expense-field"]:checked')
  );
  reportConfig.eventFields = eventChecks.map((ch) => parseInt(ch.value));
  reportConfig.expenseFields = expenseChecks.map((ch) => parseInt(ch.value));
  document.getElementById("report-config-modal").classList.add("hidden");
  showInfoToast("Configuración de informe aplicada.");
}

// Export to CSV
async function exportToCSV() {
  // Events
  const headersE = [
    "Evento",
    "Día",
    "Día Sem.",
    "Entrada",
    "Salida",
    "Oper.",
    "H. Extra",
    "Total",
  ];
  const rowsE = [];
  document.querySelectorAll("#eventos-body tr").forEach((row) => {
    if (!row.querySelector("[colspan]")) {
      const cells = Array.from(row.cells);
      rowsE.push(
        reportConfig.eventFields.map((i) => cells[i]?.textContent.trim() || "")
      );
    }
  });
  // Expenses
  const headersX = ["Descripción", "Monto"];
  const rowsX = [];
  document.querySelectorAll("#gastos-body tr").forEach((row) => {
    if (!row.querySelector("[colspan]")) {
      const cells = Array.from(row.cells);
      rowsX.push(
        reportConfig.expenseFields.map(
          (i) => cells[i]?.textContent.trim() || ""
        )
      );
    }
  });
  // Build CSV
  let csvContent = "";
  csvContent += "Eventos\n";
  csvContent +=
    reportConfig.eventFields.map((i) => headersE[i]).join(",") + "\n";
  rowsE.forEach((r) => {
    csvContent +=
      r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",") + "\n";
  });
  csvContent += "\nGastos\n";
  csvContent +=
    reportConfig.expenseFields.map((i) => headersX[i]).join(",") + "\n";
  rowsX.forEach((r) => {
    csvContent +=
      r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",") + "\n";
  });
  // Download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `reporte_${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  showSuccessToast("CSV exportado correctamente.");
}

// Export to Excel
async function exportToExcel() {
  // Check if ExcelJS is loaded
  if (typeof ExcelJS === "undefined") {
    showErrorToast("Error al exportar: Librería ExcelJS no encontrada.");
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Reporte");

  // Configuración inicial de columnas (ajustar según necesidad)
  const colCount = Math.max(
    reportConfig.eventFields.length,
    reportConfig.expenseFields.length
  );
  ws.columns = Array(colCount)
    .fill()
    .map(() => ({ width: 20 }));

  // Función auxiliar para agregar sección con estilo
  const addSection = (title, rows, headerFill, headerFontColor) => {
    ws.addRow([title]);
    const titleRow = ws.lastRow;
    titleRow.getCell(1).font = { bold: true, size: 14 };

    if (rows.length) {
      const headerRow = ws.addRow(rows[0]);
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: headerFill },
        };
        cell.font = { bold: true, color: { argb: headerFontColor } };
        cell.alignment = { horizontal: "center" };
      });
      rows.slice(1).forEach((r) => ws.addRow(r));
    }
  };

  // Preparar datos en arrays
  const eventos = [];
  eventos.push(
    reportConfig.eventFields.map(
      (i) =>
        [
          "Evento",
          "Día",
          "Día Sem.",
          "Entrada",
          "Salida",
          "Oper.",
          "H. Extra",
          "Total",
        ][i]
    )
  );
  document.querySelectorAll("#eventos-body tr").forEach((row) => {
    if (!row.querySelector("[colspan]")) {
      const cells = Array.from(row.cells).map((td) => td.textContent.trim());
      eventos.push(reportConfig.eventFields.map((i) => cells[i]));
    }
  });
  eventos.push([
    "Total Eventos",
    document.getElementById("total-pago").textContent,
  ]);

  const gastos = [];
  gastos.push(
    reportConfig.expenseFields.map((i) => ["Descripción", "Monto"][i])
  );
  document.querySelectorAll("#gastos-body tr").forEach((row) => {
    if (!row.querySelector("[colspan]")) {
      const cells = Array.from(row.cells).map((td) => td.textContent.trim());
      gastos.push(reportConfig.expenseFields.map((i) => cells[i]));
    }
  });
  gastos.push([
    "Total Gastos",
    document.getElementById("total-gastos").textContent,
  ]);

  // Información y resumen como arrays
  const info = [
    ["Generado el", new Date().toLocaleString("es-AR")],
    ["Usuario", getCurrentUser()?.email || "-"],
  ];
  const summary = [
    ["Campo", "Valor"],
    ["Sueldo Fijo", `$${document.getElementById("sueldo-fijo").value}`],
    ["TOTAL FINAL", document.getElementById("total-final").textContent],
  ];

  // Agregar secciones
  addSection("Información", info, "FFD3D3D3", "FF000000");
  addSection("Eventos", eventos, "FF4472C4", "FFFFFFFF");
  addSection("Gastos", gastos, "FFFFFF00", "FF000000");
  addSection("Resumen", summary, "FFB0E0E6", "FF000000");

  // Generar archivo y descargar
  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reporte_${new Date().toISOString().split("T")[0]}.xlsx`;
  a.click();
  showSuccessToast("Excel exportado correctamente con estilos.");
}
// Mostrar banner de conexión
function showConnectionStatus(online) {
  const banner = document.getElementById("connection-status");
  if (!banner) return;

  if (online) {
    banner.textContent = "✅ Estás online";
    banner.style.backgroundColor = "#4ade80"; // verde
    banner.style.display = "block";

    setTimeout(() => {
      banner.style.display = "none";
    }, 3000); // Se oculta después de 3 segundos
  } else {
    banner.textContent = "🛑 Estás offline";
    banner.style.backgroundColor = "#f87171"; // rojo
    banner.style.display = "block";
  }
}

// Variables para controlar notificaciones repetidas
let hasShownOfflineNotification = false;
let hasShownOnlineNotification = false;

// Escuchar eventos de conexión/desconexión
window.addEventListener("online", () => {
  // Solo mostrar la notificación si es un cambio real y no una carga inicial
  if (document.readyState === "complete" && !hasShownOnlineNotification) {
    showConnectionStatus(true);
    showSuccessToast("Conexión restaurada. Sincronizando...");
    hasShownOnlineNotification = true;
    hasShownOfflineNotification = false; // Reiniciar para permitir futuras notificaciones offline
  }
});

window.addEventListener("offline", () => {
  // Solo mostrar la notificación si es un cambio real y no una carga inicial
  if (document.readyState === "complete" && !hasShownOfflineNotification) {
    showConnectionStatus(false);
    showInfoToast(
      "Sin conexión a internet. Los cambios se guardarán localmente."
    );
    hasShownOfflineNotification = true;
    hasShownOnlineNotification = false; // Reiniciar para permitir futuras notificaciones online
  }
});
