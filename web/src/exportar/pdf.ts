import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { DatosExportacion } from "../api";
import { descargar, fechaES, hhmm, Informe, logoPng, MARCA, prepararInforme, TEXTO_LEGAL, nombreArchivoEquipo } from "./comun";

/* Informe PDF A4 vertical con la identidad de Grupo Arquisocial.
   - Un empleado: su informe.
   - Varios: página de resumen del equipo + un informe por empleado (cada uno con su código y su paginación). */

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const F = "helvetica";
const M = 14;
type Logo = { dataUrl: string; ancho: number; alto: number };

interface Seccion {
  ini: number;
  fin: number;
  titulo: string; // texto de la cabecera reducida
  codigo: string | null;
  generado: string;
  exportadoPor: string | null | undefined;
}

const estiloTabla = {
  theme: "plain" as const,
  margin: { left: M, right: M, top: 18, bottom: 24 },
  styles: { font: F, fontSize: 8.2, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: hex(MARCA.negro), lineColor: hex("#E2E5DF"), lineWidth: { bottom: 0.2 } },
  headStyles: { fillColor: hex(MARCA.verde), textColor: hex("#FFFFFF"), fontStyle: "bold" as const, fontSize: 7.8 },
};

function bandaVerde(doc: jsPDF, logo: Logo, titulo: string, periodo: string) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...hex(MARCA.verde));
  doc.rect(0, 0, W, 30, "F");
  const altoLogo = 12;
  doc.addImage(logo.dataUrl, "PNG", M, 9, (logo.ancho / logo.alto) * altoLogo, altoLogo);
  doc.setTextColor(...hex(MARCA.amarillo));
  doc.setFont(F, "bold");
  doc.setFontSize(9);
  // align:"right" no tiene en cuenta charSpace: se calcula la posición a mano
  const cs = 0.6;
  doc.text(titulo, W - M - doc.getTextWidth(titulo) - cs * (titulo.length - 1), 13.5, { charSpace: cs });
  doc.setTextColor(...hex(MARCA.crema));
  doc.setFont(F, "normal");
  doc.setFontSize(10);
  doc.text(periodo, W - M, 20, { align: "right" });
}

function tituloSeccion(doc: jsPDF, t: string, y: number) {
  doc.setFont(F, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...hex(MARCA.negro));
  doc.text(t, M, y);
}

function kpis(doc: jsPDF, y: number, lista: [string, string, boolean?][]) {
  const W = doc.internal.pageSize.getWidth();
  const gap = 4;
  const kw = (W - 2 * M - gap * (lista.length - 1)) / lista.length;
  lista.forEach(([etq, val, alerta], i) => {
    const x = M + i * (kw + gap);
    doc.setFillColor(...hex(MARCA.verdeClaro));
    doc.roundedRect(x, y, kw, 17, 2, 2, "F");
    doc.setFont(F, "bold");
    doc.setFontSize(13);
    doc.setTextColor(...hex(alerta ? MARCA.rojo : MARCA.verdeOscuro));
    doc.text(val, x + 4, y + 8);
    doc.setFont(F, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...hex(MARCA.gris));
    doc.text(etq, x + 4, y + 13.5);
  });
}

/** Dibuja el informe de un empleado empezando en la página actual. */
function informeEmpleado(doc: jsPDF, d: DatosExportacion, inf: Informe, logo: Logo) {
  const W = doc.internal.pageSize.getWidth();
  bandaVerde(doc, logo, "REGISTRO DE JORNADA", inf.periodo);

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
  fila("Centro / Departamento", inf.centro, W / 2 + 2, y);
  y += 13;

  kpis(doc, y, [
    ["Horas trabajadas", hhmm(inf.totalMinutos) + " h"],
    ["Días con jornada", String(inf.diasTrabajados)],
    ["Media por día", hhmm(inf.mediaMinutos) + " h"],
    ["Días con incidencias", String(inf.numIncidencias), inf.numIncidencias > 0],
  ]);
  y += 25;

  tituloSeccion(doc, "Resumen diario", y);
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

  let y2 = (doc as any).lastAutoTable.finalY + 10;
  if (y2 > doc.internal.pageSize.getHeight() - 50) {
    doc.addPage();
    y2 = 26;
  }
  tituloSeccion(doc, "Detalle de fichajes", y2);
  autoTable(doc, {
    ...estiloTabla,
    startY: y2 + 3,
    head: [["Fecha", "Hora", "Tipo", "Ubicación en el momento del fichaje"]],
    body: inf.fichajes.length ? inf.fichajes.map((f) => [fechaES(f.fecha), f.hora, f.tipo, f.ubicacion]) : [["—", "—", "Sin fichajes en el periodo", ""]],
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 16, halign: "center" }, 2: { cellWidth: 32 } },
  });
}

/** Página de resumen del equipo (solo en exportaciones de varios empleados). */
function resumenEquipo(doc: jsPDF, items: { d: DatosExportacion; inf: Informe }[], logo: Logo) {
  const periodo = items[0].inf.periodo;
  bandaVerde(doc, logo, "REGISTRO DE JORNADA · EQUIPO", periodo);
  const total = items.reduce((s, x) => s + x.inf.totalMinutos, 0);
  const conInc = items.filter((x) => x.inf.numIncidencias > 0).length;
  kpis(doc, 38, [
    ["Empleados", String(items.length)],
    ["Horas trabajadas (total)", hhmm(total) + " h"],
    ["Media por empleado", hhmm(Math.round(total / items.length)) + " h"],
    ["Empleados con incidencias", String(conInc), conInc > 0],
  ]);
  tituloSeccion(doc, "Resumen por empleado", 66);
  autoTable(doc, {
    ...estiloTabla,
    startY: 69,
    head: [["Empleado/a", "Centro / Dpto.", "Horas", "Días", "Media", "Incid.", "Código de verificación"]],
    body: items.map(({ d, inf }) => [inf.nombreCompleto, inf.centro, hhmm(inf.totalMinutos), String(inf.diasTrabajados), hhmm(inf.mediaMinutos), String(inf.numIncidencias), d.codigo]),
    foot: [["Total", "", hhmm(total), String(items.reduce((s, x) => s + x.inf.diasTrabajados, 0)), "", String(items.reduce((s, x) => s + x.inf.numIncidencias, 0)), ""]],
    footStyles: { fillColor: hex(MARCA.verdeClaro), textColor: hex(MARCA.verdeOscuro), fontStyle: "bold" },
    showFoot: "lastPage",
    columnStyles: {
      0: { cellWidth: 44, fontStyle: "bold" },
      1: { cellWidth: 40, textColor: hex(MARCA.gris) },
      2: { cellWidth: 16, halign: "center", fontStyle: "bold" },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 15, halign: "center" },
      5: { cellWidth: 13, halign: "center" },
      6: { halign: "center", textColor: hex(MARCA.verdeOscuro), fontSize: 7.6 },
    },
    didParseCell: (h) => {
      if (h.section === "body" && h.column.index === 5 && items[h.row.index].inf.numIncidencias > 0) h.cell.styles.textColor = hex(MARCA.rojo);
    },
  });
  const y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont(F, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...hex(MARCA.gris));
  doc.text("A continuación se incluye el registro de jornada de cada empleado, con su propio código de verificación.", M, y);
}

/** Cabecera reducida en las páginas siguientes de cada sección y pie en todas las páginas. */
function piesYCabeceras(doc: jsPDF, secciones: Seccion[], logo: Logo) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (const s of secciones) {
    const n = s.fin - s.ini + 1;
    for (let p = s.ini; p <= s.fin; p++) {
      doc.setPage(p);
      if (p > s.ini) {
        doc.setFillColor(...hex(MARCA.verde));
        doc.rect(0, 0, W, 12, "F");
        doc.addImage(logo.dataUrl, "PNG", M, 3.2, (logo.ancho / logo.alto) * 5.6, 5.6);
        doc.setFont(F, "normal");
        doc.setFontSize(8);
        doc.setTextColor(...hex(MARCA.crema));
        doc.text(s.titulo, W - M, 7.8, { align: "right" });
      }
      doc.setDrawColor(...hex(MARCA.verde));
      doc.setLineWidth(0.4);
      doc.line(M, H - 19, W - M, H - 19);
      doc.setFont(F, "normal");
      doc.setFontSize(6.6);
      doc.setTextColor(...hex(MARCA.gris));
      doc.text(TEXTO_LEGAL, M, H - 15, { maxWidth: W - 2 * M - 26 });
      let x = M;
      if (s.codigo) {
        doc.setFont(F, "bold");
        doc.setFontSize(7.2);
        doc.setTextColor(...hex(MARCA.verdeOscuro));
        const t = `Código de verificación: ${s.codigo}`;
        doc.text(t, M, H - 7.5);
        x = M + doc.getTextWidth(t) + 4;
      }
      doc.setFont(F, "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...hex(MARCA.gris));
      doc.text(`Generado el ${s.generado}${s.exportadoPor ? ` por ${s.exportadoPor}` : ""} · Grupo Arquisocial`, x, H - 7.5);
      doc.text(`Página ${p - s.ini + 1} de ${n}`, W - M, H - 7.5, { align: "right" });
    }
  }
}

export async function exportarPdf(entrada: DatosExportacion | DatosExportacion[]) {
  const lista = Array.isArray(entrada) ? entrada : [entrada];
  if (!lista.length) return;
  const items = lista.map((d) => ({ d, inf: prepararInforme(d) }));
  const equipo = items.length > 1;
  const logo = await logoPng(160);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const periodo = items[0].inf.periodo;
  doc.setProperties({
    title: equipo ? `Registro de jornada · ${items.length} empleados · ${periodo}` : `Registro de jornada · ${items[0].inf.nombreCompleto} · ${periodo}`,
    author: "Grupo Arquisocial",
    creator: "Fichajes · Grupo Arquisocial",
    subject: "Registro de jornada",
  });

  const secciones: Seccion[] = [];
  if (equipo) {
    resumenEquipo(doc, items, logo);
    secciones.push({ ini: 1, fin: doc.getNumberOfPages(), titulo: `Equipo · ${periodo}`, codigo: null, generado: items[0].inf.generado, exportadoPor: lista[0].exportadoPor });
  }
  items.forEach(({ d, inf }) => {
    if (secciones.length) doc.addPage();
    const ini = doc.getNumberOfPages();
    informeEmpleado(doc, d, inf, logo);
    secciones.push({ ini, fin: doc.getNumberOfPages(), titulo: `${inf.nombreCompleto} · ${periodo}`, codigo: d.codigo, generado: inf.generado, exportadoPor: d.exportadoPor });
  });
  piesYCabeceras(doc, secciones, logo);
  const nombre = equipo ? nombreArchivoEquipo(lista[0].desde, lista[0].hasta, items.length) : items[0].inf.nombreArchivo;
  descargar(doc.output("blob"), `${nombre}.pdf`);
}
