import { db, auth, realdb } from "./firebase.config.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  addDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  ref,
  set,
  get,
  push,
  update,
  onValue,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";
import {
  showSuccessToast,
  showErrorToast,
  showInfoToast,
} from "./notifications.js";

let currentUser = null;
let currentTarifas = {
  tarifaComun: 0,
  tarifaFin: 0,
  tarifaOperacion: 0,
  tarifaHoraExtra: 0,
};

// Elementos del DOM
//let tarifaComunInput;
let tarifaFinInput;
let tarifaOperacionInput;
let tarifaHoraExtraInput; // Nuevo campo para horas extras
let saveTarifasButton;
let userSelect; // Selector para elegir usuario a visualizar
let userInfoDiv; // Div para mostrar info del usuario seleccionado
let eventosTableBody;
let gastosTableBody;
let logoutButtonAdmin;
let notificationForm; // Formulario para enviar notificaciones
let userTokensCache = {}; // Cache para tokens de usuarios
let showGlobalBtn;
let showUserBtn;
let globalTotalsSection;
let userDataSection;

// --- Listener de Autenticación y Rol ---
onAuthStateChanged(auth, async (user) => {
  const adminContent = document.getElementById("admin-content");
  const loginPromptAdmin = document.getElementById("login-prompt-admin");
  const loadingIndicatorAdmin = document.getElementById(
    "loading-indicator-admin"
  );

  if (loadingIndicatorAdmin) loadingIndicatorAdmin.style.display = "block";
  if (adminContent) adminContent.style.display = "none";
  if (loginPromptAdmin) loginPromptAdmin.style.display = "none";

  if (user) {
    currentUser = user;
    // Verificar si el usuario es administrador
    const userDocRef = doc(db, "users", user.uid);
    try {
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists() && userDocSnap.data().role === "admin") {
        // Es admin, mostrar contenido y cargar datos
        if (adminContent) adminContent.style.display = "block";
        if (loginPromptAdmin) loginPromptAdmin.style.display = "none";
        initializeAdminUI(); // Inicializar UI y cargar datos necesarios
      } else {
        // No es admin o no tiene rol definido, redirigir
        showErrorToast("Acceso denegado. Debes ser administrador.");
        window.location.href = "index.html"; // O a login.html
      }
    } catch (error) {
      showErrorToast("Error al verificar permisos. Intenta de nuevo.");
      if (loginPromptAdmin) loginPromptAdmin.style.display = "block"; // Mostrar mensaje de login/error
      if (loadingIndicatorAdmin) loadingIndicatorAdmin.style.display = "none";
    }
  } else {
    // No hay usuario, redirigir a login
    window.location.href = "login.html";
  }
  if (loadingIndicatorAdmin) loadingIndicatorAdmin.style.display = "none";
});

// --- Inicialización de UI y Datos para Admin ---
function initializeAdminUI() {
  // Obtener referencias a elementos del DOM
  //tarifaComunInput = document.getElementById("tarifa-comun-input");
  tarifaFinInput = document.getElementById("tarifa-fin-input");
  tarifaOperacionInput = document.getElementById("tarifa-operacion-input");
  tarifaHoraExtraInput = document.getElementById("tarifa-hora-extra-input"); // Inicializar campo de horas extras
  saveTarifasButton = document.getElementById("save-tarifas-button");
  userSelect = document.getElementById("user-select");
  userInfoDiv = document.getElementById("user-info");
  eventosTableBody = document.getElementById("admin-eventos-body");
  gastosTableBody = document.getElementById("admin-gastos-body");
  logoutButtonAdmin = document.getElementById("logout-button-admin");
  notificationForm = document.getElementById("notification-form");
  showGlobalBtn = document.getElementById("show-global-totals-btn");
  showUserBtn = document.getElementById("show-user-totals-btn");
  globalTotalsSection = document.getElementById("global-totals");
  userDataSection = document.getElementById("user-data-section");

  // Cargar tarifas actuales
  loadAndDisplayTarifas();

  // Cargar lista de usuarios
  loadUsers();

  // Configurar listeners de botones y selectores
  if (saveTarifasButton) {
    saveTarifasButton.addEventListener("click", saveTarifas);
  }
  if (userSelect) {
    userSelect.addEventListener("change", handleUserSelection);
  }
  if (showGlobalBtn) showGlobalBtn.addEventListener("click", showGlobalTotals);
  if (showUserBtn) showUserBtn.addEventListener("click", showUserTotals);
  if (logoutButtonAdmin) {
    logoutButtonAdmin.onclick = async () => {
      try {
        await signOut(auth);
        window.location.href = "login.html";
      } catch (error) {
        showErrorToast("Error al cerrar sesión.");
      }
    };
  }
  if (notificationForm) {
    notificationForm.addEventListener("submit", sendNotification);
  }

  // Activar tema oscuro si está guardado en localStorage
  if (localStorage.getItem("dark-mode") === "true") {
    document.documentElement.classList.add("dark");
    const themeIcon = document.getElementById("theme-icon");
    if (themeIcon) themeIcon.textContent = "☀️";
  }

  // Inicializar theme toggle
  const themeToggle = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      document.documentElement.classList.toggle("dark");
      // Cambiar el ícono según el tema
      if (document.documentElement.classList.contains("dark")) {
        themeIcon.textContent = "☀️"; // Sol para modo oscuro
        localStorage.setItem("dark-mode", "true");
      } else {
        themeIcon.textContent = "🌙"; // Luna para modo claro
        localStorage.setItem("dark-mode", "false");
      }
    });
  }

  document
    .getElementById("proximo-evento-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nombre = document.getElementById("proximo-nombre").value.trim();
      const fechaInicio = document.getElementById("proximo-fecha-inicio").value;
      const fechaFin = document.getElementById("proximo-fecha-fin").value;
      const descripcion = document
        .getElementById("proximo-descripcion")
        .value.trim();

      if (!nombre || !fechaInicio || !fechaFin || !descripcion) {
        Toastify({
          text: "Completa todos los campos.",
          backgroundColor: "#e53e3e",
          duration: 3000,
        }).showToast();
        return;
      }

      // Validar que la fecha fin no sea anterior a la fecha inicio
      if (fechaFin < fechaInicio) {
        Toastify({
          text: "La fecha de fin no puede ser anterior a la fecha de inicio.",
          backgroundColor: "#e53e3e",
          duration: 3000,
        }).showToast();
        return;
      }

      const { addProximoEvento } = await import("./firestoreService.js");
      await addProximoEvento(nombre, fechaInicio, fechaFin, descripcion);
      e.target.reset();
    });
}

// --- Gestión de Tarifas ---
async function loadAndDisplayTarifas() {
  const configDocRef = doc(db, "config", "tarifas");
  try {
    const docSnap = await getDoc(configDocRef);
    if (docSnap.exists()) {
      currentTarifas = docSnap.data();
      //   if (tarifaComunInput)
      //     tarifaComunInput.value = currentTarifas.tarifaComun || 0;
      if (tarifaFinInput) tarifaFinInput.value = currentTarifas.tarifaFin || 0;
      if (tarifaOperacionInput)
        tarifaOperacionInput.value = currentTarifas.tarifaOperacion || 29000; // Valor por defecto 29000
      if (tarifaHoraExtraInput)
        tarifaHoraExtraInput.value = currentTarifas.tarifaHoraExtra || 20000; // Valor por defecto 20000
    } else {
      // Si no existe, crear con valores por defecto
      currentTarifas = {
        tarifaComun: 11000,
        tarifaFin: 12700,
        tarifaOperacion: 29000,
        tarifaHoraExtra: 20000, // Valor por defecto para horas extras
      };
      await setDoc(configDocRef, currentTarifas);
      //   if (tarifaComunInput) tarifaComunInput.value = currentTarifas.tarifaComun;
      if (tarifaFinInput) tarifaFinInput.value = currentTarifas.tarifaFin;
      if (tarifaOperacionInput)
        tarifaOperacionInput.value = currentTarifas.tarifaOperacion;
      if (tarifaHoraExtraInput)
        tarifaHoraExtraInput.value = currentTarifas.tarifaHoraExtra;
    }
  } catch (error) {
    showErrorToast("Error al cargar las tarifas.");
  }
}

async function saveTarifas() {
  //   const nuevaTarifaComun = parseFloat(tarifaComunInput.value);
  const nuevaTarifaFin = parseFloat(tarifaFinInput.value);
  const nuevaTarifaOperacion = parseFloat(tarifaOperacionInput.value);
  const nuevaTarifaHoraExtra = parseFloat(tarifaHoraExtraInput.value);

  if (
    //isNaN(nuevaTarifaComun) ||
    isNaN(nuevaTarifaFin) ||
    isNaN(nuevaTarifaOperacion) ||
    isNaN(nuevaTarifaHoraExtra) ||
    // nuevaTarifaComun < 0 ||
    nuevaTarifaFin < 0 ||
    nuevaTarifaOperacion < 0 ||
    nuevaTarifaHoraExtra < 0
  ) {
    showErrorToast(
      "Por favor, ingresa valores numéricos válidos para todas las tarifas."
    );
    return;
  }

  const configDocRef = doc(db, "config", "tarifas");
  try {
    // Primero actualizar el estado local para asegurar cálculos correctos
    currentTarifas = {
      //   tarifaComun: nuevaTarifaComun,
      tarifaFin: nuevaTarifaFin,
      tarifaOperacion: nuevaTarifaOperacion,
      tarifaHoraExtra: nuevaTarifaHoraExtra,
    };

    // Luego guardar en Firestore
    await setDoc(configDocRef, currentTarifas);

    showSuccessToast("Tarifas actualizadas correctamente.");

    // Si hay un usuario seleccionado, recargar sus datos para reflejar el cambio
    if (userSelect && userSelect.value) {
      // Cancelar listeners existentes antes de recargar
      if (eventsListenerSubscription) eventsListenerSubscription();
      if (expensesListenerSubscription) expensesListenerSubscription();

      // Recargar datos
      displayUserInfo(userSelect.value);
      listenToUserEvents(userSelect.value);
      listenToUserExpenses(userSelect.value);
    }
  } catch (error) {
    showErrorToast("Error al guardar las tarifas.");
  }
}

// --- Gestión de Usuarios ---
async function loadUsers() {
  if (!userSelect) return;
  userSelect.innerHTML = '<option value="">Selecciona un usuario...</option>'; // Opción por defecto

  try {
    const usersQuery = query(collection(db, "users")); // Asume una colección 'users'
    const querySnapshot = await getDocs(usersQuery);
    querySnapshot.forEach((doc) => {
      const userData = doc.data();
      const option = document.createElement("option");
      option.value = doc.id; // Guardar el UID del usuario
      option.textContent = userData.email || doc.id; // Mostrar email o UID
      userSelect.appendChild(option);
    });
  } catch (error) {
    showErrorToast("No se pudo cargar la lista de usuarios.");
  }
}

// --- Visualización de Datos de Usuario Seleccionado ---
let eventsListenerSubscription = null; // Para cancelar listener anterior
let expensesListenerSubscription = null; // Para cancelar listener anterior

function handleUserSelection() {
  const selectedUserId = userSelect.value;

  // Cancelar listeners anteriores si existen
  if (eventsListenerSubscription) eventsListenerSubscription();
  if (expensesListenerSubscription) expensesListenerSubscription();

  // Limpiar tablas e info anterior
  if (eventosTableBody) eventosTableBody.innerHTML = "";
  if (gastosTableBody) gastosTableBody.innerHTML = "";
  if (userInfoDiv) userInfoDiv.innerHTML = "";

  if (selectedUserId) {
    // Mostrar info básica (opcional, cargar desde 'users')
    displayUserInfo(selectedUserId);
    // Escuchar eventos y gastos del usuario seleccionado
    listenToUserEvents(selectedUserId);
    listenToUserExpenses(selectedUserId);
    // Cargar tokens del usuario para notificaciones
    loadUserTokens(selectedUserId);
  }
}

async function displayUserInfo(userId) {
  if (!userInfoDiv) return;
  try {
    const userDocRef = doc(db, "users", userId);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();

      // Inicializar sueldoFijo con 0 por defecto
      let sueldoFijo = 0;
      let prefErrorMessage = "";

      // Intentar cargar el sueldo fijo, pero no bloquear si falla
      try {
        const prefDocRef = doc(db, "userPrefs", userId);
        const prefDocSnap = await getDoc(prefDocRef);
        if (prefDocSnap.exists()) {
          sueldoFijo = prefDocSnap.data().sueldoFijo || 0;
        }
      } catch (prefError) {
        // Capturar el mensaje de error para mostrarlo en la UI
        if (prefError.code === "permission-denied") {
          prefErrorMessage = `<p class="text-amber-500 text-sm">(Sin permisos para acceder a las preferencias de este usuario)</p>`;
        } else {
          prefErrorMessage = `<p class="text-amber-500 text-sm">(Error al cargar preferencias: ${prefError.message})</p>`;
        }
      }

      userInfoDiv.innerHTML = `
                <p><strong>Usuario:</strong> ${userData.email || userId}</p>
                <p><strong>Rol:</strong> ${userData.role || "Usuario"}</p>
                <p><strong>Sueldo Fijo Registrado:</strong> $${(
                  sueldoFijo || 0
                ).toLocaleString()} ${prefErrorMessage}</p>
             `;
    } else {
      // Usuario no encontrado en base de datos
      userInfoDiv.innerHTML = `<p class="text-red-500">Usuario no encontrado en la base de datos.</p>`;
    }
  } catch (error) {
    userInfoDiv.innerHTML = `<p class="text-red-500">Error al cargar información: ${
      error.message || "Error desconocido"
    }</p>`;
  }
}

async function loadUserTokens(userId) {
  try {
    const tokenDocRef = doc(db, "userTokens", userId);
    const tokenDoc = await getDoc(tokenDocRef);

    if (tokenDoc.exists()) {
      const tokenData = tokenDoc.data();
      // Guardar tokens en cache
      userTokensCache[userId] = tokenData.tokens
        ? Object.keys(tokenData.tokens)
        : [];
    } else {
      userTokensCache[userId] = [];
    }
  } catch (error) {
    userTokensCache[userId] = [];
  }
}

function listenToUserEvents(userId) {
  const qEventos = query(
    collection(db, "eventos"),
    where("userId", "==", userId)
    // Puedes añadir orderBy si tienes índices configurados
    // orderBy("fecha", "desc")
  );

  // Guardar la función de cancelación devuelta por onSnapshot
  eventsListenerSubscription = onSnapshot(
    qEventos,
    (snapshot) => {
      renderUserEvents(snapshot.docs);
    },
    (error) => {
      if (eventosTableBody)
        eventosTableBody.innerHTML =
          '<tr><td colspan="8">Error al cargar eventos.</td></tr>';
    }
  );
}

function listenToUserExpenses(userId) {
  const qGastos = query(
    collection(db, "gastos"),
    where("userId", "==", userId)
    // orderBy("fecha", "desc")
  );

  // Guardar la función de cancelación
  expensesListenerSubscription = onSnapshot(
    qGastos,
    (snapshot) => {
      renderUserExpenses(snapshot.docs);
    },
    (error) => {
      if (gastosTableBody)
        gastosTableBody.innerHTML =
          '<tr><td colspan="4">Error al cargar gastos.</td></tr>';
    }
  );
}

// --- Renderizado de Tablas para Admin ---

// Necesitamos una función similar a calcularPagoEvento aquí, usando las tarifas actuales
function calcularPagoEventoAdmin(fechaStr, horaEntrada, horaSalida, operacion) {
  if (!fechaStr || !horaEntrada || !horaSalida) {
    return { pagoBase: 0, horasExtra: 0, pagoExtra: 0, pagoTotalEvento: 0 };
  }
  const fecha = new Date(`${fechaStr}T00:00:00`);
  const diaSemana = fecha.getDay(); // 0=Dom,6=Sáb
  const entrada = new Date(`${fechaStr}T${horaEntrada}`);
  let salida = new Date(`${fechaStr}T${horaSalida}`);
  if (salida < entrada) salida.setDate(salida.getDate() + 1);
  const horasTotales = (salida - entrada) / (1000 * 60 * 60);

  let pagoBase = 0;
  let horasExtra = 0;
  let pagoExtra = 0;
  let pagoTotalEvento = 0;

  const esFinSemana = diaSemana === 0 || diaSemana === 6;
  if (esFinSemana) {
    // Todas las horas al tarifa de fin de semana
    pagoBase = horasTotales * (currentTarifas.tarifaFin || 0);
    // Calcular horas extra: contar todas las horas en fin de semana
    horasExtra = horasTotales;
    pagoExtra = 0; // no pago adicional aparte de tarifaFin
  } else {
    // Primeras 7 horas a tarifa común
    const horasNormales = Math.min(horasTotales, 7);
    pagoBase = horasNormales * (currentTarifas.tarifaComun || 0);
    // Horas extra
    if (horasTotales > 7) {
      horasExtra = horasTotales - 7;
      pagoExtra = horasExtra * (currentTarifas.tarifaHoraExtra || 0);
    }
  }
  // Sumar operación si aplica
  if (operacion) {
    pagoBase += currentTarifas.tarifaOperacion || 0;
  }
  // Pago total
  pagoTotalEvento = pagoBase + pagoExtra;
  return { pagoBase, horasExtra, pagoExtra, pagoTotalEvento };
}

// Función auxiliar para obtener nombre del día (puede ser compartida o duplicada)
function getDayNameAdmin(fechaStr) {
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

function renderUserEvents(eventDocs) {
  if (!eventosTableBody) return;
  eventosTableBody.innerHTML = ""; // Limpiar tabla
  let totalPago = 0;
  let totalHorasExtra = 0;

  // Ordenar por fecha descendente antes de renderizar
  const sortedEvents = eventDocs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  if (sortedEvents.length === 0) {
    eventosTableBody.innerHTML =
      '<tr><td colspan="8" class="text-center py-4">No hay eventos para mostrar.</td></tr>';
    // Actualizar totales en cero
    const totalPagoUserSpan = document.getElementById("total-pago-user");
    const totalHorasUserSpan = document.getElementById("total-horas-user");
    if (totalPagoUserSpan) totalPagoUserSpan.textContent = "0";
    if (totalHorasUserSpan) totalHorasUserSpan.textContent = "0";
    return;
  }

  sortedEvents.forEach((evento) => {
    const row = eventosTableBody.insertRow();

    // Calcular horas extra para display independiente de cálculo de pago
    let horasExtraDisplay = 0;
    try {
      const entradaDate = new Date(`${evento.fecha}T${evento.horaEntrada}`);
      let salidaDate = new Date(`${evento.fecha}T${evento.horaSalida}`);
      if (salidaDate < entradaDate)
        salidaDate.setDate(salidaDate.getDate() + 1);
      const totalHorasCalc = (salidaDate - entradaDate) / (1000 * 60 * 60);
      // Determinar si es fin de semana
      const diaDate = new Date(`${evento.fecha}T00:00:00`);
      const diaSemanaCalc = diaDate.getDay(); // 0=Dom,6=Sáb
      const esFinSemanaCalc = diaSemanaCalc === 0 || diaSemanaCalc === 6;
      if (esFinSemanaCalc) {
        horasExtraDisplay = totalHorasCalc;
      } else {
        horasExtraDisplay = totalHorasCalc > 7 ? totalHorasCalc - 7 : 0;
      }
    } catch (e) {}

    // Usar la función de cálculo de admin con las tarifas actuales
    const calculoPago = calcularPagoEventoAdmin(
      evento.fecha,
      evento.horaEntrada,
      evento.horaSalida,
      evento.operacion
    );

    totalPago += calculoPago.pagoTotalEvento;
    // Sumar horas extra mostradas (incluye horas completas en fin de semana)
    totalHorasExtra += horasExtraDisplay;

    // Formatear el día
    const dia = evento.fecha ? evento.fecha.split("-")[2] : "";

    row.innerHTML = `
      <td>${evento.evento || ""}</td>
      <td>${dia}</td>
      <td>${getDayNameAdmin(evento.fecha)}</td>
      <td>${evento.horaEntrada || ""}</td>
      <td>${evento.horaSalida || ""}</td>
      <td>${evento.operacion ? "Sí" : "No"}</td>
      <td>${Math.round(horasExtraDisplay)}</td>
      <td>$${calculoPago.pagoTotalEvento.toLocaleString()}</td>
    `;
  });

  // Actualizar elementos del DOM con los totales
  const totalPagoUserSpan = document.getElementById("total-pago-user");
  const totalHorasUserSpan = document.getElementById("total-horas-user");
  if (totalPagoUserSpan)
    totalPagoUserSpan.textContent = totalPago.toLocaleString();
  if (totalHorasUserSpan)
    totalHorasUserSpan.textContent = Math.round(totalHorasExtra);
}

function renderUserExpenses(expenseDocs) {
  if (!gastosTableBody) return;
  gastosTableBody.innerHTML = ""; // Limpiar tabla
  let totalGastos = 0;

  // Ordenar por fecha descendente
  const sortedExpenses = expenseDocs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  if (sortedExpenses.length === 0) {
    gastosTableBody.innerHTML =
      '<tr><td colspan="2" class="text-center py-4">No hay gastos para mostrar.</td></tr>'; // Colspan ajustado a 2
    // Actualizar total en cero
    const totalGastosUserSpan = document.getElementById("total-gastos-user");
    if (totalGastosUserSpan) totalGastosUserSpan.textContent = "0";
    return;
  }

  sortedExpenses.forEach((gasto) => {
    const row = gastosTableBody.insertRow();
    const monto = gasto.monto || 0;
    totalGastos += monto;

    row.innerHTML = `
      <td>${gasto.descripcion || ""}</td>
      <td>$${monto.toLocaleString()}</td>
       <!-- Podrías añadir un botón de borrar si el admin puede borrar gastos de otros -->
    `;
  });

  // Actualizar algún elemento del DOM si quieres mostrar este total
  const totalGastosUserSpan = document.getElementById("total-gastos-user");
  if (totalGastosUserSpan)
    totalGastosUserSpan.textContent = totalGastos.toLocaleString();
}

// --- Sistema de Notificaciones Push con Realtime Database ---
async function sendNotification(event) {
  event.preventDefault();

  const userId = userSelect.value;
  if (!userId) {
    showErrorToast("Debes seleccionar un usuario para enviar la notificación");
    return;
  }

  const title = document.getElementById("notification-title").value;
  const body = document.getElementById("notification-body").value;

  if (!title || !body) {
    showErrorToast("Debes completar el título y el mensaje de la notificación");
    return;
  }

  try {
    // Verificar si el usuario existe
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      showErrorToast("El usuario seleccionado no existe");
      return;
    }

    // Crear una nueva notificación en Realtime Database
    const notificationsRef = ref(realdb, `notifications/${userId}`);
    // Generar un ID único para la notificación
    const newNotificationRef = push(notificationsRef);

    // Datos de la notificación
    const notificationData = {
      title: title,
      body: body,
      read: false,
      timestamp: Date.now(),
      sentBy: currentUser.uid,
      type: "admin",
    };

    // Realizar la escritura utilizando una promesa
    await set(newNotificationRef, notificationData);

    showSuccessToast("Notificación enviada correctamente");

    // Limpiar el formulario
    document.getElementById("notification-title").value = "";
    document.getElementById("notification-body").value = "";
  } catch (error) {
    showErrorToast("Error al enviar la notificación: " + error.message);
  }
}

// Funcionalidad para alternar entre vista por usuario y totales globales
document.addEventListener("DOMContentLoaded", () => {
  const showGlobalBtn = document.getElementById("show-global-totals-btn");
  const showUserBtn = document.getElementById("show-user-totals-btn");
  const userSection = document.getElementById("user-data-section");
  const globalSection = document.getElementById("global-totals");

  if (showGlobalBtn) {
    showGlobalBtn.addEventListener("click", () => {
      if (userSection) userSection.classList.add("hidden");
      if (globalSection) globalSection.classList.remove("hidden");
      loadGlobalTotals();
    });
  }
  if (showUserBtn) {
    showUserBtn.addEventListener("click", () => {
      if (globalSection) globalSection.classList.add("hidden");
      if (userSection) userSection.classList.remove("hidden");
    });
  }
});

// Cálculo y despliegue de totales globales de todos los usuarios
async function loadGlobalTotals() {
  let totalPago = 0;
  let totalHorasExtra = 0;
  let totalGastos = 0;
  try {
    // Obtener todos los eventos
    const eventosSnapshot = await getDocs(collection(db, "eventos"));
    eventosSnapshot.forEach((docSnap) => {
      const ev = docSnap.data();
      const calc = calcularPagoEventoAdmin(
        ev.fecha,
        ev.horaEntrada,
        ev.horaSalida,
        ev.operacion
      );
      totalPago += calc.pagoTotalEvento;
      totalHorasExtra += calc.horasExtra;
    });
    // Obtener todos los gastos
    const gastosSnapshot = await getDocs(collection(db, "gastos"));
    gastosSnapshot.forEach((docSnap) => {
      const g = docSnap.data();
      totalGastos += g.monto || 0;
    });
    // Actualizar DOM
    const pagoAll = document.getElementById("total-pago-all");
    const horasAll = document.getElementById("total-horas-all");
    const gastosAll = document.getElementById("total-gastos-all");
    if (pagoAll) pagoAll.textContent = totalPago.toLocaleString();
    if (horasAll) horasAll.textContent = Math.round(totalHorasExtra);
    if (gastosAll) gastosAll.textContent = totalGastos.toLocaleString();
  } catch (error) {
  }
}

// Mostrar sección de totales globales
async function showGlobalTotals() {
  await loadGlobalTotals();
  if (userDataSection) userDataSection.classList.add("hidden");
  if (globalTotalsSection) globalTotalsSection.classList.remove("hidden");
}

// Volver a datos por usuario
function showUserTotals() {
  if (globalTotalsSection) globalTotalsSection.classList.add("hidden");
  if (userDataSection) userDataSection.classList.remove("hidden");
}
