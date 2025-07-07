// filepath: /Users/fernandogabrielrusso/Desktop/planilla eventos/public/config.js
// Default values, actual values will be loaded from Firestore
export const DEFAULT_TARIFA_COMUN = 11000;
export const DEFAULT_TARIFA_FIN = 12700;
export const DEFAULT_TARIFA_OPERACION = 29000;
export const DEFAULT_TARIFA_HORA_EXTRA = 11000;

// Firestore Collection Names
export const COLLECTIONS = {
  EVENTOS: "eventos",
  GASTOS: "gastos",
  USER_PREFS: "userPrefs",
  CONFIG: "config",
  NOTIFICATIONS: "notifications",
};

// Global state (consider managing this more formally if complexity grows)
export let currentUser = null;
export let tarifaComunActual = DEFAULT_TARIFA_COMUN;
export let tarifaFinActual = DEFAULT_TARIFA_FIN;
export let tarifaOperacionActual = DEFAULT_TARIFA_OPERACION;
export let tarifaHoraExtraActual = DEFAULT_TARIFA_HORA_EXTRA;

export function setCurrentUser(user) {
  currentUser = user;
}

export function setTarifas(tarifas) {
  tarifaComunActual = tarifas.tarifaComun || DEFAULT_TARIFA_COMUN;
  tarifaFinActual = tarifas.tarifaFin || DEFAULT_TARIFA_FIN;
  tarifaOperacionActual = tarifas.tarifaOperacion || DEFAULT_TARIFA_OPERACION;
  tarifaHoraExtraActual = tarifas.tarifaHoraExtra || DEFAULT_TARIFA_HORA_EXTRA;
}

export function getCurrentUser() {
  return currentUser;
}
