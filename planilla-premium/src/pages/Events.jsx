import { useState, useRef, useMemo } from "react"
import { useFirestore } from "../hooks/useFirestore"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Plus, Trash2, CalendarCheck, CalendarDays } from "lucide-react"
import { doc, deleteDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { COLLECTIONS } from "../hooks/useFirestore"
import { EventModal } from "../components/events/EventModal"
import { SwipeableItem } from "../components/ui/SwipeableItem"
import { calcularPagoEvento } from "../utils/calculations"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

export default function Events() {
  const { events, loading, totalEventos, tarifasGlobales } = useFirestore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [visibleCount, setVisibleCount] = useState(15)
  const container = useRef()

  const displayedEvents = useMemo(() => {
    return events.slice(0, visibleCount)
  }, [events, visibleCount])

  useGSAP(() => {
    if (!loading && displayedEvents.length > 0) {
      gsap.from(".event-item", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: "power3.out",
        clearProps: "all"
      })
    }
  }, { scope: container, dependencies: [loading, displayedEvents.length] })

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount)
  }

  const handleDelete = async (id) => {
    if (window.confirm("¿Estás seguro de que quieres borrar este evento?")) {
      try {
        await deleteDoc(doc(db, COLLECTIONS.EVENTOS, id))
      } catch (error) {
        console.error("Error deleting event:", error)
        alert("Error al borrar el evento.")
      }
    }
  }

  const handleLoadMore = () => {
    setVisibleCount(prev => prev + 15)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 bg-white/5 rounded-xl animate-pulse" />
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-white/5 rounded-2xl border border-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" ref={container}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Registro de Eventos</h1>
          <p className="text-gray-400 mt-1">Historial completo y gestión de tus eventos pagados.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-[var(--primary)] hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/25"
        >
          <Plus className="w-5 h-5" />
          Añadir Evento
        </button>
      </div>
      
      {/* Stats Card */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
           <div className="p-4 bg-green-500/20 text-green-400 rounded-2xl shrink-0">
              <CalendarCheck className="w-8 h-8" />
           </div>
           <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-gray-400 mb-1">Ganancia por Eventos (Global)</h3>
              <p className="text-2xl sm:text-4xl font-bold text-green-400 break-all leading-tight">{formatCurrency(totalEventos)}</p>
           </div>
        </div>
      </div>

      {/* Events List */}
      <div className="glass-card rounded-2xl p-6 min-h-[500px]">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-white/5 rounded-xl">
             <CalendarDays className="w-12 h-12 mb-3 opacity-20" />
             <p>No tienes eventos registrados.</p>
          </div>
        ) : (
          <div className="space-y-3">
             {displayedEvents.map(evt => (
                <div key={evt.id} className="event-item mb-3">
                  <SwipeableItem 
                    onEdit={() => { setSelectedEvent(evt); setIsModalOpen(true); }}
                    onDelete={() => handleDelete(evt.id)}
                  >
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 px-5 rounded-xl bg-[#1a1c23] border border-white/5 transition-colors h-full w-full gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                              <h4 className="font-medium text-white text-lg">{evt.evento}</h4>
                              <div className="flex items-center gap-2">
                                {evt.operacion && (
                                   <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-[var(--primary)]/20 text-[var(--brand-300)] rounded">Operación</span>
                                )}
                                {evt.feriado && (
                                   <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-yellow-500/20 text-yellow-400 rounded">Feriado</span>
                                )}
                              </div>
                          </div>
                          <p className="text-sm text-gray-400 mb-3">
                            {format(new Date(evt.fecha + 'T12:00:00'), 'dd MMMM yyyy', { locale: es })} • {evt.horaEntrada} - {evt.horaSalida}
                          </p>
                          {/* Breakdown math */}
                          {(() => {
                             const calc = calcularPagoEvento(evt.fecha, evt.horaEntrada, evt.horaSalida, evt.operacion, evt.feriado, tarifasGlobales);
                             return (
                               <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-400 bg-black/30 p-2.5 rounded-lg border border-white/5 w-fit">
                                 {calc.horasExtra > 0 && (
                                   <span>Horas Extras: <strong className="text-gray-200">{calc.horasExtra}h</strong> <span className="opacity-70">({formatCurrency(calc.pagoExtra)})</span></span>
                                 )}
                                 {calc.pagoOperacion > 0 && (
                                   <span className="text-[var(--brand-300)] flex items-center gap-1">Operación: {formatCurrency(calc.pagoOperacion)}</span>
                                 )}
                                 <span className="text-green-400 font-semibold ml-auto sm:ml-4 text-sm break-all text-right">Ganancia: {formatCurrency(calc.pagoTotalEvento)}</span>
                               </div>
                             )
                          })()}
                        </div>
                     </div>
                  </SwipeableItem>
                </div>
             ))}

             {visibleCount < events.length && (
               <div className="pt-6 pb-2 flex justify-center">
                 <button 
                  onClick={handleLoadMore}
                  className="px-6 py-2 rounded-full border border-white/10 text-gray-400 font-medium hover:text-white hover:bg-white/5 transition-colors"
                 >
                   Cargar más eventos ({events.length - visibleCount} restantes)
                 </button>
               </div>
             )}
          </div>
        )}
      </div>

      <EventModal 
        isOpen={isModalOpen} 
        onClose={() => { setIsModalOpen(false); setSelectedEvent(null); }} 
        eventToEdit={selectedEvent}
      />
    </div>
  )
}
