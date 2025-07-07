/**
 * Google Calendar Service - Versión Simplificada y Definitiva
 * Este archivo maneja la integración con Google Calendar y la exportación/importación de eventos
 */

import { getCurrentUser } from "./config.js";
import {
  db,
  addUserToExportedByUsers,
  isUserAdmin,
} from "./firebase.config.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  setDoc,
  getDoc,
  Timestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "./notifications.js";

// ===== VARIABLES GLOBALES =====
let isInitialized = false;
let pendingEventsCount = 0;

// ===== INICIALIZACIÓN =====

// Esta función es llamada desde main.js cuando la aplicación se inicia
export function initGoogleCalendarService() {
  // Primero aseguramos que el botón de exportar tenga posición relativa
  // para que el indicador se posicione correctamente
  const exportButton = document.getElementById("export-google-btn");
  if (exportButton) {
    exportButton.style.position = "relative";
  }

  // Inicializamos el indicador de exportación
  const indicator = document.getElementById("export-indicator");
  if (indicator) {
    // Estilo inicial (oculto)
    indicator.style.display = "none";
  }

  // Configuramos evento click para el botón de exportar
  if (exportButton) {
    exportButton.addEventListener("click", function (e) {
      e.preventDefault();
      exportEventsToGoogleCalendar();
    });
  }

  // Configuramos evento click para el botón de importar
  const importButton = document.getElementById("import-google-btn");
  if (importButton) {
    importButton.addEventListener("click", function (e) {
      e.preventDefault();
      importEventsFromGoogleCalendar();
    });
  }

  // Verificamos eventos pendientes después de un breve delay
  // para asegurar que todos los componentes estén cargados
  setTimeout(() => {
    checkPendingExportEvents();
  }, 1000);

  isInitialized = true;
}

// ===== FUNCIONES DEL INDICADOR DE EXPORTACIÓN =====

// Función para verificar si hay eventos pendientes de exportar
export async function checkPendingExportEvents() {
  try {
    const user = getCurrentUser();
    if (!user) {
      return 0; // Salir si no hay usuario
    }

    // Obtenemos los eventos no exportados
    const events = await getEventsToExport(user.uid, true);
    pendingEventsCount = events.length;

    // Actualizamos el indicador
    updateExportIndicator();

    return pendingEventsCount;
  } catch (error) {
    return 0;
  }
}

// Función para actualizar visualmente el indicador
function updateExportIndicator() {
  const indicator = document.getElementById("export-indicator");
  if (!indicator) return;

  if (pendingEventsCount > 0) {
    // Mostrar el indicador
    indicator.style.display = "flex";

    // Actualizar el texto del indicador según la cantidad
    if (pendingEventsCount > 9) {
      indicator.textContent = "9+";
    } else if (pendingEventsCount > 0) {
      indicator.textContent = pendingEventsCount;
    } else {
      indicator.textContent = "";
    }
  } else {
    // Ocultar el indicador
    indicator.style.display = "none";
  }
}

// Función pública para forzar la activación del indicador desde fuera
export function forceShowExportIndicator() {
  // Activar inmediatamente
  const indicator = document.getElementById("export-indicator");
  if (indicator) {
    indicator.style.display = "flex";
    indicator.textContent = "";
  }

  // Actualizamos el contador
  pendingEventsCount = 1;

  return true;
}

// ===== FUNCIONES DE EXPORTACIÓN E IMPORTACIÓN =====

// Función para exportar eventos a Google Calendar
export function exportEventsToGoogleCalendar() {
  try {
    const user = getCurrentUser();
    if (!user) {
      showErrorToast("Debes iniciar sesión para exportar eventos");
      return;
    }

    // Mostrar opciones de exportación
    showExportOptionsModal((option) => {
      const isRecent = option === "recent";

      showInfoToast("Preparando exportación a Google Calendar...");

      // Obtener eventos
      getEventsToExport(user.uid, isRecent)
        .then((events) => {
          if (events.length === 0) {
            showInfoToast("No hay eventos para exportar");
            return;
          }

          // Crear archivo ICS
          const icsContent = generateICSFile(events);
          const timestamp = new Date().toISOString().split("T")[0];
          const filename = isRecent
            ? `eventos_nuevos_${timestamp}.ics`
            : `todos_eventos_${timestamp}.ics`;

          // Descargar archivo
          downloadICSFile(icsContent, filename);

          // Mostrar mensaje de éxito
          showSuccessToast(
            `${events.length} eventos exportados. Abre el archivo descargado para importarlos en Google Calendar.`
          );

          // Marcar eventos como exportados
          markEventsAsExported(events).then(() => {
            // Verificar eventos pendientes después de la exportación
            setTimeout(() => {
              checkPendingExportEvents();
            }, 1000);
          });
        })
        .catch((error) => {
          showErrorToast("Error al preparar eventos para Google Calendar");
        });
    });
  } catch (error) {
    showErrorToast("Error al exportar eventos a Google Calendar");
  }
}

// Función para importar eventos de Google Calendar
export function importEventsFromGoogleCalendar() {
  // Mostrar instrucciones
  const message = `
    Para importar eventos desde Google Calendar:
    
    1. Ve a Google Calendar (calendar.google.com)
    2. Haz clic en los 3 puntos junto al calendario que quieres exportar
    3. Selecciona "Configuración y compartir"
    4. Desplázate hasta "Exportar calendario" y haz clic en "Exportar"
    5. Descarga el archivo .ics
  `;

  createImportInstructionsModal(message);

  // Abrir Google Calendar en una nueva pestaña
  window.open("https://calendar.google.com/calendar/", "_blank");
}

// ===== FUNCIONES AUXILIARES =====

// Función para obtener eventos a exportar con manejo más robusto de permisos
async function getEventsToExport(userId, onlyRecent = false) {
  try {
    let events = [];

    // 1. Obtener eventos personales del usuario
    try {
      const eventosRef = collection(db, "eventos");
      const q = query(eventosRef, where("userId", "==", userId));
      const snapshot = await getDocs(q);

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (
          !onlyRecent ||
          !data.exportedByUsers ||
          !data.exportedByUsers.includes(userId)
        ) {
          events.push({
            id: doc.id,
            collection: "eventos",
            title: data.evento,
            description: `Evento: ${data.evento}\nOperación: ${
              data.operacion ? "Sí" : "No"
            }\nExportado desde Planilla de Eventos`,
            start: `${data.fecha}T${data.horaEntrada}:00`,
            end: `${data.fecha}T${data.horaSalida}:00`,
            isFullDay: false,
            isOperation: data.operacion,
          });
        }
      });
    } catch (error) {}

    // 2. Obtener eventos próximos (compartidos) - Restauramos la lectura
    try {
      const proximosEventosRef = collection(db, "proximosEventos");
      const proximosSnapshot = await getDocs(proximosEventosRef);

      for (const docSnapshot of proximosSnapshot.docs) {
        const data = docSnapshot.data();
        const eventoId = docSnapshot.id;

        if (
          onlyRecent &&
          data.exportedByUsers &&
          data.exportedByUsers.includes(userId)
        ) {
          continue;
        }

        events.push({
          id: eventoId,
          collection: "proximosEventos",
          title: data.nombre,
          description:
            data.descripcion || "Evento próximo desde Planilla de Eventos",
          start: data.fechaInicio,
          end: data.fechaFin || data.fechaInicio,
          isFullDay: true,
          userId: userId,
        });
      }
    } catch (error) {}

    return events;
  } catch (error) {
    return [];
  }
}

// ===== Función para marcar eventos como exportados =====
async function markEventsAsExported(events) {
  try {
    const user = getCurrentUser();
    if (!user) return false;

    const updatePromises = [];

    for (const event of events) {
      // Usamos la función auxiliar que maneja automáticamente los permisos
      if (event.collection === "eventos") {
        // Para eventos personales
        updatePromises.push(
          addUserToExportedByUsers("eventos", event.id, user.uid)
        );
      } else if (event.collection === "proximosEventos") {
        // Para eventos compartidos
        updatePromises.push(
          addUserToExportedByUsers("proximosEventos", event.id, user.uid)
        );
      }
    }

    await Promise.all(updatePromises);

    // Actualizar indicador
    pendingEventsCount = 0;
    updateExportIndicator();

    return true;
  } catch (error) {
    // A pesar del error, intentamos actualizar el indicador
    setTimeout(() => {
      checkPendingExportEvents();
    }, 500);
    return false;
  }
}

// Función auxiliar para verificar si un usuario es administrador
async function checkUserIsAdmin(uid) {
  try {
    const userRef = doc(db, "users", uid);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists() && userDoc.data().role === "admin") {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Función para generar archivo ICS
function generateICSFile(events) {
  // Cabecera ICS
  let icsContent =
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Planilla Eventos//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ].join("\r\n") + "\r\n";

  // Añadir cada evento
  events.forEach((event) => {
    const uid = `${event.id.replace(/[^a-z0-9]/gi, "")}@planillaEventos.com`;
    const now = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+/g, "");

    // Inicio del evento
    icsContent += "BEGIN:VEVENT\r\n";

    // Propiedades básicas
    icsContent += `UID:${uid}\r\n`;
    icsContent += `DTSTAMP:${now}\r\n`;

    // Título y descripción
    icsContent += `SUMMARY:${event.title}\r\n`;
    if (event.description) {
      const formattedDescription = event.description
        .replace(/\n/g, "\\n")
        .replace(/(.{70})/g, "$1\r\n ");
      icsContent += `DESCRIPTION:${formattedDescription}\r\n`;
    }

    // Fechas
    if (event.isFullDay) {
      const startDate = new Date(event.start)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");
      let endDate = new Date(event.end);
      endDate.setDate(endDate.getDate() + 1);
      const formattedEndDate = endDate
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");

      icsContent += `DTSTART;VALUE=DATE:${startDate}\r\n`;
      icsContent += `DTEND;VALUE=DATE:${formattedEndDate}\r\n`;
    } else {
      const startDateTime = new Date(event.start)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+/g, "");
      const endDateTime = new Date(event.end)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+/g, "");

      icsContent += `DTSTART:${startDateTime}\r\n`;
      icsContent += `DTEND:${endDateTime}\r\n`;
    }

    // Categoría
    if (event.isOperation) {
      icsContent += "CATEGORIES:Operación\r\n";
    }

    // Fin del evento
    icsContent += "END:VEVENT\r\n";
  });

  // Cierre del archivo
  icsContent += "END:VCALENDAR";

  return icsContent;
}

// Función para descargar archivo ICS
function downloadICSFile(content, filename) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ===== COMPONENTES DE UI =====

// Modal de opciones de exportación
function showExportOptionsModal(callback) {
  // Crear el modal
  const modal = document.createElement("div");
  modal.id = "export-options-modal";
  modal.classList.add(
    "fixed",
    "inset-0",
    "bg-gray-800",
    "bg-opacity-75",
    "flex",
    "items-center",
    "justify-center",
    "z-50"
  );

  const modalContent = document.createElement("div");
  modalContent.classList.add(
    "bg-white",
    "dark:bg-gray-800",
    "p-6",
    "rounded-lg",
    "shadow",
    "max-w-md",
    "w-full"
  );

  // Título y descripción
  const title = document.createElement("h3");
  title.textContent = "Opciones de Exportación";
  title.classList.add(
    "text-xl",
    "font-semibold",
    "mb-4",
    "dark:text-white",
    "text-center"
  );

  const description = document.createElement("p");
  description.textContent =
    "Selecciona qué eventos deseas exportar a Google Calendar:";
  description.classList.add("mb-4", "text-gray-700", "dark:text-gray-300");

  // Contenedor de opciones
  const optionsContainer = document.createElement("div");
  optionsContainer.classList.add("space-y-4");

  // Botón 1: Exportar todos
  const allEventsBtn = document.createElement("button");
  allEventsBtn.textContent = "Exportar todos los eventos";
  allEventsBtn.classList.add(
    "w-full",
    "bg-blue-500",
    "hover:bg-blue-700",
    "text-white",
    "py-3",
    "px-4",
    "rounded",
    "transition-colors",
    "flex",
    "items-center",
    "justify-center"
  );
  allEventsBtn.onclick = () => {
    document.body.removeChild(modal);
    callback("all");
  };

  // Botón 2: Exportar recientes
  const recentEventsBtn = document.createElement("button");
  recentEventsBtn.textContent = "Exportar solo eventos nuevos";
  recentEventsBtn.classList.add(
    "w-full",
    "bg-green-500",
    "hover:bg-green-700",
    "text-white",
    "py-3",
    "px-4",
    "rounded",
    "transition-colors",
    "flex",
    "items-center",
    "justify-center"
  );
  recentEventsBtn.onclick = () => {
    document.body.removeChild(modal);
    callback("recent");
  };

  // Botón de cancelar
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancelar";
  cancelBtn.classList.add(
    "w-full",
    "bg-gray-300",
    "hover:bg-gray-400",
    "text-gray-800",
    "py-2",
    "px-4",
    "rounded",
    "transition-colors",
    "mt-2"
  );
  cancelBtn.onclick = () => {
    document.body.removeChild(modal);
  };

  // Montar el modal
  optionsContainer.appendChild(allEventsBtn);
  optionsContainer.appendChild(recentEventsBtn);
  optionsContainer.appendChild(cancelBtn);

  modalContent.appendChild(title);
  modalContent.appendChild(description);
  modalContent.appendChild(optionsContainer);

  modal.appendChild(modalContent);
  document.body.appendChild(modal);
}

// Modal de instrucciones de importación
function createImportInstructionsModal(message) {
  // Verificar si ya existe
  let modal = document.getElementById("import-instructions-modal");
  if (modal) {
    modal.style.display = "flex";
    return;
  }

  // Crear el modal
  modal = document.createElement("div");
  modal.id = "import-instructions-modal";
  modal.classList.add(
    "fixed",
    "inset-0",
    "bg-gray-800",
    "bg-opacity-75",
    "flex",
    "items-center",
    "justify-center",
    "z-50"
  );

  const modalContent = document.createElement("div");
  modalContent.classList.add(
    "bg-white",
    "dark:bg-gray-800",
    "p-6",
    "rounded-lg",
    "shadow",
    "max-w-lg",
    "w-full",
    "relative"
  );

  // Botón de cerrar
  const closeButton = document.createElement("button");
  closeButton.innerHTML = "&times;";
  closeButton.classList.add(
    "absolute",
    "top-2",
    "right-2",
    "text-2xl",
    "text-gray-600",
    "hover:text-gray-900",
    "dark:text-gray-400",
    "dark:hover:text-gray-200",
    "focus:outline-none"
  );
  closeButton.onclick = () => document.body.removeChild(modal);

  // Título y contenido
  const title = document.createElement("h3");
  title.textContent = "Importar desde Google Calendar";
  title.classList.add("text-xl", "font-semibold", "mb-4", "dark:text-white");

  const content = document.createElement("div");
  content.classList.add(
    "space-y-4",
    "text-gray-700",
    "dark:text-gray-300",
    "whitespace-pre-line"
  );
  content.textContent = message;

  // Botón para ir a Google Calendar
  const goToCalendarButton = document.createElement("button");
  goToCalendarButton.textContent = "Ir a Google Calendar";
  goToCalendarButton.classList.add(
    "mt-4",
    "bg-blue-500",
    "hover:bg-blue-700",
    "text-white",
    "py-2",
    "px-4",
    "rounded",
    "transition-colors"
  );
  goToCalendarButton.onclick = () => {
    window.open("https://calendar.google.com/calendar/", "_blank");
  };

  // Montar el modal
  modalContent.appendChild(closeButton);
  modalContent.appendChild(title);
  modalContent.appendChild(content);
  modalContent.appendChild(goToCalendarButton);
  modal.appendChild(modalContent);

  document.body.appendChild(modal);
}
