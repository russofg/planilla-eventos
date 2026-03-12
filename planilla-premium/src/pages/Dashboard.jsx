import { useFirestore, COLLECTIONS } from "../hooks/useFirestore"
import { doc, deleteDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { useRef, useState, useMemo } from "react"
import { Link } from "react-router-dom"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import CountUp from "react-countup"
import Tilt from "react-parallax-tilt"
import { Plus, Search, Calendar as CalendarIcon, Filter, Download, Wallet } from "lucide-react"
import { EventModal } from "../components/events/EventModal"
import { ExpenseModal } from "../components/expenses/ExpenseModal"
import { ExtraModal } from "../components/extras/ExtraModal"
import { SwipeableItem } from "../components/ui/SwipeableItem"
import { calcularPagoEvento } from "../utils/calculations"
import { generatePdf } from "../utils/generatePdf"
import { useAuth } from "../contexts/AuthContext"
import { playPopSound, playTickSound } from "../utils/audio"
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell 
} from 'recharts';

gsap.registerPlugin(useGSAP)

export default function Dashboard() {
  const { currentUser } = useAuth();
  const { events, expenses, extras, loading, userPrefs, sueldoFijo, tarifasGlobales, totalBonos, totalAdelantos } = useFirestore();
  const container = useRef();
  
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isExtraModalOpen, setIsExtraModalOpen] = useState(false);
  const [selectedEventToEdit, setSelectedEventToEdit] = useState(null);
  const [selectedExpenseToEdit, setSelectedExpenseToEdit] = useState(null);
  const [selectedExtraToEdit, setSelectedExtraToEdit] = useState(null);

  // Filters
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth().toString());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [filterText, setFilterText] = useState("");

  // Pagination
  const [visibleEvents, setVisibleEvents] = useState(20);
  const [visibleExpenses, setVisibleExpenses] = useState(20);
  const [visibleExtras, setVisibleExtras] = useState(20);

  // Filtered Logic & Monthly Totals
  const { filteredEvents, filteredExpenses, filteredExtras, monthTotalEvents, monthTotalExpenses, monthTotalBonos, monthTotalAdelantos, monthTotalFinal } = useMemo(() => {
    let tempEvents = events;
    let tempExpenses = expenses;
    let tempExtras = extras;

    if (filterMonth !== "") {
      tempEvents = tempEvents.filter(e => new Date(e.fecha + 'T12:00:00').getMonth() === parseInt(filterMonth));
      tempExpenses = tempExpenses.filter(g => new Date(g.fecha + 'T12:00:00').getMonth() === parseInt(filterMonth));
      tempExtras = tempExtras.filter(x => new Date(x.fecha + 'T12:00:00').getMonth() === parseInt(filterMonth));
    }
    
    if (filterYear !== "") {
      tempEvents = tempEvents.filter(e => new Date(e.fecha + 'T12:00:00').getFullYear() === parseInt(filterYear));
      tempExpenses = tempExpenses.filter(g => new Date(g.fecha + 'T12:00:00').getFullYear() === parseInt(filterYear));
      tempExtras = tempExtras.filter(x => new Date(x.fecha + 'T12:00:00').getFullYear() === parseInt(filterYear));
    }

    if (filterText) {
      tempEvents = tempEvents.filter(e => e.evento.toLowerCase().includes(filterText.toLowerCase()));
      tempExpenses = tempExpenses.filter(g => g.descripcion.toLowerCase().includes(filterText.toLowerCase()));
      tempExtras = tempExtras.filter(x => x.descripcion.toLowerCase().includes(filterText.toLowerCase()));
    }

    const tEvents = tempEvents.reduce((acc, curr) => {
      const calc = calcularPagoEvento(curr.fecha, curr.horaEntrada, curr.horaSalida, curr.operacion, curr.feriado, tarifasGlobales);
      return acc + calc.pagoTotalEvento;
    }, 0);

    const tExpenses = tempExpenses.reduce((acc, curr) => acc + (curr.monto || 0), 0);
    
    let tBonos = 0;
    let tAdelantos = 0;
    tempExtras.forEach(ext => {
      if (ext.tipo === 'bono') tBonos += (ext.monto || 0);
      else if (ext.tipo === 'adelanto') tAdelantos += (ext.monto || 0);
    });

    const tFinal = sueldoFijo + tEvents + tExpenses + tBonos - tAdelantos;

    return {
      filteredEvents: tempEvents,
      filteredExpenses: tempExpenses,
      filteredExtras: tempExtras,
      monthTotalEvents: tEvents,
      monthTotalExpenses: tExpenses,
      monthTotalBonos: tBonos,
      monthTotalAdelantos: tAdelantos,
      monthTotalFinal: tFinal
    };
  }, [events, expenses, extras, filterMonth, filterYear, filterText, sueldoFijo, tarifasGlobales]);

  const handleDeleteEvent = async (id) => {
    if (window.confirm("¿Seguro que deseas eliminar este evento?")) {
      await deleteDoc(doc(db, COLLECTIONS.EVENTOS, id))
    }
  }

  const handleDeleteExpense = async (id) => {
    if (window.confirm("¿Seguro que deseas eliminar este gasto?")) {
      await deleteDoc(doc(db, COLLECTIONS.GASTOS, id))
    }
  }

  const handleDeleteExtra = async (id) => {
    if (window.confirm("¿Seguro que deseas eliminar este movimiento extra?")) {
      await deleteDoc(doc(db, COLLECTIONS.EXTRAS, id))
    }
  }

  const openNewEvent = () => {
     setSelectedEventToEdit(null);
     setIsEventModalOpen(true);
  }

  const openNewExpense = () => {
    setSelectedExpenseToEdit(null);
    setIsExpenseModalOpen(true);
  }

  const openNewExtra = () => {
    setSelectedExtraToEdit(null);
    setIsExtraModalOpen(true);
  }

  useGSAP(() => {
    if (!loading) {
      gsap.from(".animate-item", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        clearProps: "all"
      });
    }
  }, { scope: container, dependencies: [loading] });

  const prevMonthStats = useMemo(() => {
    if (filterText) return null; // Disable MoM if searching globally

    const currentM = filterMonth !== "" ? parseInt(filterMonth) : new Date().getMonth();
    const currentY = filterYear !== "" ? parseInt(filterYear) : new Date().getFullYear();

    let prevM = currentM - 1;
    let prevY = currentY;

    if (prevM < 0) {
      prevM = 11;
      prevY = currentY - 1;
    }

    const pEvents = events.filter(e => {
        const d = new Date(e.fecha + 'T12:00:00');
        return d.getMonth() === prevM && d.getFullYear() === prevY;
    });
    const pExpenses = expenses.filter(g => {
        const d = new Date(g.fecha + 'T12:00:00');
        return d.getMonth() === prevM && d.getFullYear() === prevY;
    });
    const pExtras = extras.filter(x => {
        const d = new Date(x.fecha + 'T12:00:00');
        return d.getMonth() === prevM && d.getFullYear() === prevY;
    });

    const pTotalEvents = pEvents.reduce((acc, curr) => {
      const calc = calcularPagoEvento(curr.fecha, curr.horaEntrada, curr.horaSalida, curr.operacion, curr.feriado, tarifasGlobales);
      return acc + calc.pagoTotalEvento;
    }, 0);
    const pTotalExpenses = pExpenses.reduce((acc, curr) => acc + (curr.monto || 0), 0);
    
    let pBonos = 0;
    let pAdelantos = 0;
    pExtras.forEach(ext => {
      if (ext.tipo === 'bono') pBonos += (ext.monto || 0);
      else if (ext.tipo === 'adelanto') pAdelantos += (ext.monto || 0);
    });

    const pTotalFinal = sueldoFijo + pTotalEvents + pTotalExpenses + pBonos - pAdelantos;

    const calculateGrowth = (current, prev) => {
      if (prev === 0) return current > 0 ? 100 : 0;
      return ((current - prev) / Math.abs(prev)) * 100;
    };

    return { 
      totalFinal: pTotalFinal, 
      eventsCount: pEvents.length,
      totalEvents: pTotalEvents,
      totalExpenses: pTotalExpenses,
      totalBonos: pBonos,
      totalAdelantos: pAdelantos,
      growths: {
        final: calculateGrowth(monthTotalFinal, pTotalFinal),
        events: calculateGrowth(monthTotalEvents, pTotalEvents),
        expenses: calculateGrowth(monthTotalExpenses, pTotalExpenses),
        bonos: calculateGrowth(pBonos, pBonos), // This seems redundant if pBonos is used twice, should be monthTotalBonos
        adelantos: calculateGrowth(pAdelantos, pAdelantos)
      }
    };
  }, [events, expenses, extras, filterMonth, filterYear, filterText, sueldoFijo, monthTotalFinal, monthTotalEvents, monthTotalExpenses, monthTotalBonos, monthTotalAdelantos, tarifasGlobales]);

  // Fix growth calculation Redundancy and add Chart Data
  const statsWithGrowth = useMemo(() => {
    if (!prevMonthStats) return null;
    
    const calculateGrowth = (current, prev) => {
      if (prev === 0) return current > 0 ? 100 : 0;
      return ((current - prev) / Math.abs(prev)) * 100;
    };

    return {
      final: calculateGrowth(monthTotalFinal, prevMonthStats.totalFinal),
      events: calculateGrowth(monthTotalEvents, prevMonthStats.totalEvents),
      expenses: calculateGrowth(monthTotalExpenses, prevMonthStats.totalExpenses),
      bonos: calculateGrowth(monthTotalBonos, prevMonthStats.totalBonos),
      adelantos: calculateGrowth(monthTotalAdelantos, prevMonthStats.totalAdelantos),
    }
  }, [monthTotalFinal, monthTotalEvents, monthTotalExpenses, monthTotalBonos, monthTotalAdelantos, prevMonthStats]);

  const { chartData, pieData } = useMemo(() => {
    // 1. Process Trend Data (AreaChart)
    const daysInMonth = new Date(parseInt(filterYear), parseInt(filterMonth) + 1, 0).getDate();
    const data = [];
    
    for (let i = 1; i <= daysInMonth; i++) {
      const dayStr = i.toString().padStart(2, '0');
      const dateKey = `${filterYear}-${(parseInt(filterMonth) + 1).toString().padStart(2, '0')}-${dayStr}`;
      
      const dayEvents = filteredEvents.filter(e => e.fecha === dateKey).reduce((acc, curr) => {
        const calc = calcularPagoEvento(curr.fecha, curr.horaEntrada, curr.horaSalida, curr.operacion, curr.feriado, tarifasGlobales);
        return acc + calc.pagoTotalEvento;
      }, 0);

      const dayExpenses = filteredExpenses.filter(e => e.fecha === dateKey).reduce((acc, curr) => acc + (curr.monto || 0), 0);
      const dayExtras = filteredExtras.filter(e => e.fecha === dateKey).reduce((acc, curr) => {
        return acc + (curr.tipo === 'bono' ? curr.monto : -curr.monto);
      }, 0);

      data.push({
        name: i,
        Ingresos: dayEvents + (dayExtras > 0 ? dayExtras : 0),
        Gastos: Math.abs(dayExpenses + (dayExtras < 0 ? dayExtras : 0))
      });
    }

    // 2. Process Pie Data (Income Sources)
    const pData = [
      { name: 'Sueldo', value: sueldoFijo, color: '#3b82f6' },
      { name: 'Eventos', value: monthTotalEvents, color: '#10b981' },
      { name: 'Bonos', value: monthTotalBonos, color: '#06b6d4' }
    ].filter(d => d.value > 0);

    return { chartData: data, pieData: pData };
  }, [filteredEvents, filteredExpenses, filteredExtras, filterMonth, filterYear, sueldoFijo, monthTotalEvents, monthTotalBonos, tarifasGlobales]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { 
      style: 'currency', 
      currency: 'ARS',
      maximumFractionDigits: 0
    }).format(amount);
  }

  const insightMessage = useMemo(() => {
    if (!prevMonthStats || filterText) return null;
    
    const diffFinal = monthTotalFinal - prevMonthStats.totalFinal;
    const diffCount = filteredEvents.length - prevMonthStats.eventsCount;
    
    if (filteredEvents.length === 0 && prevMonthStats.eventsCount === 0) return "Comienza a registrar eventos este mes.";
    
    if (diffFinal > 0) {
      return `¡Genial! Generaste ${formatCurrency(diffFinal)} más que el mes pasado ✨`;
    } else if (diffFinal < 0) {
      return `Vienes ${formatCurrency(Math.abs(diffFinal))} por debajo del mes pasado 📉`;
    } else if (diffCount > 0) {
      return `Llevas ${diffCount} evento(s) más que el mes pasado 🚀`;
    } else {
      return "Tus números se mantienen estables respecto al anterior ⚖️";
    }
  }, [prevMonthStats, monthTotalFinal, filteredEvents.length]);

  const handleExportPdf = () => {
    playTickSound();
    generatePdf({
      events: filteredEvents,
      expenses: filteredExpenses,
      extras: filteredExtras,
      sueldoFijo,
      monthTotalEvents,
      monthTotalExpenses,
      monthTotalBonos,
      monthTotalAdelantos,
      monthTotalFinal,
      filterMonth,
      filterYear,
      userEmail: currentUser?.email,
      tarifasGlobales
    });
  };

  const currentHour = new Date().getHours();
  let greeting = 'Buenas noches';
  if (currentHour >= 5 && currentHour < 12) greeting = 'Buenos días';
  else if (currentHour >= 12 && currentHour < 20) greeting = 'Buenas tardes';

  const rawName = userPrefs?.nombre || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuario';
  const userName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="flex flex-col mb-2 space-y-3">
          <div className="h-4 w-32 bg-white/5 rounded-full animate-pulse" />
          <div className="h-10 w-64 bg-white/5 rounded-xl animate-pulse" />
        </div>
        
        {/* Cards Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white/5 rounded-xl border border-white/5 animate-pulse" />
          ))}
        </div>

        {/* Analytics Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 h-[300px] bg-white/5 rounded-2xl border border-white/5 animate-pulse" />
          <div className="lg:col-span-1 h-[300px] bg-white/5 rounded-2xl border border-white/5 animate-pulse" />
        </div>

        {/* Filters Skeleton */}
        <div className="h-16 bg-white/5 rounded-xl border border-white/5 animate-pulse" />

        {/* Main Content Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-[500px] bg-white/5 rounded-2xl border border-white/5 animate-pulse" />
          <div className="lg:col-span-1 space-y-6">
            <div className="h-64 bg-white/5 rounded-2xl border border-white/5 animate-pulse" />
            <div className="h-64 bg-white/5 rounded-2xl border border-white/5 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" ref={container}>
      <div className="flex flex-col mb-2 animate-item">
        <div className="flex items-center gap-3 mb-1">
           <p className="text-gray-400 font-medium text-sm sm:text-base">{greeting},</p>
           {insightMessage && (
             <span className="hidden sm:inline-block px-2.5 py-0.5 bg-blue-500/10 text-blue-400 text-[11px] font-semibold tracking-wide rounded-full border border-blue-500/20 shadow-sm animate-pulse-slow">
               {insightMessage}
             </span>
           )}
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">{userName}</h1>
        {insightMessage && (
          <p className="sm:hidden text-blue-400 text-xs font-medium mt-1.5 opacity-90">
            {insightMessage}
          </p>
        )}
      </div>
      
      {/* Cards Overview - Premium 3D & CountUp Layout */}
      <div className="flex flex-wrap lg:flex-nowrap gap-4 animate-item">
        <Tilt tiltMaxAngleX={5} tiltMaxAngleY={5} glareEnable={true} glareMaxOpacity={0.1} glareColor="white" glarePosition="all" scale={1.02} transitionSpeed={2000} className="flex-1 min-w-[140px]">
          <div className="glass-card rounded-xl p-4 relative overflow-hidden group h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <h3 className="text-xs font-medium text-gray-400 mb-1">Sueldo Fijo</h3>
            <p className="text-lg sm:text-xl font-bold text-white break-all leading-tight">
              <CountUp end={sueldoFijo} formattingFn={formatCurrency} duration={1.5} />
            </p>
          </div>
        </Tilt>

        <Tilt tiltMaxAngleX={5} tiltMaxAngleY={5} glareEnable={true} glareMaxOpacity={0.1} glareColor="white" glarePosition="all" scale={1.02} transitionSpeed={2000} className="flex-1 min-w-[140px]">
          <div className="glass-card rounded-xl p-4 relative overflow-hidden group h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex justify-between items-start mb-1">
              <h3 className="text-xs font-medium text-gray-400">Eventos</h3>
              {statsWithGrowth && (
                <span className={`text-[10px] font-bold ${statsWithGrowth.events >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {statsWithGrowth.events >= 0 ? '+' : ''}{statsWithGrowth.events.toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-lg sm:text-xl font-bold text-green-400 break-all leading-tight">
              <CountUp end={monthTotalEvents} formattingFn={formatCurrency} duration={1.5} />
            </p>
          </div>
        </Tilt>

        {monthTotalBonos > 0 && (
          <Tilt tiltMaxAngleX={5} tiltMaxAngleY={5} glareEnable={true} glareMaxOpacity={0.1} glareColor="white" glarePosition="all" scale={1.02} transitionSpeed={2000} className="flex-1 min-w-[140px]">
            <div className="glass-card rounded-xl p-4 relative overflow-hidden group h-full">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-xs font-medium text-gray-400">Bonos</h3>
                {statsWithGrowth && statsWithGrowth.bonos !== 0 && (
                  <span className={`text-[10px] font-bold ${statsWithGrowth.bonos >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {statsWithGrowth.bonos >= 0 ? '+' : ''}{statsWithGrowth.bonos.toFixed(0)}%
                  </span>
                )}
              </div>
              <p className="text-lg sm:text-xl font-bold text-emerald-400 break-all leading-tight">
                <CountUp end={monthTotalBonos} formattingFn={(val) => `+${formatCurrency(val)}`} duration={1.5} />
              </p>
            </div>
          </Tilt>
        )}

        <Tilt tiltMaxAngleX={5} tiltMaxAngleY={5} glareEnable={true} glareMaxOpacity={0.1} glareColor="white" glarePosition="all" scale={1.02} transitionSpeed={2000} className="flex-1 min-w-[140px]">
          <div className="glass-card rounded-xl p-4 relative overflow-hidden group h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex justify-between items-start mb-1">
              <h3 className="text-xs font-medium text-gray-400">Gastos</h3>
              {statsWithGrowth && (
                <span className={`text-[10px] font-bold ${statsWithGrowth.expenses <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {statsWithGrowth.expenses > 0 ? '+' : ''}{statsWithGrowth.expenses.toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-lg sm:text-xl font-bold text-red-400 break-all leading-tight">
              <CountUp end={monthTotalExpenses} formattingFn={formatCurrency} duration={1.5} />
            </p>
          </div>
        </Tilt>

        {monthTotalAdelantos > 0 && (
          <Tilt tiltMaxAngleX={5} tiltMaxAngleY={5} glareEnable={true} glareMaxOpacity={0.1} glareColor="white" glarePosition="all" scale={1.02} transitionSpeed={2000} className="flex-1 min-w-[140px]">
            <div className="glass-card rounded-xl p-4 relative overflow-hidden group h-full">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-xs font-medium text-gray-400">Adelantos</h3>
                {statsWithGrowth && statsWithGrowth.adelantos !== 0 && (
                  <span className={`text-[10px] font-bold ${statsWithGrowth.adelantos <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {statsWithGrowth.adelantos > 0 ? '+' : ''}{statsWithGrowth.adelantos.toFixed(0)}%
                  </span>
                )}
              </div>
              <p className="text-lg sm:text-xl font-bold text-orange-400 break-all leading-tight">
                <CountUp end={monthTotalAdelantos} formattingFn={(val) => `-${formatCurrency(val)}`} duration={1.5} />
              </p>
            </div>
          </Tilt>
        )}

        <Tilt tiltMaxAngleX={5} tiltMaxAngleY={5} glareEnable={true} glareMaxOpacity={0.1} glareColor="white" glarePosition="all" scale={1.02} transitionSpeed={2000} className="flex-1 min-w-[150px]">
          <div className="glass-card rounded-xl p-4 relative overflow-hidden group border-[var(--primary)]/50 shadow-[0_0_15px_rgba(37,106,244,0.15)] h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary)]/20 to-transparent" />
            <div className="flex justify-between items-start mb-1">
              <h3 className="text-xs font-medium text-[var(--brand-300)]">TOTAL</h3>
              {statsWithGrowth && (
                <span className={`text-[10px] font-bold ${statsWithGrowth.final >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {statsWithGrowth.final >= 0 ? '+' : ''}{statsWithGrowth.final.toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-xl sm:text-2xl font-bold text-white drop-shadow-md break-all leading-tight">
              <CountUp end={monthTotalFinal} formattingFn={formatCurrency} duration={2} />
            </p>
          </div>
        </Tilt>
      </div>

      {/* Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-item">
        <div className="lg:col-span-3 glass-card rounded-2xl p-6 h-[300px]">
          <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            Tendencia Mensual (Ingresos vs Gastos)
          </h3>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorGastos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis 
                dataKey="name" 
                stroke="#666" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                minTickGap={20}
              />
              <YAxis hide />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-[#1a1c23] border border-white/10 p-3 rounded-xl shadow-2xl backdrop-blur-md">
                        <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider font-bold">Día {payload[0].payload.name}</p>
                        <div className="space-y-1">
                          <p className="text-xs text-emerald-400 flex justify-between gap-4">
                            <span>Ingresos:</span>
                            <span className="font-bold">{formatCurrency(payload[0].value)}</span>
                          </p>
                          <p className="text-xs text-rose-400 flex justify-between gap-4">
                            <span>Gastos:</span>
                            <span className="font-bold">{formatCurrency(payload[1].value)}</span>
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area 
                type="monotone" 
                dataKey="Ingresos" 
                stroke="#10b981" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorIngresos)" 
              />
              <Area 
                type="monotone" 
                dataKey="Gastos" 
                stroke="#f43f5e" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorGastos)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-1 glass-card rounded-2xl p-6 h-[300px] flex flex-col justify-center relative overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-400 mb-2 text-center">Fuentes</h3>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-[#1a1c23] border border-white/10 px-3 py-1.5 rounded-lg shadow-xl">
                          <p className="text-xs font-bold" style={{ color: payload[0].payload.color }}>
                            {payload[0].name}: {formatCurrency(payload[0].value)}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            {pieData.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-gray-400">{item.name}</span>
                </div>
                <span className="text-white font-bold">
                  {((item.value / pieData.reduce((acc, c) => acc + c.value, 0)) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced Filter Bar */}
      <div className="glass-card p-4 rounded-xl flex flex-col md:flex-row gap-4 items-center justify-between animate-item">
         <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="w-5 h-5 text-[var(--primary)]" />
            <span className="font-semibold text-white">Filtros:</span>
         </div>
         <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="relative w-full md:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder="Buscar por nombre..." 
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors"
              />
            </div>
            <select 
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors [color-scheme:dark]"
            >
              <option value="">Mes: Todos</option>
              {Array.from({length: 12}).map((_, i) => (
                <option key={i} value={i}>{format(new Date(2024, i, 1), 'MMMM', {locale: es}).toUpperCase()}</option>
              ))}
            </select>
            <select 
              value={filterYear}
              onChange={e => setFilterYear(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--primary)] transition-colors [color-scheme:dark]"
            >
              <option value="">Año: Todos</option>
              <option value="2025">2025</option>
              <option value="2026">2026</option>
              <option value="2027">2027</option>
              <option value="2028">2028</option>
            </select>
            <button 
              onClick={handleExportPdf}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 text-sm font-medium rounded-lg border border-white/20 transition-colors shrink-0"
              title="Exportar reporte del mes en PDF"
            >
               <Download className="w-4 h-4" />
               <span className="hidden sm:inline">Exportar PDF</span>
            </button>
         </div>
      </div>

      {/* Main Content Area - Bento Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Events */}
        <div className="lg:col-span-2 glass-card rounded-2xl p-6 min-h-[400px] flex flex-col animate-item">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
               <h2 className="text-lg md:text-xl font-semibold">Eventos Registrados ({filteredEvents.length})</h2>
            </div>
            <button 
              onClick={() => {
                playPopSound();
                openNewEvent();
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-[var(--primary)] text-white rounded-lg hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Añadir Evento
            </button>
          </div>
          {filteredEvents.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500 text-sm border-2 border-dashed border-white/5 rounded-xl">
               No hay eventos que coincidan con los filtros.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEvents.slice(0, visibleEvents).map(evt => (
                 <SwipeableItem 
                   key={evt.id} 
                   onEdit={() => { setSelectedEventToEdit(evt); setIsEventModalOpen(true); }}
                   onDelete={() => handleDeleteEvent(evt.id)}
                 >
                   <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-[#1a1c23] border border-white/5 transition-colors h-full w-full gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                            <h4 className="font-medium text-white">{evt.evento}</h4>
                            {evt.operacion && (
                               <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-[var(--primary)]/20 text-[var(--brand-300)] rounded">Operación</span>
                            )}
                        </div>
                        <p className="text-sm text-gray-400 mb-2">
                          {format(new Date(evt.fecha + 'T12:00:00'), 'dd MMM yyyy', { locale: es })} • {evt.horaEntrada} - {evt.horaSalida}
                        </p>
                        {/* Breakdown math */}
                        {(() => {
                           const calc = calcularPagoEvento(evt.fecha, evt.horaEntrada, evt.horaSalida, evt.operacion, evt.feriado, tarifasGlobales);
                           return (
                             <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 bg-black/20 p-2 rounded-lg border border-white/5 w-fit">
                               {calc.horasExtra > 0 && (
                                 <span>Extras: <strong className="text-gray-300">{calc.horasExtra}h</strong> <span className="opacity-70">({formatCurrency(calc.pagoExtra)})</span></span>
                               )}
                               {calc.pagoOperacion > 0 && (
                                 <span className="text-[var(--brand-300)]">Op: {formatCurrency(calc.pagoOperacion)}</span>
                               )}
                               <span className="text-green-400 font-medium ml-auto sm:ml-2 break-all">Ganancia: {formatCurrency(calc.pagoTotalEvento)}</span>
                             </div>
                           )
                        })()}
                      </div>
                   </div>
                 </SwipeableItem>
              ))}
              
              {visibleEvents < filteredEvents.length && (
                <div className="pt-4 flex justify-center">
                   <button 
                     onClick={() => setVisibleEvents(prev => prev + 20)}
                     className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10"
                   >
                     Cargar 20 eventos más
                   </button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Right Column: Gastos & Bonos Stack */}
        <div className="lg:col-span-1 flex flex-col gap-6 animate-item">
          
          {/* Gastos Card */}
          <div className="glass-card rounded-2xl p-6 flex flex-col min-h-[300px] lg:max-h-[500px]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                 <h2 className="text-lg md:text-xl font-semibold">Gastos ({filteredExpenses.length})</h2>
              </div>
              <button 
                onClick={() => {
                  playPopSound();
                  openNewExpense();
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-red-600/90 text-white rounded-lg hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Gasto</span>
              </button>
            </div>
             {filteredExpenses.length === 0 ? (
               <div className="flex items-center justify-center p-8 text-gray-500 text-sm border-2 border-dashed border-white/5 rounded-xl flex-1">
                 Ninguno registrado.
              </div>
             ) : (
               <div className="space-y-3 overflow-y-auto pr-1 pb-2 scrollbar-thin flex-1">
                {filteredExpenses.slice(0, visibleExpenses).map(gasto => (
                   <SwipeableItem 
                     key={gasto.id} 
                     onEdit={() => { setSelectedExpenseToEdit(gasto); setIsExpenseModalOpen(true); }}
                     onDelete={() => handleDeleteExpense(gasto.id)}
                   >
                     <div className="flex items-center justify-between p-4 rounded-xl bg-[#1a1c23] border border-white/5 transition-colors h-full w-full gap-2">
                       <div className="min-w-0 flex-1">
                         <h4 className="font-medium text-white truncate">{gasto.descripcion}</h4>
                         <p className="text-sm text-gray-400">
                           {format(new Date(gasto.fecha + 'T12:00:00'), 'dd MMM yyyy', { locale: es })}
                         </p>
                       </div>
                       <span className="font-semibold text-red-400 shrink-0 ml-2 break-all text-right text-sm max-w-[40%]">
                         -{formatCurrency(gasto.monto)}
                       </span>
                     </div>
                   </SwipeableItem>
                ))}
                
                {visibleExpenses < filteredExpenses.length && (
                  <div className="pt-2 flex justify-center pb-2">
                     <button 
                       onClick={() => setVisibleExpenses(prev => prev + 10)}
                       className="px-4 py-2 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10"
                     >
                       Ver más
                     </button>
                  </div>
                )}
              </div>
             )}
          </div>

          {/* Bonos y Adelantos Card */}
          <div className="glass-card rounded-2xl p-6 flex flex-col min-h-[300px] lg:max-h-[500px]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                 <h2 className="text-lg font-semibold flex items-center gap-2">
                   <Wallet className="w-5 h-5 text-gray-400" />
                   Bonos / Adelantos
                 </h2>
              </div>
              <button 
                onClick={openNewExtra}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-gray-700/80 text-white rounded-lg hover:bg-gray-600 transition-colors shadow-lg shadow-black/20 shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nuevo</span>
              </button>
            </div>
             {filteredExtras.length === 0 ? (
               <div className="flex items-center justify-center p-8 text-gray-500 text-sm border-2 border-dashed border-white/5 rounded-xl flex-1">
                 Ninguno registrado.
              </div>
             ) : (
               <div className="space-y-3 overflow-y-auto pr-1 pb-2 scrollbar-thin flex-1">
                {filteredExtras.slice(0, visibleExtras).map(extra => (
                   <SwipeableItem 
                     key={extra.id} 
                     onEdit={() => { setSelectedExtraToEdit(extra); setIsExtraModalOpen(true); }}
                     onDelete={() => handleDeleteExtra(extra.id)}
                   >
                     <div className="flex items-center justify-between p-4 rounded-xl bg-[#1a1c23] border border-white/5 transition-colors h-full w-full gap-2">
                       <div className="min-w-0 flex-1">
                         <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-white truncate">{extra.descripcion}</h4>
                            <span className={`px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded border ${
                              extra.tipo === 'bono' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' : 'bg-orange-500/20 text-orange-400 border-orange-500/20'
                            }`}>
                              {extra.tipo}
                            </span>
                         </div>
                         <p className="text-sm text-gray-400">
                           {format(new Date(extra.fecha + 'T12:00:00'), 'dd MMM yyyy', { locale: es })}
                         </p>
                       </div>
                       <span className={`font-semibold shrink-0 ml-2 break-all text-right text-sm max-w-[40%] ${
                         extra.tipo === 'bono' ? 'text-emerald-400' : 'text-orange-400'
                       }`}>
                         {extra.tipo === 'bono' ? '+' : '-'}{formatCurrency(extra.monto)}
                       </span>
                     </div>
                   </SwipeableItem>
                ))}
                
                {visibleExtras < filteredExtras.length && (
                  <div className="pt-2 flex justify-center pb-2">
                     <button 
                       onClick={() => setVisibleExtras(prev => prev + 10)}
                       className="px-4 py-2 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10"
                     >
                       Ver más
                     </button>
                  </div>
                )}
              </div>
             )}
          </div>
          
        </div>
      </div>

      {isEventModalOpen && (
        <EventModal 
          isOpen={isEventModalOpen} 
          onClose={() => { setIsEventModalOpen(false); setSelectedEventToEdit(null); }} 
          eventToEdit={selectedEventToEdit}
        />
      )}
      {isExpenseModalOpen && (
        <ExpenseModal 
          isOpen={isExpenseModalOpen} 
          onClose={() => { setIsExpenseModalOpen(false); setSelectedExpenseToEdit(null); }} 
          expenseToEdit={selectedExpenseToEdit}
        />
      )}
      {isExtraModalOpen && (
        <ExtraModal 
          isOpen={isExtraModalOpen} 
          onClose={() => { setIsExtraModalOpen(false); setSelectedExtraToEdit(null); }} 
          extraToEdit={selectedExtraToEdit}
        />
      )}
    </div>
  )
}
