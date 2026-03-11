import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useCalendarEvents } from '../hooks/useCalendarEvents'
import { useRef, useState } from 'react'
import { EventModal } from '../components/events/EventModal'
import { useAuth } from '../contexts/AuthContext'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

export default function CalendarView() {
  const { calendarEvents, loading } = useCalendarEvents();
  const container = useRef();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);

  useGSAP(() => {
    gsap.from(".animate-item", {
      y: 20,
      opacity: 0,
      duration: 0.6,
      stagger: 0.1,
      ease: "power2.out",
      clearProps: "all"
    });
  }, { scope: container });

  const handleDateClick = (arg) => {
    setSelectedDate(arg.dateStr);
    setSelectedEvent(null);
    setIsModalOpen(true);
  }

  const { currentUser } = useAuth();

  const handleEventClick = async (info) => {
    const isProximo = info.event.extendedProps.type === "proximo";
    
    if (isProximo) {
      if (currentUser?.role === 'admin') {
         if (window.confirm(`¿Seguro que deseas eliminar el próximo evento "${info.event.title}"?`)) {
            const { deleteDoc, doc } = await import("firebase/firestore");
            const { db } = await import("../lib/firebase");
            try {
               await deleteDoc(doc(db, "proximosEventos", info.event.extendedProps.originalId));
            } catch(e) { console.error("Error deleting proximo", e) }
         }
      } else {
         alert(`Próximo Evento: ${info.event.title}\n${info.event.extendedProps.descripcion || ""}`);
      }
      return;
    }

    // Normal User Event Let them edit
    setSelectedEvent({
      id: info.event.id,
      ...info.event.extendedProps
    });
    setSelectedDate("");
    setIsModalOpen(true);
  }

  const handleNewEventClick = () => {
    setSelectedDate("");
    setSelectedEvent(null);
    setIsModalOpen(true);
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col space-y-6" ref={container}>
      <div className="flex items-center justify-between animate-item shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Calendario</h1>
        <div className="flex items-center gap-3">
           <button className="glass px-4 py-2 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors">
            Importar
           </button>
           <button 
            onClick={handleNewEventClick}
            className="bg-[var(--primary)] hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-[var(--primary)]/25"
           >
            Nuevo Evento
           </button>
        </div>
      </div>
      
      <div className="flex-1 glass-card rounded-2xl p-6 relative animate-item calendar-wrapper overflow-hidden flex flex-col min-h-0">
        <style>{`
          .fc-theme-standard td, .fc-theme-standard th {
            border-color: rgba(255,255,255,0.05);
          }
          .fc .fc-toolbar-title {
            font-size: 1.25rem;
            font-weight: 600;
          }
          .fc .fc-button-primary {
            background-color: var(--primary);
            border-color: var(--primary);
            text-transform: capitalize;
            border-radius: 0.5rem;
          }
          .fc .fc-button-primary:not(:disabled):active, 
          .fc .fc-button-primary:not(:disabled).fc-button-active {
            background-color: var(--brand-700);
            border-color: var(--brand-700);
          }
           .fc-day-today {
            background-color: rgba(255,255,255,0.02) !important;
          }
          .fc-daygrid-event {
            border-radius: 4px;
            padding: 2px 4px;
            font-size: 0.75rem;
            overflow: hidden;
          }
          .fc-event-title {
            white-space: normal; /* Allow some wrapping if needed */
            line-height: 1.2;
          }
          
          /* Mobile Responsiveness for Calendar */
          @media (max-width: 768px) {
            .fc .fc-toolbar {
              flex-direction: column;
              gap: 12px;
            }
            .fc .fc-toolbar-title {
              font-size: 1.1rem;
            }
            .fc .fc-button {
              padding: 0.4em 0.6em;
              font-size: 0.8rem;
            }
            .fc-daygrid-event {
              font-size: 0.65rem;
              padding: 2px;
            }
            .fc-event-time {
              display: none !important; /* Hide time to save space for the title on mobile */
            }
            .fc-daygrid-dot-event .fc-event-title {
               font-weight: 600;
            }
          }
        `}</style>
        
        {loading ? (
           <div className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/50 backdrop-blur-sm z-10">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--primary)]"></div>
           </div>
        ) : null}

        <div className="h-full w-full overflow-y-auto custom-scrollbar">
          <FullCalendar
            plugins={[ dayGridPlugin, timeGridPlugin, interactionPlugin ]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,dayGridWeek'
            }}
            locale="es"
            events={calendarEvents}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            height="100%"
            dayMaxEvents={true}
            displayEventTime={window.innerWidth > 768} /* Globally hide time on small screens via prop as well */
            eventDisplay="block" /* Use block display so they look like solid cards rather than dots with text */
          />
        </div>
      </div>

      <EventModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        initialDate={selectedDate}
        eventToEdit={selectedEvent}
      />
    </div>
  )
}
