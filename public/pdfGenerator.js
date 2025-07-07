// filepath: /Users/fernandogabrielrusso/Desktop/planilla eventos/public/pdfGenerator.js
import { getCurrentUser } from "./config.js";
import { showSuccessToast, showErrorToast } from "./notifications.js";

export async function exportToPDF() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showErrorToast("Debes iniciar sesión para exportar.");
    return;
  }

  // Check if jsPDF and autoTable are loaded
  if (
    typeof window.jspdf === "undefined" ||
    typeof window.jspdf.jsPDF === "undefined"
  ) {
    showErrorToast("Error: La biblioteca jsPDF no está cargada.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  if (typeof doc.autoTable !== "function") {
    showErrorToast("Error: El plugin jsPDF-AutoTable no está cargado.");
    return;
  }

  try {
    // --- Document Setup ---
    doc.setFontSize(18);
    doc.setTextColor(44, 62, 80);
    const today = new Date();
    const formattedDate = today.toLocaleDateString("es-AR");
    const formattedTime = today.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    doc.text("Reporte de Eventos y Gastos", 105, 15, { align: "center" });
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generado el: ${formattedDate} a las ${formattedTime}`, 105, 22, {
      align: "center",
    });

    // --- Filter Info ---
    doc.setFontSize(10);
    doc.setTextColor(44, 62, 80);
    let filterInfo = "Filtros aplicados: ";
    const filterMonthSelect = document.getElementById("filter-month");
    const filterYearSelect = document.getElementById("filter-year");
    const filtroNombreEvento = document.getElementById("filtro-nombre-evento");
    const filtroFechaInicio = document.getElementById("filtro-fecha-inicio");
    const filtroFechaFin = document.getElementById("filtro-fecha-fin");

    const selectedMonth = filterMonthSelect ? filterMonthSelect.value : "all";
    const selectedYear = filterYearSelect ? filterYearSelect.value : "all";
    const nombreEvento = filtroNombreEvento?.value.trim() || "";
    const fechaInicio = filtroFechaInicio?.value || "";
    const fechaFin = filtroFechaFin?.value || "";

    let filtersApplied = false;
    if (selectedMonth !== "all") {
      const meses = [
        "Enero",
        "Febrero",
        "Marzo",
        "Abril",
        "Mayo",
        "Junio",
        "Julio",
        "Agosto",
        "Septiembre",
        "Octubre",
        "Noviembre",
        "Diciembre",
      ];
      filterInfo += `Mes: ${meses[parseInt(selectedMonth) - 1]}, `;
      filtersApplied = true;
    }
    if (selectedYear !== "all") {
      filterInfo += `Año: ${selectedYear}, `;
      filtersApplied = true;
    }
    if (nombreEvento) {
      filterInfo += `Nombre: "${nombreEvento}", `;
      filtersApplied = true;
    }
    if (fechaInicio) {
      filterInfo += `Desde: ${fechaInicio}, `;
      filtersApplied = true;
    }
    if (fechaFin) {
      filterInfo += `Hasta: ${fechaFin}, `;
      filtersApplied = true;
    }

    if (!filtersApplied) {
      filterInfo += "Ninguno (mostrando todos los datos)";
    } else {
      filterInfo = filterInfo.slice(0, -2); // Remove trailing comma and space
    }
    doc.text(filterInfo, 14, 30);

    // --- User Info ---
    doc.setFontSize(11);
    doc.text(`Usuario: ${currentUser.email || "No identificado"}`, 14, 40);

    let yPos = 45; // Initial Y position after user info

    // --- Events Table ---
    const eventosData = [];
    document.querySelectorAll("#eventos-body tr").forEach((row) => {
      const cells = row.cells;
      if (cells.length >= 8 && !row.querySelector('td[colspan="9"]')) {
        // Check for data rows
        eventosData.push([
          cells[0].textContent,
          cells[1].textContent,
          cells[2].textContent,
          cells[3].textContent,
          cells[4].textContent,
          cells[5].textContent,
          cells[6].textContent,
          cells[7].textContent,
        ]);
      }
    });

    if (eventosData.length > 0) {
      doc.setFontSize(14);
      doc.text("Eventos", 14, yPos);
      yPos += 5;
      doc.autoTable({
        startY: yPos,
        head: [
          [
            "Evento",
            "Día",
            "Día Sem.",
            "Entrada",
            "Salida",
            "Oper.",
            "H. Extra",
            "Total",
          ],
        ],
        body: eventosData,
        theme: "striped",
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
        styles: { fontSize: 8, cellPadding: 1.5 }, // Smaller font for tables
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 10 },
          2: { cellWidth: 15 },
          3: { cellWidth: 15 },
          4: { cellWidth: 15 },
          5: { cellWidth: 15 },
          6: { cellWidth: 15 },
          7: { cellWidth: 25, halign: "right" },
        },
        didDrawPage: function (data) {
          // Reset yPos for new page if needed (handled by autoTable)
        },
      });
      yPos = doc.previousAutoTable.finalY + 10;
    } else {
      doc.setFontSize(11);
      doc.text("No hay eventos para el período seleccionado.", 14, yPos);
      yPos += 10;
    }

    // --- Expenses Table ---
    const gastosData = [];
    document.querySelectorAll("#gastos-body tr").forEach((row) => {
      const cells = row.cells;
      if (cells.length >= 2 && !row.querySelector('td[colspan="3"]')) {
        // Check for data rows
        gastosData.push([cells[0].textContent, cells[1].textContent]);
      }
    });

    if (gastosData.length > 0) {
      doc.setFontSize(14);
      doc.text("Gastos", 14, yPos);
      yPos += 5;
      doc.autoTable({
        startY: yPos,
        head: [["Descripción", "Monto"]],
        body: gastosData,
        theme: "striped",
        headStyles: { fillColor: [231, 76, 60], textColor: 255 },
        tableWidth: 145,
        styles: { fontSize: 9, cellPadding: 1.5 },
        columnStyles: {
          0: { cellWidth: 115 },
          1: { cellWidth: 30, halign: "right" },
        },
        didDrawPage: function (data) {
          // Reset yPos for new page if needed
        },
      });
      yPos = doc.previousAutoTable.finalY + 10;
    } else {
      doc.setFontSize(11);
      doc.text("No hay gastos para el período seleccionado.", 14, yPos);
      yPos += 10;
    }

    // --- Summary Section ---
    doc.setFontSize(14);
    doc.text("Resumen", 14, yPos);
    yPos += 7;

    const totalPago =
      document.getElementById("total-pago")?.textContent || "$0";
    const totalHorasExtra =
      document.getElementById("total-horas-extra")?.textContent || "0";
    const totalGastos =
      document.getElementById("total-gastos")?.textContent || "$0";
    const sueldoFijoValue =
      document.getElementById("sueldo-fijo")?.value || "0";
    const sueldoFijoDisplay = `$${parseFloat(
      sueldoFijoValue
    ).toLocaleString()}`;
    const totalFinal =
      document.getElementById("total-final")?.textContent || "$0";

    const resumenData = [
      ["Sueldo Fijo", sueldoFijoDisplay],
      ["Total Eventos", totalPago],
      ["Total Horas Extra", totalHorasExtra],
      ["Total Gastos", totalGastos],
      ["TOTAL FINAL", totalFinal],
    ];

    doc.autoTable({
      startY: yPos,
      body: resumenData,
      theme: "plain",
      tableWidth: 145,
      styles: { fontSize: 11 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 95 },
        1: { halign: "right", cellWidth: 50 },
      },
      didDrawCell: function (data) {
        if (data.row.index === 4) {
          // Highlight the final total row
          doc.setFillColor(230, 230, 230);
          doc.rect(
            data.cell.x,
            data.cell.y,
            data.cell.width,
            data.cell.height,
            "F"
          );
          doc.setFont(undefined, "bold");
          doc.setTextColor(41, 128, 185);
          doc.setFontSize(12);
          // Manually draw text to ensure alignment and style
          doc.text(
            data.cell.text[0],
            data.cell.x + data.cell.padding("left"),
            data.cell.y + data.row.height / 1.5,
            {
              baseline: "middle",
            }
          );
        }
      },
    });

    // --- Footer ---
    const pageCount = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(150);
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.text(
        `Página ${i} de ${pageCount}`,
        105,
        doc.internal.pageSize.height - 10,
        { align: "center" }
      );
    }

    // --- Save PDF ---
    const fileName = `Planilla_Eventos_${
      today.toISOString().split("T")[0]
    }.pdf`;
    doc.save(fileName);
    showSuccessToast(`PDF exportado como ${fileName}`);
  } catch (error) {
    showErrorToast("Error al generar el PDF.");
  }
}
