import { useState, useEffect } from "react"
import { X, FileText, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { crearFactura, getUltimoComprobante } from "../../services/arcaService"
import { doc, setDoc, Timestamp } from "firebase/firestore"
import { db } from "../../lib/firebase"
import { useAuth } from "../../contexts/AuthContext"
import { generateFacturaPdf } from "../../../src/utils/generateFacturaPdf"

// Tipos de documento receptor
const DOC_TIPOS = [
  { value: 99, label: "Consumidor Final" },
  { value: 80, label: "CUIT" },
  { value: 96, label: "DNI" },
]

export function FacturacionModal({ isOpen, onClose, monthTotal, filterMonth, filterYear }) {
  const { currentUser, userProfile } = useAuth()
  
  // Form state
  const [importe, setImporte] = useState("")
  const [docTipo, setDocTipo] = useState(80)
  const [docNro, setDocNro] = useState("")
  const [razonSocial, setRazonSocial] = useState("")
  const [domicilio, setDomicilio] = useState("")
  const [condicionIva, setCondicionIva] = useState("Consumidor Final")
  const [concepto, setConcepto] = useState("")
  
  // Status state
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState("")
  const [proximoNro, setProximoNro] = useState(null)

  // Prellenar cuando se abre el modal
  useEffect(() => {
    if (isOpen) {
      setImporte(monthTotal?.toString() || "0")
      
      // Generar concepto por defecto
      const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
      const mesNombre = filterMonth !== "" ? meses[parseInt(filterMonth)] : "Mes"
      const año = filterYear || new Date().getFullYear()
      setConcepto(`Servicios - ${mesNombre} ${año}`)
      
      setResultado(null)
      setError("")
      setDocTipo(80)
      setDocNro("")
      setRazonSocial("")
      setDomicilio("")
      setCondicionIva("Consumidor Final")
      
      // Consultar último comprobante
      getUltimoComprobante()
        .then(data => setProximoNro(data.proximoComprobante))
        .catch(() => setProximoNro(null))
    }
  }, [isOpen, monthTotal, filterMonth, filterYear])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setResultado(null)

    const importeNum = parseFloat(importe)
    if (isNaN(importeNum) || importeNum <= 0) {
      setError("El importe debe ser mayor a 0")
      setLoading(false)
      return
    }

    // Validar campos del receptor según tipo de documento
    if (docTipo !== 99) {
      if (!docNro.trim()) {
        setError("Ingresá el número de documento del receptor")
        setLoading(false)
        return
      }
      if (!razonSocial.trim()) {
        setError("Ingresá la razón social del receptor")
        setLoading(false)
        return
      }
    }

    try {
      // Calcular fechaDesde y fechaHasta del período
      const mes = filterMonth !== "" ? parseInt(filterMonth) : new Date().getMonth()
      const año = filterYear ? parseInt(filterYear) : new Date().getFullYear()
      const primerDia = new Date(año, mes, 1)
      const ultimoDia = new Date(año, mes + 1, 0)
      
      const formatYMD = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')

      const result = await crearFactura({
        importeTotal: importeNum,
        docTipo,
        docNro: docTipo === 99 ? '0' : docNro.trim(),
        concepto,
        fechaDesde: formatYMD(primerDia),
        fechaHasta: formatYMD(ultimoDia),
        condicionIvaReceptor: condicionIva, // Nuevo dato RG 5616
      })

      setResultado(result)

      // Guardar en Firestore con los datos completos del receptor
      const facturaId = `${currentUser.uid}_${result.puntoDeVenta}_${result.nroComprobante}`
      await setDoc(doc(db, "facturas", facturaId), {
        userId: currentUser.uid,
        cae: result.cae,
        caeVencimiento: result.caeVencimiento,
        puntoDeVenta: result.puntoDeVenta,
        nroComprobante: result.nroComprobante,
        cbteTipo: 11,
        fecha: new Date().toISOString().slice(0, 10),
        importeTotal: importeNum,
        concepto,
        // Datos del receptor
        docTipoReceptor: docTipo,
        docNroReceptor: docTipo === 99 ? '0' : docNro.trim(),
        razonSocialReceptor: docTipo === 99 ? 'Consumidor Final' : razonSocial.trim(),
        domicilioReceptor: domicilio.trim() || '',
        condicionIvaReceptor: condicionIva,
        // Período
        mesFacturado: `${año}-${(mes + 1).toString().padStart(2, '0')}`,
        resultado: result.resultado,
        creadoEn: Timestamp.now()
      })

    } catch (err) {
      setError(err.message || "Error al crear la factura")
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!resultado) return;

    // Calculamos el mes facturado para pasarlo a la data 
    const mes = filterMonth !== "" ? parseInt(filterMonth) : new Date().getMonth()
    const año = filterYear ? parseInt(filterYear) : new Date().getFullYear()
    const primerDia = new Date(año, mes, 1)
    const ultimoDia = new Date(año, mes + 1, 0)
    
    const formatDate = (d) => d.toLocaleDateString('es-AR')

    const dataPdf = {
      emisor: {
        razonSocial: userProfile?.razonSocial || "RUSSO FERNANDO GABRIEL", // Fallback a datos del mock
        domicilioComercial: userProfile?.domicilio || "187 1152 Piso:1 Dpto:B - Bernal, Buenos Aires",
        condicionIva: userProfile?.condicionIva || "Responsable Monotributo",
        cuit: userProfile?.cuit || "23321738729",
        ingresosBrutos: userProfile?.ingresosBrutos || "23-32173872-9",
        inicioActividades: userProfile?.inicioActividades || "01/10/2009"
      },
      factura: {
        ptoVenta: resultado.puntoDeVenta,
        compNro: resultado.nroComprobante,
        fechaEmision: new Date().toLocaleDateString('es-AR'),
        periodoDesde: formatDate(primerDia),
        periodoHasta: formatDate(ultimoDia),
        fechaVtoPago: new Date().toLocaleDateString('es-AR')
      },
      cliente: {
        cuit: docTipo === 99 ? "00000000000" : docNro,
        razonSocial: docTipo === 99 ? "Consumidor Final" : razonSocial,
        condicionIva: condicionIva,
        domicilio: domicilio || ""
      },
      items: [
        {
          producto: concepto,
          cantidad: 1,
          uMedida: "unidades",
          precioUnit: importe,
          subtotal: importe
        }
      ],
      totales: {
        subtotal: importe,
        importeTotal: importe
      },
      afip: {
        cae: resultado.cae,
        caeVto: resultado.caeVencimiento
      }
    };

    await generateFacturaPdf(dataPdf);
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative w-full max-w-lg bg-[#12141a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Emitir Factura C</h2>
              <p className="text-xs text-gray-500">ARCA • Homologación</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* Resultado exitoso */}
          {resultado && (
            <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-semibold">¡Factura emitida correctamente!</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">CAE:</span>
                  <p className="text-white font-mono text-xs break-all">{resultado.cae}</p>
                </div>
                <div>
                  <span className="text-gray-500">Vencimiento CAE:</span>
                  <p className="text-white font-mono text-xs">{resultado.caeVencimiento}</p>
                </div>
                <div>
                  <span className="text-gray-500">Comprobante Nº:</span>
                  <p className="text-white font-bold">{resultado.puntoDeVenta?.toString().padStart(5,'0')}-{resultado.nroComprobante?.toString().padStart(8,'0')}</p>
                </div>
                <div>
                  <span className="text-gray-500">Importe:</span>
                  <p className="text-green-400 font-bold">${parseFloat(importe).toLocaleString('es-AR')}</p>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Form */}
          {!resultado && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Info bar */}
              {proximoNro && (
                <div className="text-xs text-gray-500 bg-white/5 px-3 py-2 rounded-lg">
                  Próximo comprobante: <span className="text-white font-mono">Nº {proximoNro}</span>
                </div>
              )}

              {/* Importe */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">
                  Importe Total
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={importe}
                    onChange={(e) => setImporte(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-blue-500/50 transition-colors"
                    required
                  />
                </div>
                {monthTotal > 0 && parseFloat(importe) !== monthTotal && (
                  <button
                    type="button"
                    onClick={() => setImporte(monthTotal.toString())}
                    className="mt-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Restaurar total del mes: ${monthTotal.toLocaleString('es-AR')}
                  </button>
                )}
              </div>

              {/* Separador visual - Datos del Receptor */}
              <div className="pt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-white/5" />
                  Datos del Receptor
                  <span className="h-px flex-1 bg-white/5" />
                </p>
              </div>

              {/* Tipo de documento */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">
                  Tipo de Documento
                </label>
                <select
                  value={docTipo}
                  onChange={(e) => {
                    const val = parseInt(e.target.value)
                    setDocTipo(val)
                    if (val === 99) {
                      setDocNro("")
                      setRazonSocial("")
                      setCondicionIva("Consumidor Final")
                    }
                  }}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors [color-scheme:dark]"
                >
                  {DOC_TIPOS.map(dt => (
                    <option key={dt.value} value={dt.value}>{dt.label}</option>
                  ))}
                </select>
              </div>

              {/* CUIT / DNI del receptor */}
              {docTipo !== 99 && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">
                    {docTipo === 80 ? "CUIT del Receptor" : "DNI del Receptor"}
                  </label>
                  <input
                    type="text"
                    value={docNro}
                    onChange={(e) => setDocNro(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder={docTipo === 80 ? "Ej: 20123456789" : "Ej: 32173872"}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                    required
                  />
                </div>
              )}

              {/* Razón Social */}
              {docTipo !== 99 && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">
                    Razón Social / Nombre Completo
                  </label>
                  <input
                    type="text"
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value)}
                    placeholder="Ej: Juan Pérez S.R.L."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                    required
                  />
                </div>
              )}

              {/* Domicilio del receptor */}
              {docTipo !== 99 && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">
                    Domicilio <span className="text-gray-600">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={domicilio}
                    onChange={(e) => setDomicilio(e.target.value)}
                    placeholder="Ej: Av. Corrientes 1234, CABA"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                  />
                </div>
              )}

              {/* Condición IVA */}
              {docTipo !== 99 && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">
                    Condición frente al IVA
                  </label>
                  <select
                    value={condicionIva}
                    onChange={(e) => setCondicionIva(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors [color-scheme:dark]"
                  >
                    <option>Consumidor Final</option>
                    <option>Responsable Inscripto</option>
                    <option>Monotributista</option>
                    <option>Exento</option>
                    <option>IVA Sujeto Exento</option>
                  </select>
                </div>
              )}

              {/* Separador visual - Datos del Comprobante */}
              <div className="pt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-white/5" />
                  Comprobante
                  <span className="h-px flex-1 bg-white/5" />
                </p>
              </div>

              {/* Concepto */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">
                  Concepto / Descripción del Servicio
                </label>
                <input
                  type="text"
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  placeholder="Ej: Servicios - Marzo 2026"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                  required
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors shadow-lg shadow-blue-500/25 mt-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Emitiendo factura...
                  </>
                ) : (
                  <>
                    <FileText className="w-5 h-5" />
                    Emitir Factura C
                  </>
                )}
              </button>
            </form>
          )}

          {/* Close / Download after success */}
          {resultado && (
            <div className="flex flex-col gap-2 mt-2">
              <button
                onClick={handleDownloadPDF}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-semibold py-3.5 rounded-xl transition-colors shadow-lg shadow-green-500/25"
              >
                <FileText className="w-5 h-5" />
                Descargar Factura PDF
              </button>
              <button
                onClick={onClose}
                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-colors font-medium"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
