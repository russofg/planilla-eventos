import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { calcularPagoEvento } from "./calculations"

export const generatePdf = ({
  events,
  expenses,
  extras,
  sueldoFijo,
  monthTotalEvents,
  monthTotalExpenses,
  monthTotalBonos,
  monthTotalAdelantos,
  monthTotalFinal,
  filterMonth,
  filterYear,
  userEmail,
  tarifasGlobales
}) => {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.width
  const margin = 14
  
  // Premium Color Palette
  const colors = {
    primary: [37, 99, 235],    // elegant blue
    dark: [15, 23, 42],        // deep slate
    textMain: [51, 65, 85],    // slate 700
    textMuted: [100, 116, 139], // slate 500
    success: [22, 163, 74],    // green 600
    danger: [220, 38, 38],     // red 600
    border: [226, 232, 240],   // slate 200
    bgLight: [248, 250, 252]   // slate 50
  }

  // Format Currency Helper
  const formatCur = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount)
  }

  // --- Premium Header ---
  doc.setFillColor(...colors.dark)
  doc.rect(0, 0, pageWidth, 40, 'F')
  
  doc.setFont("helvetica", "bold")
  doc.setFontSize(24)
  doc.setTextColor(255, 255, 255)
  doc.text("Planilla BLS", margin, 20)
  
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(200, 200, 200)
  doc.text("Reporte Mensual", margin, 28)

  doc.setFontSize(9)
  doc.text(`Generado: ${format(new Date(), 'dd MMM yyyy - HH:mm', { locale: es })}`, pageWidth - margin, 20, { align: "right" })
  doc.text(`Usuario: ${userEmail || "Tú"}`, pageWidth - margin, 28, { align: "right" })

  // --- Filtering Info Block ---
  let filterText = "Todos los registros"
  if (filterMonth !== "" || filterYear !== "") {
    const m = filterMonth !== "" ? format(new Date(2024, parseInt(filterMonth), 1), 'MMMM', { locale: es }) : ""
    const y = filterYear !== "" ? filterYear : ""
    filterText = `${m.charAt(0).toUpperCase() + m.slice(1)} ${y}`.trim()
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.setTextColor(...colors.dark)
  doc.text(`Periodo: ${filterText}`, margin, 55)
  
  doc.setDrawColor(...colors.border)
  doc.setLineWidth(0.5)
  doc.line(margin, 58, pageWidth - margin, 58)

  let currentY = 70

  // --- Events Table (Premium Style) ---
  doc.setFontSize(12)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...colors.primary)
  doc.text("Eventos", margin, currentY)
  currentY += 6

  const eventsBody = events.map(evt => {
    const calc = calcularPagoEvento(evt.fecha, evt.horaEntrada, evt.horaSalida, evt.operacion, evt.feriado, tarifasGlobales)
    const dateObj = new Date(evt.fecha + 'T12:00:00')
    return [
      evt.evento,
      format(dateObj, 'dd MMM', { locale: es }).toUpperCase(),
      evt.horaEntrada,
      evt.horaSalida,
      evt.operacion ? "Sí" : "-",
      calc.horasExtra > 0 ? calc.horasExtra.toString() : "-",
      formatCur(calc.pagoTotalEvento)
    ]
  })

  autoTable(doc, {
    startY: currentY,
    head: [['Evento', 'Fecha', 'Ingreso', 'Salida', 'Operación', 'H. Extra', 'Monto']],
    body: eventsBody,
    theme: 'grid',
    headStyles: {
      fillColor: colors.bgLight,
      textColor: colors.dark,
      fontStyle: 'bold',
      lineColor: colors.border,
      lineWidth: 0.1
    },
    bodyStyles: {
      textColor: colors.textMain,
      lineColor: colors.border,
      lineWidth: 0.1
    },
    alternateRowStyles: {
      fillColor: [252, 252, 252]
    },
    styles: {
      fontSize: 9,
      cellPadding: 5,
      halign: 'left'
    },
    columnStyles: {
      6: { halign: 'right', fontStyle: 'bold', textColor: colors.success }
    }
  })

  currentY = doc.lastAutoTable.finalY + 15

  // --- Expenses Table (Premium Style) ---
  doc.setFontSize(12)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...colors.danger)
  doc.text("Gastos", margin, currentY)
  currentY += 6

  const expensesBody = expenses.map(gasto => {
    const dateObj = new Date(gasto.fecha + 'T12:00:00')
    return [
      gasto.descripcion,
      format(dateObj, 'dd MMM', { locale: es }).toUpperCase(),
      `+${formatCur(gasto.monto)}`
    ]
  })

  autoTable(doc, {
    startY: currentY,
    head: [['Descripción del Gasto', 'Fecha', 'Monto Debit.']],
    body: expensesBody,
    theme: 'grid',
    headStyles: {
      fillColor: colors.bgLight,
      textColor: colors.dark,
      fontStyle: 'bold',
      lineColor: colors.border,
      lineWidth: 0.1
    },
    bodyStyles: {
      textColor: colors.textMain,
      lineColor: colors.border,
      lineWidth: 0.1
    },
    alternateRowStyles: {
      fillColor: [252, 252, 252]
    },
    styles: {
      fontSize: 9,
      cellPadding: 5
    },
    columnStyles: {
      2: { halign: 'right', fontStyle: 'bold', textColor: colors.danger }
    }
  })

  currentY = doc.lastAutoTable.finalY + 20

  // --- Premium Summary & Final Total ---
  // Calculate dynamic rows needed for summary
  const summaryRows = [
    { label: "Sueldo Fijo Base:", value: formatCur(sueldoFijo), color: colors.textMain },
    { label: "Total HS extras:", value: ` ${formatCur(monthTotalEvents)}`, color: colors.textMain }
  ];

  if (monthTotalBonos > 0) {
    summaryRows.push({ label: "Bonos:", value: `+${formatCur(monthTotalBonos)}`, color: colors.success });
  }

  summaryRows.push({ label: "Gastos:", value: `+${formatCur(monthTotalExpenses)}`, color: colors.textMain });

  if (monthTotalAdelantos > 0) {
    summaryRows.push({ label: "Adelantos:", value: `-${formatCur(monthTotalAdelantos)}`, color: colors.danger });
  }

  const baseBoxHeight = 45; // Title + Final Total spacing
  const rowHeight = 8;
  const boxHeight = baseBoxHeight + (summaryRows.length * rowHeight);

  if (currentY + boxHeight > doc.internal.pageSize.height) {
    doc.addPage()
    currentY = 20
  }

  // Draw Summary Box
  doc.setFillColor(...colors.bgLight)
  doc.setDrawColor(...colors.border)
  doc.setLineWidth(0.5)
  doc.roundedRect(margin, currentY, pageWidth - (margin * 2), boxHeight, 3, 3, 'FD')

  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...colors.dark)
  doc.text("Resumen", margin + 6, currentY + 10)

  // Subtotals
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  
  let currentSummaryY = currentY + 20;

  summaryRows.forEach(row => {
    doc.setTextColor(...(row.label === "Sueldo Fijo Base:" || row.label === "Total HS extras:" ? colors.textMain : row.color));
    doc.text(row.label, margin + 6, currentSummaryY)
    doc.text(row.value, pageWidth - margin - 6, currentSummaryY, { align: "right" })
    currentSummaryY += rowHeight;
  });

  // Divider line
  doc.setDrawColor(200, 200, 200)
  doc.line(margin + 6, currentSummaryY, pageWidth - margin - 6, currentSummaryY)

  // Total Final
  doc.setFontSize(16)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...colors.dark)
  doc.text("TOTAL FINAL", margin + 6, currentSummaryY + 14)
  
  doc.setTextColor(...colors.primary)
  doc.text(formatCur(monthTotalFinal), pageWidth - margin - 6, currentSummaryY + 14, { align: "right" })

  // Footer branding
  doc.setFontSize(8)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(150, 150, 150)
  doc.text("Planilla BLS - Reporte Generado Automáticamente", pageWidth / 2, doc.internal.pageSize.height - 10, { align: "center" })

  // Save the PDF
  const filename = `Planilla_BLS_${filterText.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`
  doc.save(filename)
}
