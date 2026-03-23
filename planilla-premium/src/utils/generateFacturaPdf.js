import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";

/**
 * Genera y descarga el PDF de la Factura C formato ARCA.
 * 
 * @param {Object} data 
 * @param {Object} data.emisor Datos fiscales del emisor
 * @param {Object} data.factura Datos de la factura emitida (número, fechas)
 * @param {Object} data.cliente Datos del receptor de la factura
 * @param {Array}  data.items Detalle de los productos/servicios
 * @param {Object} data.totales Subtotales e importe total
 * @param {Object} data.afip Datos de autorización (CAE, Vto)
 */
export const generateFacturaPdf = async (data) => {
  const { emisor, factura, cliente, items, totales, afip } = data;

  // 1. Inicializar documento A4 (210x297mm)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Utilidades base
  const marginX = 10;
  let cursorY = 10;

  // -- COLORES Y FUENTES --
  doc.setFont("helvetica");
  
  // Helper functions
  const drawLine = (y) => {
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageWidth - marginX, y);
  };
  
  const drawVerticalLine = (x, y1, y2) => {
    doc.setLineWidth(0.3);
    doc.line(x, y1, x, y2);
  };

  const drawBorder = (y1, h) => {
    doc.setLineWidth(0.3);
    doc.rect(marginX, y1, pageWidth - marginX * 2, h);
  };

  // --- HEADER: BORDER PRINCIPAL ---
  const headerHeight = 55;
  drawBorder(cursorY, headerHeight);

  // 1. ORIGINAL (top center, en cajita)
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("ORIGINAL", pageWidth / 2, cursorY + 5, { align: "center" });
  drawLine(cursorY + 8);

  // 2. Divisor vertical (mitad)
  const midX = pageWidth / 2;
  drawVerticalLine(midX, cursorY + 8, cursorY + headerHeight);

  // 3. LETRA C (centro arriba)
  const boxSize = 14;
  const boxX = midX - boxSize / 2;
  const boxY = cursorY + 8;
  doc.setFillColor(255, 255, 255);
  doc.rect(boxX, boxY, boxSize, boxSize, 'FD'); // Caja C
  
  doc.setFontSize(24);
  doc.text("C", midX, boxY + 10, { align: "center" });
  
  doc.setFontSize(6);
  doc.text("COD. 011", midX, boxY + boxSize + 3, { align: "center" });

  // 4. LADO IZQUIERDO (Emisor)
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  const leftX = marginX + 3;
  let lY = cursorY + 18;
  
  // Nombre Emisor
  doc.text(emisor.razonSocial.toUpperCase(), leftX, lY);
  
  lY += 12;
  doc.setFontSize(9);
  doc.text("Razón Social:", leftX, lY);
  doc.setFont("helvetica", "normal");
  doc.text(emisor.razonSocial.toUpperCase(), leftX + 25, lY);

  lY += 7;
  doc.setFont("helvetica", "bold");
  doc.text("Domicilio Comercial:", leftX, lY);
  doc.setFont("helvetica", "normal");
  // Wrap text
  const domLines = doc.splitTextToSize(emisor.domicilioComercial, midX - leftX - 35);
  doc.text(domLines, leftX + 35, lY);

  lY += 7 * domLines.length;
  doc.setFont("helvetica", "bold");
  doc.text("Condición frente al IVA:", leftX, lY);
  doc.setFont("helvetica", "normal");
  doc.text(emisor.condicionIva, leftX + 41, lY);

  // 5. LADO DERECHO (Factura data)
  const rightX = midX + 15;
  let rY = cursorY + 16;
  
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURA", rightX, rY);

  rY += 8;
  doc.setFontSize(9);
  doc.text("Punto de Venta:", rightX, rY);
  doc.setFont("helvetica", "normal");
  // Pad con 0s
  const pVentaFormat = String(factura.ptoVenta).padStart(5, '0');
  const compNroFormat = String(factura.compNro).padStart(8, '0');
  doc.text(pVentaFormat, rightX + 28, rY);
  
  doc.setFont("helvetica", "bold");
  doc.text("Comp. Nro:", rightX + 43, rY);
  doc.setFont("helvetica", "normal");
  doc.text(compNroFormat, rightX + 63, rY);

  rY += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Fecha de Emisión:", rightX, rY);
  doc.setFont("helvetica", "normal");
  doc.text(factura.fechaEmision, rightX + 31, rY);

  rY += 8;
  doc.setFont("helvetica", "bold");
  doc.text("CUIT:", rightX, rY);
  doc.setFont("helvetica", "normal");
  doc.text(emisor.cuit, rightX + 10, rY);

  rY += 5;
  doc.setFont("helvetica", "bold");
  doc.text("Ingresos Brutos:", rightX, rY);
  doc.setFont("helvetica", "normal");
  doc.text(emisor.ingresosBrutos || emisor.cuit, rightX + 28, rY);

  rY += 5;
  doc.setFont("helvetica", "bold");
  doc.text("Fecha de Inicio de Actividades:", rightX, rY);
  doc.setFont("helvetica", "normal");
  doc.text(emisor.inicioActividades || "01/01/2000", rightX + 51, rY);

  cursorY += headerHeight;

  // --- SECCIÓN: PERÍODO ---
  const periodHeight = 8;
  drawBorder(cursorY, periodHeight);
  let cY = cursorY + 5;
  
  doc.setFont("helvetica", "bold");
  doc.text("Período Facturado Desde:", marginX + 3, cY);
  doc.setFont("helvetica", "normal");
  doc.text(factura.periodoDesde || factura.fechaEmision, marginX + 48, cY);
  
  doc.setFont("helvetica", "bold");
  doc.text("Hasta:", marginX + 75, cY);
  doc.setFont("helvetica", "normal");
  doc.text(factura.periodoHasta || factura.fechaEmision, marginX + 88, cY);

  doc.setFont("helvetica", "bold");
  doc.text("Fecha de Vto. para el pago:", marginX + 115, cY);
  doc.setFont("helvetica", "normal");
  doc.text(factura.fechaVtoPago || factura.fechaEmision, marginX + 162, cY);

  cursorY += periodHeight;

  // --- SECCIÓN: DATOS DEL CLIENTE ---
  const clientHeight = 18;
  drawBorder(cursorY, clientHeight);
  cY = cursorY + 6;

  doc.setFont("helvetica", "bold");
  doc.text("CUIT:", marginX + 3, cY);
  doc.setFont("helvetica", "normal");
  doc.text(cliente.cuit, marginX + 15, cY);

  doc.setFont("helvetica", "bold");
  doc.text("Apellido y Nombre / Razón Social:", marginX + 45, cY);
  doc.setFont("helvetica", "normal");
  doc.text(cliente.razonSocial, marginX + 101, cY);

  cY += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Condición frente al IVA:", marginX + 3, cY);
  doc.setFont("helvetica", "normal");
  doc.text(cliente.condicionIva, marginX + 41, cY);

  doc.setFont("helvetica", "bold");
  doc.text("Domicilio:", marginX + 90, cY);
  doc.setFont("helvetica", "normal");
  doc.text(cliente.domicilio, marginX + 107, cY);

  cY += 6;
  // doc.setFont("helvetica", "bold");
  // doc.text("Condición de venta:", marginX + 3, cY);
  // doc.setFont("helvetica", "normal");
  // doc.text(cliente.condicionVenta || "Contado", marginX + 35, cY);

  cursorY += clientHeight + 3;

  // --- TABLA DE ITEMS ---
  const tableData = items.map(item => [
    item.codigo || "",
    item.producto,
    parseFloat(item.cantidad).toFixed(2).replace('.', ','),
    item.uMedida || "unidades",
    parseFloat(item.precioUnit).toFixed(2).replace('.', ','),
    "0,00", // % Bonif
    "0,00", // Imp. Bonif.
    parseFloat(item.subtotal).toFixed(2).replace('.', ',')
  ]);

  autoTable(doc, {
    startY: cursorY,
    head: [['Código', 'Producto / Servicio', 'Cantidad', 'U. Medida', 'Precio Unit.', '% Bonif', 'Imp. Bonif.', 'Subtotal']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [200, 200, 200],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center'
    },
    styles: {
      fontSize: 8,
      textColor: [0, 0, 0],
      cellPadding: 1
    },
    columnStyles: {
      0: { halign: 'center' },
      2: { halign: 'right' },
      3: { halign: 'center' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' }
    },
    margin: { left: marginX, right: marginX }
  });

  cursorY = doc.lastAutoTable.finalY + 5;

  // --- SECCIÓN: TOTALES ---
  // Si la tabla es muy larga, pasar a una nueva página, pero asumimos que entra en la pag 1
  if (cursorY > 220) {
    doc.addPage();
    cursorY = 20;
  }
  
  const totalBoxY = 210; // Fijo al final
  drawBorder(totalBoxY, 25);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  
  const totRightX = pageWidth - marginX - 35;
  const totValueX = pageWidth - marginX - 3;
  
  let ty = totalBoxY + 8;
  doc.text("Subtotal: $", totRightX, ty, { align: "right" });
  doc.text(parseFloat(totales.subtotal).toFixed(2).replace('.', ','), totValueX, ty, { align: "right" });
  
  ty += 7;
  doc.text("Importe Otros Tributos: $", totRightX, ty, { align: "right" });
  doc.text("0,00", totValueX, ty, { align: "right" });
  
  ty += 7;
  doc.text("Importe Total: $", totRightX, ty, { align: "right" });
  doc.setFontSize(11);
  doc.text(parseFloat(totales.importeTotal).toFixed(2).replace('.', ','), totValueX, ty, { align: "right" });


  // --- FOOTER: QR + CAE + ARCA ---
  const footerY = totalBoxY + 35;
  
  // 1. DIBUJAR LOGO ARCA (simulado textualmente en este caso)
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("ARCA", marginX + 35, footerY + 5);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.text("AGENCIA DE RECAUDACIÓN\nY CONTROL ADUANERO", marginX + 35, footerY + 8);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Comprobante Autorizado", marginX + 35, footerY + 16);
  doc.setFontSize(6);
  doc.setFont("helvetica", "italic");
  doc.text("Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación", marginX + 35, footerY + 20);
  
  // 2. Pag X/Y
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Pág. 1/1", pageWidth / 2, footerY + 5, { align: "center" });

  // 3. CAE INFO
  const caeLeftX = pageWidth / 2 + 25;
  doc.text("CAE N°:", caeLeftX, footerY + 5);
  doc.setFont("helvetica", "normal");
  doc.text(String(afip.cae), caeLeftX + 15, footerY + 5);
  
  doc.setFont("helvetica", "bold");
  doc.text("Fecha de Vto. de CAE:", caeLeftX - 23, footerY + 10);
  doc.setFont("helvetica", "normal");
  
  // Formatear vto cae si viene como YYYYMMDD
  let vtoFormateado = afip.caeVto;
  if (vtoFormateado && vtoFormateado.length === 8) {
    vtoFormateado = `${vtoFormateado.slice(6,8)}/${vtoFormateado.slice(4,6)}/${vtoFormateado.slice(0,4)}`;
  }
  doc.text(vtoFormateado, caeLeftX + 15, footerY + 10);


  // 4. GENERAR QR CODE DINÁMICO
  try {
    // Info del QR segun AFIP: url base64 con data JSON
    const qrData = {
      ver: 1,
      fecha: factura.fechaEmision.split('/').reverse().join('-'), // "2026-03-04" 
      cuit: Number(emisor.cuit),
      ptoVta: Number(factura.ptoVenta),
      tipoCmp: 11, // Factura C = 11
      nroCmp: Number(factura.compNro),
      importe: Number(totales.importeTotal),
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 80, // 80=CUIT, 96=DNI, 99=Sin Identificar
      nroDocRec: Number(cliente.cuit),
      tipoCodAut: "E", // E = CAE
      codAut: Number(afip.cae)
    };
    
    // Base64 encode JSON parameter
    const jsonString = JSON.stringify(qrData);
    const base64Data = btoa(jsonString);
    const qrUrl = "https://www.afip.gob.ar/fe/qr/?p=" + base64Data;
    
    // Generar imagen PNG base64
    const qrImage = await QRCode.toDataURL(qrUrl, { margin: 1 });
    
    // Insertar imagen en el PDF 
    // Left: marginX + 2, Top: footerY, size: ~30x30
    doc.addImage(qrImage, 'PNG', marginX + 2, footerY - 5, 28, 28);

  } catch (error) {
    console.warn("No se pudo generar el código QR:", error);
  }

  // Descargar PDF final!
  const filename = `Factura_C_${pVentaFormat}-${compNroFormat}.pdf`;
  doc.save(filename);
};
