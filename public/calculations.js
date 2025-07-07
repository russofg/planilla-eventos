// filepath: /Users/fernandogabrielrusso/Desktop/planilla eventos/public/calculations.js
import {
  tarifaFinActual,
  tarifaHoraExtraActual,
  tarifaOperacionActual,
} from "./config.js";

// Función para calcular el pago de un evento (usando tarifas importadas)
export function calcularPagoEvento(
  fechaStr,
  horaEntrada,
  horaSalida,
  operacion,
  feriado = false
) {
  if (!fechaStr || !horaEntrada || !horaSalida) {
    return {
      horasExtra: 0,
      pagoExtra: 0,
      pagoOperacion: 0,
      pagoTotalEvento: 0,
    };
  }

  try {
    // Parsear tiempos y manejar cruce de día
    const fecha = new Date(`${fechaStr}T00:00:00`);
    const entrada = new Date(`${fechaStr}T${horaEntrada}`);
    let salida = new Date(`${fechaStr}T${horaSalida}`);
    if (salida < entrada) salida.setDate(salida.getDate() + 1);

    const diffMillis = salida - entrada;
    const horasTotales = diffMillis / (1000 * 60 * 60);

    // Determinar si es fin de semana o feriado
    const diaSemana = fecha.getDay(); // 0=Dom,6=Sáb
    const esFinSemana = diaSemana === 0 || diaSemana === 6;
    const esFeriado = feriado === true;

    let horasExtra = 0;
    let pagoExtra = 0;
    let pagoOperacion = 0;
    let pagoTotal = 0;

    if (esFinSemana || esFeriado) {
      // FERIADO O FIN DE SEMANA: Todas las horas a tarifa de fin de semana
      horasExtra = horasTotales;
      pagoExtra = horasTotales * tarifaFinActual;
    } else {
      // DÍA NORMAL: Solo horas extra (más de 7)
      if (horasTotales > 7) {
        horasExtra = horasTotales - 7;
        pagoExtra = horasExtra * tarifaHoraExtraActual;
      }
    }

    if (operacion) pagoOperacion = tarifaOperacionActual;

    pagoTotal = pagoExtra + pagoOperacion;
    return { horasExtra, pagoExtra, pagoOperacion, pagoTotalEvento: pagoTotal };
  } catch (e) {
    return {
      horasExtra: 0,
      pagoExtra: 0,
      pagoOperacion: 0,
      pagoTotalEvento: 0,
    };
  }
}
