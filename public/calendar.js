// Cargar módulos ESM de FullCalendar vía Skypack para evitar errores 404
import { Calendar } from "https://cdn.skypack.dev/@fullcalendar/core@6.1.17";
import dayGridPlugin from "https://cdn.skypack.dev/@fullcalendar/daygrid@6.1.17";
import interactionPlugin from "https://cdn.skypack.dev/@fullcalendar/interaction@6.1.17";

// Import Firestore services and config
import { db } from "./firebase.config.js"; // Use consistent db import
import {
  collection,
  getDocs,
  query,
  onSnapshot, // Añadir importación de onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"; // Use consistent v11 SDK
import {
  listenToEvents,
  addEvent,
  updateEvent,
  deleteEvent,
  deleteProximoEvento,
  isUserAdmin,
  updateProximoEvento,
} from "./firestoreService.js";
import { getCurrentUser, COLLECTIONS, setCurrentUser } from "./config.js";
import { showErrorToast } from "./notifications.js";
// Importar el servicio de tema
import { initializeTheme, toggleTheme } from "./themeService.js";
// Importar el servicio de autenticación
import { setupAuthListener } from "./authService.js";

document.addEventListener("DOMContentLoaded", async () => {
  const calendarEl = document.getElementById("calendar");
  const loginPrompt = document.getElementById("calendar-login-prompt");
  const calendarContainer = document.getElementById("calendar-container");
  const mainContent = document.getElementById("main-content");
  const userEmailSpan = document.getElementById("user-email");
  const logoutButton = document.getElementById("logout-button");
  const themeToggle = document.getElementById("theme-toggle");
  const loadingIndicator = document.getElementById("loading-indicator");

  // Mostrar el indicador de carga al inicio
  if (loadingIndicator) {
    loadingIndicator.style.display = "flex";
  }

  if (!calendarEl) {
    // Ocultar el indicador de carga si hay un error
    if (loadingIndicator) {
      loadingIndicator.style.display = "none";
    }
    return;
  }

  // Inicializar el tema de la aplicación
  initializeTheme();

  // Configurar el botón de tema oscuro/claro
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  // Configurar el botón de logout
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        const { signOut } = await import("./authService.js");
        await signOut();
        window.location.href = "login.html";
      } catch (error) {
        showErrorToast("Error al cerrar sesión.");
      }
    });
  }

  // Initialize calendar instance but don't render or load data yet
  const calendar = new Calendar(calendarEl, {
    plugins: [dayGridPlugin, interactionPlugin],
    initialView: "dayGridMonth",
    locale: "es",
    // Keep dateClick and eventClick options
    dateClick: handleDateClick,
    eventClick: handleEventClick,
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,dayGridWeek",
    },
    height: "auto", // Altura automática para mejor visualización
  });

  // Modal and form handling elements
  const modal = document.getElementById("event-modal");
  const form = document.getElementById("event-form");
  const modalTitle = document.getElementById("modal-title");
  const submitBtn = document.getElementById("modal-submit");
  const cancelBtn = document.getElementById("modal-cancel");

  // --- Modal/Form Logic (extracted to functions for clarity) ---
  function handleDateClick(info) {
    form.reset();
    delete form.dataset.editingEventId;
    modalTitle.textContent = "Nuevo Evento";
    submitBtn.textContent = "Guardar";
    cancelBtn.style.display = "none";
    // Ocultar el botón de eliminar al crear un nuevo evento
    const deleteBtn = document.getElementById("modal-delete");
    if (deleteBtn) deleteBtn.style.display = "none";
    document.getElementById("modal-fecha").value = info.dateStr;
    modal.classList.remove("hidden");
  }

  async function handleEventClick(info) {
    const user = getCurrentUser();
    if (!user) return;

    // Si es un evento próximo (próximos eventos)
    if (info.event.id.startsWith("proximo_")) {
      // Verificar si el usuario es administrador
      const isAdmin = await isUserAdmin(user.uid);

      if (isAdmin) {
        // Los administradores pueden editar o eliminar eventos próximos
        const proximoEventId = info.event.id.replace("proximo_", "");
        const eventData = info.event.extendedProps;

        // Mostrar modal para editar el evento próximo
        showProximoEventoModal(proximoEventId, eventData);
      } else {
        //   "Solo los administradores pueden modificar los eventos próximos."
        // );
      }
      return;
    }

    // Lógica original para eventos normales (editables)
    const d = info.event.extendedProps;
    form.reset();
    form.dataset.editingEventId = info.event.id;
    modalTitle.textContent = "Editar Evento";
    submitBtn.textContent = "Guardar Cambios";
    cancelBtn.style.display = "inline-block"; // Show cancel button when editing

    // Mostrar el botón de eliminar al editar un evento existente
    const deleteBtn = document.getElementById("modal-delete");
    if (deleteBtn) deleteBtn.style.display = "inline-block";

    document.getElementById("modal-evento").value = d.evento;
    document.getElementById("modal-fecha").value = d.fecha;
    document.getElementById("modal-hora-entrada").value = d.horaEntrada;
    document.getElementById("modal-hora-salida").value = d.horaSalida;
    document.getElementById("modal-operacion").checked = d.operacion;
    modal.classList.remove("hidden");
  }

  // Close modal on cancel button click
  cancelBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
    form.reset();
    delete form.dataset.editingEventId;
  });

  // Agregar event listener para el botón de eliminar
  const deleteBtn = document.getElementById("modal-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const eventId = form.dataset.editingEventId;
      if (eventId) {
        await deleteEvent(eventId); // Llama a la función de firestoreService
        modal.classList.add("hidden");
        form.reset();
        delete form.dataset.editingEventId;
      }
    });
  }

  // Add listener to close modal when clicking the overlay background
  modal.addEventListener("click", (e) => {
    // Check if the click is directly on the modal background (event-modal)
    if (e.target === modal) {
      modal.classList.add("hidden");
      form.reset();
      delete form.dataset.editingEventId;
    }
  });

  // Handle form submit for add/update
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Assuming addEvent handles both add/update based on form.dataset.editingEventId
    // It should also handle fetching the user ID itself if needed.
    await addEvent(form);
    modal.classList.add("hidden");
  });

  // --- Calendar Initialization and Data Loading ---
  let stopListenToEvents = null; // To store the unsubscribe function

  async function initializeCalendar(user) {
    if (!user) {
      showLoginPrompt();
      return;
    }

    // Actualizar UI para mostrar que el usuario está autenticado
    if (userEmailSpan && user.email) {
      userEmailSpan.textContent = user.email;
    }

    if (loginPrompt) loginPrompt.style.display = "none";
    if (mainContent) mainContent.style.display = "block";
    if (calendarContainer) calendarContainer.style.display = "block";

    calendar.render(); // Render the calendar structure

    try {
      // Variable para almacenar la función de cancelación del listener de eventos próximos
      let unsubscribeProximosEventos = null;

      // Modificar la función para usar onSnapshot en lugar de getDocs
      function setupProximosEventosListener() {
        try {
          const proximosEventosRef = collection(
            db,
            COLLECTIONS.PROXIMOS_EVENTOS || "proximosEventos"
          );
          const q = query(proximosEventosRef);

          // Usar onSnapshot para recibir actualizaciones en tiempo real
          unsubscribeProximosEventos = onSnapshot(
            q,
            (snapshot) => {
              // Primero eliminar todos los eventos próximos existentes
              const currentEvents = calendar.getEvents();
              currentEvents.forEach((event) => {
                if (event.id.startsWith("proximo_")) {
                  event.remove();
                }
              });

              // Luego agregar los eventos próximos actualizados
              snapshot.forEach((doc) => {
                const d = doc.data();
                calendar.addEvent({
                  id: `proximo_${doc.id}`,
                  title: d.nombre,
                  start: d.fechaInicio, // Usar fecha de inicio
                  end: d.fechaFin
                    ? new Date(
                        new Date(d.fechaFin).setDate(
                          new Date(d.fechaFin).getDate() + 1
                        )
                      )
                        .toISOString()
                        .split("T")[0]
                    : null, // Agregar 1 día para que el evento incluya el día de fin
                  allDay: true,
                  color: "#28a745", // Verde
                  extendedProps: d,
                });
              });

              // Ocultar el indicador de carga después de cargar los datos de eventos próximos
              if (loadingIndicator) {
                loadingIndicator.style.display = "none";
              }
            },
            (error) => {
              showErrorToast("Error al monitorear eventos próximos.");

              // Ocultar el indicador de carga en caso de error
              if (loadingIndicator) {
                loadingIndicator.style.display = "none";
              }
            }
          );
        } catch (error) {
          //   "Error configurando listener de eventos próximos:",
          //   error
          // );
          showErrorToast("Error al configurar monitoreo de eventos próximos.");

          // Ocultar el indicador de carga en caso de error
          if (loadingIndicator) {
            loadingIndicator.style.display = "none";
          }
        }
      }

      // Listen for user's regular events and store the unsubscribe function
      stopListenToEvents = listenToEvents(user.uid, (docs) => {
        // Solo eliminar eventos regulares, no los próximos
        const currentEvents = calendar.getEvents();
        currentEvents.forEach((event) => {
          if (!event.id.startsWith("proximo_")) {
            event.remove();
          }
        });

        docs.forEach((d) => {
          calendar.addEvent({
            id: d.id,
            title: d.evento,
            start: `${d.fecha}T${d.horaEntrada}`,
            end: `${d.fecha}T${d.horaSalida}`,
            extendedProps: d,
          });
        });

        // Ocultar el indicador de carga después de cargar los datos de eventos regulares
        if (loadingIndicator) {
          loadingIndicator.style.display = "none";
        }
      });

      // Configurar el listener para eventos próximos
      setupProximosEventosListener();

      // Actualizar la función showLoginPrompt para cancelar también el listener de eventos próximos
      const originalShowLoginPrompt = showLoginPrompt;
      showLoginPrompt = function () {
        if (calendarContainer) calendarContainer.style.display = "none";
        if (mainContent) mainContent.style.display = "none";
        if (loginPrompt) loginPrompt.style.display = "block";
        calendar.removeAllEvents(); // Limpiar todos los eventos

        // Cancelar los listeners
        if (stopListenToEvents) {
          stopListenToEvents();
          stopListenToEvents = null;
        }

        if (unsubscribeProximosEventos) {
          unsubscribeProximosEventos();
          unsubscribeProximosEventos = null;
        }

        // Ocultar el indicador de carga
        if (loadingIndicator) {
          loadingIndicator.style.display = "none";
        }
      };
    } catch (error) {
      // Asegurarse de ocultar el indicador de carga si hay un error
      if (loadingIndicator) {
        loadingIndicator.style.display = "none";
      }
      showErrorToast("Error al inicializar el calendario");
    }
  }

  function showLoginPrompt() {
    if (calendarContainer) calendarContainer.style.display = "none";
    if (mainContent) mainContent.style.display = "none";
    if (loginPrompt) loginPrompt.style.display = "block";
    calendar.removeAllEvents(); // Clear any stale events
    if (stopListenToEvents) {
      stopListenToEvents(); // Unsubscribe from Firestore listener
      stopListenToEvents = null;
    }

    // Ocultar el indicador de carga
    if (loadingIndicator) {
      loadingIndicator.style.display = "none";
    }
  }

  // --- Auth Initialization ---
  try {
    // Configurar un listener de autenticación para esta página
    setupAuthListener((user) => {
      if (user) {
        initializeCalendar(user);
      } else {
        showLoginPrompt();
      }
    });

    // --- Initial Check ---
    // Check if user is already available when DOM loads (might happen on page refresh)
    const initialUser = getCurrentUser();
    if (initialUser) {
      // Sincronizar explícitamente con config.js para asegurar que el estado sea consistente
      setCurrentUser(initialUser);
      initializeCalendar(initialUser);
    } else {
      //   "User not available on DOMContentLoaded, waiting for authReady event..."
      // );
      showLoginPrompt(); // Show login prompt initially
    }
  } catch (error) {
    // Asegurarse de ocultar el indicador de carga si hay un error
    if (loadingIndicator) {
      loadingIndicator.style.display = "none";
    }
    showErrorToast("Error al configurar la autenticación");
  }

  // Manejar el botón de volver según la página de origen
  const backButton = document.getElementById("back-button");
  if (backButton) {
    // Verificar si venimos de la página de administrador
    const referer = document.referrer;
    if (referer && referer.includes("admin.html")) {
      backButton.href = "admin.html";
    } else {
      // Mantener el comportamiento por defecto (index.html)
    }

    // Alternativa: usar localStorage para recordar la página de origen
    const fromAdmin = localStorage.getItem("from_admin_page");
    if (fromAdmin === "true") {
      backButton.href = "admin.html";
      localStorage.removeItem("from_admin_page"); // Limpiar después de usar
      //   "El botón Volver redirigirá a admin.html (desde localStorage)"
      // );
    }
  }
});

// Función para mostrar el modal de edición de próximos eventos
function showProximoEventoModal(proximoEventId, eventData) {
  const proximoEventoModal = document.getElementById("proximo-evento-modal");
  const proximoEventoForm = document.getElementById("proximo-evento-form");

  // Llenar los campos del formulario con los datos del evento
  document.getElementById("proximo-evento-id").value = proximoEventId;
  document.getElementById("proximo-evento-nombre").value =
    eventData.nombre || "";
  document.getElementById("proximo-evento-fecha-inicio").value =
    eventData.fechaInicio || "";
  document.getElementById("proximo-evento-fecha-fin").value =
    eventData.fechaFin || "";
  document.getElementById("proximo-evento-descripcion").value =
    eventData.descripcion || "";

  // Mostrar el modal
  proximoEventoModal.classList.remove("hidden");
}

// Configurar listeners para el modal de próximos eventos
const proximoEventoModal = document.getElementById("proximo-evento-modal");
const proximoEventoForm = document.getElementById("proximo-evento-form");
const proximoEventoCancelBtn = document.getElementById("proximo-evento-cancel");
const proximoEventoDeleteBtn = document.getElementById("proximo-evento-delete");

// Event listener para cerrar el modal al hacer clic en Cancelar
if (proximoEventoCancelBtn) {
  proximoEventoCancelBtn.addEventListener("click", () => {
    proximoEventoModal.classList.add("hidden");
    proximoEventoForm.reset();
  });
}

// Event listener para eliminar el evento próximo
if (proximoEventoDeleteBtn) {
  proximoEventoDeleteBtn.addEventListener("click", async () => {
    const proximoEventId = document.getElementById("proximo-evento-id").value;
    if (proximoEventId) {
      const resultado = await deleteProximoEvento(proximoEventId);
      if (resultado) {
        proximoEventoModal.classList.add("hidden");
        proximoEventoForm.reset();
      }
    }
  });
}

// Event listener para el envío del formulario de edición de próximos eventos
if (proximoEventoForm) {
  proximoEventoForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const proximoEventId = document.getElementById("proximo-evento-id").value;
    const nombre = document.getElementById("proximo-evento-nombre").value;
    const fechaInicio = document.getElementById(
      "proximo-evento-fecha-inicio"
    ).value;
    const fechaFin = document.getElementById("proximo-evento-fecha-fin").value;
    const descripcion = document.getElementById(
      "proximo-evento-descripcion"
    ).value;

    // Validar campos requeridos
    if (!nombre || !fechaInicio) {
      showErrorToast("Por favor, completa los campos requeridos");
      return;
    }

    // Actualizar el evento próximo
    const resultado = await updateProximoEvento(
      proximoEventId,
      nombre,
      fechaInicio,
      fechaFin,
      descripcion
    );

    if (resultado) {
      proximoEventoModal.classList.add("hidden");
      proximoEventoForm.reset();
    }
  });
}

// Event listener para cerrar el modal cuando se hace clic fuera del formulario
if (proximoEventoModal) {
  proximoEventoModal.addEventListener("click", (e) => {
    if (e.target === proximoEventoModal) {
      proximoEventoModal.classList.add("hidden");
      proximoEventoForm.reset();
    }
  });
}
