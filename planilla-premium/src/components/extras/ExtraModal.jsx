import { useState, useEffect } from "react"
import { Modal } from "../ui/Modal"
import { addDoc, collection, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { COLLECTIONS } from "../../hooks/useFirestore"
import { useAuth } from "../../contexts/AuthContext"

export function ExtraModal({ isOpen, onClose, extraToEdit = null }) {
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  
  const [formData, setFormData] = useState({
    tipo: "bono", // "bono" | "adelanto"
    descripcion: "",
    fecha: "",
    monto: "",
  })

  // Pre-fill form if editing
  useEffect(() => {
    if (extraToEdit) {
      setFormData({
        tipo: extraToEdit.tipo || "bono",
        descripcion: extraToEdit.descripcion || "",
        fecha: extraToEdit.fecha || "",
        monto: extraToEdit.monto || "",
      })
    } else {
      setFormData({
        tipo: "bono",
        descripcion: "",
        fecha: new Date().toISOString().split("T")[0],
        monto: "",
      })
    }
  }, [extraToEdit, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const payload = {
        tipo: formData.tipo,
        descripcion: formData.descripcion,
        fecha: formData.fecha,
        monto: parseFloat(formData.monto) || 0,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        updatedAt: serverTimestamp()
      }

      if (extraToEdit) {
        const extraRef = doc(db, COLLECTIONS.EXTRAS, extraToEdit.id)
        await updateDoc(extraRef, payload)
      } else {
        payload.createdAt = serverTimestamp()
        await addDoc(collection(db, COLLECTIONS.EXTRAS), payload)
      }
      onClose()
    } catch (err) {
      console.error("Error saving extra:", err)
      setError("Ocurrió un error al guardar el movimiento.")
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const isBono = formData.tipo === "bono"
  const themeColor = isBono ? "emerald" : "orange"
  const themeHex = isBono ? "#10b981" : "#f97316" // corresponding Tailwind hexes for emerald-500 and orange-500

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={extraToEdit ? "Editar Movimiento" : "Añadir Nuevo"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-2">
          <label 
            className={`flex items-center justify-center p-3 rounded-xl border cursor-pointer transition-colors ${
              isBono 
                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" 
                : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/5"
            }`}
          >
            <input 
              type="radio" 
              name="tipo" 
              value="bono" 
              checked={isBono} 
              onChange={handleChange} 
              className="sr-only" 
            />
            <span className="font-semibold text-sm">Bono (Ingreso)</span>
          </label>
          <label 
            className={`flex items-center justify-center p-3 rounded-xl border cursor-pointer transition-colors ${
              !isBono 
                ? "bg-orange-500/20 border-orange-500/50 text-orange-400" 
                : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/5"
            }`}
          >
            <input 
              type="radio" 
              name="tipo" 
              value="adelanto" 
              checked={!isBono} 
              onChange={handleChange} 
              className="sr-only" 
            />
            <span className="font-semibold text-sm">Adelanto (Egreso)</span>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Concepto</label>
          <input
            type="text"
            name="descripcion"
            value={formData.descripcion}
            onChange={handleChange}
            className={`w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-${themeColor}-500 transition-colors`}
            style={{ '--tw-ring-color': themeHex, borderColor: formData.descripcion ? '' : '' }}
            placeholder={isBono ? "Ej. Premio por puntualidad" : "Ej. Adelanto en efectivo"}
            required
          />
        </div>

        <div>
           <label className="block text-sm font-medium text-gray-400 mb-1">Monto ($)</label>
           <input
             type="number"
             step="0.01"
             name="monto"
             value={formData.monto}
             onChange={handleChange}
             className={`w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-${themeColor}-500 transition-colors`}
             placeholder="Ej. 50000"
             required
           />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Fecha</label>
          <input
            type="date"
            name="fecha"
            value={formData.fecha}
            onChange={handleChange}
            className={`w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-${themeColor}-500 transition-colors [color-scheme:dark]`}
            required
          />
        </div>

        <div className="pt-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className={`flex-1 py-3 px-4 rounded-xl text-white font-medium disabled:opacity-50 transition-colors shadow-lg shadow-${themeColor}-500/25`}
            style={{ backgroundColor: themeHex }}
          >
            {loading ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
