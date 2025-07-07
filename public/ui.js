import {
  deleteEvent,
  deleteGasto,
  listenToEvents,
  listenToExpenses,
  loadUserPreferences,
  stopFirestoreListeners,
  loadNextEventsPage,
  loadPrevEventsPage,
  loadNextExpensesPage,
  loadPrevExpensesPage,
  getEventsTotalCount,
  getExpensesTotalCount,
  getEventsTotalAmount,
  getExpensesTotalAmount, // Ensure this is exported from firestoreService.js and imported here
  updateEvent,
  getEventById,
  listenToTarifasChanges,
  loadTarifas,
  resetEventPagination, // Added
  resetExpensePagination, // Added
} from "./firestoreService.js?v=20250623-fix-cache";
import { calcularPagoEvento } from "./calculations.js";
import { showInfoToast, showToastWithAction } from "./notifications.js";
import { getCurrentUser } from "./config.js";
import { checkFirestoreConnection } from "./firebase.config.js";

// Store data received from Firestore listeners
let allUserEvents = [];
let allUserExpenses = [];

// Pagination state
let currentEventsPage = 1;
let currentExpensesPage = 1;
let eventsHasNextPage = false;
let eventsHasPrevPage = false;
let expensesHasNextPage = false;
let expensesHasPrevPage = false;

// Store references to filter elements
let filterMonthSelect = null;
let filterYearSelect = null;
let filtroNombreEvento = null;
let filtroFechaInicio = null;
let filtroFechaFin = null;

// Store references to total display elements
let displaySueldo;
let displayEventos;
let displayGastos;
let totalFinalContainer;
let totalPagoContainer;
let totalHorasExtraContainer;
let totalGastosContainer;

// Store accumulated totals for the currently displayed (filtered) data
let totalPagoAcumuladoGlobal = 0;
let totalGastosAcumuladoGlobal = 0;
let totalHorasExtraAcumuladoGlobal = 0;

// Vamos a guardar el estado de los filtros para poder reaplicarlos después de operaciones
let lastAppliedFilters = {
  month: -1,
  year: -1,
  nombreEvento: "",
  fechaInicio: "",
  fechaFin: "",
};

// --- Initialization ---

export function initializeUI() {
  // Get references to frequently used DOM elements
  filterMonthSelect = document.getElementById("filter-month");
  filterYearSelect = document.getElementById("filter-year");
  filtroNombreEvento = document.getElementById("filtro-nombre-evento");
  filtroFechaInicio = document.getElementById("filtro-fecha-inicio");
  filtroFechaFin = document.getElementById("filtro-fecha-fin");

  // Resto de inicializaciones...
  displaySueldo = document.getElementById("display-sueldo");
  displayEventos = document.getElementById("display-eventos");
  displayGastos = document.getElementById("display-gastos");
  totalFinalContainer = document.getElementById("total-final");
  totalPagoContainer = document.getElementById("total-pago");
  totalHorasExtraContainer = document.getElementById("total-horas-extra");
  totalGastosContainer = document.getElementById("total-gastos");

  populateYearFilter();
  applyTheme(); // Apply initial theme

  // Asegurarse de que los listeners de eventos para los filtros estén configurados
  setupFilterEventListeners();
}

// Función para configurar los listeners de eventos para los filtros
function setupFilterEventListeners() {
  // Aplicar filtros cuando cambien los valores del mes o año
  if (filterMonthSelect) {
    filterMonthSelect.addEventListener("change", applyFilters);
  }

  if (filterYearSelect) {
    filterYearSelect.addEventListener("change", applyFilters);
  }

  // Aplicar filtros cuando se escriba en el campo de nombre del evento (con debounce)
  if (filtroNombreEvento) {
    let debounceTimeout;
    filtroNombreEvento.addEventListener("input", function () {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(applyFilters, 300); // Esperar 300ms después de la última pulsación
    });
  }

  // Aplicar filtros cuando cambien las fechas de inicio y fin
  if (filtroFechaInicio) {
    filtroFechaInicio.addEventListener("change", applyFilters);
  }

  if (filtroFechaFin) {
    filtroFechaFin.addEventListener("change", applyFilters);
  }
}

// --- Data Loading Orchestration ---

export async function loadUserData(userId, retryCount = 0, maxRetries = 3) {
  // Verificar la conectividad a Firestore antes de intentar cargar datos
  try {
    const isConnected = await checkFirestoreConnection();

    if (!isConnected) {
      console.warn(
        "No hay conexión a Firestore. Intentando cargar datos desde caché local."
      );
      showToastWithAction(
        "Sin conexión a Internet. Se están mostrando datos almacenados localmente.",
        "Reintentar",
        () => loadUserData(userId, 0, maxRetries)
      );

      // Intentar cargar datos de localStorage si están disponibles
      tryLoadFromLocalStorage();

      // Devolver una promesa resuelta para que la aplicación pueda continuar
      return Promise.resolve();
    }

    // Iniciar el listener para cambios en las tarifas
    // Esto asegura que cuando las tarifas se actualicen en Firestore,
    // la aplicación se actualizará automáticamente
    listenToTarifasChanges();

    // Si hay conexión, procedemos normalmente con la carga de datos
    return Promise.all([
      // Wrapeamos con Promise.resolve para asegurar que devuelvan promesas
      Promise.resolve(
        listenToEvents(userId, updateEventsUIWithClientFilter, {})
      ), // Pass empty filters initially
      Promise.resolve(listenToExpenses(userId, updateExpensesUI, {})), // Pass empty filters initially
      Promise.resolve(loadUserPreferences(userId)), // Load fixed salary
      Promise.resolve(loadTarifas()), // Cargar tarifas iniciales
      // Load totals for summary display (not affected by pagination)
      Promise.resolve(loadDataTotals(userId)), // Aseguramos que esta también sea una promesa
    ])
      .then((results) => {
        // Almacenar en localStorage para uso offline
        saveDataToLocalStorage();
        return results;
      })
      .catch((error) => {
        console.error(
          `Error en loadUserData (intento ${retryCount + 1}/${
            maxRetries + 1
          }):`,
          error
        );

        if (retryCount < maxRetries) {
          // Esperamos un tiempo creciente antes de reintentar (backoff exponencial)
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);

          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(loadUserData(userId, retryCount + 1, maxRetries));
            }, retryDelay);
          });
        }

        // Si llegamos aquí, hemos agotado todos los reintentos
        // Intentar cargar desde localStorage como último recurso

        const loadedFromCache = tryLoadFromLocalStorage();

        if (!loadedFromCache) {
          throw error; // Re-lanzamos el error para que se maneje en el catch de main.js
        } else {
          return Promise.resolve(); // Resolvemos la promesa si pudimos cargar desde caché
        }
      });
  } catch (error) {
    console.error("Error al verificar la conexión o cargar datos:", error);
    const loadedFromCache = tryLoadFromLocalStorage();

    if (!loadedFromCache) {
      throw error; // Re-lanzamos el error si no pudimos cargar desde caché
    } else {
      return Promise.resolve(); // Resolvemos la promesa si pudimos cargar desde caché
    }
  }
}

// Función para intentar cargar datos desde localStorage
function tryLoadFromLocalStorage() {
  try {
    // Intentar cargar datos de eventos
    const cachedEvents = localStorage.getItem("cachedEvents");
    if (cachedEvents) {
      const events = JSON.parse(cachedEvents);
      updateEventsUIWithClientFilter(events, {
        hasNextPage: false,
        hasPrevPage: false,
      });
    }

    // Intentar cargar datos de gastos
    const cachedExpenses = localStorage.getItem("cachedExpenses");
    if (cachedExpenses) {
      const expenses = JSON.parse(cachedExpenses);
      updateExpensesUI(expenses, { hasNextPage: false, hasPrevPage: false });
    }

    // Intentar cargar sueldo fijo
    const cachedSalary = localStorage.getItem("cachedSalary");
    if (cachedSalary) {
      loadUserPreferencesUI(parseFloat(cachedSalary));
    }

    return cachedEvents || cachedExpenses || cachedSalary;
  } catch (error) {
    console.error("Error al cargar datos desde localStorage:", error);
    return false;
  }
}

// Función para guardar datos en localStorage para uso offline
function saveDataToLocalStorage() {
  try {
    // Guardar eventos en localStorage
    if (allUserEvents && allUserEvents.length > 0) {
      localStorage.setItem("cachedEvents", JSON.stringify(allUserEvents));
    }

    // Guardar gastos en localStorage
    if (allUserExpenses && allUserExpenses.length > 0) {
      localStorage.setItem("cachedExpenses", JSON.stringify(allUserExpenses));
    }

    // Guardar sueldo fijo
    const sueldoFijoInput = document.getElementById("sueldo-fijo");
    if (sueldoFijoInput && sueldoFijoInput.value) {
      localStorage.setItem("cachedSalary", sueldoFijoInput.value);
    }

    // Guardar la fecha de la última sincronización
    localStorage.setItem("lastSyncTime", new Date().toISOString());
  } catch (error) {
    console.error("Error al guardar datos en localStorage:", error);
  }
}

// Function to load data totals for summary
async function loadDataTotals(userId) {
  try {
    const [eventsTotalAmount, expensesTotalAmount] = await Promise.all([
      getEventsTotalAmount(userId),
      getExpensesTotalAmount(userId),
    ]);

    // Update summary totals display
    if (displayEventos) {
      displayEventos.textContent = "$" + eventsTotalAmount.toLocaleString();
    }
    if (displayGastos) {
      displayGastos.textContent = "$" + expensesTotalAmount.toLocaleString();
    }

    // Recalculate final totals
    const sueldoFijoInput = document.getElementById("sueldo-fijo");
    const fijo = parseFloat(sueldoFijoInput?.value) || 0;
    const finalTotal = fijo + eventsTotalAmount + expensesTotalAmount;

    if (totalFinalContainer) {
      totalFinalContainer.textContent = "$" + finalTotal.toLocaleString();
    }
  } catch (error) {
    console.error("Error loading data totals:", error);
  }
}

// --- UI Update Functions ---

// Renamed from updateEventsUI to updateEventsUIWithClientFilter
export function updateEventsUIWithClientFilter(events, paginationInfo) {
  // *** SOLUCION ANTI-CACHE - FORZAR LIMITE 20 EVENTOS ***
  if (events && events.length > 20) {
    events = events.slice(0, 20);
    // Forzar paginación para mostrar que hay más páginas
    paginationInfo = { hasNextPage: true, hasPrevPage: false };
  }

  try {
    if (!events) {
      console.warn("[DEBUG UI] Events array is null or undefined");
      events = [];
    }

    // FORZAR LÍMITE: Asegurar que nunca se muestren más de 20 eventos
    events = enforceEventLimit(events, 20);

    // For debugging: log the actual event data
    if (events.length > 0) {
    }

    allUserEvents = events; // Store all events fetched for the current page (date-filtered by Firestore)

    eventsHasNextPage = paginationInfo?.hasNextPage || false;
    eventsHasPrevPage = paginationInfo?.hasPrevPage || false;
    updateEventsPaginationControls();

    // Apply client-side filters (nombreEvento, month, year)
    const nombreEventoFilter =
      lastAppliedFilters.nombreEvento?.toLowerCase().trim() || "";
    const selectedMonth = lastAppliedFilters.month;
    const selectedYear = lastAppliedFilters.year;

    let clientFilteredEvents = allUserEvents;

    if (nombreEventoFilter) {
      clientFilteredEvents = clientFilteredEvents.filter(
        (event) =>
          event.evento &&
          event.evento.toLowerCase().includes(nombreEventoFilter)
      );
    }

    if (selectedMonth !== -1 || selectedYear !== -1) {
      clientFilteredEvents = clientFilteredEvents.filter((event) => {
        if (!event.fecha) {
          return false;
        }
        const eventDate = new Date(event.fecha + "T00:00:00"); // Ensure correct date parsing
        const eventMonth = eventDate.getMonth(); // 0-based month (0-11)
        const eventYear = eventDate.getFullYear();

        const matchesMonth =
          selectedMonth === -1 || eventMonth === selectedMonth;
        const matchesYear = selectedYear === -1 || eventYear === selectedYear;

        return matchesMonth && matchesYear;
      });
    }

    renderEvents(clientFilteredEvents);

    // Force a total recalculation for consistency
    setTimeout(() => {
      if (window.recalcTotalFinal) {
        window.recalcTotalFinal();
      }
    }, 100);
  } catch (error) {
    console.error("Error al actualizar la interfaz de eventos:", error);
  }
}

export function updateExpensesUI(expenses, paginationInfo) {
  try {
    if (!expenses) {
      console.warn("[DEBUG UI] Expenses array is null or undefined");
      expenses = [];
    }

    // FORZAR LÍMITE: Asegurar que nunca se muestren más de 20 gastos
    expenses = enforceExpenseLimit(expenses, 20);

    // For debugging: log the actual expense data
    if (expenses.length > 0) {
    }

    allUserExpenses = expenses; // Store all expenses fetched for the current page (date-filtered by Firestore)

    expensesHasNextPage = paginationInfo?.hasNextPage || false;
    expensesHasPrevPage = paginationInfo?.hasPrevPage || false;
    updateExpensesPaginationControls();

    // Apply client-side filters (month, year)
    const selectedMonth = lastAppliedFilters.month;
    const selectedYear = lastAppliedFilters.year;

    let clientFilteredExpenses = allUserExpenses;

    if (selectedMonth !== -1 || selectedYear !== -1) {
      clientFilteredExpenses = clientFilteredExpenses.filter((expense) => {
        if (!expense.fecha) {
          // If no fecha field, try to use createdAt as fallback
          if (expense.createdAt && expense.createdAt.toDate) {
            const fallbackDate = expense.createdAt.toDate();
            const expenseMonth = fallbackDate.getMonth();
            const expenseYear = fallbackDate.getFullYear();

            const matchesMonth =
              selectedMonth === -1 || expenseMonth === selectedMonth;
            const matchesYear =
              selectedYear === -1 || expenseYear === selectedYear;

            return matchesMonth && matchesYear;
          }
          // If no fecha and no createdAt, include it to avoid hiding existing data

          return true;
        }
        const expenseDate = new Date(expense.fecha + "T00:00:00"); // Ensure correct date parsing
        const expenseMonth = expenseDate.getMonth(); // 0-based month (0-11)
        const expenseYear = expenseDate.getFullYear();

        const matchesMonth =
          selectedMonth === -1 || expenseMonth === selectedMonth;
        const matchesYear = selectedYear === -1 || expenseYear === selectedYear;

        return matchesMonth && matchesYear;
      });
    }

    renderGastos(clientFilteredExpenses);

    // Force a total recalculation for consistency
    setTimeout(() => {
      if (window.recalcTotalFinal) {
        window.recalcTotalFinal();
      }
    }, 100);
  } catch (error) {
    console.error("Error al actualizar la interfaz de gastos:", error);
  }
}

// Verifica si hay filtros activos que deberían aplicarse
// This function might not be needed anymore or might need adjustment
// For now, filter application is driven by applyFilters directly calling listeners
// ...existing code...
// Aplica los filtros sin resetear la paginación
// This function is likely no longer needed as applyFilters re-triggers listeners
function applyFiltersWithoutReset() {
  // Obtener fechas como objetos Date si existen
  const fechaInicioObj = lastAppliedFilters.fechaInicio
    ? new Date(`${lastAppliedFilters.fechaInicio}T00:00:00`)
    : null;

  let fechaFinObj = lastAppliedFilters.fechaFin
    ? new Date(`${lastAppliedFilters.fechaFin}T00:00:00`)
    : null;

  if (fechaFinObj) {
    fechaFinObj.setHours(23, 59, 59, 999); // Ajustar para incluir todo el día
  }

  // Filtrar eventos
  const filteredEvents = allUserEvents.filter((event) => {
    if (!event.fecha) return false;

    const eventDate = new Date(`${event.fecha}T00:00:00`);
    const eventMonth = eventDate.getMonth();
    const eventYear = eventDate.getFullYear();

    // Filtrar por mes/año
    const matchesMonthYear =
      (lastAppliedFilters.month === -1 ||
        eventMonth === lastAppliedFilters.month) &&
      (lastAppliedFilters.year === -1 || eventYear === lastAppliedFilters.year);

    // Filtrar por nombre
    const matchesNombre =
      !lastAppliedFilters.nombreEvento ||
      (event.evento &&
        event.evento.toLowerCase().includes(lastAppliedFilters.nombreEvento));

    // Filtrar por fechas
    let matchesFechas = true;
    if (fechaInicioObj) {
      matchesFechas = eventDate >= fechaInicioObj;
    }
    if (fechaFinObj && matchesFechas) {
      matchesFechas = eventDate <= fechaFinObj;
    }

    return matchesMonthYear && matchesNombre && matchesFechas;
  });

  // Filtrar gastos (solo por mes/año)
  const filteredExpenses = allUserExpenses.filter((expense) => {
    if (!expense.fecha) return false;

    const expenseDate = new Date(`${expense.fecha}T00:00:00`);
    const expenseMonth = expenseDate.getMonth();
    const expenseYear = expenseDate.getFullYear();

    return (
      (lastAppliedFilters.month === -1 ||
        expenseMonth === lastAppliedFilters.month) &&
      (lastAppliedFilters.year === -1 ||
        expenseYear === lastAppliedFilters.year)
    );
  });

  // Renderizar los datos filtrados
  renderEvents(filteredEvents);
  renderGastos(filteredExpenses);
}

// Funciones para actualizar los controles de paginación
function updateEventsPaginationControls() {
  const paginationContainer = document.getElementById("events-pagination");
  if (!paginationContainer) return;

  paginationContainer.innerHTML = `
    <div class="flex flex-col sm:flex-row justify-between items-center mt-3 p-2 sm:p-3 bg-gray-50 dark:bg-gray-700 rounded-lg gap-2 sm:gap-0">
      <button id="prev-events-page" class="px-2 py-1 sm:px-3 sm:py-2 text-xs sm:text-sm bg-blue-500 text-white rounded transition-colors ${
        !eventsHasPrevPage
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-blue-600"
      }" ${!eventsHasPrevPage ? "disabled" : ""}>
        ← Anterior
      </button>
      <span class="text-xs sm:text-sm font-medium text-center px-2">Página ${currentEventsPage} - 20 eventos/página</span>
      <button id="next-events-page" class="px-2 py-1 sm:px-3 sm:py-2 text-xs sm:text-sm bg-blue-500 text-white rounded transition-colors ${
        !eventsHasNextPage
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-blue-600"
      }" ${!eventsHasNextPage ? "disabled" : ""}>
        Siguiente →
      </button>
    </div>
  `;

  // Configurar eventos para los botones de paginación
  const prevButton = document.getElementById("prev-events-page");
  const nextButton = document.getElementById("next-events-page");

  if (prevButton) {
    prevButton.addEventListener("click", navigateToPrevEventsPage);
  }

  if (nextButton) {
    nextButton.addEventListener("click", navigateToNextEventsPage);
  }
}

function updateExpensesPaginationControls() {
  const paginationContainer = document.getElementById("expenses-pagination");
  if (!paginationContainer) return;

  paginationContainer.innerHTML = `
    <div class="flex flex-col sm:flex-row justify-between items-center mt-3 p-2 sm:p-3 bg-gray-50 dark:bg-gray-700 rounded-lg gap-2 sm:gap-0">
      <button id="prev-expenses-page" class="px-2 py-1 sm:px-3 sm:py-2 text-xs sm:text-sm bg-green-500 text-white rounded transition-colors ${
        !expensesHasPrevPage
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-green-600"
      }" ${!expensesHasPrevPage ? "disabled" : ""}>
        ← Anterior
      </button>
      <span class="text-xs sm:text-sm font-medium text-center px-2">Página ${currentExpensesPage} - 20 gastos/página</span>
      <button id="next-expenses-page" class="px-2 py-1 sm:px-3 sm:py-2 text-xs sm:text-sm bg-green-500 text-white rounded transition-colors ${
        !expensesHasNextPage
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-green-600"
      }" ${!expensesHasNextPage ? "disabled" : ""}>
        Siguiente →
      </button>
    </div>
  `;

  // Configurar eventos para los botones de paginación
  const prevButton = document.getElementById("prev-expenses-page");
  const nextButton = document.getElementById("next-expenses-page");

  if (prevButton) {
    prevButton.addEventListener("click", navigateToPrevExpensesPage);
  }

  if (nextButton) {
    nextButton.addEventListener("click", navigateToNextExpensesPage);
  }
}

// Funciones para navegar entre páginas
function navigateToNextEventsPage() {
  const currentUser = getCurrentUser();
  if (!currentUser || !eventsHasNextPage) return;

  currentEventsPage++;
  const dateFilters = {
    fechaInicio: lastAppliedFilters.fechaInicio || null,
    fechaFin: lastAppliedFilters.fechaFin || null,
  };
  loadNextEventsPage(
    currentUser.uid,
    updateEventsUIWithClientFilter,
    dateFilters
  );
}

function navigateToPrevEventsPage() {
  const currentUser = getCurrentUser();
  if (!currentUser || !eventsHasPrevPage) return;

  currentEventsPage--;
  const dateFilters = {
    fechaInicio: lastAppliedFilters.fechaInicio || null,
    fechaFin: lastAppliedFilters.fechaFin || null,
  };
  loadPrevEventsPage(
    currentUser.uid,
    updateEventsUIWithClientFilter,
    dateFilters
  );
}

function navigateToNextExpensesPage() {
  const currentUser = getCurrentUser();
  if (!currentUser || !expensesHasNextPage) return;

  currentExpensesPage++;
  const dateFilters = {
    fechaInicio: lastAppliedFilters.fechaInicio || null,
    fechaFin: lastAppliedFilters.fechaFin || null,
  };
  loadNextExpensesPage(currentUser.uid, updateExpensesUI, dateFilters);
}

function navigateToPrevExpensesPage() {
  const currentUser = getCurrentUser();
  if (!currentUser || !expensesHasPrevPage) return;

  currentExpensesPage--;
  const dateFilters = {
    fechaInicio: lastAppliedFilters.fechaInicio || null,
    fechaFin: lastAppliedFilters.fechaFin || null,
  };
  loadPrevExpensesPage(currentUser.uid, updateExpensesUI, dateFilters);
}

// Función para reiniciar la paginación (útil al aplicar filtros)
export function resetPagination() {
  currentEventsPage = 1;
  currentExpensesPage = 1;
  // Reset pagination markers in firestoreService
  resetEventPagination();
  resetExpensePagination();

  const currentUser = getCurrentUser();
  if (currentUser) {
    // Call listeners with current filters (or empty if filters were cleared)
    const dateFilters = {
      fechaInicio: lastAppliedFilters.fechaInicio || null,
      fechaFin: lastAppliedFilters.fechaFin || null,
    };
    listenToEvents(
      currentUser.uid,
      updateEventsUIWithClientFilter,
      dateFilters
    );
    listenToExpenses(currentUser.uid, updateExpensesUI, dateFilters);
  }
}

export function loadUserPreferencesUI(sueldoFijo) {
  const sueldoFijoInput = document.getElementById("sueldo-fijo");
  if (sueldoFijoInput) {
    sueldoFijoInput.value = sueldoFijo || 0;
  }
  recalcTotalFinal(); // Recalculate totals after loading salary
}

// Expose to window object to avoid circular dependency with firestoreService.js
if (typeof window !== "undefined") {
  window.loadUserPreferencesUI = loadUserPreferencesUI;
  window.recalcTotalFinal = recalcTotalFinal;
  window.applyFilters = applyFilters;
  window.renderEvents = renderEvents;
  window.renderGastos = renderGastos;
}

export function renderEvents(eventsToRender) {
  const eventosBody = document.getElementById("eventos-body");
  if (!eventosBody) return;
  eventosBody.innerHTML = ""; // Clear table

  let totalPagoAcumulado = 0;
  let totalHorasExtraAcumulado = 0;

  if (eventsToRender.length === 0) {
    eventosBody.innerHTML =
      '<tr><td colspan="9" class="text-center py-4">No hay eventos que coincidan con los filtros.</td></tr>';
  } else {
    eventsToRender.forEach((evento) => {
      const row = eventosBody.insertRow();
      row.setAttribute("data-id", evento.id);

      const calculoPago = calcularPagoEvento(
        evento.fecha,
        evento.horaEntrada,
        evento.horaSalida,
        evento.operacion,
        evento.feriado
      );

      totalPagoAcumulado += calculoPago.pagoTotalEvento;
      totalHorasExtraAcumulado += calculoPago.horasExtra;

      row.innerHTML = `
              <td>${evento.evento || ""}</td>
              <td>${evento.fecha ? evento.fecha.split("-")[2] : ""}</td>
              <td>${getDayName(evento.fecha)}</td>
              <td>${evento.horaEntrada || ""}</td>
              <td>${evento.horaSalida || ""}</td>
              <td>${evento.operacion ? "Sí" : "No"}</td>
              <td>${calculoPago.horasExtra.toFixed(0)}</td>
              <td>$${calculoPago.pagoTotalEvento.toLocaleString()}</td>
              <td class="flex space-x-1">
                <button class="edit-event-button bg-blue-500 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded">✏️</button>
                <button class="delete-event-button bg-red-500 hover:bg-red-700 text-white text-xs py-1 px-2 rounded">X</button>
              </td>
            `;

      const deleteButton = row.querySelector(".delete-event-button");
      if (deleteButton) {
        deleteButton.onclick = () => deleteEvent(evento.id);
      }

      const editButton = row.querySelector(".edit-event-button");
      if (editButton) {
        editButton.onclick = () => openEditEventModal(evento.id);
      }
    });
  }

  // Update global totals based on the filtered data rendered
  totalPagoAcumuladoGlobal = totalPagoAcumulado;
  totalHorasExtraAcumuladoGlobal = totalHorasExtraAcumulado;

  // Update display elements for event totals
  if (totalPagoContainer) {
    totalPagoContainer.textContent =
      "$" + totalPagoAcumuladoGlobal.toLocaleString();
  }
  if (totalHorasExtraContainer) {
    totalHorasExtraContainer.textContent =
      totalHorasExtraAcumuladoGlobal.toFixed(0);
  }

  recalcTotalFinal(); // Recalculate the grand total
}

export function renderGastos(gastosToRender) {
  const gastosBody = document.getElementById("gastos-body");
  if (!gastosBody) return;
  gastosBody.innerHTML = "";

  let totalGastosAcumulado = 0;

  if (gastosToRender.length === 0) {
    gastosBody.innerHTML =
      '<tr><td colspan="3" class="text-center py-4">No hay gastos que coincidan con los filtros.</td></tr>';
    totalGastosAcumuladoGlobal = 0;
  } else {
    gastosToRender.forEach((gasto) => {
      const row = gastosBody.insertRow();
      row.setAttribute("data-id", gasto.id);

      const monto = gasto.monto || 0;
      totalGastosAcumulado += monto;

      row.innerHTML = `
              <td>${gasto.descripcion || ""}</td>
              <td>$${monto.toLocaleString()}</td>
              <td><button class="delete-gasto-button bg-red-500 hover:bg-red-700 text-white text-xs py-1 px-2 rounded">X</button></td>
            `;

      const deleteButton = row.querySelector(".delete-gasto-button");
      if (deleteButton) {
        deleteButton.onclick = () => deleteGasto(gasto.id);
      }
    });
    totalGastosAcumuladoGlobal = totalGastosAcumulado;
  }

  // Update display element for expense total
  if (totalGastosContainer) {
    totalGastosContainer.textContent =
      "$" + totalGastosAcumuladoGlobal.toLocaleString();
  }

  recalcTotalFinal(); // Recalculate the grand total
}

export function recalcTotalFinal() {
  const sueldoFijoInput = document.getElementById("sueldo-fijo");
  const fijo = parseFloat(sueldoFijoInput?.value) || 0;

  // Update individual display elements
  if (displaySueldo) displaySueldo.textContent = "$" + fijo.toLocaleString();
  if (displayEventos)
    displayEventos.textContent =
      "$" + totalPagoAcumuladoGlobal.toLocaleString();
  if (displayGastos)
    displayGastos.textContent =
      "$" + totalGastosAcumuladoGlobal.toLocaleString();

  // Calculate and update the final total
  const finalTotal =
    fijo + totalPagoAcumuladoGlobal + totalGastosAcumuladoGlobal;
  if (totalFinalContainer) {
    totalFinalContainer.textContent = "$" + finalTotal.toLocaleString();
  }
}

// Expose to window object to avoid circular dependency with firestoreService.js
if (typeof window !== "undefined") {
  window.loadUserPreferencesUI = loadUserPreferencesUI;
  window.recalcTotalFinal = recalcTotalFinal;
  window.applyFilters = applyFilters;
  window.renderEvents = renderEvents;
  window.renderGastos = renderGastos;
}

export function clearUI() {
  // Stop listening to data changes
  stopFirestoreListeners();

  // Clear data arrays
  allUserEvents = [];
  allUserExpenses = [];

  // Clear tables
  const eventosBody = document.getElementById("eventos-body");
  const gastosBody = document.getElementById("gastos-body");
  if (eventosBody) eventosBody.innerHTML = "";
  if (gastosBody) gastosBody.innerHTML = "";

  // Reset totals
  totalPagoAcumuladoGlobal = 0;
  totalGastosAcumuladoGlobal = 0;
  totalHorasExtraAcumuladoGlobal = 0;

  // Reset display elements
  if (totalPagoContainer) totalPagoContainer.textContent = "$0";
  if (totalHorasExtraContainer) totalHorasExtraContainer.textContent = "0";
  if (totalGastosContainer) totalGastosContainer.textContent = "$0";
  if (totalFinalContainer) totalFinalContainer.textContent = "$0";
  if (displaySueldo) displaySueldo.textContent = "$0";
  if (displayEventos) displayEventos.textContent = "$0";
  if (displayGastos) displayGastos.textContent = "$0";

  // Reset input fields
  const sueldoFijoInput = document.getElementById("sueldo-fijo");
  if (sueldoFijoInput) sueldoFijoInput.value = "";
  // Optionally clear filter inputs as well
  // clearFilters(); // Be careful not to cause infinite loops if clearFilters calls applyFilters
}

// --- Filtering Logic ---

export function populateYearFilter() {
  if (!filterYearSelect) return;
  filterYearSelect.innerHTML = ""; // Clear existing options
  const currentYear = new Date().getFullYear();
  for (let i = 0; i < 5; i++) {
    const year = currentYear - i;
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    filterYearSelect.appendChild(option);
  }
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Todos";
  filterYearSelect.appendChild(allOption);
  filterYearSelect.value = "all";
}

export function applyFilters() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  // Obtener valores de filtro
  const selectedMonth = filterMonthSelect
    ? filterMonthSelect.value === "all"
      ? -1
      : parseInt(filterMonthSelect.value) - 1 // JavaScript months are 0-based (0-11), HTML months are 1-based (1-12)
    : -1;
  const selectedYear = filterYearSelect
    ? filterYearSelect.value === "all"
      ? -1
      : parseInt(filterYearSelect.value)
    : -1;
  const nombreEvento = filtroNombreEvento?.value.toLowerCase().trim() || "";
  const fechaInicioValue = filtroFechaInicio?.value || ""; // YYYY-MM-DD string
  const fechaFinValue = filtroFechaFin?.value || ""; // YYYY-MM-DD string

  // Guardar los filtros actuales para client-side filtering (name, month, year) and pagination
  lastAppliedFilters = {
    month: selectedMonth,
    year: selectedYear,
    nombreEvento: nombreEvento,
    fechaInicio: fechaInicioValue, // Store as string
    fechaFin: fechaFinValue, // Store as string
  };

  // Also update global scope for proper synchronization
  if (typeof window !== "undefined") {
    window.lastAppliedFilters = { ...lastAppliedFilters };
  }

  // Reset pagination before applying new filters and re-listening
  currentEventsPage = 1;
  currentExpensesPage = 1;
  resetEventPagination();
  resetExpensePagination();

  // Prepare date filters for Firestore query
  // Firestore expects 'YYYY-MM-DD' strings for date comparisons if dates are stored that way
  // Or Timestamps if dates are stored as Timestamps. Assuming 'YYYY-MM-DD' strings based on current code.
  const firestoreDateFilters = {};
  if (fechaInicioValue) {
    firestoreDateFilters.fechaInicio = fechaInicioValue;
  }
  if (fechaFinValue) {
    // Ensure the end date includes the entire day for "<=" comparisons in Firestore
    // This is tricky if dates are just strings. If they are Firestore Timestamps, this is handled differently.
    // For string 'YYYY-MM-DD', '<=' works as expected for the day.
    firestoreDateFilters.fechaFin = fechaFinValue;
  }

  // Re-listen to Firestore with new date filters.
  // updateEventsUIWithClientFilter will handle name, month, year filtering on the client side.
  listenToEvents(
    currentUser.uid,
    updateEventsUIWithClientFilter,
    firestoreDateFilters
  );
  listenToExpenses(currentUser.uid, updateExpensesUI, firestoreDateFilters);

  // Totals will be recalculated by renderEvents/renderGastos
  // No need to filter allUserEvents/allUserExpenses here anymore
}

// Exponer la función applyFilters al objeto window para poder acceder desde firestoreService.js
if (typeof window !== "undefined") {
  window.applyFilters = applyFilters;
}

export function clearFilters(event) {
  if (event) event.preventDefault(); // Prevent default if called from button click

  // Limpiar los filtros en la interfaz
  if (filterMonthSelect) {
    filterMonthSelect.value = "all";
  }
  if (filterYearSelect) {
    filterYearSelect.value = "all";
  }
  if (filtroNombreEvento) {
    filtroNombreEvento.value = "";
  }
  if (filtroFechaInicio) {
    filtroFechaInicio.value = "";
  }
  if (filtroFechaFin) {
    filtroFechaFin.value = "";
  }

  // También limpiar los filtros guardados
  lastAppliedFilters = {
    month: -1,
    year: -1,
    nombreEvento: "",
    fechaInicio: "", // Clear string dates
    fechaFin: "", // Clear string dates
  };

  // Sync with global scope
  if (typeof window !== "undefined") {
    window.lastAppliedFilters = { ...lastAppliedFilters };
  }

  // Re-apply filters which will now show all data by re-listening
  // applyFilters will call listenToEvents/Expenses with empty/null date filters
  applyFilters();

  showInfoToast("Filtros limpiados. Mostrando todos los registros.");
}

// Función para forzar el límite de eventos mostrados en la UI
function enforceEventLimit(events, maxEvents = 20) {
  if (!events || !Array.isArray(events)) {
    return [];
  }

  if (events.length > maxEvents) {
    console.warn(
      `[UI] LIMITING EVENTS: Received ${events.length} events, showing only first ${maxEvents}`
    );
    return events.slice(0, maxEvents);
  }

  return events;
}

// Función para forzar el límite de gastos mostrados en la UI
function enforceExpenseLimit(expenses, maxExpenses = 20) {
  if (!expenses || !Array.isArray(expenses)) {
    return [];
  }

  if (expenses.length > maxExpenses) {
    console.warn(
      `[UI] LIMITING EXPENSES: Received ${expenses.length} expenses, showing only first ${maxExpenses}`
    );
    return expenses.slice(0, maxExpenses);
  }

  return expenses;
}

// --- Utility Functions ---

export function getDayName(fechaStr) {
  if (!fechaStr) return "";
  try {
    const parts = fechaStr.split("-");
    const fecha = new Date(parts[0], parts[1] - 1, parts[2]);
    const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return dias[fecha.getDay()] || "";
  } catch (e) {
    return "";
  }
}

// --- Theme Handling ---

export function toggleTheme() {
  const themeIcon = document.getElementById("theme-icon");
  document.documentElement.classList.toggle("dark");
  const isDarkMode = document.documentElement.classList.contains("dark");
  if (isDarkMode) {
    if (themeIcon) themeIcon.textContent = "☀️";
    localStorage.setItem("dark-mode", "true");
  } else {
    if (themeIcon) themeIcon.textContent = "🌙";
    localStorage.setItem("dark-mode", "false");
  }
}

function applyTheme() {
  if (localStorage.getItem("dark-mode") === "true") {
    document.documentElement.classList.add("dark");
    const themeIcon = document.getElementById("theme-icon");
    if (themeIcon) themeIcon.textContent = "☀️";
  } else {
    document.documentElement.classList.remove("dark");
    const themeIcon = document.getElementById("theme-icon");
    if (themeIcon) themeIcon.textContent = "🌙";
  }
}

// Función para abrir el formulario de edición de eventos
export async function openEditEventModal(eventId) {
  try {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    // Obtener la información del evento
    const evento = await getEventById(eventId);
    if (!evento) {
      showInfoToast("No se pudo encontrar el evento para editar.");
      return;
    }

    // Obtener referencias al formulario existente
    const formulario = document.getElementById("form-operaciones");
    const tituloForm = formulario.querySelector("h2");
    const submitButton = formulario.querySelector('button[type="submit"]');

    // Crear un botón de cancelar si no existe
    let cancelButton = document.getElementById("cancel-edit-button");
    if (!cancelButton) {
      cancelButton = document.createElement("button");
      cancelButton.id = "cancel-edit-button";
      cancelButton.type = "button";
      cancelButton.className =
        "bg-gray-500 hover:bg-gray-700 text-white py-2 px-4 rounded transition-colors mr-2";
      cancelButton.textContent = "Cancelar";

      // Insertar el botón de cancelar antes del botón de enviar
      submitButton.parentNode.insertBefore(cancelButton, submitButton);
    } else {
      // Asegurarse de que el botón sea visible
      cancelButton.style.display = "inline-block";
    }

    // Llenar el formulario con los datos del evento
    const eventoInput = document.getElementById("evento");
    const fechaInput = document.getElementById("fecha-operacion");
    const horaEntradaInput = document.getElementById("hora-entrada");
    const horaSalidaInput = document.getElementById("hora-salida");
    const operacionInput = document.getElementById("operacion");
    const feriadoInput = document.getElementById("feriado");

    // Guardar id del evento que se está editando
    formulario.dataset.editingEventId = eventId;

    // Cambiar el título del formulario y el texto del botón
    if (tituloForm) tituloForm.textContent = "Editar Evento";
    if (submitButton) submitButton.textContent = "Guardar Cambios";

    // Llenar los campos con los valores del evento
    if (eventoInput) eventoInput.value = evento.evento || "";
    if (fechaInput) fechaInput.value = evento.fecha || "";
    if (horaEntradaInput) horaEntradaInput.value = evento.horaEntrada || "";
    if (horaSalidaInput) horaSalidaInput.value = evento.horaSalida || "";
    if (operacionInput) operacionInput.checked = evento.operacion || false;
    if (feriadoInput) feriadoInput.checked = evento.feriado || false;

    // Hacer scroll hasta el formulario
    formulario.scrollIntoView({ behavior: "smooth" });

    // Configurar el botón de cancelar
    cancelButton.onclick = resetForm;

    // Mostrar un mensaje al usuario
    showInfoToast(
      "Editando evento. Completa el formulario y presiona 'Guardar Cambios'."
    );
  } catch (error) {
    console.error("Error al abrir el formulario de edición:", error);
    showInfoToast("Ocurrió un error al intentar editar el evento.");
  }
}

// Función para resetear el formulario a su estado original
function resetForm() {
  const formulario = document.getElementById("form-operaciones");
  const tituloForm = formulario.querySelector("h2");
  const submitButton = formulario.querySelector('button[type="submit"]');
  const cancelButton = document.getElementById("cancel-edit-button");

  // Limpiar el id del evento que se está editando
  delete formulario.dataset.editingEventId;

  // Restaurar el título y texto del botón
  if (tituloForm) tituloForm.textContent = "Registrar Evento";
  if (submitButton) submitButton.textContent = "Agregar Evento";

  // Resetear el formulario
  formulario.reset();

  // Ocultar el botón de cancelar
  if (cancelButton) cancelButton.style.display = "none";

  showInfoToast("Edición cancelada.");
}

// ===== GLOBAL SCOPE EXPOSURE =====
// Expose critical functions to window for filter functionality
window.updateEventsUIWithClientFilter = updateEventsUIWithClientFilter;
window.updateExpensesUI = updateExpensesUI;
window.lastAppliedFilters = lastAppliedFilters;
