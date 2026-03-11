import { useState, useEffect } from "react"
import { collection, query, where, onSnapshot, orderBy, doc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { calcularPagoEvento } from "../utils/calculations"

export const COLLECTIONS = {
  EVENTOS: "eventos",
  GASTOS: "gastos",
  EXTRAS: "extras", // Bonos y Adelantos
  USER_PREFS: "userPrefs",
  CONFIG: "config"
}

export function useFirestore() {
  const { currentUser } = useAuth();
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [extras, setExtras] = useState([]); // Bonos y Adelantos
  const [loading, setLoading] = useState(true);
  
  // Custom totals & prefs
  const [userPrefs, setUserPrefs] = useState({ sueldoFijo: 0 });
  const [sueldoFijo, setSueldoFijo] = useState(0);
  const [totalEventos, setTotalEventos] = useState(0);
  const [totalGastos, setTotalGastos] = useState(0);
  const [totalBonos, setTotalBonos] = useState(0);
  const [totalAdelantos, setTotalAdelantos] = useState(0);
  const [totalFinal, setTotalFinal] = useState(0);
  const [tarifasGlobales, setTarifasGlobales] = useState({
    tarifaComun: 11000,
    tarifaFin: 12700,
    tarifaOperacion: 29000,
    tarifaHoraExtra: 20000
  });

  useEffect(() => {
    if (!currentUser) return;

    setLoading(true);

    // Listens to Global Tarifas Configuration
    const tarifasRef = doc(db, COLLECTIONS.CONFIG, "tarifas");
    const unsubscribeTarifas = onSnapshot(tarifasRef, (docSnap) => {
      if (docSnap.exists()) {
        setTarifasGlobales(docSnap.data());
      }
    });

    // Listens to Events
    const qEventos = query(
      collection(db, COLLECTIONS.EVENTOS),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribeEvents = onSnapshot(qEventos, (snapshot) => {
      const eVals = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.fecha + 'T12:00:00') - new Date(a.fecha + 'T12:00:00'));
      setEvents(eVals);
    });

    // Listens to Expenses
    const qGastos = query(
      collection(db, COLLECTIONS.GASTOS),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribeExpenses = onSnapshot(qGastos, (snapshot) => {
      const gVals = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.fecha + 'T12:00:00') - new Date(a.fecha + 'T12:00:00'));
      setExpenses(gVals);
    });

    // Listens to Extras (Bonos & Adelantos)
    const qExtras = query(
      collection(db, COLLECTIONS.EXTRAS),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribeExtras = onSnapshot(qExtras, (snapshot) => {
      const eVals = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.fecha + 'T12:00:00') - new Date(a.fecha + 'T12:00:00'));
      setExtras(eVals);
    });

    // User Prefs (Sueldo Fijo)
    const prefDocRef = doc(db, COLLECTIONS.USER_PREFS, currentUser.uid);
    
    const unsubscribePrefs = onSnapshot(prefDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserPrefs(data);
        setSueldoFijo(data.sueldoFijo || 0);
      } else {
        setUserPrefs({ sueldoFijo: 0 });
        setSueldoFijo(0);
      }
    });

    setLoading(false);

    return () => {
      unsubscribeEvents();
      unsubscribeExpenses();
      unsubscribeExtras();
      unsubscribePrefs();
      unsubscribeTarifas();
    };
  }, [currentUser]);

  // Recalculate Totals
  useEffect(() => {
    const tEvents = events.reduce((acc, curr) => {
      const calc = calcularPagoEvento(
        curr.fecha,
        curr.horaEntrada,
        curr.horaSalida,
        curr.operacion,
        curr.feriado,
        tarifasGlobales
      );
      return acc + calc.pagoTotalEvento;
    }, 0);
    setTotalEventos(tEvents);
  }, [events, tarifasGlobales]);

  useEffect(() => {
    const tGastos = expenses.reduce((acc, curr) => acc + (curr.monto || 0), 0);
    setTotalGastos(tGastos);
  }, [expenses]);

  useEffect(() => {
    let tBonos = 0;
    let tAdelantos = 0;
    extras.forEach(ext => {
      if (ext.tipo === "bono") tBonos += (ext.monto || 0);
      else if (ext.tipo === "adelanto") tAdelantos += (ext.monto || 0);
    });
    setTotalBonos(tBonos);
    setTotalAdelantos(tAdelantos);
  }, [extras]);

  // Recalculate Total Final whenever components change
  useEffect(() => {
    // Total = Sueldo Fijo + Eventos + Gastos + Bonos - Adelantos
    // Gastos se suman porque son plata puesta por el usuario que se le debe reintegrar
    setTotalFinal(sueldoFijo + totalEventos + totalGastos + totalBonos - totalAdelantos);
  }, [sueldoFijo, totalEventos, totalGastos, totalBonos, totalAdelantos]);

  return {
    events,
    expenses,
    extras,
    loading,
    sueldoFijo,
    userPrefs,
    totalEventos,
    totalGastos,
    totalBonos,
    totalAdelantos,
    totalFinal,
    tarifasGlobales
  };
}
