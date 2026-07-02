import { describe, it, expect } from "vitest";
import { calcularPagoEvento } from "../src/utils/calculations.js";
import { sumEventos, sumGastos, sumExtras, calcTotalFinal, assembleTotalFinal } from "../src/utils/totals.js";

const DEFAULT_TARIFAS = {
  tarifaFin: 12700,
  tarifaFinFijo: 120000,
  tarifaOperacion: 29000,
  tarifaHoraExtra: 20000,
};

// 2024-01-06 = Saturday; 2024-01-08 = Monday
const WEEKDAY_EVENT = {
  fecha: "2024-01-08",
  horaEntrada: "09:00",
  horaSalida: "18:00",
  operacion: false,
  feriado: false,
};

const WEEKDAY_EVENT_2 = {
  fecha: "2024-01-09",
  horaEntrada: "08:00",
  horaSalida: "19:00",
  operacion: false,
  feriado: false,
};

const WEEKEND_SHORT_EVENT = {
  fecha: "2024-01-06",
  horaEntrada: "08:00",
  horaSalida: "14:00",
  operacion: false,
  feriado: false,
};

const WEEKEND_LONG_EVENT = {
  fecha: "2024-01-06",
  horaEntrada: "08:00",
  horaSalida: "19:00",
  operacion: false,
  feriado: false,
};

// Weekday shift with operacion flag on.
const OPERACION_EVENT = {
  fecha: "2024-01-08",
  horaEntrada: "10:00",
  horaSalida: "17:00",
  operacion: true,
  feriado: false,
};

// Weekday date explicitly marked as holiday (feriado).
const FERIADO_EVENT = {
  fecha: "2024-01-08",
  horaEntrada: "08:00",
  horaSalida: "14:00",
  operacion: false,
  feriado: true,
};

describe("sumEventos", () => {
  it("returns 0 for empty array", () => {
    expect(sumEventos([], DEFAULT_TARIFAS)).toBe(0);
  });

  it("single weekday event matches direct calcularPagoEvento call", () => {
    const expected = calcularPagoEvento(
      WEEKDAY_EVENT.fecha,
      WEEKDAY_EVENT.horaEntrada,
      WEEKDAY_EVENT.horaSalida,
      WEEKDAY_EVENT.operacion,
      WEEKDAY_EVENT.feriado,
      DEFAULT_TARIFAS
    ).pagoTotalEvento;
    expect(sumEventos([WEEKDAY_EVENT], DEFAULT_TARIFAS)).toBe(expected);
  });

  it("multiple events returns the arithmetic sum of individual calcularPagoEvento results", () => {
    const events = [WEEKDAY_EVENT, WEEKDAY_EVENT_2];
    const expected =
      calcularPagoEvento(
        WEEKDAY_EVENT.fecha,
        WEEKDAY_EVENT.horaEntrada,
        WEEKDAY_EVENT.horaSalida,
        WEEKDAY_EVENT.operacion,
        WEEKDAY_EVENT.feriado,
        DEFAULT_TARIFAS
      ).pagoTotalEvento +
      calcularPagoEvento(
        WEEKDAY_EVENT_2.fecha,
        WEEKDAY_EVENT_2.horaEntrada,
        WEEKDAY_EVENT_2.horaSalida,
        WEEKDAY_EVENT_2.operacion,
        WEEKDAY_EVENT_2.feriado,
        DEFAULT_TARIFAS
      ).pagoTotalEvento;
    expect(sumEventos(events, DEFAULT_TARIFAS)).toBe(expected);
  });

  it("weekend short shift (<=8h) returns tarifaFinFijo via calcularPagoEvento", () => {
    const result = sumEventos([WEEKEND_SHORT_EVENT], DEFAULT_TARIFAS);
    const direct = calcularPagoEvento(
      WEEKEND_SHORT_EVENT.fecha,
      WEEKEND_SHORT_EVENT.horaEntrada,
      WEEKEND_SHORT_EVENT.horaSalida,
      WEEKEND_SHORT_EVENT.operacion,
      WEEKEND_SHORT_EVENT.feriado,
      DEFAULT_TARIFAS
    ).pagoTotalEvento;
    expect(result).toBe(direct);
    // Lock the flat-rate branch: 6h <= 8h => flat tarifaFinFijo
    expect(result).toBe(DEFAULT_TARIFAS.tarifaFinFijo);
  });

  it("weekend long shift (>8h) returns hourly value, not flat rate", () => {
    const result = sumEventos([WEEKEND_LONG_EVENT], DEFAULT_TARIFAS);
    const direct = calcularPagoEvento(
      WEEKEND_LONG_EVENT.fecha,
      WEEKEND_LONG_EVENT.horaEntrada,
      WEEKEND_LONG_EVENT.horaSalida,
      WEEKEND_LONG_EVENT.operacion,
      WEEKEND_LONG_EVENT.feriado,
      DEFAULT_TARIFAS
    ).pagoTotalEvento;
    expect(result).toBe(direct);
    // 11h > 8h => hourly branch; must NOT equal flat rate
    expect(result).not.toBe(DEFAULT_TARIFAS.tarifaFinFijo);
    // Lock the exact hourly amount: 08:00–19:00 = 11h (all weekend) => 11 * tarifaFin
    expect(result).toBe(11 * DEFAULT_TARIFAS.tarifaFin);
  });

  it("operacion event stays parity-locked with calcularPagoEvento", () => {
    const result = sumEventos([OPERACION_EVENT], DEFAULT_TARIFAS);
    const direct = calcularPagoEvento(
      OPERACION_EVENT.fecha,
      OPERACION_EVENT.horaEntrada,
      OPERACION_EVENT.horaSalida,
      OPERACION_EVENT.operacion,
      OPERACION_EVENT.feriado,
      DEFAULT_TARIFAS
    ).pagoTotalEvento;
    expect(result).toBe(direct);
    // Operacion branch must contribute the operacion tarifa
    expect(direct).toBeGreaterThanOrEqual(DEFAULT_TARIFAS.tarifaOperacion);
  });

  it("feriado event stays parity-locked with calcularPagoEvento", () => {
    const result = sumEventos([FERIADO_EVENT], DEFAULT_TARIFAS);
    const direct = calcularPagoEvento(
      FERIADO_EVENT.fecha,
      FERIADO_EVENT.horaEntrada,
      FERIADO_EVENT.horaSalida,
      FERIADO_EVENT.operacion,
      FERIADO_EVENT.feriado,
      DEFAULT_TARIFAS
    ).pagoTotalEvento;
    expect(result).toBe(direct);
    // 6h holiday shift (<=8h) => flat weekend/holiday rate
    expect(result).toBe(DEFAULT_TARIFAS.tarifaFinFijo);
  });
});

describe("sumGastos", () => {
  it("returns 0 for empty array", () => {
    expect(sumGastos([])).toBe(0);
  });

  it("sums valid montos and treats undefined as 0", () => {
    expect(
      sumGastos([{ monto: 100 }, { monto: undefined }, { monto: 50 }])
    ).toBe(150);
  });
});

describe("sumExtras", () => {
  it("returns all zeros for empty array", () => {
    expect(sumExtras([])).toEqual({ bonos: 0, aguinaldo: 0, adelantos: 0 });
  });

  it("one entry of each tipo returns correct keyed values", () => {
    const extras = [
      { tipo: "bono", monto: 50 },
      { tipo: "aguinaldo", monto: 200 },
      { tipo: "adelanto", monto: 30 },
    ];
    expect(sumExtras(extras)).toEqual({ bonos: 50, aguinaldo: 200, adelantos: 30 });
  });

  it("unknown tipo is ignored", () => {
    expect(sumExtras([{ tipo: "otro", monto: 999 }])).toEqual({
      bonos: 0,
      aguinaldo: 0,
      adelantos: 0,
    });
  });

  it("undefined monto defaults to 0", () => {
    expect(sumExtras([{ tipo: "bono", monto: undefined }])).toEqual({
      bonos: 0,
      aguinaldo: 0,
      adelantos: 0,
    });
  });
});

describe("calcTotalFinal", () => {
  it("adelantos subtract from total (1000 - 200 = 800)", () => {
    const result = calcTotalFinal({
      sueldoFijo: 1000,
      events: [],
      expenses: [],
      extras: [{ tipo: "adelanto", monto: 200 }],
      tarifas: DEFAULT_TARIFAS,
    });
    expect(result).toBe(800);
  });

  it("aguinaldo adds to total (1000 + 500 = 1500)", () => {
    const result = calcTotalFinal({
      sueldoFijo: 1000,
      events: [],
      expenses: [],
      extras: [{ tipo: "aguinaldo", monto: 500 }],
      tarifas: DEFAULT_TARIFAS,
    });
    expect(result).toBe(1500);
  });

  it("all-zero extras returns sueldoFijo", () => {
    const result = calcTotalFinal({
      sueldoFijo: 1500,
      events: [],
      expenses: [],
      extras: [],
      tarifas: DEFAULT_TARIFAS,
    });
    expect(result).toBe(1500);
  });

  it("combines every category (event + gasto + bono + aguinaldo - adelanto)", () => {
    const eventPayout = calcularPagoEvento(
      WEEKDAY_EVENT.fecha,
      WEEKDAY_EVENT.horaEntrada,
      WEEKDAY_EVENT.horaSalida,
      WEEKDAY_EVENT.operacion,
      WEEKDAY_EVENT.feriado,
      DEFAULT_TARIFAS
    ).pagoTotalEvento;
    const sueldoFijo = 1000;
    const gasto = 500;
    const bono = 300;
    const aguinaldo = 700;
    const adelanto = 200;
    const result = calcTotalFinal({
      sueldoFijo,
      events: [WEEKDAY_EVENT],
      expenses: [{ monto: gasto }],
      extras: [
        { tipo: "bono", monto: bono },
        { tipo: "aguinaldo", monto: aguinaldo },
        { tipo: "adelanto", monto: adelanto },
      ],
      tarifas: DEFAULT_TARIFAS,
    });
    const expected = sueldoFijo + eventPayout + gasto + bono + aguinaldo - adelanto;
    expect(result).toBe(expected);
  });
});

describe("assembleTotalFinal", () => {
  it("adelanto subtracts, every other category adds", () => {
    const result = assembleTotalFinal({
      sueldoFijo: 1000,
      eventos: 40000,
      gastos: 500,
      bonos: 300,
      aguinaldo: 700,
      adelantos: 200,
    });
    expect(result).toBe(1000 + 40000 + 500 + 300 + 700 - 200);
  });

  it("all-zero categories returns sueldoFijo", () => {
    const result = assembleTotalFinal({
      sueldoFijo: 1500,
      eventos: 0,
      gastos: 0,
      bonos: 0,
      aguinaldo: 0,
      adelantos: 0,
    });
    expect(result).toBe(1500);
  });
});
