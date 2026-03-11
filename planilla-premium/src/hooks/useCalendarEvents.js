import { useState, useEffect } from "react"
import { collection, query, onSnapshot, where } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { COLLECTIONS } from "./useFirestore"

export function useCalendarEvents() {
  const { currentUser } = useAuth();
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    // Regular Events Ref
    const qEventos = query(
      collection(db, COLLECTIONS.EVENTOS),
      where("userId", "==", currentUser.uid)
    );

    let userEvents = [];
    let proxlEvents = [];

    const updateCalendarState = () => {
      setCalendarEvents([...userEvents, ...proxlEvents]);
    };

    const unsubscribeEvents = onSnapshot(qEventos, (snapshot) => {
      userEvents = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          title: d.evento,
          start: `${d.fecha}T${d.horaEntrada}`,
          end: `${d.fecha}T${d.horaSalida}`,
          extendedProps: { ...d, type: "normal" },
          backgroundColor: d.operacion ? "var(--primary)" : "#3b82f6", // default blue vs primary for operation
          borderColor: "transparent"
        }
      });
      updateCalendarState();
      setLoading(false);
    });

    const unsubscribeProximos = onSnapshot(collection(db, "proximosEventos"), (snapshot) => {
      proxlEvents = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: `proximo_${doc.id}`,
          originalId: doc.id,
          title: d.nombre,
          start: d.fechaInicio,
          // Convert end dates slightly if they are exclusive or just use them
          end: d.fechaFin ? new Date(new Date(d.fechaFin).getTime() + 86400000).toISOString().split('T')[0] : d.fechaInicio,
          allDay: true,
          extendedProps: { ...d, type: "proximo", originalId: doc.id },
          backgroundColor: "rgba(16, 185, 129, 0.2)", // Emerald background
          borderColor: "rgba(16, 185, 129, 0.5)",    // Emerald border
          textColor: "#34D399"                       // Emerald text
        }
      });
      updateCalendarState();
    });

    return () => {
      unsubscribeEvents();
      unsubscribeProximos();
    };
  }, [currentUser]);

  return { calendarEvents, loading };
}
