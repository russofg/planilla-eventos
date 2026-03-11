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
    const fecha = new Date(`${fechaStr}T00:00:00`);
    const entrada = new Date(`${fechaStr}T${horaEntrada}`);
    let salida = new Date(`${fechaStr}T${horaSalida}`);
    if (salida < entrada) salida.setDate(salida.getDate() + 1); // Midnight rollover

    let horasFinDeSemanaOFeriado = 0;
    let horasExtraHabiles = 0;
    let horasAdentroSueldo = 0; // The 10:00 to 17:00 hours

    // Iterate minute by minute to get highly accurate boundaries regardless of midnight crossovers
    for (let current = new Date(entrada); current < salida; current.setMinutes(current.getMinutes() + 1)) {
        const currentDia = current.getDay(); // 0=Sun, 6=Sat
        const currentHora = current.getHours();
        const esFinDeSemana = currentDia === 0 || currentDia === 6;
        
        if (feriado || esFinDeSemana) {
            horasFinDeSemanaOFeriado += (1 / 60);
        } else {
            // Días hábiles
            if (currentHora >= 10 && currentHora < 17) {
                horasAdentroSueldo += (1 / 60); // 10:00 -> 16:59:59 is base salary
            } else {
                horasExtraHabiles += (1 / 60); // <10:00 or >=17:00
            }
        }
    }

    // Round safely after loop to avoid floating point math accumulating errors
    horasFinDeSemanaOFeriado = Math.round(horasFinDeSemanaOFeriado * 100) / 100;
    horasExtraHabiles = Math.round(horasExtraHabiles * 100) / 100;
    horasAdentroSueldo = Math.round(horasAdentroSueldo * 100) / 100;

    // Apply minimum 8 hours rule (jornal mínimo) for weekends/holidays
    if (horasFinDeSemanaOFeriado > 0 && horasFinDeSemanaOFeriado < 8) {
        horasFinDeSemanaOFeriado = 8;
    }

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
