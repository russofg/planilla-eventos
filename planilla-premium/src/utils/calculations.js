// Default Tarifas constants to use when the DB doesn't have them yet or while loading.
export const DEFAULT_TARIFA_COMUN = 2000;
export const DEFAULT_TARIFA_FIN = 2500;
export const DEFAULT_TARIFA_OPERACION = 5000;
export const DEFAULT_TARIFA_HORA_EXTRA = 3000;

export function calcularPagoEvento(
  fechaStr,
  horaEntrada,
  horaSalida,
  operacion,
  feriado = false,
  tarifas = {
    tarifaFin: DEFAULT_TARIFA_FIN,
    tarifaHoraExtra: DEFAULT_TARIFA_HORA_EXTRA,
    tarifaOperacion: DEFAULT_TARIFA_OPERACION,
  }
) {
  if (!fechaStr || !horaEntrada || !horaSalida) {
    return {
      horasExtra: 0,
      pagoExtra: 0,
      pagoOperacion: 0,
      pagoTotalEvento: 0,
      detalle: "Faltan datos",
      horasVividas: 0
    };
  }

  try {
    const entrada = new Date(`${fechaStr}T${horaEntrada}`);
    let salida = new Date(`${fechaStr}T${horaSalida}`);
    if (salida < entrada) salida.setDate(salida.getDate() + 1); // Midnight rollover

    // Acumulamos por minuto para luego redondear a horas enteras (hacia arriba) donde corresponde.
    let minutosFinDeSemanaOFeriado = 0;
    let minutosExtraManana = 0; // hábil: antes de las 10:00
    let minutosExtraTarde = 0; // hábil: desde las 17:00 en adelante
    let horasAdentroSueldo = 0; // The 10:00 to 17:00 hours (sin redondeo; jornada base)

    // Iterate minute by minute to get highly accurate boundaries regardless of midnight crossovers
    for (let current = new Date(entrada); current < salida; current.setMinutes(current.getMinutes() + 1)) {
        const currentDia = current.getDay(); // 0=Sun, 6=Sat
        const currentHora = current.getHours();
        const esFinDeSemana = currentDia === 0 || currentDia === 6;

        if (feriado || esFinDeSemana) {
            minutosFinDeSemanaOFeriado += 1;
        } else {
            // Días hábiles: jornada 10:00–17:00 dentro del sueldo; fuera = extra
            if (currentHora >= 10 && currentHora < 17) {
                horasAdentroSueldo += 1 / 60;
            } else if (currentHora < 10) {
                minutosExtraManana += 1;
            } else {
                minutosExtraTarde += 1;
            }
        }
    }

    // Fin de semana / feriado: mínimo 8 h y total redondeado hacia arriba (ej. 12,5 h → 13 h)
    let horasFinDeSemanaOFeriado = minutosFinDeSemanaOFeriado / 60;
    horasFinDeSemanaOFeriado = Math.round(horasFinDeSemanaOFeriado * 100) / 100;
    if (horasFinDeSemanaOFeriado > 0) {
        horasFinDeSemanaOFeriado = Math.ceil(Math.max(8, horasFinDeSemanaOFeriado));
    }

    // Día hábil: extras antes de 10 y después de 17, cada bloque redondeado hacia arriba por separado
    // (ej. 8:30–10:00 = 1,5 h → 2 h; 17:00–21:30 = 4,5 h → 5 h)
    let horasExtraHabiles = 0;
    if (minutosExtraManana > 0) {
        horasExtraHabiles += Math.ceil(minutosExtraManana / 60);
    }
    if (minutosExtraTarde > 0) {
        horasExtraHabiles += Math.ceil(minutosExtraTarde / 60);
    }

    horasAdentroSueldo = Math.round(horasAdentroSueldo * 100) / 100;

    const pagoHorasFin = horasFinDeSemanaOFeriado * tarifas.tarifaFin;
    const pagoHorasExtra = horasExtraHabiles * tarifas.tarifaHoraExtra;
    
    const horasExtraTotal = horasFinDeSemanaOFeriado + horasExtraHabiles;
    const pagoExtra = pagoHorasFin + pagoHorasExtra;
    
    let pagoOperacion = 0;
    if (operacion) {
        pagoOperacion = tarifas.tarifaOperacion;
    }

    const pagoTotal = pagoExtra + pagoOperacion;

    return { 
        horasExtra: Math.round(horasExtraTotal * 10) / 10, 
        pagoExtra, 
        pagoOperacion, 
        pagoTotalEvento: pagoTotal,
        horasAdentroSueldo: Math.round(horasAdentroSueldo * 10) / 10
    };
  } catch (e) {
    return { horasExtra: 0, pagoExtra: 0, pagoOperacion: 0, pagoTotalEvento: 0, horasAdentroSueldo: 0 };
  }
}
