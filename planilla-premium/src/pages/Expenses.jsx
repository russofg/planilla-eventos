import { useState, useRef, useMemo } from "react"
import { useFirestore } from "../hooks/useFirestore"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Plus, Trash2, ReceiptText } from "lucide-react"
import { doc, deleteDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { COLLECTIONS } from "../hooks/useFirestore"
import { ExpenseModal } from "../components/expenses/ExpenseModal"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

export default function Expenses() {
  const { expenses, loading } = useFirestore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(15)
  const container = useRef()

  const displayedExpenses = useMemo(() => {
    return expenses.slice(0, visibleCount)
  }, [expenses, visibleCount])

  useGSAP(() => {
    if (!loading && displayedExpenses.length > 0) {
      gsap.from(".expense-item", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: "power3.out",
        clearProps: "all"
      })
    }
  }, { scope: container, dependencies: [loading, displayedExpenses.length] })

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount)
  }

  const handleDelete = async (id) => {
    if (window.confirm("¿Estás seguro de que quieres borrar este gasto?")) {
      try {
        await deleteDoc(doc(db, COLLECTIONS.GASTOS, id))
      } catch (error) {
        console.error("Error deleting expense:", error)
        alert("Error al borrar el gasto.")
      }
    }
  }

  const handleLoadMore = () => {
    setVisibleCount(prev => prev + 15)
  }

  if (loading) {
     return (
       <div className="flex items-center justify-center h-full min-h-[500px]">
         <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
       </div>
     )
  }

  const totalGastos = expenses.reduce((acc, curr) => acc + (curr.monto || 0), 0)

  return (
    <div className="space-y-6" ref={container}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestión de Gastos</h1>
          <p className="text-gray-400 mt-1">Registra e historializa tus salidas financieras.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-red-600/90 hover:bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-red-500/25"
        >
          <Plus className="w-5 h-5" />
          Añadir Gasto
        </button>
      </div>
      
      {/* Stats Card */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
           <div className="p-4 bg-red-500/20 text-red-400 rounded-2xl shrink-0">
              <ReceiptText className="w-8 h-8" />
           </div>
           <div className="min-w-0 w-full overflow-hidden">
              <h3 className="text-sm font-medium text-gray-400 mb-1">Total Gastos (Todo el Tiempo)</h3>
              <p className="text-2xl sm:text-4xl font-bold text-red-500 break-all leading-tight">
                {formatCurrency(totalGastos)}
              </p>
           </div>
        </div>
      </div>

      {/* Expenses List */}
      <div className="glass-card rounded-2xl p-6 min-h-[500px]">
        {expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-white/5 rounded-xl">
             <ReceiptText className="w-12 h-12 mb-3 opacity-20" />
             <p>No tienes gastos registrados.</p>
          </div>
        ) : (
          <div className="space-y-3">
             {/* Header Row - Hidden on Mobile */}
             <div className="hidden sm:grid grid-cols-12 gap-4 px-4 py-3 border-b border-white/5 text-sm font-semibold text-gray-400">
               <div className="col-span-6">Descripción</div>
               <div className="col-span-3">Fecha</div>
               <div className="col-span-2 text-right">Monto</div>
               <div className="col-span-1 text-center"></div>
             </div>

             {displayedExpenses.map(gasto => (
                <div key={gasto.id} className="expense-item flex flex-col sm:grid sm:grid-cols-12 gap-1 sm:gap-4 items-start sm:items-center px-4 py-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group relative">
                   
                   <div className="sm:col-span-6 font-medium text-white line-clamp-1 pr-10 sm:pr-0">
                     {gasto.descripcion}
                   </div>
                   
                   <div className="sm:col-span-3 text-xs sm:text-sm text-gray-400">
                     {format(new Date(gasto.fecha + 'T12:00:00'), 'dd MMM yyyy', { locale: es })}
                   </div>
                   
                   <div className="sm:col-span-2 sm:text-right font-bold text-red-400 text-lg sm:text-base">
                     -{formatCurrency(gasto.monto)}
                   </div>
                   
                   <div className="absolute top-4 right-2 sm:relative sm:top-0 sm:right-0 sm:col-span-1 flex justify-end">
                      <button 
                        onClick={() => handleDelete(gasto.id)}
                        className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                        title="Eliminar Gasto"
                      >
                         <Trash2 className="w-5 h-5" />
                      </button>
                   </div>

                </div>
             ))}

              {visibleCount < expenses.length && (
                <div className="pt-6 pb-2 flex justify-center">
                  <button 
                    onClick={handleLoadMore}
                    className="px-6 py-2 rounded-full border border-white/10 text-gray-400 font-medium hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Cargar más gastos ({expenses.length - visibleCount} restantes)
                  </button>
                </div>
              )}
           </div>
         )}
       </div>

      <ExpenseModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  )
}
