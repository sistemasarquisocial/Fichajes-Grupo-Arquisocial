import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { DatosExportacion } from "../api";
import { descargar, fechaES, hhmm, Informe, logoPng, MARCA, prepararInforme, TEXTO_LEGAL } from "./comun";

/* Informe PDF A4 vertical con la identidad de Grupo Arquisocial. */

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const F = "helvetica";

export async function exportarPdf(d: DatosExportacion) {
  const inf = prepararInforme(d);
  const logo = await logoPng(160);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: `Registro de jornada · ${inf.nombreCompleto} · ${inf.periodo}`, author: "Grupo Arquisocial", creator: "Fichajes · Grupo Arquisocial", subject: "Registro de jornada" });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;

  // ---------- Cabecera (banda verde con logo) ----------
  doc.setFillColor(...hex(MARCA.verde));
  doc.rect(0, 0, W, 30, "F");
  const altoLogo = 12;
  doc.addImage(logo.dataUrl, "PNG", M, 9, (logo.ancho / logo.alto) * altoLogo, altoLogo);
  doc.setTextColor(...hex(MARCA.amarillo));
  doc.setFont(F, "bold");
  doc.setFontSize(9);
  doc.text("REGISTRO DE JORNADA", W - M, 13.5, { align: "right", charSpace: 0.6 });
  doc.setTextColor(...hex(MARCA.crema));
  doc.setFont(F, "normal");
  doc.setFontSize(10);
  doc.text(inf.periodo, W - M, 20, { align: "right" });

  // ---------- Datos del empleado ----------
  let y = 40;
  const fila = (etq: string, val: string, x: number, yy: number) => {
    doc.setFont(F, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...hex(MARCA.gris));
    doc.text(etq.toUpperCase(), x, yy, { charSpace: 0.3 });
    doc.setFont(F, "bold");
    doc.setFontSize(10);
    doc.setTextColor(...hex(MARCA.negro));
    doc.text(val, x, yy + 5, { maxWidth: W / 2 - M - 4 });
  };
  fila("Empleado/a", inf.nombreCompleto, M, y);
  fila("Empresa", d.empleado.empresa, W / 2 + 2, y);
  y += 13;
  fila("Correo electrónico", d.empleado.email, M, y);
  fila("Centro de trabajo", inf.centro, W / 2 + 2, y);
  y += 13;

  // ---------- Indicadores ----------
  const kpis: [string, string][] = [
    ["Horas trabajadas", hhmm(inf.totalMinutos) + " h"],
    ["Días con jornada", String(inf.diasTrabajados)],
    ["Media por día", hhmm(inf.mediaMinutos) + " h"],
    ["Días con incidencias", String(inf.numIncidencias)],
  ];
  const gap = 4;
  const kw = (W - 2 * M - gap * 3) / 4;
  kpis.forEach(([etq, val], i) => {
    const x = M + i * (kw + gap);
    doc.setFillColor(...hex(MARCA.verdeClaro));
    doc.roundedRect(x, y, kw, 17, 2, 2, "F");
    doc.setFont(F, "bold");
    doc.setFontSize(13);
    doc.setTextColor(...hex(i === 3 && inf.numIncidencias ? MARCA.rojo : MARCA.verdeOscuro));
    doc.text(val, x + 4, y + 8);
    doc.setFont(F, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...hex(MARCA.gris));
    doc.text(etq, x + 4, y + 13.5);
  });
  y += 25;

  // ---------- Tabla diaria ----------
  const titulo = (t: string, yy: number) => {
    doc.setFont(F, "bold");
    doc.setFontSize(11);
    doc.setTextColor(...hex(MARCA.negro));
    doc.text(t, M, yy);
  };
  titulo("Resumen diario", y);
  const estiloTabla = {
    theme: "plain" as const,
    margin: { left: M, right: M, top: 18, bottom: 24 },
    styles: { font: F, fontSize: 8.2, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: hex(MARCA.negro), lineColor: hex("#E2E5DF"), lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: hex(MARCA.verde), textColor: hex("#FFFFFF"), fontStyle: "bold" as const, fontSize: 7.8 },
  };
  autoTable(doc, {
    ...estiloTabla,
    startY: y + 3,
    head: [["Fecha", "Día", "Entrada", "Salida", "Pausas", "Trabajado", "Ubicación", "Incidencias"]],
    body: inf.dias.map((x) => [
      fechaES(x.fecha),
      x.diaSemana,
      x.entrada || "—",
      x.salida || "—",
      x.minutosPausa ? hhmm(x.minutosPausa) : "—",
      x.minutosTrabajados ? hhmm(x.minutosTrabajados) : "—",
      x.ubicacion || "—",
      x.incidencias,
    ]),
    foot: [["Total", "", "", "", hhmm(inf.totalPausa), hhmm(inf.totalMinutos), "", ""]],
    footStyles: { fillColor: hex(MARCA.verdeClaro), textColor: hex(MARCA.verdeOscuro), fontStyle: "bold" },
    showFoot: "lastPage",
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 19, textColor: hex(MARCA.gris) },
      2: { cellWidth: 15, halign: "center" },
      3: { cellWidth: 15, halign: "center" },
      4: { cellWidth: 15, halign: "center" },
      5: { cellWidth: 18, halign: "center", fontStyle: "bold" },
      6: { cellWidth: 19, halign: "center" },
      7: { textColor: hex(MARCA.rojo), fontSize: 7.4 },
    },
    didParseCell: (h) => {
      if (h.section !== "body") return;
      const dia = inf.dias[h.row.index];
      if (dia.finDeSemana) h.cell.styles.fillColor = hex(MARCA.grisClaro);
      if (dia.incidencias.startsWith("Jornada en curso") && h.column.index === 7) h.cell.styles.textColor = hex(MARCA.gris);
    },
  });

  // ---------- Detalle de fichajes ----------
  let y2 = (doc as any).lastAutoTable.finalY + 10;
  if (y2 > doc.internal.pageSize.getHeight() - 50) {
    doc.addPage();
    y2 = 40;
  }
  titulo("Detalle de fichajes", y2);
  autoTable(doc, {
    ...estiloTabla,
    startY: y2 + 3,
    head: [["Fecha", "Hora", "Tipo", "Ubicación en el momento del fichaje"]],
    body: inf.fichajes.length ? inf.fichajes.map((f) => [fechaES(f.fecha), f.hora, f.tipo, f.ubicacion]) : [["—", "—", "Sin fichajes en el periodo", ""]],
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 16, halign: "center" }, 2: { cellWidth: 32 } },
  });

  pieYCabecera(doc, inf, d.codigo, logo, M);
  descargar(doc.output("blob"), `${inf.nombreArchivo}.pdf`);
}

/** Pie en todas las páginas y cabecera reducida a partir de la segunda. */
function pieYCabecera(doc: jsPDF, inf: Informe, codigo: string, logo: { dataUrl: string; ancho: number; alto: number }, M: number) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFillColor(...hex(MARCA.verde));
      doc.rect(0, 0, W, 12, "F");
      doc.addImage(logo.dataUrl, "PNG", M, 3.2, (logo.ancho / logo.alto) * 5.6, 5.6);
      doc.setFont(F, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...hex(MARCA.crema));
      doc.text(`${inf.nombreCompleto} · ${inf.periodo}`, W - M, 7.8, { align: "right" });
    }
    doc.setDrawColor(...hex(MARCA.verde));
    doc.setLineWidth(0.4);
    doc.line(M, H - 19, W - M, H - 19);
    doc.setFont(F, "normal");
    doc.setFontSize(6.6);
    doc.setTextColor(...hex(MARCA.gris));
    doc.text(TEXTO_LEGAL, M, H - 15, { maxWidth: W - 2 * M - 26 });
    doc.setFont(F, "bold");
    doc.setFontSize(7.2);
    doc.setTextColor(...hex(MARCA.verdeOscuro));
    doc.text(`Código de verificación: ${codigo}`, M, H - 7.5);
    doc.setFont(F, "normal");
    doc.setTextColor(...hex(MARCA.gris));
    doc.text(`Generado el ${inf.generado} · Grupo Arquisocial`, M + 62, H - 7.5);
    doc.text(`Página ${p} de ${n}`, W - M, H - 7.5, { align: "right" });
  }
}
