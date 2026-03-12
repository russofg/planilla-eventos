import { useState, useEffect } from "react"
import { Modal } from "../ui/Modal"
import { addDoc, collection, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { COLLECTIONS } from "../../hooks/useFirestore"
import { useAuth } from "../../contexts/AuthContext"

export function EventModal({ isOpen, onClose, eventToEdit = null }) {
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  
  const [formData, setFormData] = useState({
    evento: "",
    fecha: "",
    horaEntrada: "",
    horaSalida: "",
    operacion: false,
    feriado: false
  })

  // Pre-fill form if editing
  useEffect(() => {
    if (eventToEdit) {
      setFormData({
        evento: eventToEdit.evento || "",
        fecha: eventToEdit.fecha || "",
        horaEntrada: eventToEdit.horaEntrada || "",
        horaSalida: eventToEdit.horaSalida || "",
        operacion: eventToEdit.operacion || false,
        feriado: eventToEdit.feriado || false
      })
    } else {
      setFormData({
        evento: "",
        fecha: new Date().toISOString().split("T")[0],
        horaEntrada: "",
        horaSalida: "",
        operacion: false,
        feriado: false
      })
    }
  }, [eventToEdit, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const eventNameClean = formData.evento.trim()
    
    if (eventNameClean.length < 3) {
      setError("El nombre del evento debe tener al menos 3 caracteres.")
      setLoading(false)
      return
    }

    try {
      const payload = {
        ...formData,
        evento: eventNameClean,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        updatedAt: serverTimestamp()
      }

      if (eventToEdit) {
        // Update existing event
        const eventRef = doc(db, COLLECTIONS.EVENTOS, eventToEdit.id)
        await updateDoc(eventRef, payload)
      } else {
        // Create new event
        payload.createdAt = serverTimestamp()
        await addDoc(collection(db, COLLECTIONS.EVENTOS), payload)
      }
      onClose()
    } catch (err) {
      console.error("Error saving event:", err)
      setError("Ocurrió un error al guardar el evento.")
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }))
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={eventToEdit ? "Editar Evento" : "Añadir Nuevo Evento"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Nombre del Evento</label>
          <input
            type="text"
            name="evento"
            value={formData.evento}
            onChange={handleChange}
            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--primary)] transition-colors"
            placeholder="Ej. Casamiento Pablo y Laura"
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
            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--primary)] transition-colors [color-scheme:dark]"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Hora Entrada</label>
            <input
              type="time"
              name="horaEntrada"
              value={formData.horaEntrada}
              onChange={handleChange}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--primary)] transition-colors [color-scheme:dark]"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Hora Salida</label>
            <input
              type="time"
              name="horaSalida"
              value={formData.horaSalida}
              onChange={handleChange}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--primary)] transition-colors [color-scheme:dark]"
              required
            />
          </div>
        </div>

        <div className="flex gap-6 pt-2">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative flex items-center justify-center">
              <input
                type="checkbox"
                name="operacion"
                checked={formData.operacion}
                onChange={handleChange}
                className="peer sr-only"
              />
              <div className="w-5 h-5 border-2 border-white/30 rounded bg-black/50 peer-checked:border-[var(--primary)] peer-checked:bg-[var(--primary)] transition-colors"></div>
              <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 14 10" fill="none">
                <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">Es Operación</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative flex items-center justify-center">
              <input
                type="checkbox"
                name="feriado"
                checked={formData.feriado}
                onChange={handleChange}
                className="peer sr-only"
              />
              <div className="w-5 h-5 border-2 border-white/30 rounded bg-black/50 peer-checked:border-yellow-500 peer-checked:bg-yellow-500 transition-colors"></div>
              <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 14 10" fill="none">
                <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">Es Feriado</span>
          </label>
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
            className="flex-1 py-3 px-4 rounded-xl bg-[var(--primary)] text-white font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors shadow-lg shadow-blue-500/25"
          >
            {loading ? "Guardando..." : "Guardar Evento"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
