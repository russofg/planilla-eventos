// Importar servicios necesarios
import {
  db,
  realdb,
  checkFirestoreConnection,
  // isPersistenceEnabled, // Comentamos esta importación que está causando el error
} from "./firebase.config.js";
import {
  collection,
  addDoc,
  query,
  onSnapshot,
  deleteDoc,
  doc,
  setDoc,
  getDocs,
  getDoc,
  serverTimestamp,
  where,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast,
  startAt,
  endAt,
  updateDoc,
  deleteField,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref,
  set,
  push,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import {
  getCurrentUser,
  setTarifas,
  COLLECTIONS,
  DEFAULT_TARIFA_COMUN,
  DEFAULT_TARIFA_FIN,
  DEFAULT_TARIFA_OPERACION,
  DEFAULT_TARIFA_HORA_EXTRA,
} from "./config.js";
import {
  showSuccessToast,
  showErrorToast,
  confirmToast,
  showInfoToast,
} from "./notifications.js";
import { calcularPagoEvento } from "./calculations.js";
// We need to avoid circular dependency with ui.js
// These functions will be accessed via the window object instead of direct imports
// import {
//   renderEvents,
//   renderGastos,
//   applyFilters,
//   loadUserPreferencesUI,
//   recalcTotalFinal,
// } from "./ui.js";
import {
  saveEventOffline,
  saveExpenseOffline,
  cacheEvents,
  cacheExpenses,
  getCachedEvents,
  getCachedExpenses,
  cacheUserData,
  getUserData,
} from "./offlineService.js";
import { isConnected, synchronizeData } from "./syncService.js";

// Store listeners unsubscribe functions to prevent memory leaks on logout/re-auth
let unsubscribeEvents = null;
let unsubscribeExpenses = null;

// Store the last visible document for pagination
let lastVisibleEvent = null;
let firstVisibleEvent = null;
let lastVisibleExpense = null;
let firstVisibleExpense = null;

// Pagination config
export const ITEMS_PER_PAGE = 20; // Configurado para mostrar 20 elementos por página

// --- Data Loading and Listening ---

// Variable para almacenar la función de cancelar el listener de tarifas
let unsubscribeTarifas = null;

// Nueva función para escuchar cambios en las tarifas en tiempo real
export function listenToTarifasChanges() {
  if (unsubscribeTarifas) {
    unsubscribeTarifas(); // Cancelar listener anterior si existe
  }

  const configDocRef = doc(db, COLLECTIONS.CONFIG, "tarifas");

  unsubscribeTarifas = onSnapshot(
    configDocRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const tarifas = snapshot.data();

        // Obtener los valores actuales para comparar luego
        const oldTarifas = {
          tarifaComun: DEFAULT_TARIFA_COMUN,
          tarifaFin: DEFAULT_TARIFA_FIN,
          tarifaOperacion: DEFAULT_TARIFA_OPERACION,
          tarifaHoraExtra: DEFAULT_TARIFA_HORA_EXTRA,
        };

        // Actualizar valores de tarifas en el módulo config
        setTarifas({
          tarifaComun: tarifas.tarifaComun || DEFAULT_TARIFA_COMUN,
          tarifaFin: tarifas.tarifaFin || DEFAULT_TARIFA_FIN,
          tarifaOperacion: tarifas.tarifaOperacion || DEFAULT_TARIFA_OPERACION,
          tarifaHoraExtra: tarifas.tarifaHoraExtra || DEFAULT_TARIFA_HORA_EXTRA,
        });

        // Verificar si hubo un cambio real en las tarifas
        if (
          oldTarifas.tarifaComun !== tarifas.tarifaComun ||
          oldTarifas.tarifaFin !== tarifas.tarifaFin ||
          oldTarifas.tarifaOperacion !== tarifas.tarifaOperacion ||
          oldTarifas.tarifaHoraExtra !== tarifas.tarifaHoraExtra
        ) {
          // Si estamos en la página de index.html
          const eventosBody = document.getElementById("eventos-body");
          if (eventosBody) {
            // Obtener todos los eventos actualmente mostrados en la tabla
            const filas = eventosBody.querySelectorAll("tr[data-id]");
            if (filas.length > 0) {
              // Esto recalcula los eventos utilizando las nuevas tarifas
              // pero evita un refresco de página completo
              if (window.applyFilters) {
                // Si la función applyFilters está disponible en el scope global
                window.applyFilters();
              } else if (window.recalcTotalFinal) {
                // De lo contrario, intentar recalcular al menos el total
                window.recalcTotalFinal();
              }

              // Mostrar notificación al usuario
              showInfoToast(
                "Las tarifas han sido actualizadas. Los cálculos se han actualizado automáticamente."
              );
            }
          }
        }
      }
    },
    (error) => {
      console.error("Error al escuchar cambios en tarifas:", error);
    }
  );
}

export async function loadTarifas() {
  try {
    const configDocRef = doc(db, COLLECTIONS.CONFIG, "tarifas");
    const docSnap = await getDoc(configDocRef);
    let tarifas = {};
    if (docSnap.exists()) {
      const data = docSnap.data();
      tarifas = {
        tarifaComun: data.tarifaComun || DEFAULT_TARIFA_COMUN,
        tarifaFin: data.tarifaFin || DEFAULT_TARIFA_FIN,
        tarifaOperacion: data.tarifaOperacion || DEFAULT_TARIFA_OPERACION,
        tarifaHoraExtra: data.tarifaHoraExtra || DEFAULT_TARIFA_HORA_EXTRA,
      };
    } else {
      // Use default values if the document doesn't exist
      tarifas = {
        tarifaComun: DEFAULT_TARIFA_COMUN,
        tarifaFin: DEFAULT_TARIFA_FIN,
        tarifaOperacion: DEFAULT_TARIFA_OPERACION,
        tarifaHoraExtra: DEFAULT_TARIFA_HORA_EXTRA,
      };
      // console.warn(
      //   "Tarifas document not found in Firestore, using default values."
      // );
    }
    setTarifas(tarifas); // Update global config state
  } catch (error) {
    console.error("Error loading tarifas:", error);
    // Use default values in case of error
    setTarifas({
      tarifaComun: DEFAULT_TARIFA_COMUN,
      tarifaFin: DEFAULT_TARIFA_FIN,
      tarifaOperacion: DEFAULT_TARIFA_OPERACION,
      tarifaHoraExtra: DEFAULT_TARIFA_HORA_EXTRA,
    });
    showErrorToast("Error al cargar las tarifas. Usando valores por defecto.");
  }
}

export function resetEventPagination() {
  lastVisibleEvent = null;
  firstVisibleEvent = null;
}

export function resetExpensePagination() {
  lastVisibleExpense = null;
  firstVisibleExpense = null;
}

export function listenToEvents(
  userId,
  updateUICallback,
  filters = {}, // { fechaInicio, fechaFin }
  pageSize = ITEMS_PER_PAGE,
  startAfterDoc = null,
  direction = "next"
) {
  // Unsubscribe from previous listener if exists
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }

  // Base query - SOLO userId para evitar índices complejos
  let qEventos = query(
    collection(db, COLLECTIONS.EVENTOS),
    where("userId", "==", userId)
  );

  // Apply date filters PERO SIN orderBy para evitar índices complejos
  if (filters.fechaInicio) {
    qEventos = query(qEventos, where("fecha", ">=", filters.fechaInicio));
  }
  if (filters.fechaFin) {
    qEventos = query(qEventos, where("fecha", "<=", filters.fechaFin));
  }

  // NO agregar orderBy si hay filtros de fecha - esto evita el error de índice
  if (!filters.fechaInicio && !filters.fechaFin) {
    // Solo ordenar cuando NO hay filtros de fecha
    qEventos = query(qEventos, orderBy("createdAt", "desc"));
  }

  // Apply pagination
  if (direction === "next" && startAfterDoc) {
    qEventos = query(qEventos, startAfter(startAfterDoc), limit(pageSize));
  } else if (direction === "prev" && startAfterDoc) {
    qEventos = query(qEventos, endBefore(startAfterDoc), limitToLast(pageSize));
  } else {
    // First page
    qEventos = query(qEventos, limit(pageSize));
  }

  unsubscribeEvents = onSnapshot(
    qEventos,
    (snapshot) => {
      let userEvents = [];

      // Save first and last documents for pagination
      if (!snapshot.empty) {
        firstVisibleEvent = snapshot.docs[0];
        lastVisibleEvent = snapshot.docs[snapshot.docs.length - 1];
      } else {
        firstVisibleEvent = null;
        lastVisibleEvent = null;
      }

      snapshot.forEach((doc) => {
        userEvents.push({ id: doc.id, ...doc.data() });
      });

      const paginationData = {
        hasNextPage: userEvents.length >= pageSize,
        hasPrevPage:
          direction === "prev"
            ? snapshot.docs.length > 0 && !!startAfterDoc
            : !!firstVisibleEvent && !!startAfterDoc,
      };

      // Pass data to the UI update function with pagination info
      try {
        updateUICallback(userEvents, paginationData);
      } catch (callbackError) {
        console.error(
          "Error al actualizar la interfaz de eventos:",
          callbackError
        );
        showErrorToast("Error al actualizar la interfaz de eventos.");
      }
    },
    (error) => {
      console.error("Error en listener de eventos:", error);

      // Solo mostrar error si no es un problema de índice
      if (error.code !== "failed-precondition") {
        showErrorToast("No se pudieron cargar los eventos.");
      }

      unsubscribeEvents = null; // Reset on error
    }
  );
}

export function listenToExpenses(
  userId,
  updateUICallback,
  filters = {}, // { fechaInicio, fechaFin }
  pageSize = ITEMS_PER_PAGE,
  startAfterDoc = null,
  direction = "next"
) {
  // Unsubscribe from previous listener if exists
  if (unsubscribeExpenses) {
    unsubscribeExpenses();
    unsubscribeExpenses = null; // Fix: ensure listener is nulled
  }

  // Base query - SOLO userId para evitar índices complejos
  let qGastos = query(
    collection(db, COLLECTIONS.GASTOS),
    where("userId", "==", userId)
  );

  // Apply date filters PERO SIN orderBy para evitar índices complejos
  if (filters.fechaInicio) {
    qGastos = query(qGastos, where("fecha", ">=", filters.fechaInicio));
  }
  if (filters.fechaFin) {
    qGastos = query(qGastos, where("fecha", "<=", filters.fechaFin));
  }

  // NO agregar orderBy si hay filtros de fecha - esto evita el error de índice
  if (!filters.fechaInicio && !filters.fechaFin) {
    // Solo ordenar cuando NO hay filtros de fecha
    qGastos = query(qGastos, orderBy("createdAt", "desc"));
  }

  // Apply pagination
  if (direction === "next" && startAfterDoc) {
    qGastos = query(qGastos, startAfter(startAfterDoc), limit(pageSize));
  } else if (direction === "prev" && startAfterDoc) {
    qGastos = query(qGastos, endBefore(startAfterDoc), limitToLast(pageSize));
  } else {
    // First page
    qGastos = query(qGastos, limit(pageSize));
  }

  unsubscribeExpenses = onSnapshot(
    qGastos,
    (snapshot) => {
      let userExpenses = [];

      // Save first and last documents for pagination
      if (!snapshot.empty) {
        firstVisibleExpense = snapshot.docs[0];
        lastVisibleExpense = snapshot.docs[snapshot.docs.length - 1];
      } else {
        firstVisibleExpense = null;
        lastVisibleExpense = null;
      }

      snapshot.forEach((doc) => {
        userExpenses.push({ id: doc.id, ...doc.data() });
      });

      // Pass data to the UI update function with pagination info
      try {
        updateUICallback(userExpenses, {
          hasNextPage: userExpenses.length >= pageSize,
          hasPrevPage: direction === "prev" && startAfterDoc !== null,
        });
      } catch (callbackError) {
        console.error(
          "Error al actualizar la interfaz de gastos:",
          callbackError
        );
        showErrorToast("Error al actualizar la interfaz de gastos.");
      }
    },
    (error) => {
      console.error("Error en listener de gastos:", error);

      // Solo mostrar error si no es un problema de índice
      if (error.code !== "failed-precondition") {
        showErrorToast("No se pudieron cargar los gastos.");
      }

      unsubscribeExpenses = null; // Reset on error
    }
  );
}

// Helper functions for pagination
export function loadNextEventsPage(
  userId,
  updateUICallback,
  filters = {},
  pageSize = ITEMS_PER_PAGE
) {
  if (lastVisibleEvent) {
    listenToEvents(
      userId,
      updateUICallback,
      filters,
      pageSize,
      lastVisibleEvent,
      "next"
    );
  }
}

export function loadPrevEventsPage(
  userId,
  updateUICallback,
  filters = {},
  pageSize = ITEMS_PER_PAGE
) {
  if (firstVisibleEvent) {
    listenToEvents(
      userId,
      updateUICallback,
      filters,
      pageSize,
      firstVisibleEvent,
      "prev"
    );
  }
}

export function loadNextExpensesPage(
  userId,
  updateUICallback,
  filters = {},
  pageSize = ITEMS_PER_PAGE
) {
  if (lastVisibleExpense) {
    listenToExpenses(
      userId,
      updateUICallback,
      filters,
      pageSize,
      lastVisibleExpense,
      "next"
    );
  }
}

export function loadPrevExpensesPage(
  userId,
  updateUICallback,
  filters = {},
  pageSize = ITEMS_PER_PAGE
) {
  if (firstVisibleExpense) {
    listenToExpenses(
      userId,
      updateUICallback,
      filters,
      pageSize,
      firstVisibleExpense,
      "prev"
    );
  }
}

// Function to stop listeners (call on logout)
export function stopFirestoreListeners() {
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  if (unsubscribeExpenses) {
    unsubscribeExpenses();
    unsubscribeExpenses = null;
  }
  if (unsubscribeTarifas) {
    unsubscribeTarifas();
    unsubscribeTarifas = null;
  }
}

export async function loadUserPreferences(userId) {
  const prefDocRef = doc(db, COLLECTIONS.USER_PREFS, userId);
  try {
    const docSnap = await getDoc(prefDocRef);
    let sueldoFijo = 0;
    if (docSnap.exists()) {
      const prefs = docSnap.data();
      sueldoFijo = prefs.sueldoFijo || 0;
    }
    // Update UI - using window object to access UI function to avoid circular dependency
    if (window.loadUserPreferencesUI) {
      window.loadUserPreferencesUI(sueldoFijo);
    }
  } catch (error) {
    console.error("Error loading user preferences:", error);
    // Handle error - maybe show default value in UI
    if (window.loadUserPreferencesUI) {
      window.loadUserPreferencesUI(0);
    }
    showErrorToast("Error al cargar preferencias.");
  }
}

// --- Data Modification ---

export async function addEvent(formElement) {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showErrorToast("Debes iniciar sesión para añadir eventos.");
    return;
  }

  const fecha = formElement["fecha-operacion"].value;
  const horaEntrada = formElement["hora-entrada"].value;
  const horaSalida = formElement["hora-salida"].value;
  const operacion = formElement.operacion.checked;
  const feriado = formElement.feriado ? formElement.feriado.checked : false;
  const eventoNombre = formElement.evento.value.trim();

  if (!eventoNombre || !fecha || !horaEntrada || !horaSalida) {
    showErrorToast(
      "Por favor, completa el nombre del evento, la fecha y las horas."
    );
    return;
  }

  // Check if we're editing an existing event
  const editingEventId = formElement.dataset.editingEventId;

  // Calculate payment using the dedicated function
  const calculoPago = calcularPagoEvento(
    fecha,
    horaEntrada,
    horaSalida,
    operacion,
    feriado
  );

  // Reset form before attempting to save to prevent duplicate submissions
  formElement.reset();

  // Reset the form to its original state if editing
  if (editingEventId) {
    delete formElement.dataset.editingEventId;
    const tituloForm = formElement.querySelector("h2");
    const submitButton = formElement.querySelector('button[type="submit"]');
    const cancelButton = document.getElementById("cancel-edit-button");

    if (tituloForm) tituloForm.textContent = "Registrar Evento";
    if (submitButton) submitButton.textContent = "Agregar Evento";
    if (cancelButton) cancelButton.style.display = "none";
  }

  // Verificar si hay conexión a internet
  const isOnline = isConnected();

  // Create event data object
  const newEvent = {
    evento: eventoNombre,
    fecha,
    horaEntrada,
    horaSalida,
    operacion,
    feriado,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    createdAt: serverTimestamp(),
  };

  try {
    const connectionStatus = await checkFirestoreConnection();
    // If connected to Firestore, add directly
    if (connectionStatus) {
      if (editingEventId) {
        // Update existing event
        const success = await updateEvent({
          id: editingEventId,
          evento: eventoNombre,
          fecha: fecha,
          horaEntrada: horaEntrada,
          horaSalida: horaSalida,
          operacion: operacion,
          feriado: feriado,
        });
        // No mostramos aquí la notificación porque ya se muestra en updateEvent
      } else {
        // Si hay conexión, guardar directamente en Firestore

        const docRef = await addDoc(
          collection(db, COLLECTIONS.EVENTOS),
          newEvent
        );

        // The main listener (listenToEvents) should now pick up new events automatically
        // if they match the current filters. No need to manually restart it here.
        // // Detener el listener actual si existe
        // if (unsubscribeEvents) {
        //   unsubscribeEvents();
        //   unsubscribeEvents = null;
        // }

        // // Forzar una nueva query para incluir el evento nuevo
        // const qEventos = query(
        //   collection(db, COLLECTIONS.EVENTOS),
        //   where("userId", "==", currentUser.uid),
        //   orderBy("fecha", "desc"),
        //   limit(ITEMS_PER_PAGE)
        // );

        // // Configurar nuevo listener con el evento recién agregado
        // unsubscribeEvents = onSnapshot(qEventos, (snapshot) => {
        //   const userEvents = [];
        //   if (!snapshot.empty) {
        //     firstVisibleEvent = snapshot.docs[0];
        //     lastVisibleEvent = snapshot.docs[snapshot.docs.length - 1];
        //   }
        //   snapshot.forEach((doc) => {
        //     userEvents.push({ id: doc.id, ...doc.data() });
        //   });
        //   if (window.updateEventsUI) {
        //     window.updateEventsUI(userEvents, {
        //       hasNextPage: userEvents.length >= ITEMS_PER_PAGE,
        //       hasPrevPage: false,
        //     });
        //   }
        // });

        showSuccessToast("Evento registrado correctamente");

        // Activar indicador de exportación
        const indicator = document.getElementById("export-indicator");
        if (indicator) {
          indicator.style.cssText =
            "display: flex !important; visibility: visible !important;";
        }

        try {
          const { forceShowExportIndicator } = await import(
            "./googleCalendarService.js"
          );
          forceShowExportIndicator();
        } catch (indicatorError) {
          // Método de respaldo si falla la importación
          setTimeout(() => {
            const indicator = document.getElementById("export-indicator");
            if (indicator) {
              indicator.style.cssText =
                "display: flex !important; visibility: visible !important;";
            }
          }, 100);
        }
      }
    } else {
      // Si no hay conexión, guardar localmente
      await saveEventOffline(eventData);
      // La notificación se muestra en saveEventOffline
    }
  } catch (error) {
    console.error("Error al guardar el evento:", error);
    showErrorToast("Error al guardar el evento: " + error.message);
  }
}

export async function addGasto(formElement) {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showErrorToast("Debes iniciar sesión para añadir gastos.");
    return;
  }

  const descripcion = formElement.descripcion.value.trim();
  const fecha = formElement.fecha.value.trim();
  const monto = parseFloat(formElement.monto.value.trim());

  if (!descripcion || !fecha || isNaN(monto)) {
    showErrorToast(
      "Por favor, completa la descripción, la fecha y el monto del gasto."
    );
    return;
  }

  // Create expense data object
  const newGasto = {
    descripcion,
    fecha,
    monto,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    createdAt: serverTimestamp(),
  };

  try {
    const connectionStatus = await checkFirestoreConnection();
    // If connected to Firestore, add directly
    if (connectionStatus) {
      // Si hay conexión, guardar directamente en Firestore

      const docRef = await addDoc(collection(db, COLLECTIONS.GASTOS), newGasto);

      showSuccessToast("Gasto registrado correctamente");
    } else {
      // Si no hay conexión, guardar localmente
      await saveExpenseOffline(expenseData);
      // Intentar actualizar la UI con datos actualizados del caché
      try {
        const cachedExpenses = await getCachedExpenses();
        // Añadir el gasto nuevo a los existentes para actualizar la UI inmediatamente
        const allExpenses = [
          ...cachedExpenses,
          {
            id: "temp-" + Date.now(),
            ...expenseData,
            offlineCreated: true,
            createdAt: new Date().toISOString(),
          },
        ];

        // Guardar en caché para futura referencia
        await cacheExpenses(allExpenses);
      } catch (error) {
        console.error(
          "Error al actualizar caché después de guardar gasto:",
          error
        );
      }
    }
  } catch (error) {
    console.error("Error al guardar el gasto:", error);
    showErrorToast("Error al guardar el gasto: " + error.message);
  }
}

export async function deleteEvent(id) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  const confirmar = await confirmToast(
    "¿Estás seguro de que quieres borrar este evento?"
  );

  if (confirmar) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.EVENTOS, id));

      showSuccessToast("Evento eliminado correctamente");
      // UI updates via listener
    } catch (error) {
      console.error("Error al eliminar el evento:", error);
      showErrorToast("Error al borrar el evento.");
    }
  }
}

export async function deleteGasto(id) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  const confirmar = await confirmToast(
    "¿Estás seguro de que quieres borrar este gasto?"
  );

  if (confirmar) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.GASTOS, id));
      showSuccessToast("Gasto eliminado correctamente");
      // UI updates via listener
    } catch (error) {
      console.error("Error al eliminar el gasto:", error);
      showErrorToast("Error al borrar el gasto.");
    }
  }
}

export async function saveSueldoFijo() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  const sueldoFijoInput = document.getElementById("sueldo-fijo");
  const sueldo = parseFloat(sueldoFijoInput?.value) || 0;
  const prefDocRef = doc(db, COLLECTIONS.USER_PREFS, currentUser.uid);

  try {
    await setDoc(prefDocRef, { sueldoFijo: sueldo }, { merge: true });
    if (window.recalcTotalFinal) {
      window.recalcTotalFinal(); // Recalculate totals in UI
    }
    showSuccessToast("Sueldo fijo guardado correctamente");
  } catch (error) {
    console.error("Error al guardar el sueldo fijo:", error);
    showErrorToast("Error al guardar el sueldo fijo.");
  }
}

// Function to get total counts for summary (we still need this for the dashboard totals)
export async function getEventsTotalCount(userId, filters = {}) {
  try {
    let q = query(
      collection(db, COLLECTIONS.EVENTOS),
      where("userId", "==", userId)
    );
    if (filters.fechaInicio) {
      q = query(q, where("fecha", ">=", filters.fechaInicio));
    }
    if (filters.fechaFin) {
      q = query(q, where("fecha", "<=", filters.fechaFin));
    }
    // Note: Name filter would need to be applied client-side if it's a "contains" search
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error("Error al obtener conteo de eventos:", error);
    return 0;
  }
}

export async function getExpensesTotalCount(userId, filters = {}) {
  try {
    let q = query(
      collection(db, COLLECTIONS.GASTOS),
      where("userId", "==", userId)
    );
    if (filters.fechaInicio) {
      q = query(q, where("fecha", ">=", filters.fechaInicio));
    }
    if (filters.fechaFin) {
      q = query(q, where("fecha", "<=", filters.fechaFin));
    }
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error("Error al obtener conteo de gastos:", error);
    return 0;
  }
}

// Function to get totals for summary display (not affected by pagination)
export async function getEventsTotalAmount(userId, filters = {}) {
  try {
    let q = query(
      collection(db, COLLECTIONS.EVENTOS),
      where("userId", "==", userId)
    );
    if (filters.fechaInicio) {
      q = query(q, where("fecha", ">=", filters.fechaInicio));
    }
    if (filters.fechaFin) {
      q = query(q, where("fecha", "<=", filters.fechaFin));
    }
    // Note: Name filter would need to be applied client-side
    const snapshot = await getDocs(q);
    let total = 0;
    snapshot.forEach((doc) => {
      const data = doc.data();
      total += data.pagoCalculado || 0;
    });
    return total;
  } catch (error) {
    console.error("Error al obtener total de eventos:", error);
    return 0;
  }
}

export async function getExpensesTotalAmount(userId, filters = {}) {
  try {
    let q = query(
      collection(db, COLLECTIONS.GASTOS),
      where("userId", "==", userId)
    );
    if (filters.fechaInicio) {
      q = query(q, where("fecha", ">=", filters.fechaInicio));
    }
    if (filters.fechaFin) {
      q = query(q, where("fecha", "<=", filters.fechaFin));
    }
    const snapshot = await getDocs(q);
    let total = 0;
    snapshot.forEach((doc) => {
      const data = doc.data();
      total += data.monto || 0;
    });
    return total;
  } catch (error) {
    console.error("Error al obtener total de gastos:", error);
    return 0;
  }
}

export async function updateEvent(eventData) {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showErrorToast("Debes iniciar sesión para editar eventos.");
    return false;
  }

  const { id, evento, fecha, horaEntrada, horaSalida, operacion, feriado } =
    eventData;

  if (!id || !evento || !fecha || !horaEntrada || !horaSalida) {
    showErrorToast("Faltan datos requeridos para actualizar el evento.");
    return false;
  }

  // Calculate payment using the dedicated function
  const calculoPago = calcularPagoEvento(
    fecha,
    horaEntrada,
    horaSalida,
    operacion,
    feriado
  );

  try {
    // 1. Primero obtener el documento para verificar propiedad
    const eventRef = doc(db, COLLECTIONS.EVENTOS, id);
    const docSnap = await getDoc(eventRef);

    if (!docSnap.exists()) {
      showErrorToast("No se encontró el evento que intentas editar.");
      return false;
    }

    // Verificar si el evento pertenece al usuario actual
    const existingEventData = docSnap.data();
    if (existingEventData.userId !== currentUser.uid) {
      showErrorToast("No tienes permiso para editar este evento.");
      return false;
    }

    // 2. Mantener campos que no deberían cambiar
    const dataToUpdate = {
      evento,
      fecha,
      horaEntrada,
      horaSalida,
      operacion,
      feriado,
      pagoCalculado: calculoPago.pagoTotalEvento,
      horasExtraCalculadas: calculoPago.horasExtra,
      pagoExtraCalculado: calculoPago.pagoExtra,
      updatedAt: serverTimestamp(),
      // Es crucial mantener userId sin cambios para cumplir con las reglas de seguridad
      userId: currentUser.uid,
      // Preservar exportedByUsers si existe
      ...(existingEventData.exportedByUsers
        ? { exportedByUsers: existingEventData.exportedByUsers }
        : {}),
    };

    // 3. Usar setDoc con merge: true para garantizar una actualización completa y correcta
    await setDoc(eventRef, dataToUpdate, { merge: true });

    showSuccessToast("Evento actualizado correctamente");
    return true;
  } catch (error) {
    console.error("Error al actualizar el evento:", error);
    showErrorToast("Error al actualizar el evento: " + error.message);
    return false;
  }
}

export async function getEventById(id) {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;

  try {
    const eventRef = doc(db, COLLECTIONS.EVENTOS, id);
    const docSnap = await getDoc(eventRef);

    if (docSnap.exists()) {
      const eventData = docSnap.data();
      // Verificar que el evento pertenezca al usuario actual
      if (eventData.userId === currentUser.uid) {
        return { id: docSnap.id, ...eventData };
      }
    }
    return null;
  } catch (error) {
    console.error("Error al obtener datos del evento:", error);
    showErrorToast("Error al obtener datos del evento.");
    return null;
  }
}

export async function addProximoEvento(
  nombre,
  fechaInicio,
  fechaFin,
  descripcion
) {
  try {
    // Añadir el próximo evento a Firestore
    const proximoEventoRef = await addDoc(collection(db, "proximosEventos"), {
      nombre,
      fechaInicio,
      fechaFin,
      descripcion,
      createdAt: serverTimestamp(),
    });

    // Enviar notificaciones a todos los operadores
    await notificarOperadoresNuevoEvento(
      nombre,
      fechaInicio,
      fechaFin,
      descripcion,
      proximoEventoRef.id
    );

    showSuccessToast("Próximo evento agregado correctamente");
    return true;
  } catch (error) {
    console.error("Error al agregar próximo evento:", error);
    showErrorToast("Error al guardar el próximo evento.");
    return false;
  }
}

// Función para notificar a todos los operadores sobre un nuevo evento
async function notificarOperadoresNuevoEvento(
  nombre,
  fechaInicio,
  fechaFin,
  descripcion,
  eventoId
) {
  try {
    // 1. Obtener todos los usuarios con rol de operador (corregido para buscar "operator" en lugar de "operador")
    const operadoresQuery = query(
      collection(db, "users"),
      where("role", "==", "operator")
    );

    const operadoresSnapshot = await getDocs(operadoresQuery);

    if (operadoresSnapshot.empty) {
      return;
    }

    // 2. Para cada operador, crear una notificación en Realtime Database
    const notificacionesPromises = [];

    operadoresSnapshot.forEach((userDoc) => {
      const operadorId = userDoc.id;
      const notificacionesRef = ref(realdb, `notifications/${operadorId}`);
      const newNotificationRef = push(notificacionesRef);

      // Formatear fechas para la notificación - Corregido para evitar desplazamiento de día
      const fechaInicioParts = fechaInicio.split("-");
      const fechaInicioObj = new Date(
        parseInt(fechaInicioParts[0]),
        parseInt(fechaInicioParts[1]) - 1,
        parseInt(fechaInicioParts[2])
      );
      const fechaInicioFormat = fechaInicioObj.toLocaleDateString("es-AR");

      let fechaFinFormat = fechaInicioFormat;
      if (fechaFin) {
        const fechaFinParts = fechaFin.split("-");
        const fechaFinObj = new Date(
          parseInt(fechaFinParts[0]),
          parseInt(fechaFinParts[1]) - 1,
          parseInt(fechaFinParts[2])
        );
        fechaFinFormat = fechaFinObj.toLocaleDateString("es-AR");
      }

      // Crear objeto de notificación
      const notificacion = {
        title: `Nuevo evento: ${nombre}`,
        body: `Fecha: ${fechaInicioFormat}${
          fechaFin ? ` al ${fechaFinFormat}` : ""
        }\n${descripcion || ""}`,
        read: false,
        timestamp: Date.now(),
        type: "proximo_evento",
        eventoId: eventoId,
        data: {
          nombre,
          fechaInicio,
          fechaFin,
          descripcion,
        },
      };

      // Añadir promesa para enviar la notificación
      notificacionesPromises.push(set(newNotificationRef, notificacion));
    });

    // 3. Esperar a que todas las notificaciones se envíen
    await Promise.all(notificacionesPromises);

    return true;
  } catch (error) {
    console.error("Error al notificar a los operadores:", error);
    return false;
  }
}

export async function deleteProximoEvento(id) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  // Verificar si el usuario es administrador antes de permitir la eliminación
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists() || userDoc.data().role !== "admin") {
      showErrorToast(
        "Solo los administradores pueden eliminar eventos próximos."
      );
      return false;
    }

    const confirmar = await confirmToast(
      "¿Estás seguro de que quieres borrar este evento próximo?"
    );

    if (confirmar) {
      // Primero obtenemos los datos del evento que se va a eliminar
      const eventoRef = doc(db, "proximosEventos", id);
      const eventoDoc = await getDoc(eventoRef);

      if (!eventoDoc.exists()) {
        showErrorToast("El evento próximo no existe.");
        return false;
      }

      const datosEvento = eventoDoc.data();

      // Eliminar el evento
      await deleteDoc(eventoRef);

      // Notificar a los operadores sobre la eliminación del evento
      await notificarOperadoresEventoEliminado(id, datosEvento);

      showSuccessToast("Evento próximo eliminado correctamente");
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error al eliminar el evento próximo:", error);
    showErrorToast("Error al borrar el evento próximo.");
    return false;
  }
}

// Función para notificar a los operadores cuando se elimina un evento próximo
async function notificarOperadoresEventoEliminado(eventoId, datosEvento) {
  try {
    // 1. Obtener todos los usuarios con rol de operador
    const operadoresQuery = query(
      collection(db, "users"),
      where("role", "==", "operator")
    );

    const operadoresSnapshot = await getDocs(operadoresQuery);

    if (operadoresSnapshot.empty) {
      return;
    }

    // 2. Para cada operador, crear una notificación en Realtime Database
    const notificacionesPromises = [];

    // Formatear fechas para la notificación - Corregido para prevenir el desplazamiento de día
    // Crear fechas usando el constructor con partes separadas para evitar problemas de zona horaria
    const fechaInicioParts = datosEvento.fechaInicio.split("-");
    const fechaInicioObj = new Date(
      parseInt(fechaInicioParts[0]),
      parseInt(fechaInicioParts[1]) - 1,
      parseInt(fechaInicioParts[2])
    );
    const fechaInicioFormat = fechaInicioObj.toLocaleDateString("es-AR");

    let fechaFinFormat = fechaInicioFormat;
    if (datosEvento.fechaFin) {
      const fechaFinParts = datosEvento.fechaFin.split("-");
      const fechaFinObj = new Date(
        parseInt(fechaFinParts[0]),
        parseInt(fechaFinParts[1]) - 1,
        parseInt(fechaFinParts[2])
      );
      fechaFinFormat = fechaFinObj.toLocaleDateString("es-AR");
    }

    operadoresSnapshot.forEach((userDoc) => {
      const operadorId = userDoc.id;
      const notificacionesRef = ref(realdb, `notifications/${operadorId}`);
      const newNotificationRef = push(notificacionesRef);

      // Crear objeto de notificación
      const notificacion = {
        title: `Evento eliminado: ${datosEvento.nombre}`,
        body: `Se ha eliminado el evento programado para ${fechaInicioFormat}${
          datosEvento.fechaFin ? ` al ${fechaFinFormat}` : ""
        }`,
        read: false,
        timestamp: Date.now(),
        type: "proximo_evento_eliminado",
        eventoId: eventoId,
        data: {
          eventoEliminado: true,
          nombre: datosEvento.nombre,
          fechaInicio: datosEvento.fechaInicio,
          fechaFin: datosEvento.fechaFin,
          descripcion: datosEvento.descripcion,
        },
      };

      // Añadir promesa para enviar la notificación
      notificacionesPromises.push(set(newNotificationRef, notificacion));
    });

    // 3. Esperar a que todas las notificaciones se envíen
    await Promise.all(notificacionesPromises);

    return true;
  } catch (error) {
    console.error("Error al notificar eliminación:", error);
    return false;
  }
}

// Función para verificar si un usuario es administrador
export async function isUserAdmin(userId) {
  try {
    const userRef = doc(db, "users", userId);
    const userDoc = await getDoc(userRef);
    return userDoc.exists() && userDoc.data().role === "admin";
  } catch (error) {
    console.error("Error al verificar si el usuario es administrador:", error);
    return false;
  }
}

export async function updateProximoEvento(
  id,
  nombre,
  fechaInicio,
  fechaFin,
  descripcion
) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;

  // Verificar si el usuario es administrador
  try {
    const isAdmin = await isUserAdmin(currentUser.uid);
    if (!isAdmin) {
      showErrorToast(
        "Solo los administradores pueden editar eventos próximos."
      );
      return false;
    }

    // Primero obtenemos los datos actuales para poder notificar los cambios
    const eventoRef = doc(db, "proximosEventos", id);
    const eventoDoc = await getDoc(eventoRef);

    if (!eventoDoc.exists()) {
      showErrorToast("El evento próximo no existe.");
      return false;
    }

    const datosAnteriores = eventoDoc.data();

    // Actualizar el próximo evento
    await setDoc(
      eventoRef,
      {
        nombre,
        fechaInicio,
        fechaFin,
        descripcion,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // Notificar a los operadores sobre la modificación del evento
    await notificarOperadoresEventoModificado(
      id,
      nombre,
      fechaInicio,
      fechaFin,
      descripcion,
      datosAnteriores
    );

    showSuccessToast("Evento próximo actualizado correctamente");
    return true;
  } catch (error) {
    console.error("Error al actualizar el evento próximo:", error);
    showErrorToast("Error al actualizar el evento próximo.");
    return false;
  }
}

// Función para notificar a los operadores sobre un evento modificado
async function notificarOperadoresEventoModificado(
  eventoId,
  nombreNuevo,
  fechaInicioNueva,
  fechaFinNueva,
  descripcionNueva,
  datosAnteriores
) {
  try {
    // 1. Obtener todos los usuarios con rol de operador
    const operadoresQuery = query(
      collection(db, "users"),
      where("role", "==", "operator")
    );

    const operadoresSnapshot = await getDocs(operadoresQuery);

    if (operadoresSnapshot.empty) {
      return;
    }

    // 2. Identificar qué campos cambiaron
    const cambios = [];
    if (nombreNuevo !== datosAnteriores.nombre) {
      cambios.push(`Nombre: ${datosAnteriores.nombre} → ${nombreNuevo}`);
    }

    if (fechaInicioNueva !== datosAnteriores.fechaInicio) {
      // Formatear la fecha anterior con seguridad ante problemas de zona horaria
      const fechaInicioAnteriorParts = datosAnteriores.fechaInicio.split("-");
      const fechaInicioAnteriorObj = new Date(
        parseInt(fechaInicioAnteriorParts[0]),
        parseInt(fechaInicioAnteriorParts[1]) - 1,
        parseInt(fechaInicioAnteriorParts[2])
      );
      const fechaInicioAnteriorFormat =
        fechaInicioAnteriorObj.toLocaleDateString("es-AR");

      // Formatear la nueva fecha
      const fechaInicioNuevaParts = fechaInicioNueva.split("-");
      const fechaInicioNuevaObj = new Date(
        parseInt(fechaInicioNuevaParts[0]),
        parseInt(fechaInicioNuevaParts[1]) - 1,
        parseInt(fechaInicioNuevaParts[2])
      );
      const fechaInicioNuevaFormat =
        fechaInicioNuevaObj.toLocaleDateString("es-AR");

      cambios.push(
        `Fecha inicio: ${fechaInicioAnteriorFormat} → ${fechaInicioNuevaFormat}`
      );
    }

    if (fechaFinNueva !== datosAnteriores.fechaFin) {
      let fechaFinAnteriorFormat = "No definida";
      if (datosAnteriores.fechaFin) {
        const fechaFinAnteriorParts = datosAnteriores.fechaFin.split("-");
        const fechaFinAnteriorObj = new Date(
          parseInt(fechaFinAnteriorParts[0]),
          parseInt(fechaFinAnteriorParts[1]) - 1,
          parseInt(fechaFinAnteriorParts[2])
        );
        fechaFinAnteriorFormat =
          fechaFinAnteriorObj.toLocaleDateString("es-AR");
      }

      let fechaFinNuevaFormat = "No definida";
      if (fechaFinNueva) {
        const fechaFinNuevaParts = fechaFinNueva.split("-");
        const fechaFinNuevaObj = new Date(
          parseInt(fechaFinNuevaParts[0]),
          parseInt(fechaFinNuevaParts[1]) - 1,
          parseInt(fechaFinNuevaParts[2])
        );
        fechaFinNuevaFormat = fechaFinNuevaObj.toLocaleDateString("es-AR");
      }

      cambios.push(
        `Fecha fin: ${fechaFinAnteriorFormat} → ${fechaFinNuevaFormat}`
      );
    }

    if (descripcionNueva !== datosAnteriores.descripcion) {
      cambios.push("Descripción modificada");
    }

    // Si no hay cambios detectados, no enviar notificación
    if (cambios.length === 0) {
      return;
    }

    // 3. Para cada operador, crear una notificación en Realtime Database
    const notificacionesPromises = [];

    operadoresSnapshot.forEach((userDoc) => {
      const operadorId = userDoc.id;
      const notificacionesRef = ref(realdb, `notifications/${operadorId}`);
      const newNotificationRef = push(notificacionesRef);

      // Formatear fechas para la notificación
      const fechaInicioParts = fechaInicioNueva.split("-");
      const fechaInicioObj = new Date(
        parseInt(fechaInicioParts[0]),
        parseInt(fechaInicioParts[1]) - 1,
        parseInt(fechaInicioParts[2])
      );
      const fechaInicioFormat = fechaInicioObj.toLocaleDateString("es-AR");

      let fechaFinFormat = fechaInicioFormat;
      if (fechaFinNueva) {
        const fechaFinParts = fechaFinNueva.split("-");
        const fechaFinObj = new Date(
          parseInt(fechaFinParts[0]),
          parseInt(fechaFinParts[1]) - 1,
          parseInt(fechaFinParts[2])
        );
        fechaFinFormat = fechaFinObj.toLocaleDateString("es-AR");
      }

      // Crear objeto de notificación
      const notificacion = {
        title: `Evento modificado: ${nombreNuevo}`,
        body: `Se modificó el evento para ${fechaInicioFormat}${
          fechaFinNueva ? ` al ${fechaFinFormat}` : ""
        }\nCambios: ${cambios.join(", ")}`,
        read: false,
        timestamp: Date.now(),
        type: "proximo_evento_modificado",
        eventoId: eventoId,
        data: {
          nombre: nombreNuevo,
          fechaInicio: fechaInicioNueva,
          fechaFin: fechaFinNueva,
          descripcion: descripcionNueva,
          cambios: cambios,
        },
      };

      // Añadir promesa para enviar la notificación
      notificacionesPromises.push(set(newNotificationRef, notificacion));
    });

    // 4. Esperar a que todas las notificaciones se envíen
    await Promise.all(notificacionesPromises);

    return true;
  } catch (error) {
    console.error("Error al notificar modificación:", error);
    return false;
  }
}
