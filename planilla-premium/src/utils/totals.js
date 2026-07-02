import { calcularPagoEvento } from "./calculations.js";

/**
 * Sums the payout of all events by delegating to calcularPagoEvento.
 * @param {Array} events
 * @param {Object} tarifas
 * @returns {number}
 */
export function sumEventos(events, tarifas) {
  return events.reduce((acc, e) => {
    const { pagoTotalEvento } = calcularPagoEvento(
      e.fecha,
      e.horaEntrada,
      e.horaSalida,
      e.operacion,
      e.feriado,
      tarifas
    );
    return acc + pagoTotalEvento;
  }, 0);
}

/**
 * Sums the monto of all expenses. Missing or undefined monto is treated as 0.
 * @param {Array} expenses
 * @returns {number}
 */
export function sumGastos(expenses) {
  return expenses.reduce((acc, e) => acc + (e.monto || 0), 0);
}

/**
 * Aggregates extras by tipo into { bonos, aguinaldo, adelantos }.
 * Recognized tipos: "bono" → bonos, "aguinaldo" → aguinaldo, "adelanto" → adelantos.
 * Unknown tipos are ignored. Missing monto defaults to 0.
 * @param {Array} extras
 * @returns {{ bonos: number, aguinaldo: number, adelantos: number }}
 */
export function sumExtras(extras) {
  let bonos = 0;
  let aguinaldo = 0;
  let adelantos = 0;
  extras.forEach((ext) => {
    if (ext.tipo === "bono") bonos += ext.monto || 0;
    else if (ext.tipo === "aguinaldo") aguinaldo += ext.monto || 0;
    else if (ext.tipo === "adelanto") adelantos += ext.monto || 0;
  });
  return { bonos, aguinaldo, adelantos };
}

/**
 * Assembles the final total from ALREADY-SUMMED category values.
 * This is the single source of truth for the final-total formula.
 * Formula: sueldoFijo + eventos + gastos + bonos + aguinaldo - adelantos
 * @param {{ sueldoFijo: number, eventos: number, gastos: number, bonos: number, aguinaldo: number, adelantos: number }} param
 * @returns {number}
 */
export function assembleTotalFinal({ sueldoFijo, eventos, gastos, bonos, aguinaldo, adelantos }) {
  return sueldoFijo + eventos + gastos + bonos + aguinaldo - adelantos;
}

/**
 * Computes the final total.
 * Formula: sueldoFijo + sumEventos + sumGastos + bonos + aguinaldo - adelantos
 * @param {{ sueldoFijo: number, events: Array, expenses: Array, extras: Array, tarifas: Object }} param
 * @returns {number}
 */
export function calcTotalFinal({ sueldoFijo, events, expenses, extras, tarifas }) {
  const eventos = sumEventos(events, tarifas);
  const gastos = sumGastos(expenses);
  const { bonos, aguinaldo, adelantos } = sumExtras(extras);
  return assembleTotalFinal({ sueldoFijo, eventos, gastos, bonos, aguinaldo, adelantos });
}
