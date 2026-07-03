import { describe, it, expect } from "vitest";
import {
  calcularPagoEvento,
  DEFAULT_TARIFA_FIN_FIJO,
} from "../src/utils/calculations.js";

// Fixed tarifas used across the suite (mirrors tests/totals.test.js).
const TARIFAS = {
  tarifaFin: 12700, // weekend/holiday hourly rate (> 8h)
  tarifaFinFijo: 120000, // weekend/holiday flat rate (<= 8h)
  tarifaOperacion: 29000,
  tarifaHoraExtra: 20000, // weekday extra hour rate
};

// Reference dates:
//   2024-01-05 = Friday  2024-01-06 = Saturday  2024-01-08 = Monday
const MON = "2024-01-08";
const SAT = "2024-01-06";
const FRI = "2024-01-05";

describe("calcularPagoEvento — missing data guard", () => {
  it("returns the 'Faltan datos' shape when fecha is empty", () => {
    const r = calcularPagoEvento("", "10:00", "17:00", false, false, TARIFAS);
    expect(r.pagoTotalEvento).toBe(0);
    expect(r.detalle).toBe("Faltan datos");
  });

  it("returns zeros when horaEntrada is missing", () => {
    expect(calcularPagoEvento(MON, "", "17:00", false, false, TARIFAS).pagoTotalEvento).toBe(0);
  });

  it("returns zeros when horaSalida is missing", () => {
    expect(calcularPagoEvento(MON, "10:00", "", false, false, TARIFAS).pagoTotalEvento).toBe(0);
  });
});

describe("calcularPagoEvento — weekday shifts", () => {
  it("pays nothing extra for a shift fully inside the base 10:00-17:00 window", () => {
    const r = calcularPagoEvento(MON, "10:00", "17:00", false, false, TARIFAS);
    expect(r.pagoExtra).toBe(0);
    expect(r.pagoTotalEvento).toBe(0);
    expect(r.horasExtra).toBe(0);
    expect(r.horasAdentroSueldo).toBe(7);
  });

  it("charges morning hours before 10:00 as extra, rounded up", () => {
    // 08:00-10:00 = 120 min before 10:00 -> 2 extra hours
    const r = calcularPagoEvento(MON, "08:00", "10:00", false, false, TARIFAS);
    expect(r.horasExtra).toBe(2);
    expect(r.pagoExtra).toBe(2 * TARIFAS.tarifaHoraExtra); // 40000
    expect(r.horasAdentroSueldo).toBe(0);
  });

  it("rounds a partial afternoon extra block up (17:00-21:30 -> 5h)", () => {
    // 270 min after 17:00 -> ceil(4.5) = 5
    const r = calcularPagoEvento(MON, "17:00", "21:30", false, false, TARIFAS);
    expect(r.horasExtra).toBe(5);
    expect(r.pagoExtra).toBe(5 * TARIFAS.tarifaHoraExtra); // 100000
  });

  it("rounds the morning and afternoon extra blocks up SEPARATELY", () => {
    // 08:30-18:30: morning 90min -> 2h, afternoon 90min -> 2h (not 3h combined)
    const r = calcularPagoEvento(MON, "08:30", "18:30", false, false, TARIFAS);
    expect(r.horasExtra).toBe(4);
    expect(r.pagoExtra).toBe(4 * TARIFAS.tarifaHoraExtra); // 80000
    expect(r.horasAdentroSueldo).toBe(7);
  });
});

describe("calcularPagoEvento — weekend / holiday shifts", () => {
  it("pays the flat rate for a weekend shift of 8h or less", () => {
    const r = calcularPagoEvento(SAT, "10:00", "14:00", false, false, TARIFAS); // 4h
    expect(r.horasExtra).toBe(4);
    expect(r.pagoExtra).toBe(TARIFAS.tarifaFinFijo); // 120000 flat
    expect(r.pagoTotalEvento).toBe(TARIFAS.tarifaFinFijo);
  });

  it("still pays the flat rate at exactly 8h (boundary)", () => {
    const r = calcularPagoEvento(SAT, "09:00", "17:00", false, false, TARIFAS); // 8h
    expect(r.horasExtra).toBe(8);
    expect(r.pagoExtra).toBe(TARIFAS.tarifaFinFijo);
  });

  it("switches to hourly for a weekend shift over 8h", () => {
    const r = calcularPagoEvento(SAT, "08:00", "19:00", false, false, TARIFAS); // 11h
    expect(r.horasExtra).toBe(11);
    expect(r.pagoExtra).toBe(11 * TARIFAS.tarifaFin); // 139700
  });

  it("ceils weekend hours before applying the 8h boundary (8.5h -> 9h -> hourly)", () => {
    const r = calcularPagoEvento(SAT, "10:00", "18:30", false, false, TARIFAS); // 8.5h -> 9h
    expect(r.horasExtra).toBe(9);
    expect(r.pagoExtra).toBe(9 * TARIFAS.tarifaFin); // 114300
  });

  it("treats a holiday (feriado) weekday as weekend, overriding the base-shift window", () => {
    // Monday 10:00-14:00 would normally be inside the base shift (no pay),
    // but feriado=true forces weekend flat-rate logic.
    const r = calcularPagoEvento(MON, "10:00", "14:00", false, true, TARIFAS);
    expect(r.horasExtra).toBe(4);
    expect(r.horasAdentroSueldo).toBe(0);
    expect(r.pagoExtra).toBe(TARIFAS.tarifaFinFijo);
  });
});

describe("calcularPagoEvento — operacion", () => {
  it("adds tarifaOperacion to a shift with no extra hours", () => {
    const r = calcularPagoEvento(MON, "10:00", "17:00", true, false, TARIFAS);
    expect(r.pagoOperacion).toBe(TARIFAS.tarifaOperacion); // 29000
    expect(r.pagoExtra).toBe(0);
    expect(r.pagoTotalEvento).toBe(TARIFAS.tarifaOperacion);
  });

  it("sums extra hours and operacion in the total", () => {
    // 17:00-19:00 = 2 afternoon extra hours (40000) + operacion (29000)
    const r = calcularPagoEvento(MON, "17:00", "19:00", true, false, TARIFAS);
    expect(r.pagoExtra).toBe(2 * TARIFAS.tarifaHoraExtra); // 40000
    expect(r.pagoOperacion).toBe(TARIFAS.tarifaOperacion); // 29000
    expect(r.pagoTotalEvento).toBe(40000 + 29000); // 69000
  });
});

describe("calcularPagoEvento — midnight rollover", () => {
  it("splits an overnight shift across the day boundary (Fri weekday -> Sat weekend)", () => {
    // Fri 22:00 -> next day 02:00.
    // Fri 22:00-23:59 = 120 min weekday afternoon -> 2h extra (40000)
    // Sat 00:00-01:59 = 120 min weekend -> 2h flat (120000)
    const r = calcularPagoEvento(FRI, "22:00", "02:00", false, false, TARIFAS);
    expect(r.horasExtra).toBe(4);
    expect(r.pagoExtra).toBe(2 * TARIFAS.tarifaHoraExtra + TARIFAS.tarifaFinFijo); // 160000
    expect(r.pagoTotalEvento).toBe(160000);
  });
});

describe("calcularPagoEvento — default tarifas", () => {
  it("falls back to DEFAULT_TARIFA_FIN_FIJO when no tarifas are provided", () => {
    const r = calcularPagoEvento(SAT, "10:00", "14:00", false); // 4h weekend, defaults
    expect(r.pagoExtra).toBe(DEFAULT_TARIFA_FIN_FIJO);
    expect(DEFAULT_TARIFA_FIN_FIJO).toBe(120000);
  });
});
