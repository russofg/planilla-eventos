import { useState, useRef, useEffect } from "react"
import { useFirestore } from "../hooks/useFirestore"
import { doc, setDoc } from "firebase/firestore"
import { db } from "../lib/firebase"
import { COLLECTIONS } from "../hooks/useFirestore"
import { useAuth } from "../contexts/AuthContext"
import { Moon, Save, User, Camera, Upload } from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

export default function Settings() {
  const { sueldoFijo, userPrefs, loading: firestoreLoading, tarifasGlobales } = useFirestore()
  const { currentUser } = useAuth()
  
  const [localName, setLocalName] = useState("")
  const [localAvatar, setLocalAvatar] = useState("")
  const [localSueldo, setLocalSueldo] = useState("")
  
  const [localTarifaFin, setLocalTarifaFin] = useState("")
  const [localTarifaOperacion, setLocalTarifaOperacion] = useState("")
  const [localTarifaHoraExtra, setLocalTarifaHoraExtra] = useState("")

  const [isSaving, setIsSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState("")
  const fileInputRef = useRef(null)

  const container = useRef()

  useEffect(() => {
    if (!firestoreLoading) {
      setLocalName(userPrefs?.nombre || "")
      setLocalAvatar(userPrefs?.avatar || "")
      setLocalSueldo(sueldoFijo.toString())
      if (tarifasGlobales) {
        setLocalTarifaFin(tarifasGlobales.tarifaFin?.toString() || "0")
        setLocalTarifaOperacion(tarifasGlobales.tarifaOperacion?.toString() || "0")
        setLocalTarifaHoraExtra(tarifasGlobales.tarifaHoraExtra?.toString() || "0")
      }
    }
  }, [sueldoFijo, userPrefs, firestoreLoading, tarifasGlobales])

  useGSAP(() => {
    gsap.from(".settings-panel", {
      y: 30,
      opacity: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: "power3.out",
      clearProps: "all"
    })
  }, { scope: container })

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLocalAvatar(reader.result);
      };
      // Reduce logic needed if file is huge, but assuming regular avatars here
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = async () => {
    const nameClean = localName.trim()
    if (!nameClean && !localAvatar) {
       setIsSaving(false)
       return
    }

    try {
      const prefDocRef = doc(db, COLLECTIONS.USER_PREFS, currentUser.uid)
      await setDoc(prefDocRef, { 
        nombre: nameClean, 
        avatar: localAvatar 
      }, { merge: true })
      setSuccessMsg("Perfil actualizado correctamente.")
      setTimeout(() => setSuccessMsg(""), 3000)
    } catch (error) {
      console.error("Error saving profile:", error)
      alert("Error al actualizar perfil.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveSueldo = async () => {
    const parsedSueldo = parseFloat(localSueldo)
    if (isNaN(parsedSueldo) || parsedSueldo < 0) {
      alert("El sueldo debe ser un número válido mayor o igual a 0.")
      setIsSaving(false)
      return
    }

    try {
      const prefDocRef = doc(db, COLLECTIONS.USER_PREFS, currentUser.uid)
      await setDoc(prefDocRef, { sueldoFijo: parsedSueldo }, { merge: true })
      setSuccessMsg("Sueldo guardado correctamente.")
      setTimeout(() => setSuccessMsg(""), 3000)
    } catch (error) {
      console.error("Error saving preferences:", error)
      alert("Error al guardar preferencias.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveTarifas = async () => {
    const tFin = parseFloat(localTarifaFin)
    const tOp = parseFloat(localTarifaOperacion)
    const tHE = parseFloat(localTarifaHoraExtra)

    if (isNaN(tFin) || tFin < 0 || isNaN(tOp) || tOp < 0 || isNaN(tHE) || tHE < 0) {
      alert("Todas las tarifas deben ser números positivos.")
      setIsSaving(false)
      return
    }

    try {
      const configDocRef = doc(db, COLLECTIONS.CONFIG, "tarifas")
      await setDoc(configDocRef, {
        tarifaFin: tFin,
        tarifaOperacion: tOp,
        tarifaHoraExtra: tHE,
        tarifaComun: tarifasGlobales?.tarifaComun || 11000 // preserve original unused var
      }, { merge: true })
      setSuccessMsg("Tarifas globales guardadas exitosamente.")
      setTimeout(() => setSuccessMsg(""), 3000)
    } catch (error) {
      console.error("Error saving tarifas:", error)
      alert("Error al guardar las tarifas.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6" ref={container}>
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Ajustes</h1>
      </div>
      
      {/* Profiler block */}
      <div className="settings-panel glass-card rounded-2xl p-6 max-w-2xl flex flex-col md:flex-row items-start md:items-center gap-6 mb-6">
         <div className="relative group shrink-0">
           {localAvatar ? (
             <img src={localAvatar} alt="Profile" className="w-20 h-20 rounded-full object-cover border-2 border-[var(--primary)]/50" />
           ) : (
             <div className="w-20 h-20 rounded-full bg-[var(--primary)]/20 flex items-center justify-center border-2 border-[var(--primary)]/50">
               <User className="w-10 h-10 text-[var(--brand-300)]" />
             </div>
           )}
           <button 
             onClick={() => fileInputRef.current.click()}
             className="absolute bottom-0 right-0 p-1.5 bg-blue-600 rounded-full text-white shadow-lg hover:bg-blue-500 transition-colors"
           >
             <Camera className="w-4 h-4" />
           </button>
           <input 
             type="file" 
             ref={fileInputRef} 
             onChange={handleImageUpload} 
             accept="image/*" 
             className="hidden" 
           />
         </div>
         <div className="flex-1 w-full space-y-4">
            <div>
              <p className="text-gray-400 text-sm font-medium mb-1">Nombre para mostrar</p>
              <input 
                type="text" 
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                placeholder={currentUser?.email?.split('@')[0]} 
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--primary)] transition-colors" 
              />
            </div>
            <div>
               <p className="text-gray-500 text-xs">Email: <span className="text-gray-400">{currentUser?.email}</span></p>
            </div>
         </div>
         <div className="self-end md:self-center w-full md:w-auto mt-2 md:mt-0">
            <button
              onClick={handleSaveProfile}
              disabled={isSaving || firestoreLoading}
              className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              Guardar Perfil
            </button>
         </div>
      </div>

      <div className="settings-panel glass-card rounded-2xl p-6 max-w-2xl">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
          Preferencias Generales
        </h2>
        
        {successMsg && (
          <div className="mb-4 bg-green-500/10 border border-green-500/50 text-green-400 p-3 rounded-xl text-sm transition-all">
            {successMsg}
          </div>
        )}

        <div className="space-y-4">
          
          <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
            <div className="flex items-start gap-4">
               <div className="p-2 bg-gray-800 rounded-lg text-gray-400">
                  <Moon className="w-5 h-5" />
               </div>
               <div>
                 <p className="font-medium">Modo Oscuro</p>
                 <p className="text-sm text-gray-400">El diseño Premium utiliza modo oscuro por defecto.</p>
               </div>
            </div>
            <div className="w-12 h-6 bg-[var(--primary)] rounded-full relative cursor-not-allowed opacity-80">
               <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors gap-4">
             <div>
              <p className="font-medium text-white mb-1">Sueldo Fijo Mensual</p>
              <p className="text-sm text-gray-400">Configura tu salario base recurrente.</p>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">$</span>
              <input 
                type="number" 
                value={localSueldo}
                onChange={(e) => setLocalSueldo(e.target.value)}
                placeholder="Ej. 150000" 
                className="bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-right text-white focus:outline-none focus:border-[var(--primary)] transition-colors w-32" 
              />
              <button
                onClick={handleSaveSueldo}
                disabled={isSaving || firestoreLoading}
                className="p-2 bg-[var(--primary)] hover:bg-blue-600 rounded-lg text-white transition-colors disabled:opacity-50"
                title="Guardar Sueldo Fijo"
              >
                 <Save className="w-5 h-5" />
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Global Tarifas Block */}
      <div className="settings-panel glass-card rounded-2xl p-6 max-w-2xl">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
          Tarifas de Eventos (Global)
        </h2>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors gap-4">
            <div>
              <p className="font-medium text-white mb-1">Horas Extra (Finde/Feriados)</p>
              <p className="text-sm text-gray-400">Monto por cada hora en fin de semana o feriado.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">$</span>
              <input 
                type="number" 
                value={localTarifaFin}
                onChange={(e) => setLocalTarifaFin(e.target.value)}
                className="bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-right text-white focus:outline-none focus:border-[var(--primary)] transition-colors w-32" 
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors gap-4">
            <div>
              <p className="font-medium text-white mb-1">Plus por Operación</p>
              <p className="text-sm text-gray-400">Adicional sumado si el evento es Operación.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">$</span>
              <input 
                type="number" 
                value={localTarifaOperacion}
                onChange={(e) => setLocalTarifaOperacion(e.target.value)}
                className="bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-right text-white focus:outline-none focus:border-[var(--primary)] transition-colors w-32" 
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors gap-4">
            <div>
              <p className="font-medium text-white mb-1">Horas Extra (Día Hábil)</p>
              <p className="text-sm text-gray-400">Fuera del horario base (antes de 10hs o después de 17hs).</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">$</span>
              <input 
                type="number" 
                value={localTarifaHoraExtra}
                onChange={(e) => setLocalTarifaHoraExtra(e.target.value)}
                className="bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-right text-white focus:outline-none focus:border-[var(--primary)] transition-colors w-32" 
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end pt-4 border-t border-white/5">
            <button
               onClick={handleSaveTarifas}
               disabled={isSaving || firestoreLoading}
               className="flex items-center gap-2 px-5 py-2.5 bg-[var(--primary)] hover:bg-blue-600 rounded-xl text-white font-medium transition-colors disabled:opacity-50 shadow-lg shadow-blue-500/25"
            >
               <Save className="w-5 h-5" />
               Aplicar Tarifas
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
