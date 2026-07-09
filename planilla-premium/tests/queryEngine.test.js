import { describe, it, expect } from "vitest";
import { filterByPeriod, computeMetric, unsupportedCombo } from "../netlify/functions/utils/queryEngine.js";
import { calcularPagoEvento } from "../src/utils/calculations.js";
import { sumEventos, sumGastos, calcTotalFinal } from "../src/utils/totals.js";

// Shared tarifas — identical to tests/totals.test.js.
const TARIFAS = {
  tarifaFin: 12700,
  tarifaFinFijo: 120000,
  tarifaOperacion: 29000,
  tarifaHoraExtra: 20000,
};

// 2024-01-06 = Saturday; 2024-01-08 = Monday.
const evJanA = { evento: "Amcham", fecha: "2024-01-08", horaEntrada: "08:00", horaSalida: "20:00", operacion: true, feriado: false };
const evJanB = { evento: "Expo", fecha: "2024-01-06", horaEntrada: "08:00", horaSalida: "14:00", operacion: false, feriado: false };
const evJanC = { evento: "Cumbre", fecha: "2024-01-20", horaEntrada: "10:00", horaSalida: "17:00", operacion: true, feriado: false };
const evFeb = { evento: "Congreso", fecha: "2024-02-05", horaEntrada: "09:00", horaSalida: "18:00", operacion: false, feriado: false };

const EVENTS = [evJanA, evJanB, evJanC, evFeb];

const GASTOS = [
  { descripcion: "Comida", fecha: "2024-01-10", monto: 5000 },
  { descripcion: "Viaje", fecha: "2024-02-10", monto: 3000 },
];

const EXTRAS = [
  { tipo: "bono", fecha: "2024-01-15", monto: 10000 },
  { tipo: "aguinaldo", fecha: "2024-01-20", monto: 50000 },
  { tipo: "adelanto", fecha: "2024-01-25", monto: 20000 },
  { tipo: "bono", fecha: "2024-02-15", monto: 7000 },
];

const SUELDO_FIJO = 120000;

const DATA = { events: EVENTS, expenses: GASTOS, extras: EXTRAS, tarifas: TARIFAS, sueldoFijo: SUELDO_FIJO };

const JAN = { type: "month", year: 2024, month: 1 };
const FEB = { type: "month", year: 2024, month: 2 };
const EMPTY = { type: "month", year: 2099, month: 1 };

const horasExtraOf = (e) =>
  calcularPagoEvento(e.fecha, e.horaEntrada, e.horaSalida, e.operacion, e.feriado, TARIFAS).horasExtra;

describe("filterByPeriod", () => {
  it("month filter keeps only rows whose fecha maps to that month/year", () => {
    const rows = filterByPeriod(EVENTS, JAN);
    expect(rows.map((e) => e.evento)).toEqual(["Amcham", "Expo", "Cumbre"]);
  });

  it("month filter isolates a different month", () => {
    const rows = filterByPeriod(EVENTS, FEB);
    expect(rows.map((e) => e.evento)).toEqual(["Congreso"]);
  });

  it("month filter uses fecha+'T12:00:00' (no timezone off-by-one at boundaries)", () => {
    const boundary = [{ evento: "First", fecha: "2024-01-01" }, { evento: "Last", fecha: "2024-01-31" }];
    expect(filterByPeriod(boundary, JAN).map((e) => e.evento)).toEqual(["First", "Last"]);
  });

  it("range filter uses ISO string comparison (inclusive bounds)", () => {
    const range = { type: "range", from: "2024-01-01", to: "2024-01-31" };
    expect(filterByPeriod(EVENTS, range).map((e) => e.evento)).toEqual(["Amcham", "Expo", "Cumbre"]);
  });

  it("range filter excludes rows outside the bounds", () => {
    const range = { type: "range", from: "2024-01-07", to: "2024-01-09" };
    expect(filterByPeriod(EVENTS, range).map((e) => e.evento)).toEqual(["Amcham"]);
  });

  it("compare period is NOT filtered here (computeMetric handles it; filterByPeriod returns [])", () => {
    // compare is never passed to filterByPeriod in the real flow: computeMetric
    // intercepts it and runs each sub-period through filterByPeriod individually.
    // At this level a compare period is a non-month/non-range type, so the safe
    // fallthrough returns [] (never the full, unfiltered history).
    const compare = { type: "compare", periods: [JAN, FEB] };
    expect(filterByPeriod(EVENTS, compare)).toEqual([]);
  });

  it("empty dataset returns []", () => {
    expect(filterByPeriod([], JAN)).toEqual([]);
  });
});

describe("computeMetric — counts and list", () => {
  it("countEventos returns the count of period events", () => {
    const r = computeMetric({ metric: "countEventos", period: JAN, data: DATA });
    expect(r).toMatchObject({ metric: "countEventos", kind: "scalar", unit: "count", value: 3 });
  });

  it("countEventosConOperacion counts only operacion===true", () => {
    const r = computeMetric({ metric: "countEventosConOperacion", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "count", value: 2 });
  });

  it("listEventosConOperacion returns evento names sorted by fecha desc", () => {
    const r = computeMetric({ metric: "listEventosConOperacion", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "list" });
    expect(r.items).toEqual(["Cumbre", "Amcham"]);
  });
});

describe("computeMetric — engine delegation", () => {
  it("horasExtra sums calcularPagoEvento(...).horasExtra over period events", () => {
    const janEvents = filterByPeriod(EVENTS, JAN);
    const expected = janEvents.reduce((a, e) => a + horasExtraOf(e), 0);
    const r = computeMetric({ metric: "horasExtra", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "hours", value: expected });
  });

  it("horasExtra matches the engine for a single weekday 08:00-20:00 shift (spec scenario = 5)", () => {
    const single = { events: [evJanA], expenses: [], extras: [], tarifas: TARIFAS, sueldoFijo: 0 };
    const r = computeMetric({ metric: "horasExtra", period: JAN, data: single });
    expect(r.value).toBe(5);
  });

  it("totalEventos delegates to sumEventos for the period", () => {
    const janEvents = filterByPeriod(EVENTS, JAN);
    const expected = sumEventos(janEvents, TARIFAS);
    const r = computeMetric({ metric: "totalEventos", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "money", value: expected });
  });

  it("totalGastos delegates to sumGastos for the period", () => {
    const expected = sumGastos(GASTOS.filter((g) => g.fecha.startsWith("2024-01")));
    const r = computeMetric({ metric: "totalGastos", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "money", value: expected });
    expect(r.value).toBe(5000);
  });
});

describe("computeMetric — extras money metrics", () => {
  it("totalBonos reads sumExtras(...).bonos for the period", () => {
    const r = computeMetric({ metric: "totalBonos", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "money", value: 10000 });
  });

  it("totalAguinaldo reads sumExtras(...).aguinaldo for the period", () => {
    const r = computeMetric({ metric: "totalAguinaldo", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "money", value: 50000 });
  });

  it("totalAdelantos reads sumExtras(...).adelantos for the period", () => {
    const r = computeMetric({ metric: "totalAdelantos", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "money", value: 20000 });
  });

  it("totalFinal delegates to calcTotalFinal with per-period data + sueldoFijo", () => {
    const janEvents = filterByPeriod(EVENTS, JAN);
    const janGastos = GASTOS.filter((g) => g.fecha.startsWith("2024-01"));
    const janExtras = EXTRAS.filter((x) => x.fecha.startsWith("2024-01"));
    const expected = calcTotalFinal({ sueldoFijo: SUELDO_FIJO, events: janEvents, expenses: janGastos, extras: janExtras, tarifas: TARIFAS });
    const r = computeMetric({ metric: "totalFinal", period: JAN, data: DATA });
    expect(r).toMatchObject({ kind: "scalar", unit: "money", value: expected });
  });
});

describe("computeMetric — compare period", () => {
  it("returns both sub-period values, labels, and signed delta (last - first)", () => {
    const period = { type: "compare", periods: [JAN, FEB] };
    const janHoras = filterByPeriod(EVENTS, JAN).reduce((a, e) => a + horasExtraOf(e), 0);
    const febHoras = filterByPeriod(EVENTS, FEB).reduce((a, e) => a + horasExtraOf(e), 0);
    const r = computeMetric({ metric: "horasExtra", period, data: DATA });
    expect(r.kind).toBe("compare");
    expect(r.unit).toBe("hours");
    expect(r.results).toEqual([
      { label: "enero 2024", value: janHoras },
      { label: "febrero 2024", value: febHoras },
    ]);
    expect(r.delta).toBe(febHoras - janHoras);
    // febHoras < janHoras → delta is negative.
    expect(r.delta).toBeLessThan(0);
  });

  it("delta is 0 when both sub-periods are identical", () => {
    const period = { type: "compare", periods: [JAN, JAN] };
    const r = computeMetric({ metric: "countEventos", period, data: DATA });
    expect(r.delta).toBe(0);
    expect(r.unit).toBe("count");
  });
});

describe("computeMetric — empty period", () => {
  it("numeric metrics return 0 and list metric returns [] with no error thrown", () => {
    expect(computeMetric({ metric: "countEventos", period: EMPTY, data: DATA }).value).toBe(0);
    expect(computeMetric({ metric: "totalEventos", period: EMPTY, data: DATA }).value).toBe(0);
    expect(computeMetric({ metric: "totalFinal", period: EMPTY, data: DATA }).value).toBe(SUELDO_FIJO);
    expect(computeMetric({ metric: "listEventosConOperacion", period: EMPTY, data: DATA }).items).toEqual([]);
  });
});

// NOTE: isValidPeriod lives in telegram-webhook.js and is not exported, so it is
// not unit-testable in isolation here. It is covered by manual/integration only.
// The engine-side guarantee below is the real safety net: even if a malformed
// period slips past the webhook validator, filterByPeriod must NOT leak the full
// history — an unknown/malformed period type computes over nothing.
describe("filterByPeriod — unknown/malformed period type does not leak full history", () => {
  it("unknown period type returns [] (never all rows)", () => {
    expect(filterByPeriod(EVENTS, { type: "bogus" })).toEqual([]);
    expect(filterByPeriod(EVENTS, { type: "week", from: "2024-01-01" })).toEqual([]);
    expect(filterByPeriod(EVENTS, {})).toEqual([]);
  });

  it("null/undefined period returns [] (never the full history)", () => {
    expect(filterByPeriod(EVENTS, null)).toEqual([]);
    expect(filterByPeriod(EVENTS, undefined)).toEqual([]);
  });

  it("a metric over an unknown-type period is 0 / empty, not the full dataset", () => {
    const bogus = { type: "bogus" };
    expect(computeMetric({ metric: "countEventos", period: bogus, data: DATA }).value).toBe(0);
    expect(computeMetric({ metric: "totalGastos", period: bogus, data: DATA }).value).toBe(0);
    expect(computeMetric({ metric: "totalEventos", period: bogus, data: DATA }).value).toBe(0);
    // totalFinal collapses to just sueldoFijo (no events/gastos/extras counted).
    expect(computeMetric({ metric: "totalFinal", period: bogus, data: DATA }).value).toBe(SUELDO_FIJO);
    expect(computeMetric({ metric: "listEventosConOperacion", period: bogus, data: DATA }).items).toEqual([]);
  });
});

describe("unsupportedCombo — support gate (never show a wrong number)", () => {
  it("totalFinal over a multi-calendar-month range is unsupported", () => {
    const range = { type: "range", from: "2024-01-01", to: "2024-02-28" };
    expect(unsupportedCombo("totalFinal", range)).toMatch(/sueldo fijo es mensual/);
  });

  it("totalFinal over a range within a single calendar month is supported", () => {
    const range = { type: "range", from: "2024-01-01", to: "2024-01-31" };
    expect(unsupportedCombo("totalFinal", range)).toBeNull();
  });

  it("totalFinal in a compare with a multi-month range sub-period is unsupported", () => {
    const period = { type: "compare", periods: [JAN, { type: "range", from: "2024-01-01", to: "2024-03-15" }] };
    expect(unsupportedCombo("totalFinal", period)).toMatch(/sueldo fijo es mensual/);
  });

  it("totalFinal month-vs-month compare is supported", () => {
    const period = { type: "compare", periods: [JAN, FEB] };
    expect(unsupportedCombo("totalFinal", period)).toBeNull();
  });

  it("listEventosConOperacion inside a compare is unsupported", () => {
    const period = { type: "compare", periods: [JAN, FEB] };
    expect(unsupportedCombo("listEventosConOperacion", period)).toMatch(/comparar listas/);
  });

  it("listEventosConOperacion over a single period is supported", () => {
    expect(unsupportedCombo("listEventosConOperacion", JAN)).toBeNull();
  });

  it("other supported combos return null", () => {
    expect(unsupportedCombo("countEventos", JAN)).toBeNull();
    expect(unsupportedCombo("totalFinal", JAN)).toBeNull();
    expect(unsupportedCombo("totalGastos", { type: "range", from: "2024-01-01", to: "2024-06-30" })).toBeNull();
  });
});

describe("computeMetric — compare period on a money unit", () => {
  it("totalGastos compare returns both money values, labels, and signed delta", () => {
    const period = { type: "compare", periods: [JAN, FEB] };
    const janGastos = sumGastos(GASTOS.filter((g) => g.fecha.startsWith("2024-01")));
    const febGastos = sumGastos(GASTOS.filter((g) => g.fecha.startsWith("2024-02")));
    const r = computeMetric({ metric: "totalGastos", period, data: DATA });
    expect(r.kind).toBe("compare");
    expect(r.unit).toBe("money");
    expect(r.results).toEqual([
      { label: "enero 2024", value: janGastos },
      { label: "febrero 2024", value: febGastos },
    ]);
    expect(r.results[0].value).toBe(5000);
    expect(r.results[1].value).toBe(3000);
    expect(r.delta).toBe(febGastos - janGastos);
    expect(r.delta).toBe(-2000);
  });

  it("totalEventos compare returns both money values and signed delta", () => {
    const period = { type: "compare", periods: [JAN, FEB] };
    const janTotal = sumEventos(filterByPeriod(EVENTS, JAN), TARIFAS);
    const febTotal = sumEventos(filterByPeriod(EVENTS, FEB), TARIFAS);
    const r = computeMetric({ metric: "totalEventos", period, data: DATA });
    expect(r.kind).toBe("compare");
    expect(r.unit).toBe("money");
    expect(r.results).toEqual([
      { label: "enero 2024", value: janTotal },
      { label: "febrero 2024", value: febTotal },
    ]);
    expect(r.delta).toBe(febTotal - janTotal);
  });
});

describe("computeMetric — detailed listings", () => {
  it("listEventos returns full detail, newest first", () => {
    const r = computeMetric({ metric: "listEventos", period: JAN, data: DATA });
    expect(r.kind).toBe("listDetail");
    expect(r.entity).toBe("evento");
    // JAN events sorted by fecha desc: Cumbre (20), Amcham (08), Expo (06).
    expect(r.items.map((e) => e.evento)).toEqual(["Cumbre", "Amcham", "Expo"]);
    const amcham = r.items.find((e) => e.evento === "Amcham");
    expect(amcham).toMatchObject({
      fecha: "2024-01-08",
      horaEntrada: "08:00",
      horaSalida: "20:00",
      operacion: true,
      feriado: false,
    });
    expect(amcham.horasExtra).toBe(horasExtraOf(evJanA));
  });

  it("listEventos computes weekday and weekend correctly", () => {
    const r = computeMetric({ metric: "listEventos", period: JAN, data: DATA });
    const expo = r.items.find((e) => e.evento === "Expo"); // 2024-01-06 = Saturday
    const amcham = r.items.find((e) => e.evento === "Amcham"); // 2024-01-08 = Monday
    expect(expo.diaSemana).toBe("sábado");
    expect(expo.finde).toBe(true);
    expect(amcham.diaSemana).toBe("lunes");
    expect(amcham.finde).toBe(false);
  });

  it("listGastos and listExtras return their period records", () => {
    const g = computeMetric({ metric: "listGastos", period: JAN, data: DATA });
    expect(g.kind).toBe("listDetail");
    expect(g.entity).toBe("gasto");
    expect(g.items).toEqual([{ descripcion: "Comida", fecha: "2024-01-10", monto: 5000 }]);

    const x = computeMetric({ metric: "listExtras", period: JAN, data: DATA });
    expect(x.entity).toBe("extra");
    expect(x.items.map((e) => e.tipo).sort()).toEqual(["adelanto", "aguinaldo", "bono"]);
  });

  it("empty period yields empty detail list", () => {
    expect(computeMetric({ metric: "listEventos", period: EMPTY, data: DATA }).items).toEqual([]);
  });

  it("a detailed listing cannot be compared", () => {
    const period = { type: "compare", periods: [JAN, FEB] };
    expect(unsupportedCombo("listEventos", period)).toBeTruthy();
    expect(unsupportedCombo("listGastos", period)).toBeTruthy();
  });
});
