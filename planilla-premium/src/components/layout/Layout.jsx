import { Outlet, Link, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { 
  LayoutDashboard, 
  Calendar, 
  CalendarDays,
  Receipt, 
  Settings, 
  LogOut,
  Bell,
  Search,
  Menu,
  ChevronRight,
  ShieldAlert,
  MessageSquare,
  Check
} from "lucide-react"
import { useAuth } from "../../contexts/AuthContext"
import { useFirestore } from "../../hooks/useFirestore"
import { useState, useEffect, useRef } from "react"
import { cn } from "../../utils/cn"
import { subscribeToNotifications, markNotificationAsRead } from "../../services/pushService"
import { ParticlesBackground } from "../ui/Particles"
import { playTickSound } from "../../utils/audio"

export default function Layout() {
  const { logout, currentUser } = useAuth()
  const { userPrefs } = useFirestore()
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768)
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    if (currentUser?.uid) {
      const unsubscribe = subscribeToNotifications(currentUser.uid, (data) => {
        setNotifications(data)
      })
      return () => unsubscribe()
    }
  }, [currentUser])

  const unreadCount = notifications.filter(n => !n.read).length

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/" },
    { icon: CalendarDays, label: "Eventos", href: "/events" },
    { icon: Calendar, label: "Calendario", href: "/calendar" },
    { icon: Receipt, label: "Gastos", href: "/expenses" },
    { icon: Settings, label: "Ajustes", href: "/settings" },
  ]

  // Dynamically add the Admin Panel link if the user has the required permission
  if (currentUser?.role === "admin") {
    navItems.push({ icon: ShieldAlert, label: "Admin VIP", href: "/admin" })
  }

  const pageVariants = {
    initial: { 
      opacity: 0, 
      scale: 0.99,
      y: 10
    },
    animate: { 
      opacity: 1, 
      scale: 1,
      y: 0,
      transition: { 
        duration: 0.4, 
        ease: "easeOut"
      } 
    },
    exit: { 
      opacity: 0, 
      scale: 1.01,
      y: -10,
      transition: { 
        duration: 0.3, 
        ease: "easeIn" 
      } 
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-white overflow-hidden selection:bg-blue-500/30 relative">
      
      {/* 3D WebGL Premium Background */}
      <ParticlesBackground />

      {/* Mobile Sidebar Overlay */}
      <div 
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300",
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar Navigation */}
      <aside 
        className={cn(
          "fixed md:relative z-50 md:z-20 h-full flex flex-col glass border-r-0 border-white/5 transition-all duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0 w-64" : "-translate-x-full w-64 md:translate-x-0 md:w-20"
        )}
      >
        <div className="flex items-center gap-3 p-6 shrink-0 h-20">
          <img src="/app-logo.png" alt="Logo" className="h-10 w-10 object-contain rounded-xl" />
          {sidebarOpen && (
             <span className="font-semibold text-lg tracking-tight whitespace-nowrap overflow-hidden">
               Planilla BLS
             </span>
          )}
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => {
                  playTickSound();
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative",
                  isActive 
                    ? "text-white bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]" 
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
              >
                {isActive && (
                  <motion.div 
                    layoutId="active-nav-indicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r-full"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon className={cn("w-5 h-5 shrink-0 transition-transform duration-200", isActive ? "scale-110 text-blue-400" : "group-hover:scale-110")} />
                {sidebarOpen && <span className="font-medium">{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 shrink-0 border-t border-white/5">
          <button 
            onClick={logout}
            className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 group"
          >
            <LogOut className="w-5 h-5 shrink-0 group-hover:-translate-x-1 transition-transform" />
            {sidebarOpen && <span className="font-medium whitespace-nowrap">Cerrar Sesión</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
        {/* Top Header */}
        <header className="h-20 glass relative z-50 border-b-0 border-white/5 px-4 md:px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 md:gap-4">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
             {/* Bell & Notifications Container */}
             <div className="relative">
               <button 
                 onClick={() => {
                   playTickSound();
                   setNotifOpen(!notifOpen);
                 }}
                 className="relative p-2 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all duration-300"
               >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)] animate-pulse border-2 border-[#121212]" />}
               </button>

               {/* Notifications Popover */}
               <AnimatePresence>
                  {notifOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: 15, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 15, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      className="absolute top-full -right-4 sm:right-0 mt-4 w-[calc(100vw-2rem)] sm:w-[350px] glass-card bg-black/80 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-xl overflow-hidden z-[100] flex flex-col max-h-[60vh] sm:max-h-[450px]"
                    >
                      <div className="p-4 border-b border-white/10 bg-gradient-to-r from-blue-500/10 to-transparent flex items-center justify-between">
                        <h3 className="font-semibold text-white flex items-center gap-2">
                          <Bell className="w-4 h-4 text-blue-400" />
                          Notificaciones
                        </h3>
                        {unreadCount > 0 && <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-medium">{unreadCount} nuevas</span>}
                      </div>
                      
                      <div className="overflow-y-auto pl-2 pr-4 py-2 w-full flex-1 custom-scrollbar">
                         {notifications.length === 0 ? (
                           <div className="p-8 text-center text-gray-500 flex flex-col items-center justify-center">
                             <MessageSquare className="w-8 h-8 mb-3 opacity-20" />
                             <p className="text-sm">No tienes notificaciones nuevas.</p>
                           </div>
                         ) : (
                           notifications.map(n => (
                             <div 
                               key={n.id} 
                               onClick={() => !n.read && markNotificationAsRead(currentUser.uid, n.id)} 
                               className={cn(
                                 "p-4 rounded-2xl mb-2 transition-all duration-300 cursor-pointer border backdrop-blur-md relative group overflow-hidden", 
                                 n.read 
                                   ? 'bg-white/5 border-white/5 opacity-60 hover:opacity-100 hover:bg-white/10' 
                                   : 'bg-gradient-to-br from-blue-500/10 to-indigo-500/5 border-blue-500/20 hover:border-blue-500/40 shadow-[0_4px_20px_rgba(59,130,246,0.05)]'
                               )}
                             >
                               {/* Subtle highlight effect on hover for unread */}
                               {!n.read && <div className="absolute inset-0 bg-blue-400/0 group-hover:bg-blue-400/5 transition-colors duration-300" />}

                               <div className="flex items-start gap-4 mx-auto relative z-10">
                                 <div className={cn(
                                   "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                                   n.read ? "bg-white/10 text-gray-400" : "bg-blue-500/20 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                                 )}>
                                   {n.read ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                                 </div>
                                 <div className="flex-1">
                                   <div className="flex items-start justify-between gap-2">
                                     <h4 className={cn("text-sm leading-tight", n.read ? 'text-gray-300' : 'text-white font-semibold')}>{n.title}</h4>
                                     {!n.read && <span className="w-2 h-2 shrink-0 rounded-full bg-blue-500 mt-1 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
                                   </div>
                                   <p className="text-[13px] text-gray-400 mt-1.5 leading-relaxed">{n.message}</p>
                                   <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mt-3 block">
                                     {n.date && !isNaN(new Date(n.date).getTime()) ? new Date(n.date).toLocaleDateString() : ""}
                                   </span>
                                 </div>
                               </div>
                             </div>
                           ))
                         )}
                      </div>
                    </motion.div>
                  )}
               </AnimatePresence>
             </div>

             <div className="h-8 w-px bg-white/10 mx-1" />
             <Link 
               to="/settings"
               onClick={() => playTickSound()}
               className="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-1 pr-3 rounded-full transition-colors border border-transparent hover:border-white/10 group"
             >
                <img 
                  src={userPrefs?.avatar || `https://ui-avatars.com/api/?name=${currentUser?.email}&background=256af4&color=fff`} 
                  alt="Avatar" 
                  className="w-8 h-8 rounded-full shadow-md object-cover"
                />
                <span className="text-sm font-medium text-gray-300 hidden md:block max-w-[120px] truncate">
                  {userPrefs?.nombre || currentUser?.email?.split('@')[0]}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
             </Link>
          </div>
        </header>

        {/* Scrollable Page Content */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar p-4 md:p-8 perspective-1000">
           <AnimatePresence mode="wait">
             <motion.div
                key={location.pathname}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="w-full max-w-7xl mx-auto origin-top"
             >
                <Outlet />
             </motion.div>
           </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
