import { useEffect, useState, useRef } from "react"
import { useAuth } from "../contexts/AuthContext"
import { db } from "../lib/firebase"
import { collection, getDocs } from "firebase/firestore"
import { ShieldAlert, Users, Send, CheckCircle2, CalendarPlus, Save } from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { Navigate } from "react-router-dom"
import { sendNotificationToAll } from "../services/pushService"

export default function Admin() {
  const { currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [notifTitle, setNotifTitle] = useState("")
  const [notifMsg, setNotifMsg] = useState("")
  const [pushing, setPushing] = useState(false)
  const [pushSuccess, setPushSuccess] = useState(false)

  // Proximos Eventos State
  const [proxNombre, setProxNombre] = useState("")
  const [proxInicio, setProxInicio] = useState("")
  const [proxFin, setProxFin] = useState("")
  const [proxDesc, setProxDesc] = useState("")
  const [proxSaving, setProxSaving] = useState(false)

  const containerRef = useRef(null)

  useEffect(() => {
    async function fetchUsers() {
      try {
        const snapshot = await getDocs(collection(db, "users"))
        const usersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        setUsers(usersList)
      } catch (error) {
        console.error("Error fetching users:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchUsers()
  }, [])

  useGSAP(() => {
    if (!loading) {
      gsap.from(".admin-card", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: "power3.out"
      })
    }
  }, { scope: containerRef, dependencies: [loading] })

  const handleSendNotification = async () => {
    if (!notifTitle.trim() || !notifMsg.trim()) return
    setPushing(true)
    const res = await sendNotificationToAll(notifTitle, notifMsg)
    setPushing(false)
    if (res.success) {
      setNotifTitle("")
      setNotifMsg("")
      setPushSuccess(true)
      setTimeout(() => setPushSuccess(false), 3000)
    } else {
      alert("Error enviando notificaciones: " + res.error)
    }
  }

  const handleSaveProximo = async () => {
    const nameClean = proxNombre.trim()
    if (!nameClean || !proxInicio || !proxFin) return;
    setProxSaving(true);
    const { addDoc, collection } = await import("firebase/firestore");
    try {
      await addDoc(collection(db, "proximosEventos"), {
        nombre: nameClean,
        fechaInicio: proxInicio,
        fechaFin: proxFin,
        descripcion: proxDesc.trim(),
        createdAt: new Date().toISOString()
      });
      setProxNombre("");
      setProxInicio("");
      setProxFin("");
      setProxDesc("");
      alert("Próximo evento agregado con éxito al Calendario de todos.");
    } catch(e) {
      console.error(e);
      alert("Error al guardar Próximo Evento.");
    } finally {
      setProxSaving(false);
    }
  }

  // Protect route
  if (!currentUser) return <Navigate to="/login" />
  if (currentUser.role !== "admin") return (
    <div className="flex flex-col items-center justify-center min-h-[500px] text-center">
      <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
      <h2 className="text-2xl font-bold text-white mb-2">Acceso Denegado</h2>
      <p className="text-gray-400">Esta sección es exclusiva para Administradores.</p>
    </div>
  )

  if (loading) {
     return (
       <div className="flex items-center justify-center min-h-[500px]">
         <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
       </div>
     )
  }

  return (
    <div className="space-y-6" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-white/10 pb-6">
        <div className="p-3 bg-red-500/20 text-red-400 rounded-xl">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Panel de Administración</h1>
          <p className="text-gray-400 mt-1">Control total, configuraciones globales y estadísticas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Users Section */}
        <div className="admin-card glass-card rounded-2xl p-6">
           <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
             <Users className="w-5 h-5 text-blue-400" />
             Usuarios / Empleados
           </h2>
           <div className="space-y-3">
             {users.map(u => (
                <div key={u.id} className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition">
                  <div>
                    <p className="font-semibold text-white">{u.email}</p>
                    <p className="text-xs text-gray-500 font-mono mt-1">UID: {u.id}</p>
                  </div>
                  <span className={`px-2 py-1 text-xs font-bold uppercase rounded-md ${u.role === 'admin' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                    {u.role || 'Usuario'}
                  </span>
                </div>
             ))}
           </div>
        </div>

        {/* Global Notifications Section */}
        <div className="admin-card glass-card rounded-2xl p-6">
           <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
             <Send className="w-5 h-5 text-purple-400" />
             Notificaciones Push
           </h2>
           <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Título de la Notificación</label>
                <input 
                  type="text" 
                  value={notifTitle}
                  onChange={e => setNotifTitle(e.target.value)}
                  placeholder="Ej: Nuevas Tarifas de Feriado" 
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Mensaje</label>
                <textarea 
                  rows={4}
                  value={notifMsg}
                  onChange={e => setNotifMsg(e.target.value)}
                  placeholder="Escribe el mensaje para el personal..." 
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors resize-none"
                />
              </div>
              <button 
                onClick={handleSendNotification}
                disabled={pushing || !notifTitle || !notifMsg}
                className={`w-full flex items-center justify-center gap-2 font-semibold py-3 rounded-xl transition-all shadow-lg text-white
                   ${pushSuccess ? 'bg-green-600 shadow-green-600/20' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/20'}
                   disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                 {pushSuccess ? <><CheckCircle2 className="w-5 h-5"/> ¡Enviado Exitosamente!</> : pushing ? 'Enviando...' : <><Send className="w-5 h-5" /> Enviar a Todos</>}
              </button>
           </div>
        </div>

        {/* Global Upcoming Events Section */}
        <div className="admin-card lg:col-span-2 glass-card rounded-2xl p-6">
           <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
             <CalendarPlus className="w-5 h-5 text-green-400" />
             Añadir "Próximo Evento" Global
           </h2>
           <p className="text-sm text-gray-400 mb-6">Los eventos creados aquí aparecerán en color VERDE en el Calendario de todos los empleados.</p>
           
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Nombre del Evento *</label>
                <input 
                  type="text" 
                  value={proxNombre}
                  onChange={e => setProxNombre(e.target.value)}
                  placeholder="Ej: Feriado Nacional / Gran Evento" 
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Fecha Inicio *</label>
                    <input 
                      type="date" 
                      value={proxInicio}
                      onChange={e => setProxInicio(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary cursor-text"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Fecha Fin *</label>
                    <input 
                      type="date" 
                      value={proxFin}
                      onChange={e => setProxFin(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary cursor-text"
                    />
                 </div>
              </div>
           </div>
           
           <div className="mb-4">
              <label className="block text-sm font-medium text-gray-400 mb-1">Descripción corta (Opcional)</label>
              <textarea 
                rows={2}
                value={proxDesc}
                onChange={e => setProxDesc(e.target.value)}
                placeholder="Detalles del evento..." 
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors resize-none"
              />
           </div>

           <button 
             onClick={handleSaveProximo}
             disabled={proxSaving || !proxNombre || !proxInicio || !proxFin}
             className="w-full md:w-auto px-8 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-green-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
           >
              <Save className="w-5 h-5" /> {proxSaving ? 'Guardando...' : 'Añadir al Calendario'}
           </button>
        </div>

      </div>
    </div>
  )
}
