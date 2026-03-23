import { useState, useEffect } from "react"
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore"
import { db } from "../lib/firebase"
import { useAuth } from "../contexts/AuthContext"
import { useFirestore } from "../hooks/useFirestore"
import { motion, AnimatePresence } from "framer-motion"
import { Search, Plus, FileText, Download, Calendar as CalendarIcon, Hash, CheckCircle2 } from "lucide-react"
import { FacturacionModal } from "../components/facturacion/FacturacionModal"
import { generateFacturaPdf } from "../utils/generateFacturaPdf"
import { playTickSound, playPopSound } from "../utils/audio"

export default function Facturacion() {
  const { currentUser } = useAuth()
  const { userPrefs } = useFirestore()
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [filterText, setFilterText] = useState("")

  useEffect(() => {
    if (!currentUser) return;

    setLoading(true);
    const facturasRef = collection(db, "facturas");
    // Show user's invoices. If admin, could show all, but we stick to user's for privacy/safety
    const q = query(
      facturasRef,
      where("userId", "==", currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a, b) => {
        const timeA = a.creadoEn?.toMillis ? a.creadoEn.toMillis() : 0;
        const timeB = b.creadoEn?.toMillis ? b.creadoEn.toMillis() : 0;
        return timeB - timeA;
      });
      setFacturas(docs);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching facturas:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleDownloadPDF = async (factura) => {
    playTickSound();
    try {
      // Parsear fecha guardada en Firestore (YYYY-MM-DD -> DD/MM/YYYY)
      const dateParts = factura.fecha.split('-');
      const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : factura.fecha;

      const dataParaPdf = {
        emisor: {
          razonSocial: userPrefs?.razonSocial || "RUSSO FERNANDO GABRIEL",
          domicilioComercial: userPrefs?.domicilio || "187 1152 Piso:1 Dpto:B - Bernal, Buenos Aires",
          condicionIva: userPrefs?.condicionIva || "Responsable Monotributo",
          cuit: userPrefs?.cuit || "23321738729",
          ingresosBrutos: userPrefs?.ingresosBrutos || "23-32173872-9",
          inicioActividades: userPrefs?.inicioActividades || "01/10/2009"
        },
        factura: {
          ptoVenta: factura.puntoDeVenta || factura.ptoVenta || 4,
          compNro: factura.nroComprobante,
          fechaEmision: formattedDate,
          periodoDesde: formattedDate,
          periodoHasta: formattedDate,
          fechaVtoPago: formattedDate
        },
        cliente: {
          cuit: factura.docNroReceptor || factura.docNro || "00000000000",
          razonSocial: factura.razonSocialReceptor || factura.razonSocial || "Consumidor Final",
          condicionIva: factura.condicionIvaReceptor || factura.condicionIva || "Consumidor Final",
          domicilio: factura.domicilioReceptor || factura.domicilio || ""
        },
        items: [
          {
            producto: factura.concepto || "Servicios",
            cantidad: 1,
            uMedida: "unidades",
            precioUnit: factura.importeTotal,
            subtotal: factura.importeTotal
          }
        ],
        totales: {
          subtotal: factura.importeTotal,
          importeTotal: factura.importeTotal
        },
        afip: {
          cae: factura.cae,
          caeVto: factura.caeVencimiento
        }
      };

      const pdfBase64 = await generateFacturaPdf(dataParaPdf);

      // Create download link
      const linkSource = `data:application/pdf;base64,${pdfBase64}`;
      const downloadLink = document.createElement("a");
      const fileName = `Factura_C_${factura.puntoDeVenta.toString().padStart(4, '0')}-${factura.nroComprobante.toString().padStart(8, '0')}.pdf`;
      downloadLink.href = linkSource;
      downloadLink.download = fileName;
      downloadLink.click();
      
      playPopSound();
    } catch (err) {
      console.error("Error al regenerar el PDF:", err);
      alert("Hubo un error al regenerar el PDF de esta factura.");
    }
  };

  const filteredFacturas = facturas.filter(f => 
    f.razonSocialReceptor?.toLowerCase().includes(filterText.toLowerCase()) ||
    f.nroComprobante?.toString().includes(filterText) ||
    f.concepto?.toLowerCase().includes(filterText.toLowerCase())
  );

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight flex items-center gap-3">
            <FileText className="w-8 h-8 text-blue-500" />
            Facturación AFIP
          </h1>
          <p className="text-gray-400 mt-2">Historial de comprobantes emitidos y generación de nuevas facturas C.</p>
        </div>

        <button 
          onClick={() => { playTickSound(); setIsModalOpen(true); }}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3.5 rounded-xl font-medium transition-all shadow-lg shadow-blue-500/20 active:scale-95 whitespace-nowrap"
        >
          <Plus className="w-5 h-5" />
          Nueva Factura C
        </button>
      </div>

      <div className="glass-card p-4 rounded-2xl border border-white/5 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input 
            type="text" 
            placeholder="Buscar por cliente, concepto o número..." 
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-medium"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : filteredFacturas.length === 0 ? (
        <div className="glass-card p-12 rounded-2xl border border-dashed border-white/10 text-center flex flex-col items-center justify-center opacity-80">
          <FileText className="w-16 h-16 text-gray-600 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No hay facturas emitidas</h3>
          <p className="text-gray-400 max-w-md">
            El historial está vacío o no se encontraron comprobantes con esos filtros. Usá el botón "Nueva Factura C" para emitir la primera.
          </p>
        </div>
      ) : (
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid gap-4"
        >
          {filteredFacturas.map((factura) => (
            <motion.div 
              key={factura.id}
              variants={itemVariants}
              className="glass p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors group flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative overflow-hidden"
            >
              {/* Subtle accent line */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-indigo-500" />
              
              <div className="flex-1 min-w-0 pl-2">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h3 className="text-lg font-bold text-white truncate">
                    {factura.razonSocialReceptor}
                  </h3>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aprobada
                  </div>
                </div>
                
                <p className="text-gray-400 text-sm mb-3 truncate">
                  {factura.concepto}
                </p>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Hash className="w-4 h-4" />
                    <span className="font-medium text-gray-300">
                      {factura.puntoDeVenta.toString().padStart(4, '0')} - {factura.nroComprobante.toString().padStart(8, '0')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <CalendarIcon className="w-4 h-4" />
                    <span>{new Date(factura.fecha + 'T12:00:00').toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500" title="CAE Autorizado">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span className="font-mono text-xs text-gray-400">CAE: {factura.cae}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-center gap-4 shrink-0 pl-4 sm:border-l border-white/5">
                <div className="text-xl font-bold text-white">
                  ${factura.importeTotal?.toLocaleString('es-AR')}
                </div>
                
                <button
                  onClick={() => handleDownloadPDF(factura)}
                  className="flex items-center gap-2 text-sm font-medium text-blue-400 hover:text-white bg-blue-500/10 hover:bg-blue-500/20 px-4 py-2 rounded-xl transition-all"
                >
                  <Download className="w-4 h-4" />
                  Descargar PDF
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {isModalOpen && (
        <FacturacionModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
        />
      )}
    </div>
  )
}
