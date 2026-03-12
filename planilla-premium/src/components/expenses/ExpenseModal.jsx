import { useState, useEffect } from "react"
import { Modal } from "../ui/Modal"
import { addDoc, collection, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { COLLECTIONS } from "../../hooks/useFirestore"
import { useAuth } from "../../contexts/AuthContext"
import { motion } from "framer-motion"

export function ExpenseModal({ isOpen, onClose, expenseToEdit = null }) {
  const { currentUser } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  
  const [formData, setFormData] = useState({
    descripcion: "",
    fecha: "",
    monto: "",
  })
  
  const [isCustomCategory, setIsCustomCategory] = useState(false)
  const presetCategories = ["Nafta", "Comida", "Estacionamiento", "Bono", "General"]

  // Pre-fill form if editing
  useEffect(() => {
    if (expenseToEdit) {
      const isPreset = presetCategories.includes(expenseToEdit.descripcion);
      setFormData({
        descripcion: expenseToEdit.descripcion || "",
        fecha: expenseToEdit.fecha || "",
        monto: expenseToEdit.monto || "",
      })
      setIsCustomCategory(!isPreset);
    } else {
      setFormData({
        descripcion: "Nafta", // Default preset
        fecha: new Date().toISOString().split("T")[0],
        monto: "",
      })
      setIsCustomCategory(false);
    }
  }, [expenseToEdit, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const descClean = formData.descripcion.trim()
    const montoNum = parseFloat(formData.monto)
    
    if (!descClean) {
      setError("La descripción es obligatoria.")
      setLoading(false)
      return
    }

    if (isNaN(montoNum) || montoNum <= 0) {
      setError("El monto debe ser un número mayor a 0.")
      setLoading(false)
      return
    }

    try {
      const payload = {
        descripcion: descClean,
        fecha: formData.fecha,
        monto: montoNum,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        updatedAt: serverTimestamp()
      }

      if (expenseToEdit) {
        // Update existing expense
        const expenseRef = doc(db, COLLECTIONS.GASTOS, expenseToEdit.id)
        await updateDoc(expenseRef, payload)
      } else {
        // Create new expense
        payload.createdAt = serverTimestamp()
        await addDoc(collection(db, COLLECTIONS.GASTOS), payload)
      }
      onClose()
    } catch (err) {
      console.error("Error saving expense:", err)
      setError("Ocurrió un error al guardar el gasto.")
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === "categorySelect") {
       if (value === "Otra") {
         setIsCustomCategory(true);
         setFormData(prev => ({ ...prev, descripcion: "" }));
       } else {
         setIsCustomCategory(false);
         setFormData(prev => ({ ...prev, descripcion: value }));
       }
       return;
    }
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={expenseToEdit ? "Editar Gasto" : "Añadir Nuevo Gasto"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Categoría del Gasto</label>
          <select
            name="categorySelect"
            value={isCustomCategory ? "Otra" : formData.descripcion}
            onChange={handleChange}
            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors [color-scheme:dark] mb-3"
          >
            {presetCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
            {/* If they were editing a custom one that isn't in presets, make sure it's selected as 'Otra' */}
            {expenseToEdit && isCustomCategory && presetCategories.indexOf(expenseToEdit.descripcion) === -1 && (
               <option value="Otra" className="hidden">Otra</option>
            )}
            <option value="Otra">Otra (Escribir manualmente...)</option>
          </select>

          {isCustomCategory && (
            <motion.div 
               initial={{ opacity: 0, height: 0 }}
               animate={{ opacity: 1, height: "auto" }}
               className="mt-2"
            >
              <input
                type="text"
                name="descripcion"
                value={formData.descripcion}
                onChange={handleChange}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors"
                placeholder="Ej. Compra insumos"
                required={isCustomCategory}
              />
            </motion.div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Fecha</label>
          <input
            type="date"
            name="fecha"
            value={formData.fecha}
            onChange={handleChange}
            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors [color-scheme:dark]"
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
             className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors"
             placeholder="Ej. 15000"
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
            className="flex-1 py-3 px-4 rounded-xl bg-red-600/90 text-white font-medium hover:bg-red-600 disabled:opacity-50 transition-colors shadow-lg shadow-red-500/25"
          >
            {loading ? "Guardando..." : "Guardar Gasto"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
