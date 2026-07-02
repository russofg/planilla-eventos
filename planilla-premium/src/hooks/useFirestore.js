import { useState, useEffect } from "react"
import { collection, query, where, onSnapshot, doc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { sumEventos, sumGastos, sumExtras, assembleTotalFinal } from "../utils/totals"

export const COLLECTIONS = {
  EVENTOS: "eventos",
  GASTOS: "gastos",
  EXTRAS: "extras", // Bonos, Aguinaldo y Adelantos
  USER_PREFS: "userPrefs",
  CONFIG: "config"
}

export function useFirestore() {
  const { currentUser } = useAuth();
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [extras, setExtras] = useState([]); // Bonos y Adelantos
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  // Custom totals & prefs
  const [userPrefs, setUserPrefs] = useState({ sueldoFijo: 0 });
  const [sueldoFijo, setSueldoFijo] = useState(0);
  const [totalEventosGlobal, setTotalEventosGlobal] = useState(0);
  const [totalGastosGlobal, setTotalGastosGlobal] = useState(0);
  const [totalBonosGlobal, setTotalBonosGlobal] = useState(0);
  const [totalAguinaldoGlobal, setTotalAguinaldoGlobal] = useState(0);
  const [totalAdelantosGlobal, setTotalAdelantosGlobal] = useState(0);
  const [totalFinalGlobal, setTotalFinalGlobal] = useState(0);
  const [tarifasGlobales, setTarifasGlobales] = useState({
    tarifaComun: 11000,
    tarifaFin: 12700,
    tarifaFinFijo: 120000,
    tarifaOperacion: 29000,
    tarifaHoraExtra: 20000
  });

  useEffect(() => {
    if (!currentUser) return;

    setLoading(true);
    setError(null);

    // A Firestore listener that errors is terminated by the SDK and never
    // recovers on its own — that's why the app used to load the sueldo fijo
    // (a cached single doc) but leave events/extras empty until a full reload.
    // Here every listener has an error callback that surfaces the failure and
    // schedules a single auto-retry, so the data self-heals instead of needing
    // a close-and-reopen.
    let retryTimeout;
    const scheduleRetry = (source, err) => {
      console.error(`Firestore listener error [${source}]:`, err);
      setError({ source, code: err?.code || "unknown", message: err?.message || String(err) });
      if (!retryTimeout) {
        retryTimeout = setTimeout(() => setRetryCount((c) => c + 1), 3000);
      }
    };

    const byFechaDesc = (a, b) =>
      new Date(b.fecha + 'T12:00:00') - new Date(a.fecha + 'T12:00:00');
    const mapDocs = (snapshot) =>
      snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byFechaDesc);

    // Listens to Global Tarifas Configuration
    const tarifasRef = doc(db, COLLECTIONS.CONFIG, "tarifas");
    const unsubscribeTarifas = onSnapshot(
      tarifasRef,
      (docSnap) => {
        if (docSnap.exists()) setTarifasGlobales(docSnap.data());
      },
      (err) => scheduleRetry("tarifas", err)
    );

    // Listens to Events
    const qEventos = query(
      collection(db, COLLECTIONS.EVENTOS),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribeEvents = onSnapshot(
      qEventos,
      (snapshot) => {
        setEvents(mapDocs(snapshot));
        // First successful backend response for the primary collection means
        // we really have data (or a confirmed empty set) — stop "loading" now,
        // not synchronously before the listeners have answered.
        setLoading(false);
      },
      (err) => scheduleRetry("eventos", err)
    );

    // Listens to Expenses
    const qGastos = query(
      collection(db, COLLECTIONS.GASTOS),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribeExpenses = onSnapshot(
      qGastos,
      (snapshot) => setExpenses(mapDocs(snapshot)),
      (err) => scheduleRetry("gastos", err)
    );

    // Listens to Extras (Bonos, Aguinaldo & Adelantos)
    const qExtras = query(
      collection(db, COLLECTIONS.EXTRAS),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribeExtras = onSnapshot(
      qExtras,
      (snapshot) => setExtras(mapDocs(snapshot)),
      (err) => scheduleRetry("extras", err)
    );

    // User Prefs (Sueldo Fijo)
    const prefDocRef = doc(db, COLLECTIONS.USER_PREFS, currentUser.uid);

    const unsubscribePrefs = onSnapshot(
      prefDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setUserPrefs(data);
          setSueldoFijo(data.sueldoFijo || 0);
        } else {
          setUserPrefs({ sueldoFijo: 0 });
          setSueldoFijo(0);
        }
      },
      (err) => scheduleRetry("userPrefs", err)
    );

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      unsubscribeEvents();
      unsubscribeExpenses();
      unsubscribeExtras();
      unsubscribePrefs();
      unsubscribeTarifas();
    };
  }, [currentUser, retryCount]);

  // Recalculate Totals
  useEffect(() => {
    setTotalEventosGlobal(sumEventos(events, tarifasGlobales));
  }, [events, tarifasGlobales]);

  useEffect(() => {
    setTotalGastosGlobal(sumGastos(expenses));
  }, [expenses]);

  useEffect(() => {
    const { bonos, aguinaldo, adelantos } = sumExtras(extras);
    setTotalBonosGlobal(bonos);
    setTotalAguinaldoGlobal(aguinaldo);
    setTotalAdelantosGlobal(adelantos);
  }, [extras]);

  // Recalculate Total Final whenever components change
  useEffect(() => {
    // Total = Sueldo Fijo + Eventos + Gastos + Bonos + Aguinaldo - Adelantos
    // Gastos se suman porque son plata puesta por el usuario que se le debe reintegrar
    setTotalFinalGlobal(
      assembleTotalFinal({
        sueldoFijo,
        eventos: totalEventosGlobal,
        gastos: totalGastosGlobal,
        bonos: totalBonosGlobal,
        aguinaldo: totalAguinaldoGlobal,
        adelantos: totalAdelantosGlobal,
      })
    );
  }, [sueldoFijo, totalEventosGlobal, totalGastosGlobal, totalBonosGlobal, totalAguinaldoGlobal, totalAdelantosGlobal]);

  return {
    events,
    expenses,
    extras,
    loading,
    error,
    retry: () => setRetryCount((c) => c + 1),
    sueldoFijo,
    userPrefs,
    totalEventosGlobal,
    totalGastosGlobal,
    totalBonosGlobal,
    totalAguinaldoGlobal,
    totalAdelantosGlobal,
    totalFinalGlobal,
    tarifasGlobales
  };
}
